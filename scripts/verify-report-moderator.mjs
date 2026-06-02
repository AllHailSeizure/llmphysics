#!/usr/bin/env node
/**
 * Automated verification for report-moderator.
 *
 * Pre-conditions (portal settings — must already be set from depth-cap verification):
 *   depthCap = 5
 *   depthCapIgnoreModerators = false
 *   depthCapIgnoreContributors = false
 *   (needed so depth-cap fires and the bot posts a notice reply for test 1)
 *
 * Run: node scripts/verify-report-moderator.mjs
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';

// ─── Auth ────────────────────────────────────────────────────────────────────

function loadToken() {
  const raw = readFileSync(`${homedir()}/.devvit/token`, 'utf8');
  const outer = JSON.parse(raw);
  const inner = JSON.parse(Buffer.from(outer.token, 'base64').toString('utf8'));
  return inner.accessToken;
}

const TOKEN = loadToken();
const UA = 'llmphysics-bot-verify/1.0 (by AllHailSeizure)';

async function reddit(method, path, body) {
  const url = `https://oauth.reddit.com${path}`;
  const opts = {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(body).toString();
  }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Reddit API ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function submitPost(title) {
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json', kind: 'self', sr: 'llmphysics_dev',
    title: `[verify-report-mod] ${title} ${Date.now()}`,
    text: 'Automated report-moderator verification.', resubmit: 'true',
  });
  const id = d.json?.data?.id;
  if (!id) throw new Error(`submitPost failed: ${JSON.stringify(d)}`);
  return `t3_${id}`;
}

async function submitComment(parentFullname, text = 'test comment') {
  await sleep(1200);
  const d = await reddit('POST', '/api/comment', {
    api_type: 'json', thing_id: parentFullname, text,
  });
  const id = d.json?.data?.things?.[0]?.data?.id;
  if (!id) throw new Error(`submitComment failed: ${JSON.stringify(d)}`);
  return `t1_${id}`;
}

async function buildChain(postFullname, depth) {
  const chain = [postFullname];
  for (let i = 0; i < depth; i++) {
    chain.push(await submitComment(chain[chain.length - 1], `chain comment ${i + 1}`));
  }
  return chain;
}

async function getCommentReplies(postId, commentFullname) {
  const cId = commentFullname.replace('t1_', '');
  const pId = postId.replace('t3_', '');
  const d = await reddit('GET', `/comments/${pId}/comment/${cId}?depth=2&limit=10`);
  const thread = d[1]?.data?.children?.[0];
  const replies = thread?.data?.replies?.data?.children ?? [];
  return replies.filter(c => c.kind === 't1').map(c => c.data);
}

async function submitReport(fullname, reason = 'automated-verify-test') {
  // report API returns {} on success; treat any 2xx as ok (already handled by res.ok check)
  try {
    await reddit('POST', '/api/report', { api_type: 'json', thing_id: fullname, reason });
  } catch (err) {
    // Reddit silently rejects some reports (e.g. self-reports in some contexts) — log but don't throw
    console.warn(`    (submitReport warning: ${err.message})`);
  }
}

async function getNumReports(fullname) {
  const d = await reddit('GET', `/api/info?id=${fullname}`);
  const item = d.data?.children?.[0]?.data;
  return item?.num_reports ?? 0;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try { await fn(); console.log('PASS'); passed++; }
  catch (err) { console.log(`FAIL: ${err.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const BOT_WAIT_MS = 7000;

// ─── Scenarios ───────────────────────────────────────────────────────────────

console.log('\n=== report-moderator verification ===\n');
console.log('PRE-CONDITIONS:');
console.log('  • devvit playtest r/llmphysics_dev is running');
console.log('  • depthCap = 5, depthCapIgnoreModerators = false, depthCapIgnoreContributors = false');
console.log('    (triggers depth-cap so bot posts a removal notice for test 1)\n');

// 1. Happy path: report a bot comment → ignoreReports() called → num_reports = 0
//    Finds an existing llmphysics-bot comment from recent depth-cap runs rather than
//    building a fresh chain (avoids depth-cap settings dependency).
await test('1. Bot comment report → ignored (num_reports=0)', async () => {
  // Find a recent bot comment in the subreddit
  const d = await reddit('GET', '/user/llmphysics-bot/comments?subreddit=llmphysics_dev&limit=25&t=all');
  const botComments = d.data?.children?.map(c => c.data) ?? [];
  assert(botComments.length > 0, 'no llmphysics-bot comments found in llmphysics_dev — run depth-cap tests first');
  const botComment = botComments[0]; // most recent bot comment
  const botReplyFullname = `t1_${botComment.id}`;

  await submitReport(botReplyFullname, 'verify-report-mod-bot-comment');
  await sleep(BOT_WAIT_MS);

  // ignoreReports() sets ignore_reports:true and removes from mod queue;
  // num_reports stays at the raw count — check ignore_reports flag instead
  const d2 = await reddit('GET', `/api/info?id=${botReplyFullname}`);
  const item = d2.data?.children?.[0]?.data;
  assert(item?.ignore_reports === true, `ignore_reports = ${item?.ignore_reports}, expected true after bot ignoreReports()`);
});

// 2. No-op: report a user comment → NOT ignored → num_reports stays > 0
await test('2. User comment report → not ignored (num_reports>0)', async () => {
  const post = await submitPost('user-comment-report');
  const c1 = await submitComment(post, 'user comment that should stay reported');
  await sleep(1000);

  await submitReport(c1, 'verify-report-mod-user-comment');
  await sleep(BOT_WAIT_MS);

  const n = await getNumReports(c1);
  assert(n > 0, `num_reports = ${n}, expected > 0 (user report should NOT be ignored)`);
});

// 3. No-op: report a user post → NOT ignored → num_reports stays > 0
await test('3. User post report → not ignored (num_reports>0)', async () => {
  const post = await submitPost('user-post-report');
  await sleep(1000);

  await submitReport(post, 'verify-report-mod-user-post');
  await sleep(BOT_WAIT_MS);

  const n = await getNumReports(post);
  assert(n > 0, `num_reports = ${n}, expected > 0 (user post report should NOT be ignored)`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(44)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('\nAll functional tests PASSED ✓');
  console.log('Check devvit logs for "Ignored bot comment report" (test 1)');
  console.log('and "author not in BOT_AUTHORS, skipping" (tests 2-3).');
} else {
  console.log('\nSome tests FAILED ✗ — diagnose before promoting.');
}
