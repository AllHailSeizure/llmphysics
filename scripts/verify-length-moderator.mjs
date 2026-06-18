#!/usr/bin/env node
/**
 * verify-length-moderator.mjs
 *
 * Verification script for the length-moderator trigger module.
 *
 * Usage:
 *   node scripts/verify-length-moderator.mjs [--auto] [-h|--help]
 *
 * Flags:
 *   --auto   Run only the automated (settings-independent) checks.
 *            All tests that require portal settings are skipped.
 *   -h, --help  Show this help message and exit.
 *
 * IMPORTANT — portal prerequisites before running tests:
 *   1. lengthModEnabled          → true
 *   2. lengthModFlairId          → <your flair template UUID>   (see instructions below)
 *   3. lengthModMaxUnhostedLength → 100
 *   4. lengthModMinHostedLength   → 0 (disable hosted check during unhosted tests)
 *   5. lengthModMaxUnhostedComment → "Your post is too long. Please shorten it."
 *   6. lengthModMinHostedComment   → "Your link post needs more context."
 *
 * How to find a flair template ID:
 *   Go to r/llmphysics_dev → Mod tools → Post flair → copy the UUID from the
 *   flair template URL or use the Reddit API:
 *   GET https://oauth.reddit.com/r/llmphysics_dev/api/link_flair_v2
 *
 * All tests in this script are marked SKIP because they require:
 *   - A specific flair template UUID configured in the portal
 *   - The ability to submit posts with that flair (flair_template_id param)
 *   - Live bot playtest running to process onPostSubmit events
 *
 * To run tests interactively:
 *   1. Start playtest: devvit playtest r/llmphysics_dev
 *   2. Configure all portal settings above
 *   3. Follow the manual steps printed below for each test
 *   4. Check devvit logs for confirmation
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
  console.log(`Usage: node scripts/verify-length-moderator.mjs [--auto] [-h|--help]`);
  console.log('See file header for full documentation.');
  process.exit(0);
}
const autoOnly = args.includes('--auto');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== length-moderator verification ===\n');
  console.log('Module type : trigger (onPostSubmit + onPostFlairUpdate)');
  console.log('Subreddit   : r/llmphysics_dev');
  console.log('Test user   : AllHailSeizure\n');

  const accessToken = loadAccessToken();

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // ─── Test 0: Portal connectivity ──────────────────────────────────────────
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

  // ─── Test 1: Flair template list ──────────────────────────────────────────
  console.log('\nTest 1: Fetch available flair templates (for manual reference)');
  try {
    const flairs = await redditGet('/r/llmphysics_dev/api/link_flair_v2', accessToken);
    if (Array.isArray(flairs) && flairs.length > 0) {
      pass(`Found ${flairs.length} flair template(s)`);
      passed++;
      console.log('\n  Available flair templates (copy the id value into portal settings):');
      for (const f of flairs) {
        info(`  id="${f.id}"  text="${f.text}"`);
      }
      console.log('');
    } else if (Array.isArray(flairs) && flairs.length === 0) {
      skip('Flair template list', 'No flair templates found — create one in Mod tools → Post flair first');
      skipped++;
    } else {
      fail('Flair template list', 'Unexpected response format');
      failed++;
    }
  } catch (err) {
    fail('Flair template list', err.message);
    failed++;
  }

  // ─── Tests 2–4: Require live playtest + portal settings ──────────────────
  console.log('Test 2: No-op — post without restricted flair → not removed');
  skip('No-op (no flair)', 'Requires live playtest + lengthModFlairId configured in portal');
  skipped++;
  console.log('  Manual steps:');
  info('1. Start playtest: devvit playtest r/llmphysics_dev');
  info('2. Submit a self-post to r/llmphysics_dev WITHOUT the restricted flair');
  info('   Body can be any length.');
  info('3. Expected: post is NOT removed, no bot comment appears.');
  info('4. Check: devvit logs r/llmphysics_dev llmphysics-bot --since 2m');
  info('   Should see: "Length moderator triggered" with actualFlairMatch=false');
  console.log('');

  console.log('Test 3: Happy path — post with flair + body > 100 chars → removed + bot comment');
  skip('Over-length with flair', 'Requires live playtest + lengthModFlairId + lengthModMaxUnhostedLength=100 in portal');
  skipped++;
  console.log('  Prerequisites: set these in the Developer Portal before running:');
  info('  lengthModFlairId          = <your flair template UUID>');
  info('  lengthModMaxUnhostedLength = 100');
  info('  lengthModMaxUnhostedComment = "Your post is too long. Please shorten it."');
  console.log('  Manual steps:');
  info('1. Submit a self-post with the restricted flair applied');
  info('   Use the API or Reddit UI to apply the flair at submission time.');
  info('   Body must be > 100 non-whitespace characters.');
  info('2. Expected: post is removed AND locked, bot comment appears');
  info('   Comment text should be "Your post is too long..." + bot signature');
  info('3. Check: devvit logs --since 2m');
  info('   Should see: "Post exceeds max unhosted length" then "max-unhosted: post removed"');
  console.log('');

  console.log('Test 4: No-op — post with flair + body ≤ 100 chars → not removed');
  skip('Under-length with flair', 'Requires live playtest + lengthModFlairId + lengthModMaxUnhostedLength=100 in portal');
  skipped++;
  console.log('  Manual steps:');
  info('1. Submit a self-post with the restricted flair applied');
  info('   Body must be ≤ 100 non-whitespace characters.');
  info('2. Expected: post is NOT removed, no bot comment.');
  info('3. Check: devvit logs --since 2m');
  info('   Should see: "Length moderator triggered" with no "post removed" line after it.');
  console.log('');

  console.log('Test 5: Flair-update path — post passes on submit, flair applied later → removed');
  skip('Flair-update trigger', 'Requires live playtest; submit without flair, then apply it manually as mod');
  skipped++;
  console.log('  Manual steps:');
  info('1. Submit a self-post WITHOUT the restricted flair, body > 100 non-whitespace chars.');
  info('2. As a moderator, apply the restricted flair to the post after submission.');
  info('   (Mod tools → Edit flair on the post)');
  info('3. Expected: onPostFlairUpdate fires, post is removed + locked, bot comment appears.');
  info('4. Check: devvit logs --since 2m');
  info('   Should see: "Length moderator (flair update) triggered" then removal events.');
  console.log('');

  console.log('Test 6: Min hosted length — link post with < min chars → removed');
  skip('Under-length link post', 'Requires live playtest + lengthModMinHostedLength>0 in portal');
  skipped++;
  console.log('  Prerequisites: set these in portal:');
  info('  lengthModMinHostedLength = 50');
  info('  lengthModMinHostedComment = "Your link post needs more context."');
  console.log('  Manual steps:');
  info('1. Submit a link post (url field set) with body < 50 non-whitespace chars.');
  info('2. Expected: post removed + locked, bot comment appears.');
  info('3. Check devvit logs for "Post with link below min hosted length".');
  console.log('');

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    console.log('\nAction required: fix failures before marking VERIFIED.');
    process.exit(1);
  } else {
    console.log('\nAutomated checks passed. Complete manual steps above to fully verify.');
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
