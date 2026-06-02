#!/usr/bin/env node
// verify-define-command.mjs
//
// Command module — fully scriptable. Posts comments with !define and checks bot replies.
//
// Flags:
//   --auto              Run happy-path, off-topic, and missing-argument tests
//   --disabled          Test that no reply is posted when defineCommandEnabled=false
//   --no-grounding      Test that definition still works with defineCommandSearchGrounding=false
//   --cleanup <id>      Delete the test post by fullname

import { readFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const AUTO = args.includes('--auto');
const DISABLED = args.includes('--disabled');
const NO_GROUNDING = args.includes('--no-grounding');
const CLEANUP = args.includes('--cleanup');
const CLEANUP_ID = CLEANUP ? args[args.indexOf('--cleanup') + 1] : null;

if (!AUTO && !DISABLED && !NO_GROUNDING && !CLEANUP) {
  console.log('Usage:');
  console.log('  node verify-define-command.mjs --auto');
  console.log('  node verify-define-command.mjs --disabled       (set defineCommandEnabled=false first)');
  console.log('  node verify-define-command.mjs --no-grounding   (set defineCommandSearchGrounding=false first)');
  console.log('  node verify-define-command.mjs --cleanup <fullname>');
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
    title: `[verify-define] ${title} ${Date.now()}`,
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

async function getCommentReplies(postId, commentId) {
  const pid = postId.replace('t3_', '');
  const cid = commentId.replace('t1_', '');
  const res = await fetch(
    `https://oauth.reddit.com/r/llmphysics_dev/comments/${pid}/_/${cid}?depth=2&limit=10`,
    { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA } },
  );
  if (!res.ok) throw new Error(`GET comments → ${res.status}`);
  const data = await res.json();
  const children = data[1]?.data?.children?.[0]?.data?.replies?.data?.children ?? [];
  return children.filter(c => c.kind === 't1').map(c => c.data);
}

// Test runner
let passed = 0, failed = 0;
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try { await fn(); console.log('PASS'); passed++; }
  catch (err) { console.log(`FAIL: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

if (AUTO) {
  const postId = await submitPost('define command');
  console.log(`Test post: ${postId}`);
  console.log(`Cleanup: node verify-define-command.mjs --cleanup ${postId}\n`);

  // Test 1: physics term
  console.log('Test 1: happy path — physics term');
  const c1 = await submitComment(postId, 'u/LLMPhysics-bot !define [quantum entanglement]');
  console.log(`  Comment: ${c1} — waiting 25s for bot reply...`);
  await new Promise(r => setTimeout(r, 25000));
  await test('bot replied with definition', async () => {
    const replies = await getCommentReplies(postId, c1);
    const botReply = replies.find(r => r.author?.toLowerCase() === 'llmphysics-bot');
    assert(botReply, `no reply from LLMPhysics-bot (got ${replies.length} replies from: ${replies.map(r=>r.author).join(', ')||'none'})`);
    assert(
      botReply.body?.toLowerCase().includes('wikipedia') || botReply.body?.toLowerCase().includes('entanglement'),
      `unexpected reply body: ${botReply.body?.slice(0, 200)}`,
    );
  });

  // Test 2: off-topic term
  console.log('\nTest 2: off-topic term — pizza');
  const c2 = await submitComment(postId, 'u/LLMPhysics-bot !define [pizza]');
  console.log(`  Comment: ${c2} — waiting 25s for bot reply...`);
  await new Promise(r => setTimeout(r, 25000));
  await test('bot replied with not-a-concept message', async () => {
    const replies = await getCommentReplies(postId, c2);
    const botReply = replies.find(r => r.author?.toLowerCase() === 'llmphysics-bot');
    assert(botReply, `no reply from LLMPhysics-bot (got ${replies.length} replies)`);
    assert(
      botReply.body?.toLowerCase().includes("doesn't appear") || botReply.body?.toLowerCase().includes('not a'),
      `unexpected reply body: ${botReply.body?.slice(0, 200)}`,
    );
  });

  // Test 3: missing argument (should be silently skipped — no reply)
  console.log('\nTest 3: missing argument — no reply expected');
  const c3 = await submitComment(postId, 'u/LLMPhysics-bot !define');
  console.log(`  Comment: ${c3} — waiting 15s...`);
  await new Promise(r => setTimeout(r, 15000));
  await test('no reply when argument missing', async () => {
    const replies = await getCommentReplies(postId, c3);
    const botReply = replies.find(r => r.author?.toLowerCase() === 'llmphysics-bot');
    assert(!botReply, `unexpected bot reply: ${botReply?.body?.slice(0, 100)}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (DISABLED) {
  const postId = await submitPost('define disabled');
  console.log(`Test post: ${postId}`);
  console.log(`Cleanup: node verify-define-command.mjs --cleanup ${postId}\n`);

  console.log('Test: disabled — no reply expected');
  const c1 = await submitComment(postId, 'u/LLMPhysics-bot !define [photon]');
  console.log(`  Comment: ${c1} — waiting 15s...`);
  await new Promise(r => setTimeout(r, 15000));
  await test('no reply when command disabled', async () => {
    const replies = await getCommentReplies(postId, c1);
    const botReply = replies.find(r => r.author?.toLowerCase() === 'llmphysics-bot');
    assert(!botReply, `unexpected bot reply: ${botReply?.body?.slice(0, 100)}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (NO_GROUNDING) {
  const postId = await submitPost('define no-grounding');
  console.log(`Test post: ${postId}`);
  console.log(`Cleanup: node verify-define-command.mjs --cleanup ${postId}\n`);

  console.log('Test: search grounding off — definition should still work');
  const c1 = await submitComment(postId, 'u/LLMPhysics-bot !define [electron]');
  console.log(`  Comment: ${c1} — waiting 25s for bot reply...`);
  await new Promise(r => setTimeout(r, 25000));
  await test('bot replied with definition (no grounding)', async () => {
    const replies = await getCommentReplies(postId, c1);
    const botReply = replies.find(r => r.author?.toLowerCase() === 'llmphysics-bot');
    assert(botReply, `no reply from LLMPhysics-bot (got ${replies.length} replies)`);
    assert(
      botReply.body?.toLowerCase().includes('wikipedia') || botReply.body?.toLowerCase().includes('electron'),
      `unexpected reply body: ${botReply.body?.slice(0, 200)}`,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (CLEANUP) {
  if (!CLEANUP_ID) { console.error('--cleanup requires a post fullname'); process.exit(1); }
  console.log(`Deleting ${CLEANUP_ID}...`);
  await reddit('POST', '/api/del', { id: CLEANUP_ID });
  console.log('Done.');
}
