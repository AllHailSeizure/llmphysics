#!/usr/bin/env node
/**
 * verify-response-tool.mjs
 *
 * Verification script for the response-tool action module (Saved Responses).
 *
 * Usage:
 *   node scripts/verify-response-tool.mjs [--auto] [-h|--help]
 *
 * Flags:
 *   --auto   Run only the automated checks (API connectivity + fixture setup).
 *   -h, --help  Show this help message and exit.
 *
 * All Saved Responses UI tests require mod-menu interaction on a live playtest.
 * This script:
 *   1. Verifies API connectivity.
 *   2. Creates a test post + comment to target with "Apply saved response".
 *   3. Prints step-by-step instructions for every test case.
 *
 * Portal prerequisites:
 *   responseToolEnabled = true   (default)
 *
 * Test order:
 *   Run in this sequence — each test builds on state from the previous:
 *   1. Add response (via subreddit menu → Saved Responses → New)
 *   2. Apply response to post (via post/comment menu → Saved Responses)
 *   3. Apply response to comment
 *   4. Verify {get_username} macro expansion
 *   5. Edit response
 *   6. Delete response
 *   7. Disabled state
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
  console.log('Usage: node scripts/verify-response-tool.mjs [--auto] [-h|--help]');
  console.log('See file header for full documentation.');
  process.exit(0);
}
const autoOnly = args.includes('--auto');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== response-tool (Saved Responses) verification ===\n');
  console.log('Module type : action (mod menu → Saved Responses, post + comment + subreddit)');
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

  // ─── Test 0b: Create test post + comment ─────────────────────────────────
  console.log('\nTest 0b: Create test post and comment as targets for Saved Responses');
  let postId = null;
  let commentId = null;
  try {
    const submitRes = await redditPost('/api/submit', {
      sr: 'llmphysics_dev',
      kind: 'self',
      title: '[VERIFY] response-tool test post — delete after testing',
      text: 'This post was created by the verify-response-tool script. Delete it after testing.',
      resubmit: true,
    }, accessToken);

    const postData = submitRes?.json?.data;
    if (!postData?.id) throw new Error('Submit did not return post ID');
    postId = postData.id;
    pass(`Created test post: t3_${postId}`);
    info(`Post URL: https://www.reddit.com/r/llmphysics_dev/comments/${postId}/?playtest=llmphysics-bot`);
    passed++;

    const commentRes = await redditPost('/api/comment', {
      thing_id: `t3_${postId}`,
      text: '[verify] Test comment — Saved Responses target',
    }, accessToken);
    const cId = commentRes?.json?.data?.things?.[0]?.data?.id;
    if (!cId) throw new Error('Comment submit did not return ID');
    commentId = cId;
    pass(`Created test comment: t1_${commentId}`);
    passed++;
  } catch (err) {
    fail('Create test fixtures', err.message);
    failed++;
    postId = postId ?? '<create failed>';
    commentId = commentId ?? '<create failed>';
  }

  const playUrl = `https://www.reddit.com/r/llmphysics_dev/comments/${postId}/?playtest=llmphysics-bot`;
  const subUrl = `https://www.reddit.com/r/llmphysics_dev/?playtest=llmphysics-bot`;

  if (autoOnly) {
    console.log('\n(--auto flag set: skipping manual test instructions)');
    skipped += 7;
  } else {
    // ─── Test 1: Add response ───────────────────────────────────────────────
    console.log('\nTest 1: Add — create a new saved response via subreddit menu');
    skip('Add response', 'Action module — requires mod-menu UI');
    skipped++;
    console.log('  Manual steps:');
    info(`1. Go to: ${subUrl}`);
    info('2. Open the subreddit overflow menu (three dots near top)');
    info('3. Click "Saved Responses"');
    info('4. In the form, select "New" and click "Next"');
    info('5. Fill in:');
    info('     Name: Verify Test Response');
    info('     Message: Hello {get_username}, thanks for your post.');
    info('     Available on: Both posts and comments');
    info('6. Click "Save"');
    info('7. Expected: toast "Saved response \\"Verify Test Response\\" added."');
    console.log('');

    // ─── Test 2: Apply to post ───────────────────────────────────────────────
    console.log('Test 2: Apply — use saved response on a post');
    skip('Apply to post', 'Action module — requires mod-menu UI');
    skipped++;
    console.log('  Manual steps (requires Test 1 to be completed first):');
    info(`1. Go to: ${playUrl}`);
    info('2. Click the post overflow menu (three dots on the post)');
    info('3. Click "Saved Responses"');
    info('4. Select "Verify Test Response" and click "Next"');
    info('5. In the apply form:');
    info('     Post comment as: Bot');
    info('     Message: (leave as-is or edit)');
    info('     Distinguish comment: checked');
    info('     Lock target: unchecked');
    info('6. Click "Submit"');
    info('7. Expected: toast "Response posted."');
    info('8. Verify: a distinguished bot comment appears on the post');
    info('   If {get_username} is in the message, verify it expanded to the post author name');
    info('9. Check devvit logs --since 2m for action=apply entry');
    console.log('');

    // ─── Test 3: Apply to comment ────────────────────────────────────────────
    console.log('Test 3: Apply — use saved response on a comment');
    skip('Apply to comment', 'Action module — requires mod-menu UI');
    skipped++;
    console.log('  Manual steps:');
    info(`1. Go to: ${playUrl}`);
    info(`2. Find the test comment: t1_${commentId}`);
    info('3. Click the comment overflow menu → "Saved Responses"');
    info('4. Responses marked "Posts only" should NOT appear (location filter)');
    info('5. Select a response available on comments, click "Next" → "Submit"');
    info('6. Expected: toast "Response posted." and bot reply appears under the comment');
    console.log('');

    // ─── Test 4: {get_username} macro ────────────────────────────────────────
    console.log('Test 4: {get_username} macro expansion');
    skip('{get_username} macro', 'Action module — requires mod-menu UI; verify during Test 2/3');
    skipped++;
    console.log('  Verification (check while running Test 2 or 3):');
    info('  The bot comment text should have "u/AllHailSeizure" (the post/comment author)');
    info('  in place of {get_username}.');
    info('  If the literal text {get_username} appears, the macro expansion failed.');
    console.log('');

    // ─── Test 5: Edit response ───────────────────────────────────────────────
    console.log('Test 5: Edit — modify the saved response body');
    skip('Edit response', 'Action module — requires mod-menu UI');
    skipped++;
    console.log('  Manual steps:');
    info(`1. Go to: ${subUrl}`);
    info('2. Subreddit menu → "Saved Responses" → select "Edit" → "Next"');
    info('3. Select "Verify Test Response" → "Next"');
    info('4. Change the body to: "Edited: {get_username}, please review the rules."');
    info('5. Click "Save"');
    info('6. Expected: toast "Response \\"Verify Test Response\\" updated."');
    info('7. Verify by opening Apply Saved Response on a post — body should show the edited text');
    console.log('');

    // ─── Test 6: Delete response ─────────────────────────────────────────────
    console.log('Test 6: Delete — remove the test saved response');
    skip('Delete response', 'Action module — requires mod-menu UI');
    skipped++;
    console.log('  Manual steps:');
    info(`1. Go to: ${subUrl}`);
    info('2. Subreddit menu → "Saved Responses" → select "Delete" → "Next"');
    info('3. Select "Verify Test Response" → "Delete"');
    info('4. Expected: toast "Response \\"Verify Test Response\\" deleted."');
    info('5. Verify: the response no longer appears in the select form');
    console.log('');

    // ─── Test 7: Disabled state ──────────────────────────────────────────────
    console.log('Test 7: Disabled state — responseToolEnabled=false → toast');
    skip('Disabled state', 'Action module — requires portal setting change + mod-menu UI');
    skipped++;
    console.log('  Manual steps:');
    info('1. In Developer Portal, set responseToolEnabled = false');
    info(`2. Open post/comment overflow menu on any item at: ${playUrl}`);
    info('3. Click "Saved Responses"');
    info('4. Expected: toast "Saved Responses is disabled."');
    info('   Note: The current code returns a string toast, not an object toast.');
    info('   IMPROVEMENT: Should be { text: "...", appearance: "neutral" }');
    info('5. Reset: set responseToolEnabled = true in portal');
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
    console.log('Run in test order: Add → Apply to post → Apply to comment → Edit → Delete');
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
