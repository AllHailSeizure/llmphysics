#!/usr/bin/env node
/**
 * Automated verification for self-response-moderator.
 *
 * Pre-conditions for --auto (happy path):
 *   selfResponseModEnabled = true
 *   selfResponseIgnoreModerators = false   ← required: AllHailSeizure is a mod
 *   selfResponseIgnoreContributors = false  ← required: AllHailSeizure is a contributor
 *   selfResponseResponse = "Self-response rule: please keep discussion open."
 *
 * Run:
 *   node scripts/verify-self-response-moderator.mjs --auto
 *   node scripts/verify-self-response-moderator.mjs --test3   (module disabled)
 *   node scripts/verify-self-response-moderator.mjs --test4   (mod exempt)
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
    title: `[verify-srmod] ${title} ${Date.now()}`,
    text: 'Automated self-response-moderator verification post.',
    resubmit: 'true',
  });
  const postId = data.json?.data?.id;
  if (!postId) throw new Error(`submitPost failed: ${JSON.stringify(data)}`);
  return `t3_${postId}`;
}

async function submitComment(parentFullname, text = 'self-response verification comment') {
  await sleep(1200); // Reddit rejects comments posted < ~1s apart
  const data = await reddit('POST', '/api/comment', {
    api_type: 'json',
    thing_id: parentFullname,
    text,
  });
  const id = data.json?.data?.things?.[0]?.data?.id;
  if (!id) throw new Error(`submitComment failed: ${JSON.stringify(data)}`);
  return `t1_${id}`;
}

async function getComment(fullname) {
  const data = await reddit('GET', `/api/info?id=${fullname}`);
  return data.data?.children?.[0]?.data;
}

async function getRemoved(fullname) {
  const c = await getComment(fullname);
  if (!c) return false;
  // A removed comment has its body replaced and spam/removed flags set.
  // The removed flag is visible to mods via the API.
  return c.removed === true || c.spam === true;
}

async function getCommentReplies(postId, commentFullname) {
  const commentId = commentFullname.replace('t1_', '');
  const pId = postId.replace('t3_', '');
  const data = await reddit('GET', `/comments/${pId}/comment/${commentId}?depth=2&limit=10`);
  // data is [postListing, commentListing]
  const commentThread = data[1]?.data?.children?.[0];
  const replies = commentThread?.data?.replies?.data?.children ?? [];
  return replies.filter(c => c.kind === 't1').map(c => c.data);
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

const BOT_WAIT_MS = 7000; // time to wait for bot to process after triggering comment

const AUTO = process.argv.includes('--auto');
const TEST3 = process.argv.includes('--test3'); // module disabled
const TEST4 = process.argv.includes('--test4'); // mod exempt
const SINGLE_TEST = TEST3 || TEST4;

console.log('\n=== self-response-moderator verification ===\n');
console.log('PRE-CONDITIONS (for --auto / happy path):');
console.log('  • devvit playtest r/llmphysics_dev is running');
console.log('  • selfResponseModEnabled = true');
console.log('  • selfResponseIgnoreModerators = false  ← AllHailSeizure is a mod');
console.log('  • selfResponseIgnoreContributors = false  ← AllHailSeizure is a contributor');
console.log('  • selfResponseResponse = "Self-response rule: please keep discussion open."');
console.log('');
console.log('Settings URL: https://developers.reddit.com/r/llmphysics_dev/apps/llmphysics-bot');
if (AUTO) console.log('  • --auto mode: settings-dependent tests (--test3, --test4) will be skipped\n');
else if (SINGLE_TEST) console.log(`  • single-test mode (${process.argv.slice(2).join(' ')}): only the flagged settings test will run\n`);
else console.log();

// 1. Happy path — OP comments on own post → removed + bot reply
if (SINGLE_TEST) { console.log('  1. Happy path: OP self-reply → removed + bot reply ... SKIP (single-test mode)'); }
else await test('1. Happy path: OP self-reply → removed + bot reply', async () => {
  const post = await submitPost('happy-path');
  const comment = await submitComment(post, 'Self-reply verification comment — should be removed.');
  await sleep(BOT_WAIT_MS);

  // Check removed
  const removed = await getRemoved(comment);
  assert(removed, `Comment ${comment} was not removed (removed=${removed}). If this is AllHailSeizure's comment on their own post and both ignore flags are false, the bot should have removed it. Check portal settings: selfResponseIgnoreModerators=false AND selfResponseIgnoreContributors=false.`);

  // Check bot reply
  const replies = await getCommentReplies(post, comment);
  const botReplies = replies.filter(r => r.author === 'llmphysics-bot');
  assert(botReplies.length >= 1, `No bot reply found on ${comment} (got ${replies.length} replies total). Ensure selfResponseResponse is set in portal settings.`);
});

// 2. No-op: different author — SKIP (only 1 test user available)
if (SINGLE_TEST) { console.log('  2. No-op: different author → no removal ... SKIP (single-test mode)'); }
else { console.log('  2. No-op: different author → no removal ... SKIP (only 1 test user available)'); }

// 3. Settings: module disabled  (--test3: assumes selfResponseModEnabled=false already set)
if (AUTO) { console.log('  3. Module disabled → no removal ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST3) { /* skip — different test flag active */ }
else await test('3. Module disabled → no removal', async () => {
  // Pre-condition: selfResponseModEnabled = false already set in portal
  // Post AND comment from same user (OP) → should NOT be removed
  const post = await submitPost('disabled-module');
  const comment = await submitComment(post, 'Self-reply while module disabled — should NOT be removed.');
  await sleep(BOT_WAIT_MS);

  const removed = await getRemoved(comment);
  assert(!removed, `Comment ${comment} was removed even though module is disabled!`);

  const replies = await getCommentReplies(post, comment);
  const botReplies = replies.filter(r => r.author === 'llmphysics-bot');
  assert(botReplies.length === 0, `Unexpected bot reply on ${comment} when module is disabled`);
});

// 4. Settings: moderator exempt  (--test4: assumes selfResponseIgnoreModerators=true)
if (AUTO) { console.log('  4. Moderator exempt → no removal ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST4) { /* skip — different test flag active */ }
else await test('4. Moderator exempt when selfResponseIgnoreModerators=true', async () => {
  // Pre-condition: selfResponseIgnoreModerators = true, selfResponseIgnoreContributors = false
  // AllHailSeizure is a mod → should be exempt
  const post = await submitPost('mod-exempt');
  const comment = await submitComment(post, 'Self-reply by moderator — should NOT be removed (mod exempt).');
  await sleep(BOT_WAIT_MS);

  const removed = await getRemoved(comment);
  assert(!removed, `Comment ${comment} was removed even though AllHailSeizure is a mod and ignoreModerators=true!`);

  const replies = await getCommentReplies(post, comment);
  const botReplies = replies.filter(r => r.author === 'llmphysics-bot');
  assert(botReplies.length === 0, `Unexpected bot reply on ${comment} — mod should be exempt`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(44)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0 && passed > 0) {
  console.log('\nAll run tests PASSED ✓');
} else if (failed === 0 && passed === 0) {
  console.log('\nNo tests ran (all skipped or single-test mode with no matching flag).');
} else {
  console.log('\nSome tests FAILED ✗');
  if (!SINGLE_TEST && !AUTO) {
    console.log('\nNOTE: If test 1 (happy path) failed, check portal settings:');
    console.log('  selfResponseIgnoreModerators = false');
    console.log('  selfResponseIgnoreContributors = false');
    console.log('  selfResponseModEnabled = true');
    console.log('  selfResponseResponse = (non-empty string)');
  }
}
