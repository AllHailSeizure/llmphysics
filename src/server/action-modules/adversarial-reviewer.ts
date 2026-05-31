import type { Hono } from 'hono';
import { reddit, redis, settings } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { PostId } from '../types';
import { logger } from '../helpers/log-helper';
import { writeSetting, formatSignature } from '../helpers/settings-helper';

const log = logger('adversarial-reviewer');

const GEMINI_PRIMARY_API  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const GEMINI_FALLBACK_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';
const BODY_CHAR_LIMIT     = 8000;
const DEDUPE_TTL_SECS     = 60 * 60 * 24 * 7; // 7 days
const USER_QUOTA_TTL_SECS = 60 * 60 * 25;      // 25 hrs — spans a full UTC day with margin
const DEV_SUB             = 'llmphysics_dev';  // dedup lock released after each review here
const PENDING_JOBS_KEY    = 'bot:adversarial:pdfjobs';
const ACTIVE_LOCKS_KEY    = 'bot:adversarial:active-locks'; // sorted set: member=postId, score=expiry ms
const PDF_JOB_TTL_SECS    = 60 * 60;           // 1 hour — give up on stale jobs

// ─── Shared system prompt ─────────────────────────────────────────────────────
// Keep in sync with supabase/functions/process-review/index.ts

export const SYSTEM_PROMPT =
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

function extractFirstBodyUrl(body: string): string | null {
  const match = body.match(/https?:\/\/[^\s\)\]>"]+/);
  return match ? match[0] : null;
}

async function fetchWithLogging(url: string, options: RequestInit = {}): Promise<Response> {
  const startTime = Date.now();
  const logInfo = {
    url,
    method: options.method || 'GET',
    requestUrl: url.includes('key=') ? url.substring(0, url.indexOf('key=') + 4) + '***' : url,
  };
  log.info('FETCH START', logInfo);
  try {
    const res = await fetch(url, options);
    const duration = Date.now() - startTime;
    const responseInfo = { ...logInfo, status: res.status, duration };
    log.info('FETCH END', responseInfo);
    if (!res.ok) log.warn('Fetch request failed', responseInfo);
    return res;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('Fetch threw an error', { ...logInfo, error: (error as Error).message, duration });
    throw error;
  }
}

// ─── Text-only Gemini call ────────────────────────────────────────────────────

async function callGemini(title: string, body: string, apiKey: string): Promise<{ text: string; model: string } | null> {
  const truncatedBody = body.length > BODY_CHAR_LIMIT
    ? body.slice(0, BODY_CHAR_LIMIT) + '\n[...truncated]'
    : body;

  const buildPayload = (model: string) => JSON.stringify({
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nYour model designation for the title is: ${model}\n\n---\n\nPost title: ${title}\n\nPost body:\n${truncatedBody || '(no body — title only)'}` }] }],
    generationConfig: { temperature: 0.6 },
  });

  const opts = (payload: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: payload,
  });

  let model = 'Gemini 3.5 Flash';
  let res = await fetchWithLogging(GEMINI_PRIMARY_API, opts(buildPayload(model)));
  if (res.status === 429) {
    log.info('Gemini 3.5 rate limited, falling back to 3.1');
    model = 'Gemini 3.1 Flash Lite';
    res = await fetchWithLogging(GEMINI_FALLBACK_API, opts(buildPayload(model)));
  }
  if (!res.ok) throw new Error(`Gemini API ${res.status}`);

  type GeminiResponse = {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const data = await res.json() as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return text ? { text, model } : null;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export function register(app: Hono): void {

  // ── Menu: Request Adversarial Review ────────────────────────────────────────
  app.post('/internal/menu/adversarial-review', async (c) => {
    const enabled = (await settings.get<boolean>('adversarialReviewerEnabled')) ?? false;
    if (!enabled) {
      return c.json<UiResponse>({ showToast: { text: 'Adversarial reviewer is disabled.', appearance: 'neutral' } });
    }

    const { targetId } = await c.req.json<MenuItemRequest>();
    const postId = targetId as PostId;

    // Dedup — one review per post for 7 days (expiration set atomically to avoid immortal keys)
    const dedupeKey = `bot:adversarial:lock:${postId}`;
    const claimed = await redis.set(dedupeKey, '1', {
      nx: true,
      expiration: new Date(Date.now() + DEDUPE_TTL_SECS * 1000),
    });
    if (!claimed) {
      // Back-fill legacy locks (set before ACTIVE_LOCKS_KEY existed) into the registry
      // so they show up in LLM Reviewer Settings for clearing.
      const inRegistry = await redis.zScore(ACTIVE_LOCKS_KEY, postId as string);
      if (inRegistry === undefined || inRegistry === null) {
        await redis.zAdd(ACTIVE_LOCKS_KEY, { score: Date.now() + DEDUPE_TTL_SECS * 1000, member: postId as string });
      }
      return c.json<UiResponse>({ showToast: { text: 'This post has already been reviewed.', appearance: 'neutral' } });
    }
    await redis.zAdd(ACTIVE_LOCKS_KEY, { score: Date.now() + DEDUPE_TTL_SECS * 1000, member: postId as string });

    const apiKey = (await settings.get<string>('geminiApiKey')) || undefined;
    if (!apiKey) {
      await redis.del(dedupeKey);
      await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
      return c.json<UiResponse>({ showToast: { text: 'Gemini API key not configured.', appearance: 'neutral' } });
    }

    let fullPost: Awaited<ReturnType<typeof reddit.getPostById>>;
    try {
      fullPost = await reddit.getPostById(postId);
    } catch (err) {
      log.error('Failed to fetch post', err as Error, { postId });
      await redis.del(dedupeKey);
      await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
      return c.json<UiResponse>({ showToast: { text: 'Failed to fetch post.', appearance: 'neutral' } });
    }

    type PostDetails = {
      selftext?: string;
      body?: string;
      url?: string;
      subredditName?: string;
      removed?: boolean;
      spam?: boolean;
      flair?: { templateId?: string };
    };
    const p = fullPost as typeof fullPost & PostDetails;
    const postBody      = p.selftext ?? p.body ?? '';
    const postUrl       = p.url as string | undefined;
    const subredditName = p.subredditName ?? '';

    // Gate: removed / spam
    if (p.removed || p.spam) {
      await redis.del(dedupeKey);
      await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
      return c.json<UiResponse>({ showToast: { text: 'Removed posts cannot be reviewed.', appearance: 'neutral' } });
    }

    // Gate: flair (skip if setting is empty — allow any flair)
    const requiredFlairId = (await settings.get<string>('adversarialReviewerFlairId')) ?? '';
    if (requiredFlairId) {
      const postFlairId = p.flair?.templateId;
      if (!postFlairId || postFlairId !== requiredFlairId) {
        await redis.del(dedupeKey);
        await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
        return c.json<UiResponse>({ showToast: { text: 'This post does not have the required flair for a review.', appearance: 'neutral' } });
      }
    }

    // Gate: per-user daily quota (mods exempt)
    try {
      const currentUser = await reddit.getCurrentUser();
      if (currentUser) {
        let isModerator = false;
        try {
          const modPerms = await currentUser.getModPermissionsForSubreddit(subredditName);
          isModerator = modPerms.length > 0;
        } catch (err) {
          log.warn('Could not check mod status', { error: (err as Error).message });
        }

        if (!isModerator) {
          const dayKey      = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
          const userQuotaKey = `bot:adversarial:user:${currentUser.id}:${dayKey}`;
          const quotaUsed   = await redis.get(userQuotaKey);
          if (quotaUsed) {
            await redis.del(dedupeKey);
            await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
            return c.json<UiResponse>({ showToast: { text: 'You can only request one review per day.', appearance: 'neutral' } });
          }
          // Claim quota slot — consumed even if the review fails
          await redis.set(userQuotaKey, '1', { expiration: new Date(Date.now() + USER_QUOTA_TTL_SECS * 1000) });
        }
      }
    } catch (err) {
      log.warn('Could not get current user for quota check', { error: (err as Error).message });
    }

    // Collect PDF candidate URLs: link post URL first, then first body URL (if different)
    const isLinkPost = !!postUrl && !postUrl.includes('reddit.com');
    const bodyUrl    = extractFirstBodyUrl(postBody);
    const candidateUrls: string[] = [];
    if (isLinkPost && postUrl) candidateUrls.push(postUrl);
    if (bodyUrl && bodyUrl !== postUrl) candidateUrls.push(bodyUrl);

    log.info('Review requested', { postId, isLinkPost, candidates: candidateUrls.length });

    // ── PDF path: offload to Supabase Edge Function (no 30s timeout) ──────────
    const supabaseUrl = (await settings.get<string>('supabaseUrl')) || '';
    const supabaseKey = (await settings.get<string>('supabaseServiceRoleKey')) || '';

    if (supabaseUrl && supabaseKey && candidateUrls.length > 0) {
      try {
        const jobRes = await fetchWithLogging(`${supabaseUrl}/rest/v1/review_jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            post_id: postId,
            pdf_url: candidateUrls[0],
            title: fullPost.title,
            body: postBody.slice(0, 8000),
          }),
        });

        if (jobRes.ok || jobRes.status === 409) {
          // 409 = UNIQUE conflict — already queued for this post, that's fine
          await redis.zAdd(PENDING_JOBS_KEY, { score: Date.now(), member: postId as string });
          log.info('PDF review job queued to Supabase', { postId, pdfUrl: candidateUrls[0] });
          return c.json<UiResponse>({ showToast: { text: 'Review request queued. Please wait.', appearance: 'neutral' } });
        }
        log.warn('Supabase job insert failed — falling back to text-only', { postId, status: jobRes.status });
      } catch (err) {
        log.warn('Supabase submit threw — falling back to text-only', { postId, error: (err as Error).message });
      }
    }

    // ── Text-only fallback ────────────────────────────────────────────────────
    let result: { text: string; model: string } | null = null;
    try {
      result = await callGemini(fullPost.title, postBody, apiKey);
    } catch (err) {
      log.error('Gemini review failed', err as Error, { postId });
      await redis.del(dedupeKey);
      await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
      return c.json<UiResponse>({ showToast: { text: 'Review failed — try again later.', appearance: 'neutral' } });
    }

    if (!result) {
      await redis.del(dedupeKey);
      await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
      return c.json<UiResponse>({ showToast: { text: 'Gemini returned an empty review.', appearance: 'neutral' } });
    }

    const rawSignature = (await settings.get<string>('botSignature')) ?? '';
    const signature    = formatSignature(rawSignature);
    try {
      const comment = await fullPost.addComment({ text: result.text + signature });
      await comment.distinguish(true);
      log.info('Adversarial review posted', { postId, commentId: comment.id });

      // On the dev sub, release the dedup lock so the post can be re-reviewed
      if (subredditName.toLowerCase() === DEV_SUB) {
        await redis.del(dedupeKey);
        await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
        log.info('Dev sub — dedup lock released', { postId });
      }
    } catch (err) {
      log.error('Failed to post review comment', err as Error, { postId });
      await redis.del(dedupeKey);
      await redis.zRem(ACTIVE_LOCKS_KEY, [postId as string]);
      return c.json<UiResponse>({ showToast: { text: 'Review generated but failed to post.', appearance: 'neutral' } });
    }

    return c.json<UiResponse>({ showToast: { text: 'Review posted!', appearance: 'success' } });
  });

  // ── Scheduler: poll Supabase for completed PDF review jobs ──────────────────
  app.post('/internal/scheduler/pdf-review-poll', async (c) => {
    const supabaseUrl = (await settings.get<string>('supabaseUrl')) || '';
    const supabaseKey = (await settings.get<string>('supabaseServiceRoleKey')) || '';
    if (!supabaseUrl || !supabaseKey) return c.json({ status: 'no supabase config' });

    const rawSignature = (await settings.get<string>('botSignature')) ?? '';
    const signature    = formatSignature(rawSignature);
    const cutoff       = Date.now() - PDF_JOB_TTL_SECS * 1000;

    // Get all pending postIds from the sorted set (score = enqueue timestamp).
    // zRange returns { member: string } objects in this Devvit version — extract member.
    const pendingRaw = await redis.zRange(PENDING_JOBS_KEY, 0, -1);
    type ZEntry = string | { member: string };
    const pendingIds = pendingRaw.map((e: ZEntry) => (typeof e === 'string' ? e : e.member));
    if (!pendingIds.length) return c.json({ status: 'nothing pending' });

    log.info('PDF poll tick', { count: pendingIds.length });

    for (const postId of pendingIds) {
      // Stale check — give up on jobs older than PDF_JOB_TTL_SECS
      const score = await redis.zScore(PENDING_JOBS_KEY, postId);
      if (score !== undefined && score < cutoff) {
        log.warn('PDF review job expired — giving up', { postId });
        await redis.zRem(PENDING_JOBS_KEY, [postId]);
        await redis.del(`bot:adversarial:lock:${postId}`);
        await redis.zRem(ACTIVE_LOCKS_KEY, [postId]);
        continue;
      }

      // Query Supabase for current job status
      try {
        const res = await fetchWithLogging(
          `${supabaseUrl}/rest/v1/review_jobs?post_id=eq.${postId}&select=status,result,error`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        if (!res.ok) {
          log.warn('Supabase poll failed', { postId, status: res.status });
          continue;
        }

        const jobs = await res.json() as { status: string; result: string | null; error: string | null }[];
        const job  = jobs[0];
        if (!job) { log.warn('No job record found for postId', { postId }); continue; }

        if (job.status === 'done' && job.result) {
          // Post the review comment and clean up
          try {
            const fullPost      = await reddit.getPostById(postId as PostId);
            type FullPostDetails = { subredditName?: string };
            const subredditName = ((fullPost as typeof fullPost & FullPostDetails).subredditName) ?? '';
            const comment       = await fullPost.addComment({ text: job.result + signature });
            await comment.distinguish(true);
            log.info('PDF review posted', { postId, commentId: comment.id });
            // On the dev sub, release dedup lock so the post can be re-reviewed
            if (subredditName.toLowerCase() === DEV_SUB) {
              await redis.del(`bot:adversarial:lock:${postId}`);
              await redis.zRem(ACTIVE_LOCKS_KEY, [postId]);
              log.info('Dev sub — dedup lock released', { postId });
            }
          } catch (err) {
            log.error('Failed to post PDF review comment', err as Error, { postId });
            continue; // leave in set, retry next poll
          }
          await redis.zRem(PENDING_JOBS_KEY, [postId]);

        } else if (job.status === 'failed') {
          log.warn('PDF review failed in Supabase', { postId, error: job.error });
          await redis.zRem(PENDING_JOBS_KEY, [postId]);
          await redis.del(`bot:adversarial:lock:${postId}`);
          await redis.zRem(ACTIVE_LOCKS_KEY, [postId]);
        }
        // status 'queued' or 'processing' → leave in set, check again next tick

      } catch (err) {
        log.warn('PDF poll threw for postId — skipping', { postId, error: (err as Error).message });
      }
    }

    return c.json({ status: 'ok', checked: pendingIds.length });
  });

  // ── Menu: LLM Reviewer Settings (mod-only, subreddit) ──────────────────────
  app.post('/internal/menu/bot-settings-adversarial', async (c) => {
    const flairId = (await settings.get<string>('adversarialReviewerFlairId')) ?? '';

    // Clean expired lock entries, then get active ones
    await redis.zRemRangeByScore(ACTIVE_LOCKS_KEY, 0, Date.now() - 1);
    const rawLocks = await redis.zRange(ACTIVE_LOCKS_KEY, 0, -1);
    type ZEntry = string | { member: string };
    const lockedIds = rawLocks.map((e: ZEntry) => (typeof e === 'string' ? e : e.member));

    // Fetch post titles (cap at 20 to avoid timeout)
    const lockOptions: { label: string; value: string }[] = [];
    for (const pid of lockedIds.slice(0, 20)) {
      try {
        const post = await reddit.getPostById(pid as PostId);
        lockOptions.push({ label: post.title.slice(0, 80), value: pid });
      } catch {
        lockOptions.push({ label: `[unavailable] ${pid}`, value: pid });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields: any[] = [
      {
        type: 'paragraph',
        name: 'adversarialReviewerFlairId',
        label: 'Required flair template ID',
        helpText: 'Only posts with this flair can request a review. Leave blank to allow any flair.',
        required: false,
        defaultValue: flairId,
      },
    ];

    if (lockOptions.length > 0) {
      fields.push({
        type: 'select',
        name: 'locksToRelease',
        label: `Active Review Locks (${lockOptions.length})`,
        helpText: 'Select posts to unlock. Unlocked posts can be reviewed again.',
        multiSelect: true,
        options: lockOptions,
        required: false,
      });
    }

    return c.json<UiResponse>({
      showForm: {
        name: 'bot-settings-adversarial',
        form: { title: 'LLM Reviewer Settings', acceptLabel: 'Save', fields },
      },
    });
  });

  // ── Form: LLM Reviewer Settings submit ─────────────────────────────────────
  app.post('/internal/forms/bot-settings-adversarial', async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await c.req.json<Record<string, any>>();

    await writeSetting('adversarialReviewerFlairId', body.adversarialReviewerFlairId ?? '');

    const locksToRelease: string[] = Array.isArray(body.locksToRelease) ? body.locksToRelease : [];
    for (const pid of locksToRelease) {
      await redis.del(`bot:adversarial:lock:${pid}`);
      await redis.zRem(ACTIVE_LOCKS_KEY, [pid]);
      log.info('Review lock released via settings', { postId: pid });
    }

    const lockMsg = locksToRelease.length > 0 ? ` Cleared ${locksToRelease.length} lock(s).` : '';
    return c.json<UiResponse>({ showToast: { text: `LLM Reviewer settings saved.${lockMsg}`, appearance: 'success' } });
  });
}
