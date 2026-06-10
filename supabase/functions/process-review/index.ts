/**
 * process-review — Supabase Edge Function
 *
 * Triggered by a Supabase Database Webhook on INSERT to the review_jobs table.
 * Downloads the PDF from the source URL, uploads it to the Gemini Files API,
 * and generates a physics review. Falls back to text-only if PDF processing fails.
 *
 * Timeout tiers: Free plan = 60s, Pro plan = 150s.
 * Files API approach keeps each step bounded:
 *   PDF download: 2–8s | Upload: 2–8s | Poll ACTIVE: 1–5s | Generate: 5–20s
 *   Typical total: 10–40s — comfortable within 60s free tier.
 *
 * SYSTEM_PROMPT must be kept in sync with:
 *   llmphysics-bot/src/server/action-modules/adversarial-reviewer.ts
 */

const GEMINI_PRIMARY_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const GEMINI_FALLBACK_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';
const GEMINI_UPLOAD_API  = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const GEMINI_FILES_API   = 'https://generativelanguage.googleapis.com/v1beta/files';
const BODY_CHAR_LIMIT    = 8000;

const URL_CONTEXT_PROMPT =
  `You are a URL extraction bot. Visit the provided webpage and locate the direct download link for the primary academic PDF paper.\n\n` +
  `Rules if multiple files exist:\n` +
  `1. Ignore files ending in .zip, .csv, .xlsx, .tar, .png, or .jpg.\n` +
  `2. Prioritize the main manuscript (e.g., "paper.pdf", "manuscript.pdf") over supplementary files, errata, or appendices.\n` +
  `3. If filenames are ambiguous, return the direct link to the largest PDF file.\n\n` +
  `Return ONLY the raw string of the direct download URL. No markdown, no explanation, no choices.`;

// ─── System prompt — keep in sync with adversarial-reviewer.ts ───────────────

const SYSTEM_PROMPT =
  `You are an expert, objective physics peer reviewer evaluating submissions for a Reddit community. Your task is to provide a concise, high-level, and rigorous critique of the provided text.\n\n` +
  `### Output Format Requirements\n` +
  `- **Title**: Begin exactly with: ## Adversarial Review of [Insert Paper Title or Core Topic] — *by [Model Name & version (eg Gemini 3.5 Flash)]*\n` +
  `- **Structure**: Use clean markdown headers, bold bullet points, and inline code blocks for mathematical equations, units, or variables (e.g., \`ρ = m/V\` or \`F_b = ρ × V × g\`).\n` +
  `- **Tone**: Maintain a neutral, robotic, and strictly objective academic tone. Completely omit introductory filler ("Here is my review...") and concluding remarks.\n\n` +
  `### Review Guidelines\n\n` +
  `1. **Core Critique**: Identify and highlight fundamental methodological, mathematical, or structural flaws. Do not parrot generic category names; generate unique, descriptive headers for each specific flaw discovered in the text. Evaluate the paper against:\n` +
  `   - Real-world grounding, quantitative frameworks, and testable predictions.\n` +
  `   - Internal logical consistency and dimensional alignment.\n` +
  `   - Avoidance of "jargon sheen" (using advanced terms like quantum, metrics, or tensors without mathematical backing) or "physics woo" (conflating mathematical abstractions with metaphysical or philosophical concepts).\n` +
  `   - Attempting to solve an artificial or non-existent problem.\n` +
  `   - Numerology: identifying numerical coincidences or pattern-fitted constants and presenting them as physically meaningful without deriving them from first principles or a causal mechanism.\n\n` +
  `2. **Common Misconceptions**: Evaluate if the text commits foundational errors regarding common physics principles.\n` +
  `   - *Strict Rule*: Do not force-fit a misconception. If the author uses a word like "observe" or "theory" correctly or casually, do not manufacture a critique.\n` +
  `   - *Strict Rule*: Never list a misconception simply to state it was absent or missing. If the text does not commit a common misconception, omit this section entirely.\n` +
  `   - Key examples to look out for:\n` +
  `     - *The Observer Effect*: Confusing physical interaction via a measurement apparatus with human consciousness, awareness, or subjective experience.\n` +
  `     - *Theory vs. Hypothesis*: Treating an unverified, speculative conjecture as a scientifically established, tested framework.\n` +
  `     - *Math vs. Metaphor*: Substituting analogy or imagery for mathematical rigor. Metaphor is a legitimate pedagogical tool — the problem arises when a metaphor is constructed first and mathematics is then fitted afterward to justify it, rather than mathematics driving the conclusion. Flag cases where the explanatory chain runs imagery → fitted equation rather than derivation → insight.\n\n` +
  `3. **Technical Feedback**: Correct explicit misunderstandings of standard physics terminology, values, or governing laws (e.g., thermodynamics, conservation laws, field mechanics). Target the logical and structural gaps in the math or definitions provided.\n\n` +
  `4. **Probing Questions**: Conclude the review with 1-2 highly specific, probing questions targeting the foundational mechanics of the author's claims. These must demand explicit operational definitions or verifiable calculations, structured so they cannot be answered by feeding the prompt back into an LLM.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface JobRecord {
  id: string;
  post_id: string;
  pdf_url: string | null;
  title: string | null;
  body: string | null;
}

async function updateJob(
  supabaseUrl: string,
  supabaseKey: string,
  jobId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await fetch(`${supabaseUrl}/rest/v1/review_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

async function callGemini(
  endpoint: string,
  geminiKey: string,
  payload: string,
): Promise<string | null> {
  const res = await fetch(`${endpoint}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!res.ok) {
    console.warn(`Gemini call failed: ${res.status}`);
    return null;
  }
  const data = await res.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

// Uses the post title + body to pick the primary paper PDF from a list of candidates.
// Falls back to largest by size if Gemini can't decide.
async function pickPdfFile<T extends { name: string; size?: number }>(
  files: T[],
  title: string | null,
  body: string | null,
  geminiKey: string,
): Promise<T | null> {
  if (!files.length) return null;
  if (files.length === 1) return files[0];

  const fileList = files
    .map((f, i) => `${i + 1}. "${f.name}"${f.size ? ` (${Math.round(f.size / 1024)}KB)` : ''}`)
    .join('\n');

  const prompt =
    `You are selecting the primary academic paper PDF from a list of files.\n\n` +
    `Post title: ${title ?? '(none)'}\n` +
    `Post body excerpt: ${(body ?? '').slice(0, 500) || '(none)'}\n\n` +
    `Available PDF files:\n${fileList}\n\n` +
    `Return ONLY the number of the file most likely to be the primary paper. ` +
    `Prefer filenames that match the post title or topic. ` +
    `Ignore supplementary materials, appendices, and data files. ` +
    `Return a single integer, nothing else.`;

  try {
    const res = await fetch(`${GEMINI_FALLBACK_API}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 4 },
      }),
    });
    if (res.ok) {
      const data = await res.json() as any;
      const choice = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      const idx = parseInt(choice, 10) - 1;
      if (idx >= 0 && idx < files.length) {
        console.log(`Gemini picked file ${idx + 1}: "${files[idx].name}"`);
        return files[idx];
      }
    }
  } catch (err) {
    console.warn(`pickPdfFile Gemini call failed: ${(err as Error).message}`);
  }

  // Fallback: largest file
  return [...files].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0] ?? null;
}

async function resolveWithUrlContext(url: string, geminiKey: string): Promise<string | null> {
  try {
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: `${URL_CONTEXT_PROMPT}\n\nPage URL: ${url}` }] }],
      tools: [{ url_context: {} }],
      generationConfig: { temperature: 0.0 },
    });
    const res = await fetch(`${GEMINI_FALLBACK_API}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (!res.ok) {
      console.warn(`url_context call failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as any;
    const rawUrl = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawUrl?.startsWith('http')) {
      console.warn(`url_context returned non-URL: ${rawUrl}`);
      return null;
    }
    return rawUrl;
  } catch (err) {
    console.warn(`url_context threw: ${(err as Error).message}`);
    return null;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  let payload: { record: JobRecord };
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const record = payload.record;
  if (!record?.id) return new Response('No record', { status: 400 });

  const { id: jobId, pdf_url: pdfUrl, title, body } = record;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const geminiKey   = Deno.env.get('GEMINI_API_KEY')!;

  // Respond immediately — webhook does not need to wait for processing
  // (Supabase Edge Functions keep running after the response is sent)
  const response = new Response('OK', { status: 200 });

  try {
    await updateJob(supabaseUrl, supabaseKey, jobId, { status: 'processing' });

    let resultText: string | null = null;
    let extractionType: string | null = null;

    // ── PDF path: Files API (resolve URL → download → upload → poll ACTIVE → generate) ──
    // The Files API lets Gemini unpack and index the PDF asynchronously before the
    // generateContent call. This avoids timeout — the heavy work (PDF parsing) is done
    // by the time we ask for the review.
    if (pdfUrl) {
      try {
        // Step 0: Resolve landing pages to a direct PDF download URL.
        console.log('[step0] starting PDF resolution', { pdfUrl });
        let resolvedUrl = pdfUrl;

        // Zenodo records page (e.g. /records/12345) → Zenodo API → first PDF file URL.
        // The Edge Function runs on Supabase — no domain restrictions apply here.
        const zenodoMatch = resolvedUrl.match(/zenodo\.org\/records\/(\d+)(?:\/|$)/);
        if (zenodoMatch && !resolvedUrl.includes('/files/')) {
          const apiRes = await fetch(`https://zenodo.org/api/records/${zenodoMatch[1]}`);
          if (!apiRes.ok) throw new Error(`Zenodo API failed: ${apiRes.status}`);
          const apiData = await apiRes.json() as any;
          const pdfFiles = ((apiData.files as any[]) ?? [])
            .filter((f: any) => (f.key as string)?.toLowerCase().endsWith('.pdf'))
            .map((f: any) => ({ name: f.key as string, size: f.size as number, links: f.links }));
          if (!pdfFiles.length) throw new Error('No PDF files found in Zenodo record');
          const pdfFile = await pickPdfFile(pdfFiles, title, body, geminiKey);
          if (!pdfFile?.links?.self) throw new Error('No download link for Zenodo PDF');
          resolvedUrl = pdfFile.links.self as string;
          console.log(`Zenodo resolved (${pdfFiles.length} PDFs, picked "${pdfFile.name}"): ${resolvedUrl}`);
          extractionType = 'API'; console.log('[step0] extraction_type=API (zenodo)');
        }

        // figshare article page → figshare API → largest PDF download URL.
        const figshareMatch = resolvedUrl.match(/figshare\.com\/articles\/(?:[^\/]+\/)*(\d+)/);
        if (figshareMatch) {
          const apiRes = await fetch(`https://api.figshare.com/v2/articles/${figshareMatch[1]}`);
          if (!apiRes.ok) throw new Error(`figshare API failed: ${apiRes.status}`);
          const apiData = await apiRes.json() as any;
          const pdfFiles = ((apiData.files as any[]) ?? [])
            .filter((f: any) => (f.name as string)?.toLowerCase().endsWith('.pdf'))
            .map((f: any) => ({ name: f.name as string, size: f.size as number, download_url: f.download_url as string }));
          if (!pdfFiles.length) throw new Error('No PDF files found in figshare article');
          const pdfFile = await pickPdfFile(pdfFiles, title, body, geminiKey);
          if (!pdfFile?.download_url) throw new Error('No download_url for figshare PDF');
          resolvedUrl = pdfFile.download_url as string;
          console.log(`figshare resolved (${pdfFiles.length} PDFs, picked "${pdfFile.name}"): ${resolvedUrl}`);
          extractionType = 'API'; console.log('[step0] extraction_type=API (figshare)');
        }

        // arXiv abstract page → PDF page
        if (resolvedUrl.includes('arxiv.org/abs/')) {
          resolvedUrl = resolvedUrl.replace('arxiv.org/abs/', 'arxiv.org/pdf/');
          console.log(`arXiv resolved: ${resolvedUrl}`);
          extractionType = 'URL'; console.log('[step0] extraction_type=URL (arxiv)');
        }

        // viXra abstract page → PDF page (same pattern as arXiv)
        if (resolvedUrl.includes('vixra.org/abs/')) {
          resolvedUrl = resolvedUrl.replace('vixra.org/abs/', 'vixra.org/pdf/') + '.pdf';
          console.log(`viXra resolved: ${resolvedUrl}`);
          extractionType = 'URL'; console.log('[step0] extraction_type=URL (vixra)');
        }

        // url_context fallback — ONLY for landing pages no prior resolver handled.
        // A non-null extractionType means Zenodo/figshare (API) or arxiv/vixra (URL)
        // already resolved a direct download link. Those links end in /content or
        // /files/<id> (not .pdf), so without the !extractionType guard this block would
        // clobber a good API/URL resolution with a Gemini guess and mislabel it 'Gemini'.
        if (!extractionType && !resolvedUrl.toLowerCase().endsWith('.pdf') && !resolvedUrl.includes('arxiv.org/pdf/')) {
          const extracted = await resolveWithUrlContext(resolvedUrl, geminiKey);
          if (extracted) {
            console.log(`url_context resolved: ${resolvedUrl} → ${extracted}`);
            resolvedUrl = extracted;
            extractionType = 'Gemini'; console.log('[step0] extraction_type=Gemini (url_context)');
          } else {
            console.warn(`url_context found no PDF URL for: ${resolvedUrl}`);
          }
        }

        // Step 1: Download PDF bytes
        console.log('[step1] downloading PDF', { resolvedUrl });
        const pdfRes = await fetch(resolvedUrl);
        if (!pdfRes.ok) throw new Error(`[step1] PDF download failed: ${pdfRes.status} from ${resolvedUrl}`);
        const pdfBytes = await pdfRes.arrayBuffer();
        console.log(`[step1] PDF downloaded: ${pdfBytes.byteLength} bytes from ${resolvedUrl}`);

        // Step 2: Upload to Gemini Files API
        console.log('[step2] uploading to Files API', { bytes: pdfBytes.byteLength });
        const uploadRes = await fetch(`${GEMINI_UPLOAD_API}?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf', 'X-Goog-Upload-Protocol': 'raw' },
          body: pdfBytes,
        });
        if (!uploadRes.ok) throw new Error(`Files API upload failed: ${uploadRes.status}`);
        const uploadData = await uploadRes.json() as any;
        const fileUri   = uploadData.file?.uri as string | undefined;
        const fileName  = uploadData.file?.name as string | undefined;
        let   fileState = uploadData.file?.state as string | undefined;

        if (!fileUri || !fileName) {
          throw new Error(
            '[step2] Files API upload returned no fileUri/fileName — response: ' +
            JSON.stringify(uploadData)
          );
        }
        console.log('[step2] file uploaded', { fileName, fileState });

        // Step 3: Poll until ACTIVE (Gemini indexes the PDF asynchronously; usually instant)
        const fileId = fileName.split('/').pop()!;
        console.log('[step3] polling file state', { fileName });
        for (let i = 0; i < 3 && fileState === 'PROCESSING'; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const stateRes = await fetch(`${GEMINI_FILES_API}/${fileId}?key=${geminiKey}`);
          if (stateRes.ok) {
            fileState = ((await stateRes.json()) as any).state;
            console.log('[step3] poll', { attempt: i + 1, fileState });
          }
        }
        if (fileState !== 'ACTIVE') throw new Error('[step3] File not ACTIVE after polling: ' + fileState);

        // Step 4: generateContent — PDF already indexed, this is fast
        console.log('[step4] calling generateContent with file_data', { fileUri });
        const buildPdfPayload = (model: string) => JSON.stringify({
          contents: [{ parts: [
            { text: `Your model designation for the title is: ${model}` },
            { file_data: { mime_type: 'application/pdf', file_uri: fileUri } },
          ] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { temperature: 0.6 },
        });

        let model = 'Gemini 3.5 Flash (PDF)';
        resultText = await callGemini(GEMINI_PRIMARY_API, geminiKey, buildPdfPayload(model));
        if (!resultText) {
          model = 'Gemini 3.1 Flash Lite (PDF)';
          resultText = await callGemini(GEMINI_FALLBACK_API, geminiKey, buildPdfPayload(model));
        }
        if (resultText) {
          // Gemini tends to drop the "(PDF)" suffix from the designation despite the instruction.
          // Force the correct model string into the title line.
          resultText = resultText.replace(/— \*by ([^*]+)\*/, `— *by ${model}*`);
          console.log('[step4] PDF review generated', { model });
        }

      } catch (err) {
        console.warn('PDF path failed — falling back to text-only:', {
          step: (err as Error).message.match(/^\[step\d\]/)?.[0] ?? 'unknown',
          message: (err as Error).message,
          stack: (err as Error).stack,
        });
      }
    }

    // ── Text-only fallback ────────────────────────────────────────────────────
    if (!resultText) {
      const truncatedBody = (body ?? '').slice(0, BODY_CHAR_LIMIT);
      const buildTextPayload = (model: string) => JSON.stringify({
        contents: [{ parts: [{ text:
          `${SYSTEM_PROMPT}\n\nYour model designation for the title is: ${model}\n\n---\n\nPost title: ${title ?? '(no title)'}\n\nPost body:\n${truncatedBody || '(no body — title only)'}`
        }] }],
        generationConfig: { temperature: 0.6 },
      });

      let model = 'Gemini 3.5 Flash';
      resultText = await callGemini(GEMINI_PRIMARY_API, geminiKey, buildTextPayload(model));
      if (!resultText) {
        model = 'Gemini 3.1 Flash Lite';
        resultText = await callGemini(GEMINI_FALLBACK_API, geminiKey, buildTextPayload(model));
      }
      if (resultText) console.log(`Text-only review generated via ${model}`);
    }

    if (resultText) {
      await updateJob(supabaseUrl, supabaseKey, jobId, {
        status: 'done',
        result: resultText,
        extraction_type: extractionType,
      });
      console.log(`Job ${jobId} done`);
    } else {
      await updateJob(supabaseUrl, supabaseKey, jobId, { status: 'failed', error: 'Empty response from Gemini' });
      console.warn(`Job ${jobId} failed — empty Gemini response`);
    }

  } catch (err) {
    const message = (err as Error).message;
    console.error(`Job ${jobId} threw:`, message);
    await updateJob(supabaseUrl, supabaseKey, jobId, { status: 'failed', error: message });
  }

  return response;
});
