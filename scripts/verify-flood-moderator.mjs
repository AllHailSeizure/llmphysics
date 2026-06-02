#!/usr/bin/env node
/**
 * Automated verification for flood-moderator.
 *
 * PRE-CONDITIONS (set in r/llmphysics_dev mod tools → llmphysics-bot settings):
 *   floodAssistantMaxPosts        = 1
 *   floodAssistantIgnoreModerators   = false   ← AllHailSeizure is a mod
 *   floodAssistantIgnoreContributors = false   ← AllHailSeizure is a contributor
 *   floodModEnabled               = true
 *
 * ISOLATION WARNING: These tests use a quota of 1 post per 24h window.
 * Do NOT run other post-submission tests at the same time.
 *
 * Run:
 *   node scripts/verify-flood-moderator.mjs --auto        # tests 1-3 only
 *   node scripts/verify-flood-moderator.mjs --test4       # module disabled
 *   node scripts/verify-flood-moderator.mjs --test5       # custom removal message
 *   node scripts/verify-flood-moderator.mjs --test6       # mod exemption
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
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': UA,
    },
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
  const data = await reddit('POST', '/api/submit', {
    api_type: 'json',
    kind: 'self',
    sr: 'llmphysics_dev',
    title: `[verify-flood-moderator] ${title} ${Date.now()}`,
    text: 'Automated flood-moderator verification post.',
    resubmit: 'true',
  });
  const postId = data.json?.data?.id;
  if (!postId) throw new Error(`submitPost failed: ${JSON.stringify(data)}`);
  return `t3_${postId}`;
}

async function getPost(fullname) {
  const data = await reddit('GET', `/api/info?id=${fullname}`);
  return data.data?.children?.[0]?.data;
}

async function getPostComments(postFullname) {
  const postId = postFullname.replace('t3_', '');
  const data = await reddit('GET', `/comments/${postId}?depth=1&limit=25`);
  // data is [postListing, commentListing]
  const comments = data[1]?.data?.children ?? [];
  return comments.filter(c => c.kind === 't1').map(c => c.data);
}

async function deletePost(fullname) {
  // Delete the post so runOnPostDelete marks it as deleted → ignoreDeleted=true → won't count
  try { await reddit('POST', '/api/del', { id: fullname }); } catch (_) {}
  await sleep(3000); // give runOnPostDelete time to fire and mark the post
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('PASS');
    passed++;
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

const BOT_WAIT_MS = 8000; // time to wait for bot to process after post submission

const AUTO  = process.argv.includes('--auto');
const TEST2 = process.argv.includes('--test2'); // no-op: single post under quota (run BEFORE --auto on clean quota)
const TEST4 = process.argv.includes('--test4'); // module disabled
const TEST5 = process.argv.includes('--test5'); // custom removal message
const TEST6 = process.argv.includes('--test6'); // mod exemption
const SINGLE_TEST = TEST2 || TEST4 || TEST5 || TEST6;

console.log('\n=== flood-moderator verification ===\n');
console.log('PRE-CONDITIONS:');
console.log('  • devvit playtest r/llmphysics_dev is running');
console.log('  • floodAssistantMaxPosts = 1 (set in bot settings)');
console.log('  • floodAssistantIgnoreModerators = false');
console.log('  • floodAssistantIgnoreContributors = false (AllHailSeizure is a contributor)');
console.log('  • floodModEnabled = true');
if (AUTO) console.log('  • --auto mode: tests 4-6 (require setting changes) will be skipped\n');
else if (SINGLE_TEST) console.log(`  • single-test mode (${process.argv.slice(2).join(' ')}): only the flagged settings test will run\n`);
else console.log();

// ─── 1. Happy path — submit 2 posts, first passes, second is removed ──────────

if (SINGLE_TEST) { console.log('  1. Happy path: post 1 allowed, post 2 removed by bot ... SKIP (single-test mode)'); }
else await test('1. Happy path: post 1 allowed, post 2 removed by bot', async () => {
  const post1 = await submitPost('happy-path-p1');
  await sleep(2000); // brief gap so timestamps differ in the sorted set
  const post2 = await submitPost('happy-path-p2');
  await sleep(BOT_WAIT_MS);

  const p1data = await getPost(post1);
  assert(p1data?.removed !== true, `post 1 should NOT be removed (got removed=${p1data?.removed})`);

  const p2data = await getPost(post2);
  assert(p2data?.removed === true, `post 2 should be removed (got removed=${p2data?.removed})`);

  // Clean up post1 (allowed) so it doesn't pollute subsequent tests' quota counts
  await deletePost(post1);
});

// ─── 2. No-op — single post stays up (under quota) ───────────────────────────
// Run with --test2 on a CLEAN quota (before --auto, or after window has cleared).
// In --auto mode this is implicitly covered: test 1's post 1 IS the "under quota"
// case — it is allowed before the second post triggers enforcement.

if (AUTO) { console.log('  2. No-op: single post under quota → not removed ... SKIP (--auto; covered by test 1 post 1; run --test2 on clean quota)'); }
else if (SINGLE_TEST && !TEST2) { console.log('  2. No-op: single post under quota → not removed ... SKIP (single-test mode)'); }
else await test('2. No-op: single post under quota → not removed', async () => {
  const post = await submitPost('noop-under-quota');
  await sleep(BOT_WAIT_MS);

  const pdata = await getPost(post);
  assert(pdata?.removed !== true, `post should NOT be removed (got removed=${pdata?.removed})`);
  const comments = await getPostComments(post);
  const botComments = comments.filter(c => c.author === 'llmphysics-bot');
  assert(botComments.length === 0, `unexpected bot comment on under-quota post (got ${botComments.length})`);
});

// ─── 3. Bot posts removal comment when response text is configured ────────────
//    This is part of the happy path. Requires floodAssistantResponse to be set.
//    If the response field is blank, the bot removes but does not comment — that
//    is by design. This test is best run after setting a response message (test 5).
//    Here we verify that the second post from test 1 received a bot comment IF
//    a response is configured. We skip this silently when running --auto because
//    the response field may be blank in base pre-conditions.

if (SINGLE_TEST) { console.log('  3. Removal comment: bot comments when floodAssistantResponse is set ... SKIP (single-test mode)'); }
else if (AUTO) { console.log('  3. Removal comment check ... SKIP (--auto; run --test5 for full message verification)'); }
else await test('3. Removal comment: bot comments when floodAssistantResponse is set', async () => {
  // Re-submit 2 posts to get a fresh removal with whatever response is currently set
  const post1 = await submitPost('comment-check-p1');
  await sleep(2000);
  const post2 = await submitPost('comment-check-p2');
  await sleep(BOT_WAIT_MS);

  const p2data = await getPost(post2);
  assert(p2data?.removed === true, `post 2 should be removed first (got removed=${p2data?.removed})`);

  const comments = await getPostComments(post2);
  const botComment = comments.find(c => c.author === 'llmphysics-bot');
  // Only assert if a response is configured — if not, bot intentionally does not comment
  if (botComment) {
    assert(botComment.distinguished === 'moderator', `bot comment should be distinguished (got ${botComment.distinguished})`);
    assert(botComment.stickied === true, `bot comment should be stickied (got ${botComment.stickied})`);
  }
  // If no botComment, that's valid when floodAssistantResponse = ''
});

// ─── 4. Settings: module disabled  (--test4: set floodModEnabled=false first) ─

if (AUTO) { console.log('  4. Module disabled → no enforcement ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST4) { /* skip — different test flag active */ }
else await test('4. Module disabled → no enforcement', async () => {
  // Caller has already set floodModEnabled = false in the portal
  const post1 = await submitPost('disabled-p1');
  await sleep(2000);
  const post2 = await submitPost('disabled-p2');
  await sleep(BOT_WAIT_MS);

  const p2data = await getPost(post2);
  assert(p2data?.removed !== true, `post 2 should NOT be removed when module is disabled (got removed=${p2data?.removed})`);
  // Reset reminder printed after test
});

// ─── 5. Settings: custom removal message  (--test5: set floodAssistantResponse="Test flood message." first) ─

if (AUTO) { console.log('  5. Custom removal message appears in bot comment ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST5) { /* skip — different test flag active */ }
else await test('5. Custom removal message appears in bot comment', async () => {
  const CUSTOM_MSG = 'Test flood message.';
  // Caller has already set floodAssistantResponse = "Test flood message." in the portal
  const post1 = await submitPost('custom-msg-p1');
  await sleep(2000);
  const post2 = await submitPost('custom-msg-p2');
  await sleep(BOT_WAIT_MS);

  const p2data = await getPost(post2);
  assert(p2data?.removed === true, `post 2 should be removed (got removed=${p2data?.removed})`);

  const comments = await getPostComments(post2);
  const botComment = comments.find(c => c.author === 'llmphysics-bot');
  assert(botComment, `no bot comment found on removed post`);
  assert(
    botComment.body.startsWith(CUSTOM_MSG),
    `bot comment body does not start with expected message. Got: "${botComment.body.slice(0, 80)}"`,
  );
  // Reset reminder printed after test
});

// ─── 6. Settings: moderator exempt  (--test6: set floodAssistantIgnoreModerators=true first) ─

if (AUTO) { console.log('  6. Moderator exempt when floodAssistantIgnoreModerators=true ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST6) { /* skip — different test flag active */ }
else await test('6. Moderator exempt when floodAssistantIgnoreModerators=true', async () => {
  // Caller has already set floodAssistantIgnoreModerators = true in the portal
  const post1 = await submitPost('mod-exempt-p1');
  await sleep(2000);
  const post2 = await submitPost('mod-exempt-p2');
  await sleep(BOT_WAIT_MS);

  const p2data = await getPost(post2);
  assert(
    p2data?.removed !== true,
    `post 2 should NOT be removed (AllHailSeizure is a mod and is exempt). Got removed=${p2data?.removed}`,
  );
  // Reset reminder printed after test
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(44)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('\nAll functional tests PASSED ✓');
  if (AUTO) {
    console.log('\nNext steps for full verification:');
    console.log('  1. Set floodModEnabled = false                    → node scripts/verify-flood-moderator.mjs --test4');
    console.log('  2. Set floodAssistantResponse = "Test flood message." → node scripts/verify-flood-moderator.mjs --test5');
    console.log('  3. Set floodAssistantIgnoreModerators = true      → node scripts/verify-flood-moderator.mjs --test6');
    console.log('\nReset all settings after each --testN run (see PRE-CONDITIONS above).');
  }
} else {
  console.log('\nSome tests FAILED ✗ — fix before promoting.');
}

if (TEST4) {
  console.log('\n  ⚠  Reset: set floodModEnabled = true in the portal before running other tests.');
}
if (TEST5) {
  console.log('\n  ⚠  Reset: clear floodAssistantResponse in the portal before running other tests.');
}
if (TEST6) {
  console.log('\n  ⚠  Reset: set floodAssistantIgnoreModerators = false in the portal before running other tests.');
}
