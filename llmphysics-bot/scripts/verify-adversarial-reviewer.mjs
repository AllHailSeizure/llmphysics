#!/usr/bin/env node
// verify-adversarial-reviewer.mjs
//
// Action module verification for adversarial-reviewer.
// Claude drives interactive steps in conversation; script handles seeding and API-state checks.
//
// Flags:
//   --seed                     Create a plain self-post; print fullname + playtest URL
//   --seed-link <url>          Create a link post with <url>; print fullname + playtest URL
//   --check-review <postId>    Wait 8s; assert 1 distinguished bot comment with ## Adversarial Review
//   --check-dedup  <postId>    Assert still exactly 1 bot comment (dedup held second trigger)
//   --cleanup      <postId>    Delete the post

import { readFileSync } from 'fs';
import { homedir } from 'os';

// ── Auth ──────────────────────────────────────────────────────────────────────

const outer = JSON.parse(readFileSync(homedir() + '/.devvit/token', 'utf8'));
const inner = JSON.parse(Buffer.from(outer.token, 'base64').toString());
const TOKEN = inner.accessToken;
const UA    = 'llmphysics-bot-verify/1.0 (by AllHailSeizure)';

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

async function submitSelfPost(title) {
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json', kind: 'self', sr: 'llmphysics_dev',
    title: `[verify] adversarial-reviewer ${title} ${Date.now()}`,
    text: 'Automated verification post for adversarial-reviewer. Safe to delete.',
  });
  const id = d.json?.data?.id;
  if (!id) throw new Error(`Submit failed: ${JSON.stringify(d)}`);
  return `t3_${id}`;
}

async function submitLinkPost(url, label) {
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json', kind: 'link', sr: 'llmphysics_dev',
    title: `[verify] adversarial-reviewer ${label} ${Date.now()}`,
    url,
  });
  const id = d.json?.data?.id;
  if (!id) throw new Error(`Submit failed: ${JSON.stringify(d)}`);
  return `t3_${id}`;
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

function playtestUrl(postId) {
  const shortId = postId.replace('t3_', '');
  return `https://www.reddit.com/r/llmphysics_dev/comments/${shortId}/?playtest=llmphysics-bot`;
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try { await fn(); console.log('PASS'); passed++; }
  catch (err) { console.log(`FAIL: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const after = flag => args[args.indexOf(flag) + 1];

if (!has('--seed') && !has('--seed-link') && !has('--check-review') && !has('--check-dedup') && !has('--cleanup')) {
  console.log('Usage:');
  console.log('  node scripts/verify-adversarial-reviewer.mjs --seed');
  console.log('  node scripts/verify-adversarial-reviewer.mjs --seed-link <url>');
  console.log('  node scripts/verify-adversarial-reviewer.mjs --check-review <postFullname>');
  console.log('  node scripts/verify-adversarial-reviewer.mjs --check-dedup  <postFullname>');
  console.log('  node scripts/verify-adversarial-reviewer.mjs --cleanup      <postFullname>');
  console.log('');
  console.log('Settings required (set once at https://developers.reddit.com/r/llmphysics_dev/apps/llmphysics-bot):');
  console.log('  adversarialReviewerEnabled = ON');
  console.log('  adversarialReviewerFlairId = (blank for happy-path tests)');
  console.log('  geminiApiKey               = (already configured)');
  process.exit(0);
}

// ── --seed ────────────────────────────────────────────────────────────────────

if (has('--seed')) {
  const postId = await submitSelfPost('text-only');
  console.log(`Seeded:  ${postId}`);
  console.log(`URL:     ${playtestUrl(postId)}`);
  console.log(`Cleanup: node scripts/verify-adversarial-reviewer.mjs --cleanup ${postId}`);
}

// ── --seed-link ───────────────────────────────────────────────────────────────

if (has('--seed-link')) {
  const url = after('--seed-link');
  if (!url) { console.error('--seed-link requires a URL argument'); process.exit(1); }

  // Derive a label from the URL hostname for readability
  let label = 'pdf';
  try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }

  const postId = await submitLinkPost(url, label);
  console.log(`Seeded:  ${postId}`);
  console.log(`URL:     ${playtestUrl(postId)}`);
  console.log(`PDF URL: ${url}`);
  console.log(`Cleanup: node scripts/verify-adversarial-reviewer.mjs --cleanup ${postId}`);
}

// ── --check-review ────────────────────────────────────────────────────────────

if (has('--check-review')) {
  const postId = after('--check-review');
  if (!postId) { console.error('--check-review requires a post fullname'); process.exit(1); }

  console.log(`\nChecking review comment on ${postId}...`);
  console.log('Waiting 8s for bot...');
  await new Promise(r => setTimeout(r, 8000));

  await test('LLMPhysics-bot posted a distinguished review comment', async () => {
    const comments = await getPostComments(postId);
    const botComments = comments.filter(c =>
      c.author?.toLowerCase() === 'llmphysics-bot' && c.distinguished === 'moderator'
    );
    assert(botComments.length >= 1,
      `expected ≥1 distinguished bot comment, got ${botComments.length} (total: ${comments.length}, authors: ${comments.map(c => c.author).join(', ') || 'none'})`
    );
    assert(
      botComments[0].body?.includes('## Adversarial Review'),
      `comment missing "## Adversarial Review" header. Body start: ${botComments[0].body?.slice(0, 150)}`
    );
    console.log(`\n    body preview: ${botComments[0].body?.slice(0, 120)}...`);
  });

  console.log(`\nPassed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

// ── --check-dedup ─────────────────────────────────────────────────────────────

if (has('--check-dedup')) {
  const postId = after('--check-dedup');
  if (!postId) { console.error('--check-dedup requires a post fullname'); process.exit(1); }

  console.log(`\nChecking dedup held on ${postId}...`);
  console.log('Waiting 8s for bot...');
  await new Promise(r => setTimeout(r, 8000));

  await test('Post still has exactly 1 bot comment (dedup prevented duplicate)', async () => {
    const comments = await getPostComments(postId);
    const botComments = comments.filter(c =>
      c.author?.toLowerCase() === 'llmphysics-bot' && c.distinguished === 'moderator'
    );
    assert(botComments.length === 1,
      `expected exactly 1 bot comment, got ${botComments.length} — dedup may not have fired`
    );
  });

  console.log(`\nPassed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

// ── --cleanup ─────────────────────────────────────────────────────────────────

if (has('--cleanup')) {
  const postId = after('--cleanup');
  if (!postId) { console.error('--cleanup requires a post fullname'); process.exit(1); }
  console.log(`Deleting ${postId}...`);
  await reddit('POST', '/api/del', { id: postId });
  console.log('Done.');
}
