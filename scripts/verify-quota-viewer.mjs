#!/usr/bin/env node
// verify-quota-viewer.mjs
//
// Action module — UI-driven. Automates test data seeding only.
// Claude drives interactive steps in conversation and checks logs via Supabase MCP.
//
// Flags:
//   --seed              Submit a test post so AllHailSeizure has quota data.
//   --cleanup <id>      Delete a seeded post by fullname (e.g. t3_abc123).

import { readFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const SEED = args.includes('--seed');
const CLEANUP = args.includes('--cleanup');
const CLEANUP_ID = CLEANUP ? args[args.indexOf('--cleanup') + 1] : null;

if (!SEED && !CLEANUP) {
  console.log('Usage:');
  console.log('  node verify-quota-viewer.mjs --seed');
  console.log('  node verify-quota-viewer.mjs --cleanup <fullname>');
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

if (SEED) {
  console.log('Submitting seed post...');
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json',
    kind: 'self',
    sr: 'llmphysics_dev',
    title: `[verify-quota] seed ${Date.now()}`,
    text: 'Automated verification post — safe to delete.',
  });
  const id = d.json?.data?.id;
  if (!id) { console.error('Submit failed:', JSON.stringify(d)); process.exit(1); }
  const fullname = `t3_${id}`;
  console.log(`Seeded: ${fullname}`);
  console.log(`URL: https://www.reddit.com/r/llmphysics_dev/comments/${id}/`);
  console.log('Wait ~8s for flood-moderator to track it before running interactive tests.');
}

if (CLEANUP) {
  if (!CLEANUP_ID) { console.error('--cleanup requires a fullname (e.g. t3_abc123)'); process.exit(1); }
  console.log(`Deleting ${CLEANUP_ID}...`);
  await reddit('POST', '/api/del', { id: CLEANUP_ID });
  console.log('Done.');
}
