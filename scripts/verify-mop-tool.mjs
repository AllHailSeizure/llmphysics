#!/usr/bin/env node
// verify-mop-tool.mjs
//
// Action module — UI-driven. Seeds comment chains and verifies state via Reddit API.
// Claude drives interactive steps in conversation.
//
// Flags:
//   --seed              Create a post with a 3-comment chain; prints IDs to use with --check
//   --check-removed <ids>  Comma-separated fullnames — verify all are removed (e.g. t1_a,t1_b,t1_c)
//   --check-locked <ids>   Comma-separated fullnames — verify all are locked
//   --cleanup <postId>  Delete the test post

import { readFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const SEED = args.includes('--seed');
const CHECK_REMOVED = args.includes('--check-removed');
const CHECK_LOCKED = args.includes('--check-locked');
const CLEANUP = args.includes('--cleanup');

const CHECK_IDS = (CHECK_REMOVED || CHECK_LOCKED)
  ? (args[args.indexOf(CHECK_REMOVED ? '--check-removed' : '--check-locked') + 1] ?? '').split(',').filter(Boolean)
  : [];
const CLEANUP_ID = CLEANUP ? args[args.indexOf('--cleanup') + 1] : null;

if (!SEED && !CHECK_REMOVED && !CHECK_LOCKED && !CLEANUP) {
  console.log('Usage:');
  console.log('  node verify-mop-tool.mjs --seed');
  console.log('  node verify-mop-tool.mjs --check-removed t1_a,t1_b,t1_c');
  console.log('  node verify-mop-tool.mjs --check-locked t1_a,t1_b,t1_c');
  console.log('  node verify-mop-tool.mjs --cleanup t3_xxx');
  process.exit(0);
}

// Auth
const outer = JSON.parse(readFileSync(homedir() + '/.devvit/token', 'utf8'));
const inner = JSON.parse(Buffer.from(outer.token, 'base64').toString());
const TOKEN = inner.accessToken;
const UA = 'llmphysics-bot-verify/1.0 (by AllHailSeizure)';

async function reddit(method, path, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA } };
  if (body) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(body).toString();
  }
  const res = await fetch(`https://oauth.reddit.com${path}`, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function submitPost(title) {
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json', kind: 'self', sr: 'llmphysics_dev',
    title: `[verify-mop] ${title} ${Date.now()}`,
    text: 'Automated verification post — safe to delete.',
  });
  const id = d.json?.data?.id;
  if (!id) throw new Error(JSON.stringify(d));
  return `t3_${id}`;
}

async function submitComment(parent, text) {
  await new Promise(r => setTimeout(r, 1400));
  const d = await reddit('POST', '/api/comment', { api_type: 'json', thing_id: parent, text });
  const id = d.json?.data?.things?.[0]?.data?.id;
  if (!id) throw new Error(JSON.stringify(d));
  return `t1_${id}`;
}

async function getComment(fullname) {
  const d = await reddit('GET', `/api/info?id=${fullname}`);
  return d.data?.children?.[0]?.data;
}

// Test runner
let passed = 0, failed = 0;
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try { await fn(); console.log('PASS'); passed++; }
  catch (err) { console.log(`FAIL: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

if (SEED) {
  console.log('Creating post and 3-comment chain...');
  const postId = await submitPost('chain-mop seed');
  console.log(`Post: ${postId}`);

  const c1 = await submitComment(postId, 'root comment (Chain Mop target)');
  const c2 = await submitComment(c1, 'reply to root');
  const c3 = await submitComment(c2, 'reply to reply');

  console.log(`\nChain:`);
  console.log(`  c1 (root): ${c1}`);
  console.log(`  c2       : ${c2}`);
  console.log(`  c3       : ${c3}`);
  console.log(`\nPost URL: https://www.reddit.com/r/llmphysics_dev/comments/${postId.slice(3)}/`);
  console.log(`\nWait ~5s then open Chain Mop on c1 (${c1}).`);
  console.log(`IDs for --check flags: ${c1},${c2},${c3}`);
  console.log(`Cleanup: node verify-mop-tool.mjs --cleanup ${postId}`);
}

if (CHECK_REMOVED) {
  if (!CHECK_IDS.length) { console.error('--check-removed requires comma-separated fullnames'); process.exit(1); }
  console.log(`Checking ${CHECK_IDS.length} comments are removed...`);
  await new Promise(r => setTimeout(r, 8000)); // wait for bot action
  for (const id of CHECK_IDS) {
    await test(`${id} removed`, async () => {
      const c = await getComment(id);
      assert(c, `comment not found`);
      assert(c.removed === true, `removed=${c.removed}`);
    });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (CHECK_LOCKED) {
  if (!CHECK_IDS.length) { console.error('--check-locked requires comma-separated fullnames'); process.exit(1); }
  console.log(`Checking ${CHECK_IDS.length} comments are locked...`);
  await new Promise(r => setTimeout(r, 8000));
  for (const id of CHECK_IDS) {
    await test(`${id} locked`, async () => {
      const c = await getComment(id);
      assert(c, `comment not found`);
      assert(c.locked === true, `locked=${c.locked}`);
    });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (CLEANUP) {
  if (!CLEANUP_ID) { console.error('--cleanup requires a post fullname'); process.exit(1); }
  console.log(`Deleting ${CLEANUP_ID}...`);
  await reddit('POST', '/api/del', { id: CLEANUP_ID });
  console.log('Done.');
}
