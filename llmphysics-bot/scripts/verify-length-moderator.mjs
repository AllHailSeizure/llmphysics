#!/usr/bin/env node
/**
 * Automated verification for length-moderator.
 *
 * FIRST RUN: node scripts/verify-length-moderator.mjs --list-flairs
 *   → prints flair template IDs for r/llmphysics_dev
 *
 * PORTAL SETUP (required before --auto):
 *   lengthModEnabled              = true
 *   lengthModFlairId              = <uuid from --list-flairs>
 *   lengthModMaxUnhostedLength    = 100
 *   lengthModMaxUnhostedComment   = "Your post is too long."
 *
 * RUN: node scripts/verify-length-moderator.mjs --auto --flair=<uuid>
 *
 * Optional settings tests:
 *   --test4  (lengthModEnabled = false)
 *   --test5  (lengthModMinHostedLength = 50, lengthModMinHostedComment = "Too short.")
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

const created = [];

async function reddit(method, path, body) {
  const url = `https://oauth.reddit.com${path}`;
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA } };
  if (body) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(body).toString();
  }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Reddit API ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getFlairs() {
  const d = await reddit('GET', '/r/llmphysics_dev/api/link_flair_v2');
  return Array.isArray(d) ? d : [];
}

async function submitPost(title, bodyText, flairId = null) {
  const body = {
    api_type: 'json', kind: 'self', sr: 'llmphysics_dev',
    title: `[verify-len-mod] ${title} ${Date.now()}`,
    text: bodyText, resubmit: 'true',
  };
  if (flairId) body.flair_id = flairId;
  const d = await reddit('POST', '/api/submit', body);
  const id = d.json?.data?.id;
  if (!id) throw new Error(`submitPost failed: ${JSON.stringify(d)}`);
  const fullname = `t3_${id}`;
  created.push(fullname);
  return fullname;
}

async function submitLinkPost(title, url, bodyText = '') {
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json', kind: 'link', sr: 'llmphysics_dev',
    title: `[verify-len-mod] ${title} ${Date.now()}`,
    url, resubmit: 'true',
    text: bodyText,
  });
  const id = d.json?.data?.id;
  if (!id) throw new Error(`submitLinkPost failed: ${JSON.stringify(d)}`);
  const fullname = `t3_${id}`;
  created.push(fullname);
  return fullname;
}

async function deleteCreated() {
  if (created.length === 0) return;
  process.stdout.write(`\nCleaning up ${created.length} created post(s)...`);
  for (const id of [...created].reverse()) {
    try { await reddit('POST', '/api/del', { id }); } catch (_) {}
  }
  console.log(' done.');
}

async function selectFlair(postFullname, flairId) {
  await reddit('POST', '/r/llmphysics_dev/api/selectflair', {
    link: postFullname, flair_template_id: flairId,
  });
}

async function getPost(fullname) {
  const d = await reddit('GET', `/api/info?id=${fullname}`);
  return d.data?.children?.[0]?.data;
}

async function getPostComments(postFullname) {
  const postId = postFullname.replace('t3_', '');
  const d = await reddit('GET', `/comments/${postId}?depth=1&limit=25`);
  const comments = d[1]?.data?.children ?? [];
  return comments.filter(c => c.kind === 't1').map(c => c.data);
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

// ─── Flair list mode ──────────────────────────────────────────────────────────

const LIST_FLAIRS = process.argv.includes('--list-flairs');
const AUTO = process.argv.includes('--auto');
const TEST4 = process.argv.includes('--test4'); // module disabled
const TEST5 = process.argv.includes('--test5'); // min hosted length
const SINGLE_TEST = TEST4 || TEST5;

const flairArg = process.argv.find(a => a.startsWith('--flair='));
const FLAIR_ID = flairArg ? flairArg.split('=')[1] : null;

if (LIST_FLAIRS) {
  const flairs = await getFlairs();
  console.log('\nAvailable flair templates for r/llmphysics_dev:\n');
  if (flairs.length === 0) {
    console.log('  (none configured)');
  } else {
    for (const f of flairs) {
      console.log(`  ID:   ${f.id}`);
      console.log(`  Text: ${f.text || '(blank)'}`);
      console.log();
    }
    console.log('Set lengthModFlairId to one of these IDs in the Devvit portal.');
    console.log('Then run: node scripts/verify-length-moderator.mjs --auto --flair=<uuid>');
  }
  process.exit(0);
}

if ((AUTO || !SINGLE_TEST) && !FLAIR_ID) {
  console.log('\nERROR: --flair=<uuid> is required. First run with --list-flairs to see options.\n');
  console.log('  node scripts/verify-length-moderator.mjs --list-flairs');
  process.exit(1);
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

console.log('\n=== length-moderator verification ===\n');
console.log('PRE-CONDITIONS:');
console.log('  • devvit playtest r/llmphysics_dev is running');
console.log('  • lengthModEnabled = true');
if (FLAIR_ID) console.log(`  • lengthModFlairId = ${FLAIR_ID} (set in portal)`);
console.log('  • lengthModMaxUnhostedLength = 100');
console.log('  • lengthModMaxUnhostedComment = "Your post is too long."');
if (AUTO) console.log('  • --auto mode: tests 4-5 will be skipped\n');
else if (SINGLE_TEST) console.log(`  • single-test mode (${process.argv.slice(2).join(' ')})\n`);
else console.log();

const LONG_BODY  = 'a'.repeat(101); // 101 non-whitespace chars → over limit
const SHORT_BODY = 'a'.repeat(50);  // 50 chars → under limit

// 1. Happy path: post with flair + over limit → removed + bot comment
if (SINGLE_TEST) { console.log('  1. Over max length with flair → removed ... SKIP (single-test mode)'); }
else await test('1. Over max length with flair → removed + bot comment', async () => {
  const post = await submitPost('over-limit', LONG_BODY, FLAIR_ID);
  await sleep(BOT_WAIT_MS);

  const pdata = await getPost(post);
  assert(pdata?.removed === true, `post should be removed (got removed=${pdata?.removed})`);

  const comments = await getPostComments(post);
  const botComment = comments.find(c => c.author === 'llmphysics-bot');
  assert(botComment, `expected bot comment on removed post`);
});

// 2. No-op: post with flair + under limit → not removed
if (SINGLE_TEST) { console.log('  2. Under max length with flair → not removed ... SKIP (single-test mode)'); }
else await test('2. Under max length with flair → not removed', async () => {
  const post = await submitPost('under-limit', SHORT_BODY, FLAIR_ID);
  await sleep(BOT_WAIT_MS);

  const pdata = await getPost(post);
  assert(pdata?.removed !== true, `post should NOT be removed (got removed=${pdata?.removed})`);
});

// 3. No-op: post without flair + over limit → not removed (flair gate not met)
if (SINGLE_TEST) { console.log('  3. Over max length, no flair → not removed ... SKIP (single-test mode)'); }
else await test('3. Over max length without flair → not removed', async () => {
  const post = await submitPost('over-limit-no-flair', LONG_BODY); // no flair
  await sleep(BOT_WAIT_MS);

  const pdata = await getPost(post);
  assert(pdata?.removed !== true, `post should NOT be removed without flair (got removed=${pdata?.removed})`);
});

// 4. Settings: module disabled (--test4)
if (AUTO) { console.log('  4. Module disabled → no enforcement ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST4) { console.log('  4. Module disabled → no enforcement ... SKIP (single-test mode)'); }
else await test('4. Module disabled → no enforcement', async () => {
  const post = await submitPost('disabled-test', LONG_BODY, FLAIR_ID);
  await sleep(BOT_WAIT_MS);
  const pdata = await getPost(post);
  assert(pdata?.removed !== true, `post should NOT be removed when module is disabled`);
});

// 5. Settings: min hosted length — link post with short body → removed (--test5)
//    Requires: lengthModMinHostedLength = 50, lengthModMinHostedComment = "Too short."
if (AUTO) { console.log('  5. Link post below min hosted length → removed ... SKIP (--auto)'); }
else if (SINGLE_TEST && !TEST5) { console.log('  5. Link post below min hosted length → removed ... SKIP (single-test mode)'); }
else await test('5. Link post below min hosted length → removed', async () => {
  // Submit a link post with short body text (fewer than 50 non-whitespace chars)
  const post = await submitLinkPost('min-hosted-test', 'https://en.wikipedia.org/wiki/Physics', 'short');
  await sleep(BOT_WAIT_MS);
  const pdata = await getPost(post);
  assert(pdata?.removed === true, `link post with short body should be removed (got removed=${pdata?.removed})`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(44)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('\nAll run tests PASSED ✓');
  if (AUTO) {
    console.log('\nInteractive tests remaining:');
    console.log('  Set lengthModEnabled = false          → node scripts/verify-length-moderator.mjs --test4 --flair=' + FLAIR_ID);
    console.log('  Set lengthModMinHostedLength = 50     → node scripts/verify-length-moderator.mjs --test5 --flair=' + FLAIR_ID);
  }
} else {
  console.log('\nSome tests FAILED ✗ — diagnose before promoting.');
}

await deleteCreated();
