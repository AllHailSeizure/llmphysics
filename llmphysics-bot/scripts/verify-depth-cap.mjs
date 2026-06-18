#!/usr/bin/env node
/**
 * Automated verification for depth-cap-moderator.
 *
 * Pre-conditions (set in r/llmphysics_dev mod tools → llmphysics-bot settings):
 *   depthCap = 5
 *   depthCapIgnoreModerators = false   ← required: AllHailSeizure is a mod
 *   depthCapModEnabled = true
 *
 * Run: node scripts/verify-depth-cap.mjs
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

const created = []; // fullnames of all posts/comments we create, for auto-cleanup

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
    title: `[verify-depth-cap] ${title} ${Date.now()}`,
    text: 'Automated depth-cap verification post.',
    resubmit: 'true',
  });
  const postId = data.json?.data?.id;
  if (!postId) throw new Error(`submitPost failed: ${JSON.stringify(data)}`);
  const fullname = `t3_${postId}`;
  created.push(fullname);
  return fullname;
}

async function submitComment(parentFullname, text = 'depth chain comment') {
  await sleep(1200); // Reddit rejects comments posted < ~1s apart
  const data = await reddit('POST', '/api/comment', {
    api_type: 'json',
    thing_id: parentFullname,
    text,
  });
  const id = data.json?.data?.things?.[0]?.data?.id;
  if (!id) throw new Error(`submitComment failed: ${JSON.stringify(data)}`);
  const fullname = `t1_${id}`;
  created.push(fullname);
  return fullname;
}

async function deleteCreated() {
  if (created.length === 0) return;
  process.stdout.write(`\nCleaning up ${created.length} created post(s)/comment(s)...`);
  for (const id of [...created].reverse()) {
    try { await reddit('POST', '/api/del', { id }); } catch (_) {}
  }
  console.log(' done.');
}

async function getComment(fullname) {
  const data = await reddit('GET', `/api/info?id=${fullname}`);
  return data.data?.children?.[0]?.data;
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

async function buildChain(postFullname, depth) {
  const chain = [postFullname];
  for (let i = 0; i < depth; i++) {
    const parent = chain[chain.length - 1];
    const next = await submitComment(parent, `depth chain comment ${i + 1}`);
    chain.push(next);
  }
  return chain; // [post, c1, c2, ..., cN]
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

const BOT_WAIT_MS = 5000; // time to wait for bot to process after final comment

const AUTO = process.argv.includes('--auto');
const TEST5 = process.argv.includes('--test5'); // module disabled
const TEST6 = process.argv.includes('--test6'); // cap=3
const TEST7 = process.argv.includes('--test7'); // custom response
const TEST8 = process.argv.includes('--test8'); // mod exempt
const SINGLE_TEST = TEST5 || TEST6 || TEST7 || TEST8;

console.log('\n=== depth-cap-moderator verification ===\n');
console.log('PRE-CONDITIONS:');
console.log('  • devvit playtest r/llmphysics_dev is running');
console.log('  • depthCap = 5  (set in bot settings)');
console.log('  • depthCapIgnoreModerators = false');
console.log('  • depthCapIgnoreContributors = false  (AllHailSeizure is a contributor on this sub)');
console.log('  • depthCapModEnabled = true');
if (AUTO) console.log('  • --auto mode: tests 5-8 (require setting changes) will be skipped\n');
else if (SINGLE_TEST) console.log(`  • single-test mode (${process.argv.slice(2).join(' ')}): only the flagged settings test will run\n`);
else console.log();

// 1. Happy path — depth == cap fires
if (SINGLE_TEST) { console.log('  1. Happy path: depth 5 → locked + bot reply ... SKIP (single-test mode)'); }
else await test('1. Happy path: depth 5 → locked + bot reply', async () => {
  const post = await submitPost('happy-path');
  const chain = await buildChain(post, 5); // c1..c5
  const c5 = chain[5];
  const c3 = chain[3];
  const c4 = chain[4];
  await sleep(BOT_WAIT_MS);

  const c5data = await getComment(c5);
  assert(c5data?.locked === true, `c5 not locked (locked=${c5data?.locked})`);

  const c3data = await getComment(c3);
  assert(c3data?.locked !== true, `c3 should NOT be locked`);
  const c4data = await getComment(c4);
  assert(c4data?.locked !== true, `c4 should NOT be locked`);

  const replies = await getCommentReplies(post, c5);
  assert(replies.length >= 1, `c5 has no bot reply (got ${replies.length} replies)`);
  assert(replies[0].author === 'llmphysics-bot', `reply author is ${replies[0].author}, expected LLMPhysics-bot`);
});

// 2. No-op — depth < cap
if (SINGLE_TEST) { console.log('  2. No-op: depth 4 → not locked ... SKIP (single-test mode)'); }
else await test('2. No-op: depth 4 → not locked', async () => {
  const post = await submitPost('noop-depth-4');
  const chain = await buildChain(post, 4); // c1..c4
  const c4 = chain[4];
  await sleep(BOT_WAIT_MS);

  const c4data = await getComment(c4);
  assert(c4data?.locked !== true, `c4 should NOT be locked (got locked=${c4data?.locked})`);
  const replies = await getCommentReplies(post, c4);
  const botReplies = replies.filter(r => r.author === 'llmphysics-bot');
  assert(botReplies.length === 0, `unexpected bot reply on c4`);
});

// 3. No-op — depth > cap (submit c6 before bot can act on c5)
if (SINGLE_TEST) { console.log('  3. No-op: depth 6 → c6 not locked ... SKIP (single-test mode)'); }
else await test('3. No-op: depth 6 → c6 not locked', async () => {
  const post = await submitPost('noop-depth-6');
  const chain = await buildChain(post, 6); // quickly builds c1..c6
  const c6 = chain[6];
  await sleep(BOT_WAIT_MS);

  const c6data = await getComment(c6);
  assert(c6data?.locked !== true, `c6 should NOT be locked (depth > cap exits early)`);
});

// 4. Boundary: depth 4 no-op then depth 5 fires
if (SINGLE_TEST) { console.log('  4. Boundary: c4 no-op / c5 fires in same chain ... SKIP (single-test mode)'); }
else await test('4. Boundary: c4 no-op / c5 fires in same chain', async () => {
  const post = await submitPost('boundary');
  const chain4 = await buildChain(post, 4);
  const c4 = chain4[4];
  await sleep(BOT_WAIT_MS);
  const c4data = await getComment(c4);
  assert(c4data?.locked !== true, `c4 should NOT be locked`);

  const c5 = await submitComment(c4, 'boundary depth 5');
  await sleep(BOT_WAIT_MS);
  const c5data = await getComment(c5);
  assert(c5data?.locked === true, `c5 should be locked`);
});

// 5. Settings: disabled  (--test5: assumes depthCapModEnabled already set to false)
if (AUTO) { console.log('  5. Module disabled → no enforcement ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST5) { /* skip — different test flag active */ }
else await test('5. Module disabled → no enforcement', async () => {
  if (!TEST5) { console.log('\n    ⚠ Set depthCapModEnabled = false, then press Enter'); await waitForEnter(); }
  const post = await submitPost('disabled');
  const chain = await buildChain(post, 5);
  const c5 = chain[5];
  await sleep(BOT_WAIT_MS);
  const c5data = await getComment(c5);
  assert(c5data?.locked !== true, `c5 should NOT be locked when module is disabled`);
  if (!TEST5) { console.log('    ⚠ Reset depthCapModEnabled = true, then press Enter'); await waitForEnter(); }
});

// 6. Settings: custom cap  (--test6: assumes depthCap already set to 3)
if (AUTO) { console.log('  6. Custom cap=3 → c3 locked ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST6) { /* skip — different test flag active */ }
else await test('6. Custom cap=3 → c3 locked', async () => {
  if (!TEST6) { console.log('\n    ⚠ Set depthCap = 3, then press Enter'); await waitForEnter(); }
  const post = await submitPost('cap-3');
  const chain = await buildChain(post, 3);
  const c3 = chain[3];
  await sleep(BOT_WAIT_MS);
  const c3data = await getComment(c3);
  assert(c3data?.locked === true, `c3 should be locked when cap=3`);
  if (!TEST6) { console.log('    ⚠ Reset depthCap = 5, then press Enter'); await waitForEnter(); }
});

// 7. Settings: custom response  (--test7: assumes depthCapResponse already set to 'Test cap message.')
if (AUTO) { console.log('  7. Custom response message appears in bot reply ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST7) { /* skip — different test flag active */ }
else await test('7. Custom response message appears in bot reply', async () => {
  const CUSTOM_MSG = 'Test cap message.';
  if (!TEST7) { console.log(`\n    ⚠ Set depthCapResponse = "${CUSTOM_MSG}", then press Enter`); await waitForEnter(); }
  const post = await submitPost('custom-response');
  const chain = await buildChain(post, 5);
  const c5 = chain[5];
  await sleep(BOT_WAIT_MS);
  const replies = await getCommentReplies(post, c5);
  const botReply = replies.find(r => r.author === 'llmphysics-bot');
  assert(botReply, 'no bot reply found');
  assert(botReply.body.startsWith(CUSTOM_MSG), `reply body: "${botReply.body.slice(0, 60)}"`);
  if (!TEST7) { console.log('    ⚠ Clear depthCapResponse, then press Enter'); await waitForEnter(); }
});

// 8. Settings: moderator exemption  (--test8: assumes depthCapIgnoreModerators already set to true)
if (AUTO) { console.log('  8. Moderator exempt when depthCapIgnoreModerators=true ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST8) { /* skip — different test flag active */ }
else await test('8. Moderator exempt when depthCapIgnoreModerators=true', async () => {
  if (!TEST8) { console.log('\n    ⚠ Set depthCapIgnoreModerators = true, then press Enter'); await waitForEnter(); }
  const post = await submitPost('mod-exempt');
  const chain = await buildChain(post, 5);
  const c5 = chain[5];
  await sleep(BOT_WAIT_MS);
  const c5data = await getComment(c5);
  assert(c5data?.locked !== true, `c5 should NOT be locked (AllHailSeizure is a mod, exempt)`);
  if (!TEST8) { console.log('    ⚠ Reset depthCapIgnoreModerators = false, then press Enter'); await waitForEnter(); }
});


// 9. Regression: direct reply to post (depth 1) with cap > 1
if (SINGLE_TEST) { console.log('  9. Regression: depth 1 direct reply → no enforcement ... SKIP (single-test mode)'); }
else await test('9. Regression: depth 1 direct reply → no enforcement', async () => {
  const post = await submitPost('depth-1-regression');
  const c1 = await submitComment(post, 'direct reply to post');
  await sleep(BOT_WAIT_MS);
  const c1data = await getComment(c1);
  assert(c1data?.locked !== true, `c1 (depth 1) should NOT be locked`);
  const replies = await getCommentReplies(post, c1);
  const botReplies = replies.filter(r => r.author === 'llmphysics-bot');
  assert(botReplies.length === 0, `unexpected bot reply on depth-1 comment`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(44)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('\nAll functional tests PASSED ✓');
  console.log('Run Supabase log check (scenario 10) to complete verification.');
} else {
  console.log('\nSome tests FAILED ✗ — fix before promoting.');
}

await deleteCreated();

// ─── Utility ─────────────────────────────────────────────────────────────────

function waitForEnter() {
  return new Promise(resolve => {
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}
