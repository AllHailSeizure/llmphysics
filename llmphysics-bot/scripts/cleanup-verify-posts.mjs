#!/usr/bin/env node
/**
 * cleanup-verify-posts.mjs
 *
 * Finds and deletes all [verify...] test posts you submitted to r/llmphysics_dev.
 *
 * Usage:
 *   node scripts/cleanup-verify-posts.mjs            — dry run, lists found posts
 *   node scripts/cleanup-verify-posts.mjs --confirm  — actually deletes them
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';

// ─── Auth ─────────────────────────────────────────────────────────────────────

const outer = JSON.parse(readFileSync(homedir() + '/.devvit/token', 'utf8'));
const inner = JSON.parse(Buffer.from(outer.token, 'base64').toString('utf8'));
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main ─────────────────────────────────────────────────────────────────────

const CONFIRM = process.argv.includes('--confirm');

const me = await reddit('GET', '/api/v1/me');
const username = me.name;
if (!username) { console.error('Could not determine username'); process.exit(1); }
console.log(`Logged in as u/${username}`);
console.log(`Scanning r/llmphysics_dev for [verify...] posts...\n`);

// Collect all matching posts via paginated listing
const posts = [];
let after = null;

while (true) {
  const qs = new URLSearchParams({ subreddit: 'llmphysics_dev', limit: '100', t: 'all' });
  if (after) qs.set('after', after);

  const data = await reddit('GET', `/user/${username}/submitted?${qs}`);
  const children = data.data?.children ?? [];
  if (children.length === 0) break;

  for (const child of children) {
    const post = child.data;
    // Match any title that starts with [verify (case-insensitive)
    if (/^\[verify/i.test(post.title)) {
      posts.push({ fullname: `t3_${post.id}`, title: post.title, removed: post.removed });
    }
  }

  after = data.data?.after;
  if (!after) break;

  await sleep(500); // be kind to the API
}

if (posts.length === 0) {
  console.log('No [verify...] posts found. Nothing to delete.');
  process.exit(0);
}

console.log(`Found ${posts.length} post(s):\n`);
for (const p of posts) {
  const tag = p.removed ? ' [removed by bot]' : '';
  console.log(`  ${p.fullname}  ${p.title}${tag}`);
}

if (!CONFIRM) {
  console.log(`\nDry run — nothing deleted.`);
  console.log(`Run with --confirm to delete all ${posts.length} post(s).`);
  process.exit(0);
}

console.log(`\nDeleting ${posts.length} post(s)...`);
let deleted = 0;
let errored = 0;

for (const p of posts) {
  try {
    await reddit('POST', '/api/del', { id: p.fullname });
    process.stdout.write('.');
    deleted++;
  } catch (err) {
    process.stdout.write('x');
    errored++;
  }
  await sleep(300); // stay under Reddit's rate limit
}

console.log(`\nDone. Deleted: ${deleted}  Errors: ${errored}`);
