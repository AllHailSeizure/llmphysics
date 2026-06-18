#!/usr/bin/env node
/**
 * verify-adversarial-reviewer.mjs
 *
 * Verification script for the adversarial-reviewer action module.
 *
 * Usage:
 *   node scripts/verify-adversarial-reviewer.mjs            # create posts + print manual steps
 *   node scripts/verify-adversarial-reviewer.mjs --auto     # create posts only (skip instructions)
 *   node scripts/verify-adversarial-reviewer.mjs --jobs     # show last 10 Supabase review_jobs
 *   node scripts/verify-adversarial-reviewer.mjs --jobs 20  # show last N jobs
 *   node scripts/verify-adversarial-reviewer.mjs -h         # help
 *
 * For --jobs: set SUPABASE_SERVICE_ROLE_KEY in env (SUPABASE_URL defaults to project URL).
 *
 * Prerequisites:
 *   - devvit playtest r/llmphysics_dev must be running
 *   - adversarialReviewerEnabled = true (Developer Portal → r/llmphysics_dev settings)
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ─── Supabase config ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://eimdgqymjwfljtapnuyl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function loadAccessToken() {
  try {
    const tokenPath = join(homedir(), '.devvit', 'token');
    const outer = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const inner = JSON.parse(Buffer.from(outer.token, 'base64').toString('utf8'));
    return inner.accessToken;
  } catch (err) {
    console.error('Could not load access token from ~/.devvit/token:', err.message);
    process.exit(1);
  }
}

async function redditGet(path, accessToken) {
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'llmphysics-bot-verify/1.0 (by AllHailSeizure)',
    },
  });
  if (!res.ok) throw new Error(`Reddit API ${path} → HTTP ${res.status}`);
  return res.json();
}

async function redditPost(path, body, accessToken) {
  const params = new URLSearchParams(body);
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'llmphysics-bot-verify/1.0 (by AllHailSeizure)',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Reddit API POST ${path} → HTTP ${res.status}`);
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, reason) { console.log(`  FAIL  ${label}: ${reason}`); }
function skip(label) { console.log(`  SKIP  ${label}`); }
function info(msg) { console.log(`        ${msg}`); }
function step(n, msg) { console.log(`  ${n}.  ${msg}`); }

function playtestUrl(postId) {
  return `https://www.reddit.com/r/llmphysics_dev/comments/${postId}/?playtest=llmphysics-bot`;
}

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node scripts/verify-adversarial-reviewer.mjs [--auto] [--jobs [N]] [-h]');
  console.log('See file header for full documentation.');
  process.exit(0);
}

const autoOnly  = args.includes('--auto');
const jobsFlag  = args.includes('--jobs');
const jobsCount = jobsFlag ? (parseInt(args[args.indexOf('--jobs') + 1], 10) || 10) : 10;

// ─── --jobs mode ──────────────────────────────────────────────────────────────

async function showJobs(n) {
  if (!SUPABASE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY env var is required for --jobs.');
    process.exit(1);
  }
  console.log(`\n=== Last ${n} review_jobs from Supabase ===\n`);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/review_jobs?select=post_id,pdf_url,status,error,created_at&order=created_at.desc&limit=${n}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) {
    console.error(`Supabase query failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const jobs = await res.json();
  if (!jobs.length) {
    console.log('  (no jobs found)');
    return;
  }
  for (const j of jobs) {
    const ts = new Date(j.created_at).toLocaleTimeString();
    const url = j.pdf_url ?? '(none — text-only)';
    const err = j.error ? `  error: ${j.error}` : '';
    console.log(`  [${ts}] ${j.status.padEnd(10)} post=${j.post_id}  pdf_url=${url}${err}`);
  }
  console.log('');
}

if (jobsFlag) {
  showJobs(jobsCount).catch(err => { console.error(err); process.exit(1); });
  // don't fall through to main
} else {
  main().catch(err => { console.error('\nUnhandled error:', err); process.exit(1); });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== adversarial-reviewer verification ===\n');
  console.log('Module type : action (post menu → Request Adversarial Review)');
  console.log('Subreddit   : r/llmphysics_dev');
  console.log('Test user   : AllHailSeizure\n');

  const accessToken = loadAccessToken();
  let passed = 0, failed = 0, skipped = 0;

  // ─── T0: API connectivity ──────────────────────────────────────────────────
  console.log('T0: Reddit API connectivity');
  try {
    const me = await redditGet('/api/v1/me', accessToken);
    if (me.name) { pass(`Authenticated as u/${me.name}`); passed++; }
    else { fail('API connectivity', 'Unexpected response shape'); failed++; }
  } catch (err) {
    fail('API connectivity', err.message); failed++;
  }

  // ─── T1: Create no-link post ───────────────────────────────────────────────
  console.log('\nT1 setup: Create no-link test post');
  let postA = null;
  try {
    const res = await redditPost('/api/submit', {
      sr: 'llmphysics_dev',
      kind: 'self',
      title: '[VERIFY] adversarial-reviewer — no-link test — delete after',
      text: 'This post has no external links. The reviewer should show a form prompting for an optional manuscript URL.',
      resubmit: true,
    }, accessToken);
    postA = res?.json?.data?.id;
    if (!postA) throw new Error('Submit did not return post ID');
    pass(`Created no-link post: t3_${postA}`);
    info(playtestUrl(postA));
    passed++;
  } catch (err) {
    fail('Create no-link post', err.message); failed++;
  }

  // ─── T2: Create single-link post ──────────────────────────────────────────
  console.log('\nT2 setup: Create single-link test post');
  let postB = null;
  try {
    const res = await redditPost('/api/submit', {
      sr: 'llmphysics_dev',
      kind: 'self',
      title: '[VERIFY] adversarial-reviewer — single-link test — delete after',
      text: 'This post references exactly one external link:\n\nhttps://arxiv.org/abs/2401.12345\n\nThe reviewer should queue directly with no form.',
      resubmit: true,
    }, accessToken);
    postB = res?.json?.data?.id;
    if (!postB) throw new Error('Submit did not return post ID');
    pass(`Created single-link post: t3_${postB}`);
    info(playtestUrl(postB));
    passed++;
  } catch (err) {
    fail('Create single-link post', err.message); failed++;
  }

  // ─── T3: Create multi-link post ───────────────────────────────────────────
  console.log('\nT3 setup: Create multi-link test post');
  let postC = null;
  try {
    const res = await redditPost('/api/submit', {
      sr: 'llmphysics_dev',
      kind: 'self',
      title: '[VERIFY] adversarial-reviewer — multi-link test — delete after',
      text: 'This post has two external links:\n\nhttps://arxiv.org/abs/2401.12345\n\nhttps://zenodo.org/records/99999999\n\nThe reviewer should show a dropdown picker.',
      resubmit: true,
    }, accessToken);
    postC = res?.json?.data?.id;
    if (!postC) throw new Error('Submit did not return post ID');
    pass(`Created multi-link post: t3_${postC}`);
    info(playtestUrl(postC));
    passed++;
  } catch (err) {
    fail('Create multi-link post', err.message); failed++;
  }

  if (autoOnly) {
    console.log('\n(--auto flag set: skipping manual test instructions)');
    skipped += 8;
    printSummary(passed, failed, skipped);
    return;
  }

  // ─── Manual test instructions ──────────────────────────────────────────────

  const jobsCmd  = 'node scripts/verify-adversarial-reviewer.mjs --jobs';
  const logsCmd  = 'npx devvit logs r/llmphysics_dev llmphysics-bot --since 2m --show-timestamps';

  console.log('\n' + '─'.repeat(60));
  console.log('MANUAL TESTS — complete these in order on r/llmphysics_dev');
  console.log('─'.repeat(60));

  // ── Test A: no-link post, submit blank ───────────────────────────────────
  console.log('\nTest A — No-link post, submit blank → text-only review');
  skip('No-link form (blank)');  skipped++;
  console.log('  Steps:');
  step(1, postA ? `Open: ${playtestUrl(postA)}` : 'Open the no-link test post (creation failed — create manually)');
  step(2, 'Click the post overflow menu → "Request Adversarial Review"');
  step(3, 'Expected: form appears titled "Request Adversarial Review" with a "Manuscript URL" field');
  step(4, 'Leave the field blank and click Submit');
  step(5, 'Expected: toast "Review posted!" and a distinguished bot comment appears on the post');
  console.log('  Verify:');
  info(`Run: ${logsCmd}`);
  info('Look for: text_review_posted_via_form');

  // ── Test B: no-link post, submit URL ─────────────────────────────────────
  console.log('\nTest B — No-link post, submit URL → Supabase job queued');
  skip('No-link form (with URL)');  skipped++;
  console.log('  Note: dev sub releases the lock after Test A completes, so click again on the same post.');
  console.log('  Steps:');
  step(1, postA ? `Open: ${playtestUrl(postA)}` : 'Open the no-link test post');
  step(2, 'Click the post overflow menu → "Request Adversarial Review"');
  step(3, 'Expected: form appears again (lock was released after Test A)');
  step(4, 'Enter a URL, e.g. https://arxiv.org/abs/2401.99999, and click Submit');
  step(5, 'Expected: toast "Review request queued. Please wait."');
  console.log('  Verify:');
  info(`Run: ${jobsCmd}`);
  info(`Look for: post_id=${postA ?? '<post-id>'}  pdf_url=https://arxiv.org/abs/2401.99999`);

  // ── Test C: single-link post ──────────────────────────────────────────────
  console.log('\nTest C — Single-link post → direct queue, no form');
  skip('Single-link direct queue');  skipped++;
  console.log('  Steps:');
  step(1, postB ? `Open: ${playtestUrl(postB)}` : 'Open the single-link test post');
  step(2, 'Click the post overflow menu → "Request Adversarial Review"');
  step(3, 'Expected: NO form appears — directly shows toast "Review request queued. Please wait."');
  console.log('  Verify:');
  info(`Run: ${jobsCmd}`);
  info(`Look for: post_id=${postB ?? '<post-id>'}  pdf_url=https://arxiv.org/abs/2401.12345`);

  // ── Test D: multi-link post, select None ─────────────────────────────────
  console.log('\nTest D — Multi-link post, select "None" → text-only review');
  skip('Multi-link form (None)');  skipped++;
  console.log('  Steps:');
  step(1, postC ? `Open: ${playtestUrl(postC)}` : 'Open the multi-link test post');
  step(2, 'Click the post overflow menu → "Request Adversarial Review"');
  step(3, 'Expected: form appears with dropdown listing both arxiv + zenodo URLs, plus "Other" and "None — review post text only"');
  step(4, 'Select "None — review post text only" and click Submit');
  step(5, 'Expected: toast "Review posted!" and a distinguished bot comment appears');
  console.log('  Verify:');
  info(`Run: ${logsCmd}`);
  info('Look for: text_review_posted_via_form');

  // ── Test E: multi-link post, select "Other" ───────────────────────────────
  console.log('\nTest E — Multi-link post, select "Other" → custom URL queued');
  skip('Multi-link form (Other)');  skipped++;
  console.log('  Note: dev sub releases the lock after Test D completes, so click again on the same post.');
  console.log('  Steps:');
  step(1, postC ? `Open: ${playtestUrl(postC)}` : 'Open the multi-link test post');
  step(2, 'Click "Request Adversarial Review" again');
  step(3, 'Expected: form appears again');
  step(4, 'Select "Other" from the dropdown');
  step(5, 'Enter https://example.com/custom-paper.pdf in the "Custom URL" field');
  step(6, 'Click Submit');
  step(7, 'Expected: toast "Review request queued. Please wait."');
  console.log('  Verify:');
  info(`Run: ${jobsCmd}`);
  info(`Look for: post_id=${postC ?? '<post-id>'}  pdf_url=https://example.com/custom-paper.pdf`);

  // ── Test F: multi-link post, select a listed URL ──────────────────────────
  console.log('\nTest F — Multi-link post, select a listed URL → that URL queued');
  skip('Multi-link form (select listed URL)');  skipped++;
  console.log('  Note: run after Test E job completes (up to 5 min for the Supabase review to finish + lock to release).');
  console.log('  Alternatively: use the "LLM Reviewer Settings" mod menu on r/llmphysics_dev to manually clear the lock first.');
  console.log('  Steps:');
  step(1, postC ? `Open: ${playtestUrl(postC)}` : 'Open the multi-link test post');
  step(2, 'Click "Request Adversarial Review"');
  step(3, 'Expected: form appears with the dropdown');
  step(4, 'Select the first URL (https://arxiv.org/abs/2401.12345) from the dropdown');
  step(5, 'Click Submit');
  step(6, 'Expected: toast "Review request queued. Please wait."');
  console.log('  Verify:');
  info(`Run: ${jobsCmd}`);
  info(`Look for: post_id=${postC ?? '<post-id>'}  pdf_url=https://arxiv.org/abs/2401.12345`);

  // ── Test G: disabled state ────────────────────────────────────────────────
  console.log('\nTest G — Disabled state → neutral toast');
  skip('Disabled state');  skipped++;
  console.log('  Steps:');
  step(1, 'In Developer Portal, set adversarialReviewerEnabled = false for r/llmphysics_dev');
  step(2, 'Click "Request Adversarial Review" on any post');
  step(3, 'Expected: toast "Adversarial reviewer is disabled."');
  step(4, 'Reset: set adversarialReviewerEnabled = true in portal');

  // ── Test H: per-user quota ────────────────────────────────────────────────
  console.log('\nTest H — Per-user daily quota (non-mod, non-dev-sub only)');
  skip('Per-user quota (skip if only testing on dev sub)');  skipped++;
  info('Quota is bypassed on r/llmphysics_dev. Test on r/llmphysics with a non-mod account.');
  info('Expected: second request same day → toast "You can only request one review per day."');

  // ─── Summary ──────────────────────────────────────────────────────────────
  printSummary(passed, failed, skipped);
}

function printSummary(passed, failed, skipped) {
  console.log('\n' + '─'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped (manual)`);
  if (failed > 0) {
    console.log('\nAction required: fix failures before playtesting.');
    process.exit(1);
  } else {
    console.log('\nAutomated setup complete. Work through the manual tests above during playtest.');
    console.log(`Check jobs anytime: node scripts/verify-adversarial-reviewer.mjs --jobs`);
  }
}
