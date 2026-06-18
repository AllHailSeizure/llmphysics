import type { Hono } from 'hono';
import { reddit, redis, settings } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { PostId } from '../types';
import { logger } from '../helpers/log-helper';
import { writeSetting, formatSignature } from '../helpers/settings-helper';

const log = logger('adversarial-reviewer');

const DEDUPE_TTL_SECS     = 60 * 60 * 24 * 7; // 7 days
const USER_QUOTA_TTL_SECS = 60 * 60 * 25;      // 25 hrs — spans a full UTC day with margin
const DEV_SUB             = 'llmphysics_dev';  // dedup lock released after each review here
const PENDING_JOBS_KEY    = 'bot:adversarial:pdfjobs';
const RETRY_QUEUE_KEY     = 'bot:adversarial:retry-queue'; // sorted set: score=retry-at ms, member=JSON
const ACTIVE_LOCKS_KEY    = 'bot:adversarial:active-locks'; // sorted set: member=postId, score=expiry ms
const PDF_JOB_TTL_SECS    = 60 * 60;           // 1 hour — give up on stale jobs
const RETRY_DELAY_MS      = 15 * 60 * 1000;    // 15 minutes between retry attempts
const MAX_RETRY_ATTEMPTS  = 3;                  // give up after 3 failed attempts

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractAllBodyUrls(body: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of body.matchAll(/https?:\/\/[^\s\)\]>"]+/g)) {
    if (!seen.has(m[0])) { seen.add(m[0]); result.push(m[0]); }
  }
  return result;
}

function collectPostUrls(postUrl: string | undefined, body: string): string[] {
  const result: string[] = [];
  if (postUrl && !postUrl.includes('reddit.com')) result.push(postUrl);
  for (const u of extractAllBodyUrls(body)) {
    if (!result.includes(u)) result.push(u);
  }
  return result;
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

// ─── Shared form helper ───────────────────────────────────────────────────────

type PendingForm = { postId: PostId; title: string; body: string; subredditName: string };

async function queueOrReview(
  { postId, title, body: postBody }: PendingForm,
  pdfUrl: string | null,
): Promise<UiResponse> {
  const supabaseUrl = (await settings.get<string>('supabaseUrl')) || '';
  const supabaseKey = (await settings.get<string>('supabaseServiceRoleKey')) || '';

  try {
    const jobRes = await fetchWithLogging(`${supabaseUrl}/rest/v1/review_jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ post_id: postId, pdf_url: pdfUrl, title, body: postBody }),
    });
    if (jobRes.ok || jobRes.status === 409) {
      await redis.zAdd(PENDING_JOBS_KEY, { score: Date.now(), member: postId as string });
      log.info('review_queued_via_form', { postId, pdfUrl: pdfUrl ?? '(none)' });
      return { showToast: { text: 'Review request queued. Please wait.', appearance: 'neutral' } };
    }
    log.warn('supabase_submit_failed', { postId, status: jobRes.status });
  } catch (err) {
    log.warn('supabase_submit_threw', { postId, error: (err as Error).message });
  }

  // Supabase unavailable — add to retry queue; scheduler will re-attempt in 15 min
  const retryMember = JSON.stringify({ postId, title, body: postBody, pdfUrl, attempts: 1 });
  await redis.zAdd(RETRY_QUEUE_KEY, { score: Date.now() + RETRY_DELAY_MS, member: retryMember });
  log.warn('supabase_unavailable_queued_retry', { postId, pdfUrl: pdfUrl ?? '(none)' });
  return { showToast: { text: 'Could not queue right now — will retry automatically.', appearance: 'neutral' } };
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
    let currentUser: Awaited<ReturnType<typeof reddit.getCurrentUser>> | null = null;
    try {
      currentUser = await reddit.getCurrentUser();
      if (currentUser) {
        let isModerator = false;
        try {
          const mods = await reddit.getModerators({ subredditName, username: currentUser.username }).all();
          isModerator = mods.length > 0;
        } catch (err) {
          log.warn('mod_check_failed', { error: (err as Error).message });
        }

        if (!isModerator && subredditName.toLowerCase() !== DEV_SUB) {
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

    const urls = collectPostUrls(postUrl, postBody);
    const formContext = JSON.stringify({
      postId, title: fullPost.title, body: postBody.slice(0, 8000), subredditName,
    });

    if (currentUser && urls.length === 0) {
      await redis.set(`bot:adversarial:pending-form:${currentUser.id}`, formContext,
        { expiration: new Date(Date.now() + 5 * 60 * 1000) });
      log.info('showing_no_link_form', { postId });
      return c.json<UiResponse>({
        showForm: {
          name: 'adversarial-no-link',
          form: {
            title: 'Request Adversarial Review',
            acceptLabel: 'Submit',
            fields: [{
              type: 'paragraph',
              name: 'manuscriptUrl',
              label: 'Manuscript URL',
              helpText: 'If your post is based on an external manuscript, you may submit a link. Otherwise, the bot will review your post.',
              required: false,
              defaultValue: '',
            }],
          },
        },
      });
    }

    if (currentUser && urls.length > 1) {
      await redis.set(`bot:adversarial:pending-form:${currentUser.id}`, formContext,
        { expiration: new Date(Date.now() + 5 * 60 * 1000) });
      log.info('showing_multi_link_form', { postId, urlCount: urls.length });
      return c.json<UiResponse>({
        showForm: {
          name: 'adversarial-multi-link',
          form: {
            title: 'Request Adversarial Review',
            acceptLabel: 'Submit',
            fields: [
              {
                type: 'select',
                name: 'selectedUrl',
                label: 'Select manuscript link',
                helpText: 'Your post has multiple links. Please select the one that links to your manuscript.',
                options: [
                  ...urls.map(u => ({ label: u.length > 80 ? u.slice(0, 77) + '...' : u, value: u })),
                  { label: 'Other', value: 'other' },
                  { label: 'None — review post text only', value: 'none' },
                ],
                required: true,
                multiSelect: false,
              },
              {
                type: 'paragraph',
                name: 'customUrl',
                label: 'Custom URL',
                helpText: 'If you selected "Other", paste the URL here.',
                required: false,
                defaultValue: '',
              },
            ],
          },
        },
      });
    }

    // 1 URL, or currentUser unavailable (rare) — use first URL or empty
    const candidateUrls = urls.slice(0, 1);

    log.info('review_requested', { postId, candidates: candidateUrls.length });

    const pdfUrl = candidateUrls.length > 0 ? candidateUrls[0] : null;
    return c.json<UiResponse>(await queueOrReview({ postId, title: fullPost.title, body: postBody, subredditName }, pdfUrl));
  });

  // ── Scheduler: poll Supabase for completed PDF review jobs ──────────────────
  app.post('/internal/scheduler/pdf-review-poll', async (c) => {
    const supabaseUrl = (await settings.get<string>('supabaseUrl')) || '';
    const supabaseKey = (await settings.get<string>('supabaseServiceRoleKey')) || '';
    if (!supabaseUrl || !supabaseKey) return c.json({ status: 'no supabase config' });

    const [rawSignature, lockComment, stickyComment] = await Promise.all([
      settings.get<string>('botSignature').then(v => v ?? ''),
      settings.get<boolean>('adversarialReviewerLockComment').then(v => v ?? false),
      settings.get<boolean>('adversarialReviewerStickyComment').then(v => v ?? false),
    ]);
    const signature = formatSignature(rawSignature);
    const cutoff    = Date.now() - PDF_JOB_TTL_SECS * 1000;

    // Get all pending postIds from the sorted set (score = enqueue timestamp).
    // zRange returns { member: string } objects in this Devvit version — extract member.
    const pendingRaw = await redis.zRange(PENDING_JOBS_KEY, 0, -1);
    type ZEntry = string | { member: string };
    const pendingIds = pendingRaw.map((e: ZEntry) => (typeof e === 'string' ? e : e.member));

    log.info('pdf_poll_tick', { pending: pendingIds.length });

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
            await comment.distinguish(stickyComment);
            if (lockComment) { try { await comment.lock(); } catch (err) { log.warn('comment_lock_failed', { postId, error: (err as Error).message }); } }
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

    // ── Drain retry queue ─────────────────────────────────────────────────────
    const retryNow = Date.now();
    const retryRaw = await redis.zRange(RETRY_QUEUE_KEY, 0, retryNow, { by: 'score' });
    const retryMembers = (retryRaw as ZEntry[]).map((e: ZEntry) => (typeof e === 'string' ? e : e.member));

    for (const member of retryMembers) {
      let job: { postId: string; title: string; body: string; pdfUrl: string | null; attempts: number };
      try {
        job = JSON.parse(member);
      } catch {
        await redis.zRem(RETRY_QUEUE_KEY, [member]);
        continue;
      }

      const { postId: rPostId, title: rTitle, body: rBody, pdfUrl: rPdfUrl, attempts } = job;

      if (attempts >= MAX_RETRY_ATTEMPTS) {
        log.warn('retry_max_attempts_reached', { postId: rPostId, attempts });
        await redis.zRem(RETRY_QUEUE_KEY, [member]);
        await redis.del(`bot:adversarial:lock:${rPostId}`);
        await redis.zRem(ACTIVE_LOCKS_KEY, [rPostId]);
        continue;
      }

      try {
        const jobRes = await fetchWithLogging(`${supabaseUrl}/rest/v1/review_jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ post_id: rPostId, pdf_url: rPdfUrl, title: rTitle, body: rBody }),
        });
        await redis.zRem(RETRY_QUEUE_KEY, [member]);
        if (jobRes.ok || jobRes.status === 409) {
          await redis.zAdd(PENDING_JOBS_KEY, { score: Date.now(), member: rPostId });
          log.info('retry_resubmitted', { postId: rPostId, attempts });
        } else {
          const updated = JSON.stringify({ ...job, attempts: attempts + 1 });
          await redis.zAdd(RETRY_QUEUE_KEY, { score: Date.now() + RETRY_DELAY_MS, member: updated });
          log.warn('retry_still_failing', { postId: rPostId, nextAttempts: attempts + 1, status: jobRes.status });
        }
      } catch (err) {
        await redis.zRem(RETRY_QUEUE_KEY, [member]);
        const updated = JSON.stringify({ ...job, attempts: attempts + 1 });
        await redis.zAdd(RETRY_QUEUE_KEY, { score: Date.now() + RETRY_DELAY_MS, member: updated });
        log.warn('retry_threw', { postId: rPostId, nextAttempts: attempts + 1, error: (err as Error).message });
      }
    }

    return c.json({ status: 'ok', checked: pendingIds.length, retried: retryMembers.length });
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

  // ── Form: no-link URL input ──────────────────────────────────────────────────
  app.post('/internal/forms/adversarial-no-link', async (c) => {
    const formBody = await c.req.json<Record<string, unknown>>();
    const pdfUrl   = (typeof formBody.manuscriptUrl === 'string' ? formBody.manuscriptUrl.trim() : '') || null;

    const currentUser = await reddit.getCurrentUser();
    if (!currentUser) return c.json<UiResponse>({ showToast: { text: 'Could not identify user.', appearance: 'neutral' } });

    const pendingKey = `bot:adversarial:pending-form:${currentUser.id}`;
    const raw = await redis.get(pendingKey);
    if (!raw) return c.json<UiResponse>({ showToast: { text: 'Form expired. Please try again.', appearance: 'neutral' } });
    await redis.del(pendingKey);

    return c.json<UiResponse>(await queueOrReview(JSON.parse(raw) as PendingForm, pdfUrl));
  });

  // ── Form: multi-link picker ──────────────────────────────────────────────────
  app.post('/internal/forms/adversarial-multi-link', async (c) => {
    const formBody    = await c.req.json<Record<string, unknown>>();
    const selectedRaw = formBody.selectedUrl;
    // Devvit returns select fields as string[] even when multiSelect: false
    const selected    = Array.isArray(selectedRaw) ? (selectedRaw[0] as string) : (selectedRaw as string ?? '');
    const custom      = (typeof formBody.customUrl === 'string' ? formBody.customUrl.trim() : '');
    const pdfUrl      = selected === 'other' ? (custom || null)
                      : selected === 'none'  ? null
                      : (selected || null);

    const currentUser = await reddit.getCurrentUser();
    if (!currentUser) return c.json<UiResponse>({ showToast: { text: 'Could not identify user.', appearance: 'neutral' } });

    const pendingKey = `bot:adversarial:pending-form:${currentUser.id}`;
    const raw = await redis.get(pendingKey);
    if (!raw) return c.json<UiResponse>({ showToast: { text: 'Form expired. Please try again.', appearance: 'neutral' } });
    await redis.del(pendingKey);

    return c.json<UiResponse>(await queueOrReview(JSON.parse(raw) as PendingForm, pdfUrl));
  });
}
