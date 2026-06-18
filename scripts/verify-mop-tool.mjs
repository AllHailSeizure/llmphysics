#!/usr/bin/env node
/**
 * verify-mop-tool.mjs
 *
 * Verification script for the mop-tool action module (Chain Mop).
 *
 * Usage:
 *   node scripts/verify-mop-tool.mjs [--auto] [-h|--help]
 *
 * Flags:
 *   --auto   Run only the automated checks (API connectivity + comment setup).
 *   -h, --help  Show this help message and exit.
 *
 * All Chain Mop tests require mod-menu UI on a live playtest. This script:
 *   1. Verifies API connectivity.
 *   2. Submits a test comment thread you can target with Chain Mop.
 *   3. Prints manual steps for each test case.
 *
 * Prerequisites (Developer Portal):
 *   mopToolEnabled = true   (default)
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ─── Auth ──────────────────────────────────────────────────────────────────────

function loadAccessToken() {
  try {
    const tokenPath = join(homedir(), '.devvit', 'token');
    const outer = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const inner = JSON.parse(Buffer.from(outer.token, 'base64').toString('utf8'));
    return inner.accessToken;
  } catch (err) {
    console.error('Could not load access token from ~/.devvit/token:', err.message);
    process.exit(1);
  }
}

async function redditGet(path, accessToken) {
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'llmphysics-bot-verify/1.0 (by AllHailSeizure)',
    },
  });
  if (!res.ok) throw new Error(`Reddit API ${path} → HTTP ${res.status}`);
  return res.json();
}

async function redditPost(path, body, accessToken) {
  const params = new URLSearchParams(body);
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'llmphysics-bot-verify/1.0 (by AllHailSeizure)',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Reddit API POST ${path} → HTTP ${res.status}`);
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, reason) { console.log(`  FAIL  ${label}: ${reason}`); }
function skip(label, reason) { console.log(`  SKIP  ${label}: ${reason}`); }
function info(msg) { console.log(`        ${msg}`); }

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node scripts/verify-mop-tool.mjs [--auto] [-h|--help]');
  console.log('See file header for full documentation.');
  process.exit(0);
}
const autoOnly = args.includes('--auto');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== mop-tool (Chain Mop) verification ===\n');
  console.log('Module type : action (mod menu → Chain Mop, comment location)');
  console.log('Subreddit   : r/llmphysics_dev');
  console.log('Test user   : AllHailSeizure\n');

  const accessToken = loadAccessToken();

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // ─── Test 0: API connectivity ─────────────────────────────────────────────
  console.log('Test 0: Reddit API connectivity');
  try {
    const me = await redditGet('/api/v1/me', accessToken);
    if (me.name) {
      pass(`Authenticated as u/${me.name}`);
      passed++;
    } else {
      fail('API connectivity', 'Unexpected response shape');
      failed++;
    }
  } catch (err) {
    fail('API connectivity', err.message);
    failed++;
  }

  // ─── Test 0b: Create test post + comment chain ────────────────────────────
  console.log('\nTest 0b: Create test post and comment chain for manual Chain Mop tests');
  let postId = null;
  let topCommentId = null;
  try {
    const submitRes = await redditPost('/api/submit', {
      sr: 'llmphysics_dev',
      kind: 'self',
      title: '[VERIFY] mop-tool test post — delete after testing',
      text: 'This post was created by the verify-mop-tool script. Delete it after testing.',
      nsfw: false,
      spoiler: false,
      resubmit: true,
    }, accessToken);

    const postData = submitRes?.json?.data;
    if (!postData?.id) throw new Error('Submit did not return post ID');
    postId = postData.id;
    pass(`Created test post: t3_${postId}`);
    info(`URL: https://www.reddit.com/r/llmphysics_dev/comments/${postId}/`);
    passed++;

    // Add root comment
    const rootRes = await redditPost('/api/comment', {
      thing_id: `t3_${postId}`,
      text: '[verify] Root comment — Chain Mop target',
      return_rtjson: false,
    }, accessToken);
    const rootCommentId = rootRes?.json?.data?.things?.[0]?.data?.id;
    if (!rootCommentId) throw new Error('Root comment submit did not return ID');
    topCommentId = rootCommentId;
    pass(`Created root comment: t1_${rootCommentId}`);
    passed++;

    // Add a reply to the root comment
    const replyRes = await redditPost('/api/comment', {
      thing_id: `t1_${rootCommentId}`,
      text: '[verify] Child comment 1 — should be removed with chain',
    }, accessToken);
    const replyId = replyRes?.json?.data?.things?.[0]?.data?.id;
    if (replyId) {
      pass(`Created child comment: t1_${replyId}`);
      passed++;
    }

    console.log(`\n  Test chain ready. Target the ROOT comment for Chain Mop:`);
    info(`Root comment ID: t1_${topCommentId}`);
    info(`Post URL: https://www.reddit.com/r/llmphysics_dev/comments/${postId}/?playtest=llmphysics-bot`);
    console.log('');
  } catch (err) {
    fail('Create test chain', err.message);
    failed++;
    topCommentId = '<create failed — use an existing comment>';
  }

  if (autoOnly) {
    console.log('\n(--auto flag set: skipping manual test instructions)');
    skipped += 4;
  } else {
    // ─── Test 1: Happy path — remove chain ──────────────────────────────────
    console.log('Test 1: Happy path — invoke Chain Mop → chain removed');
    skip('Chain removal', 'Action module — requires mod-menu UI on the comment');
    skipped++;
    console.log('  Manual steps:');
    info(`1. Go to the test post URL printed above with ?playtest=llmphysics-bot`);
    info(`2. Find the root comment: t1_${topCommentId}`);
    info('3. Click the comment overflow menu (three dots)');
    info('4. Click "Chain Mop"');
    info('5. In the form: Remove comments = checked, Lock comments = unchecked,');
    info('   Skip distinguished comments = unchecked');
    info('6. Click "Mop"');
    info('7. Expected: toast "Removed 2 comments." (root + child)');
    info('8. Verify: both comments show [removed] on the post page');
    info('9. Check devvit logs --since 2m for "chain_mop_triggered" and removal events');
    console.log('');

    // ─── Test 2: Lock only ───────────────────────────────────────────────────
    console.log('Test 2: Lock only — invoke Chain Mop with lock checked, remove unchecked');
    skip('Lock only', 'Action module — requires mod-menu UI; create a fresh comment chain first');
    skipped++;
    console.log('  Manual steps:');
    info('1. Add a new test comment thread to the same or a new post');
    info('2. Open Chain Mop on the root comment');
    info('3. Remove comments = unchecked, Lock comments = checked');
    info('4. Click "Mop"');
    info('5. Expected: toast "Locked N comments." where N = chain length');
    info('6. Verify: comments show a lock icon but are not [removed]');
    console.log('');

    // ─── Test 3: No action selected ──────────────────────────────────────────
    console.log('Test 3: No action selected → neutral toast');
    skip('No action selected', 'Action module — requires mod-menu UI');
    skipped++;
    console.log('  Manual steps:');
    info('1. Open Chain Mop on any comment');
    info('2. Uncheck both "Remove comments" and "Lock comments"');
    info('3. Click "Mop"');
    info('4. Expected: neutral toast "No actions selected."');
    info('5. Verify: no comment is removed or locked');
    console.log('');

    // ─── Test 4: Disabled state ──────────────────────────────────────────────
    console.log('Test 4: Disabled state — mopToolEnabled=false → toast');
    skip('Disabled state', 'Action module — requires portal setting change + mod-menu UI');
    skipped++;
    console.log('  Manual steps:');
    info('1. In Developer Portal, set mopToolEnabled = false');
    info('2. Open Chain Mop on any comment');
    info('3. Expected: toast "Chain Mop is disabled. Enable it in bot settings."');
    info('4. Reset: set mopToolEnabled = true in portal');
    console.log('');
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped (action module)`);
  if (failed > 0) {
    console.log('\nAction required: fix failures before marking VERIFIED.');
    process.exit(1);
  } else {
    console.log('\nAutomated setup passed. Complete manual steps above during live playtest.');
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
