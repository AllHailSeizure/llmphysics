#!/usr/bin/env node
// verify-response-tool.mjs
//
// Action module — UI-driven. Seeds posts and verifies state via Reddit API.
// Claude drives interactive steps in conversation.
//
// Flags:
//   --seed                   Create a test post; prints ID
//   --check-comment <postId> Verify LLMPhysics-bot commented on the post
//   --check-locked <postId>  Verify the post is locked
//   --cleanup <postId>       Delete the test post

import { readFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const SEED = args.includes('--seed');
const CHECK_COMMENT = args.includes('--check-comment');
const CHECK_LOCKED = args.includes('--check-locked');
const CLEANUP = args.includes('--cleanup');

const POST_ID = (CHECK_COMMENT || CHECK_LOCKED || CLEANUP)
  ? args[(CHECK_COMMENT ? args.indexOf('--check-comment') : CHECK_LOCKED ? args.indexOf('--check-locked') : args.indexOf('--cleanup')) + 1]
  : null;

if (!SEED && !CHECK_COMMENT && !CHECK_LOCKED && !CLEANUP) {
  console.log('Usage:');
  console.log('  node verify-response-tool.mjs --seed');
  console.log('  node verify-response-tool.mjs --check-comment <fullname>');
  console.log('  node verify-response-tool.mjs --check-locked <fullname>');
  console.log('  node verify-response-tool.mjs --cleanup <fullname>');
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

async function getPost(fullname) {
  const d = await reddit('GET', `/api/info?id=${fullname}`);
  return d.data?.children?.[0]?.data;
}

async function getPostComments(postId) {
  const pid = postId.replace('t3_', '');
  const res = await fetch(
    `https://oauth.reddit.com/r/llmphysics_dev/comments/${pid}?limit=25&depth=1&sort=new`,
    { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA } },
  );
  if (!res.ok) throw new Error(`GET comments → ${res.status}`);
  const data = await res.json();
  const children = data[1]?.data?.children ?? [];
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

if (SEED) {
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json', kind: 'self', sr: 'llmphysics_dev',
    title: `[verify-response-tool] seed ${Date.now()}`,
    text: 'Automated verification post — safe to delete.',
  });
  const id = d.json?.data?.id;
  if (!id) { console.error('Submit failed:', JSON.stringify(d)); process.exit(1); }
  const fullname = `t3_${id}`;
  console.log(`Seeded: ${fullname}`);
  console.log(`URL: https://www.reddit.com/r/llmphysics_dev/comments/${id}/?playtest=llmphysics-bot`);
  console.log(`Cleanup: node verify-response-tool.mjs --cleanup ${fullname}`);
}

if (CHECK_COMMENT) {
  if (!POST_ID) { console.error('--check-comment requires a post fullname'); process.exit(1); }
  console.log(`Checking for bot comment on ${POST_ID}...`);
  await new Promise(r => setTimeout(r, 5000));
  await test('LLMPhysics-bot commented on post', async () => {
    const comments = await getPostComments(POST_ID);
    const botComment = comments.find(c => c.author?.toLowerCase() === 'llmphysics-bot');
    assert(botComment, `no comment from LLMPhysics-bot (${comments.length} total comments from: ${comments.map(c=>c.author).join(', ')||'none'})`);
    console.log(`\n    comment body: ${botComment.body?.slice(0, 120)}`);
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (CHECK_LOCKED) {
  if (!POST_ID) { console.error('--check-locked requires a post fullname'); process.exit(1); }
  console.log(`Checking ${POST_ID} is locked...`);
  await new Promise(r => setTimeout(r, 5000));
  await test('post is locked', async () => {
    const post = await getPost(POST_ID);
    assert(post, 'post not found');
    assert(post.locked === true, `locked=${post.locked}`);
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (CLEANUP) {
  if (!POST_ID) { console.error('--cleanup requires a post fullname'); process.exit(1); }
  console.log(`Deleting ${POST_ID}...`);
  await reddit('POST', '/api/del', { id: POST_ID });
  console.log('Done.');
}
