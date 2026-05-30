import { logger } from './log-helper';

const log = logger('paper-fetch-helper');

const GEMINI_PRIMARY_API  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const GEMINI_FALLBACK_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

const URL_CONTEXT_PROMPT =
  `You are a URL extraction bot. Visit the provided webpage and locate the direct download link for the primary academic PDF paper.\n\n` +
  `Rules if multiple files exist:\n` +
  `1. Ignore files ending in .zip, .csv, .xlsx, .tar, .png, or .jpg.\n` +
  `2. Prioritize the main manuscript (e.g., "paper.pdf", "manuscript.pdf") over supplementary files, errata, or appendices.\n` +
  `3. If filenames are ambiguous, return the direct link to the largest PDF file.\n\n` +
  `Return ONLY the raw string of the direct download URL. No markdown, no explanation, no choices.`;

async function fetchWithLogging(url: string, options: RequestInit = {}): Promise<Response> {
  const startTime = Date.now();
  const logInfo = {
    url,
    method: options.method || 'GET',
    requestUrl: url.includes('key=') ? url.substring(0, url.indexOf("key=") + 4) + '***' : url,
  };

  log.info('FETCH START', logInfo);
  try {
    const res = await fetch(url, options);
    const duration = Date.now() - startTime;
    const responseInfo = { ...logInfo, status: res.status, duration };
    log.info('FETCH END', responseInfo);
    if (!res.ok) {
      log.warn('Fetch request failed', responseInfo);
    }
    return res;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('Fetch threw an error', { ...logInfo, error: (error as Error).message, duration });
    throw error;
  }
}

/**
 * Uses Gemini 3.1 Flash Lite with the url_context tool to extract the direct
 * PDF download URL from a landing page.
 * Google's servers visit the URL — no Devvit sandbox HTTP permission needed.
 */
async function resolveWithUrlContext(url: string, apiKey: string): Promise<string | null> {
  try {
    const payload = {
      contents: [{
        parts: [{ text: `${URL_CONTEXT_PROMPT}\n\nPage URL: ${url}` }],
      }],
      tools: [{ url_context: {} }],
      generationConfig: { temperature: 0.0 },
    };

    const res = await fetchWithLogging(`${GEMINI_FALLBACK_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      log.warn('URL context call failed', { url, status: res.status });
      return null;
    }

    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const rawUrl = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawUrl) return null;

    if (!rawUrl.startsWith('http')) {
      log.warn('URL context returned non-URL', { url, rawUrl });
      return null;
    }

    log.info('URL context resolved PDF URL', { inputUrl: url, pdfUrl: rawUrl });
    return rawUrl;
  } catch (err) {
    log.warn('URL context threw', { url, error: (err as Error).message });
    return null;
  }
}

/**
 * Resolves a post URL to a direct PDF URL.
 * - arxiv /abs/ links are transformed locally (deterministic, no network call).
 * - Direct .pdf links are returned as-is.
 * - Everything else (zenodo, ResearchGate, university pages, etc.) is resolved
 *   by Gemini visiting the landing page via the url_context tool.
 */
async function resolvePdfUrl(url: string, apiKey: string): Promise<string | null> {
  if (url.includes('arxiv.org/abs/')) {
    // e.g. arxiv.org/abs/2401.12345 → arxiv.org/pdf/2401.12345.pdf
    return url.replace('/abs/', '/pdf/') + '.pdf';
  }

  if (url.toLowerCase().endsWith('.pdf')) {
    return url;
  }

  // Landing pages — Gemini visits the page and extracts the direct PDF URL.
  // Google's infrastructure fetches the external domain; Devvit only calls googleapis.com.
  return resolveWithUrlContext(url, apiKey);
}

/**
 * Resolves a post URL to a direct PDF URL.
 * Returns the URL string (not bytes) — Gemini fetches the PDF itself via file_data.
 *
 * Other modules chain this with callGeminiWithPdf.
 */
export async function getPaperFromUrl(url: string, apiKey: string): Promise<string | null> {
  const pdfUrl = await resolvePdfUrl(url, apiKey);
  if (!pdfUrl) {
    log.info('No PDF URL resolvable', { url });
    return null;
  }
  log.info('PDF URL resolved', { url, pdfUrl });
  return pdfUrl;
}

/**
 * Sends a PDF to Gemini via file_data.file_uri.
 * Google's infrastructure fetches the PDF from the external URL — no base64
 * conversion or in-Devvit download required.
 *
 * The caller supplies the system prompt — the helper stays policy-neutral.
 * Returns { text, model } on success, null on failure.
 */
export async function callGeminiWithPdf(
  pdfUri: string,
  apiKey: string,
  systemPrompt: string,
): Promise<{ text: string; model: string } | null> {
  // Strip query parameters — file_data expects a clean direct-stream URL
  const cleanUri = pdfUri.split('?')[0];

  const buildPayload = (model: string) => JSON.stringify({
    contents: [{
      parts: [
        { text: `Please review the paper at the following URL according to your instructions. Your model designation for the title is: ${model}\n\nPaper URL: ${cleanUri}` },
      ],
    }],
    tools: [{ url_context: {} }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.0 },
  });

  const opts = (payload: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });

  try {
    let model = 'Gemini 3.5 Flash (PDF)';
    let res = await fetchWithLogging(`${GEMINI_PRIMARY_API}?key=${apiKey}`, opts(buildPayload(model)));
    if (res.status === 429) {
      log.info('Gemini 3.5 PDF rate limited, falling back to 3.1');
      model = 'Gemini 3.1 Flash Lite (PDF)';
      res = await fetchWithLogging(`${GEMINI_FALLBACK_API}?key=${apiKey}`, opts(buildPayload(model)));
    }
    if (!res.ok) {
      log.warn('Gemini PDF call failed', { status: res.status });
      return null;
    }

    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text ? { text, model } : null;
  } catch (err) {
    log.warn('Gemini PDF call threw', { error: (err as Error).message });
    return null;
  }
}

