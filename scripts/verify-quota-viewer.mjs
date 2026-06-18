#!/usr/bin/env node
/**
 * verify-quota-viewer.mjs
 *
 * Verification script for the quota-viewer action module.
 *
 * Usage:
 *   node scripts/verify-quota-viewer.mjs [--auto] [-h|--help]
 *
 * Flags:
 *   --auto   Run only the automated (settings-independent) checks.
 *   -h, --help  Show this help message and exit.
 *
 * All UI-driven tests are skipped — this module requires mod-menu interaction.
 *
 * ─── BLOCKER: settings mismatch ───────────────────────────────────────────────
 * quota-viewer.ts reads floodAssistant* settings via readSetting() (Redis backend,
 * key prefix "settings:"). But these keys are declared as Devvit PLATFORM settings
 * in devvit.json (settings.subreddit) and written by the Devvit platform, NOT to
 * Redis. flood-moderator.ts correctly uses settings.get() for the same keys.
 *
 * Effect: quota-viewer will always read its defaults (maxPosts=1, windowHours=24,
 * all ignore flags=true) regardless of what the mod sets in the portal.
 *
 * Fix required in quota-viewer.ts: replace all readSetting('floodAssistant*', ...)
 * calls with settings.get<T>('floodAssistant*').
 *
 * Also note: floodModEnabled is a platform setting — the enabled check at the top
 * of quota-viewer.ts uses readSetting('floodModEnabled', true) which has the same
 * bug. It will never see a portal-level disable.
 * ──────────────────────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, reason) { console.log(`  FAIL  ${label}: ${reason}`); }
function skip(label, reason) { console.log(`  SKIP  ${label}: ${reason}`); }
function info(msg) { console.log(`        ${msg}`); }
function warn(msg) { console.log(`  WARN  ${msg}`); }

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node scripts/verify-quota-viewer.mjs [--auto] [-h|--help]');
  console.log('See file header for full documentation.');
  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== quota-viewer verification ===\n');
  console.log('Module type : action (mod menu → Flood Quota, subreddit location)');
  console.log('Subreddit   : r/llmphysics_dev');
  console.log('Test user   : AllHailSeizure\n');

  // ─── BLOCKER warning ──────────────────────────────────────────────────────
  console.log('BLOCKER DETECTED (code audit — see file header for full details):');
  console.log('');
  warn('quota-viewer.ts uses readSetting() for floodAssistant* keys.');
  warn('These are platform settings (devvit.json settings.subreddit), NOT Redis settings.');
  warn('The quota viewer will always use hardcoded defaults, ignoring portal configuration.');
  warn('Fix: replace readSetting(...) with settings.get<T>(...) for all floodAssistant* reads.');
  warn('Affected keys: floodAssistantMaxPosts, floodAssistantWindowHours,');
  warn('  floodAssistantIgnoreDeleted, floodAssistantIgnoreRemoved,');
  warn('  floodAssistantIgnoreAutoRemoved, floodAssistantIgnoreModerators,');
  warn('  floodAssistantIgnoreContributors, and floodModEnabled.');
  console.log('');
  console.log('This module cannot be marked VERIFIED until the code fix is deployed.');
  console.log('');

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

  // ─── Test 1: Happy path ───────────────────────────────────────────────────
  console.log('\nTest 1: Happy path — Flood Quota shows correct user status');
  skip('Happy path', 'Action module — requires mod-menu UI interaction');
  skipped++;
  console.log('  Manual steps (after deploying the readSetting → settings.get fix):');
  info('1. Start playtest: devvit playtest r/llmphysics_dev');
  info('2. Go to: https://www.reddit.com/r/llmphysics_dev/?playtest=llmphysics-bot');
  info('3. Click the subreddit overflow menu (three dots near subreddit header)');
  info('4. Click "Flood Quota"');
  info('5. Enter username: AllHailSeizure');
  info('6. Click "Search"');
  info('7. Expected: a results form appears showing:');
  info('   - Tracked posts within the configured window');
  info('   - Each post labeled "Included In Quota" or "Excluded From Quota"');
  info('   - "Next Post Opportunity" field with a timestamp or "Now"');
  info('8. Verify the quota counts match the portal settings');
  info('   (Max posts = floodAssistantMaxPosts, window = floodAssistantWindowHours hours)');
  info('9. Check devvit logs --since 2m for any error messages');
  console.log('');

  // ─── Test 2: Disabled state ───────────────────────────────────────────────
  console.log('Test 2: Disabled state — quota viewer toast when floodModEnabled=false');
  skip('Disabled state', 'Action module — requires portal setting change + mod-menu UI');
  skipped++;
  console.log('  Manual steps:');
  info('1. In Developer Portal, set floodModEnabled = false');
  info('2. Go to r/llmphysics_dev/?playtest=llmphysics-bot');
  info('3. Open subreddit overflow menu → click "Flood Quota"');
  info('4. Expected: toast appears with "Flood Moderator is disabled."');
  info('   (Note: after the code fix, this will work correctly.)');
  info('5. Reset: set floodModEnabled = true in portal');
  console.log('');

  // ─── Test 3: Unknown user ─────────────────────────────────────────────────
  console.log('Test 3: Unknown user — search for non-existent username → neutral toast');
  skip('Unknown user', 'Action module — requires mod-menu UI interaction');
  skipped++;
  console.log('  Manual steps:');
  info('1. Open "Flood Quota" from the subreddit menu');
  info('2. Enter username: zzzthisuserdoesnotexist99999');
  info('3. Click "Search"');
  info('4. Expected: neutral toast "User \\"zzzthisuserdoesnotexist99999\\" not found"');
  console.log('');

  // ─── Test 4: "Search again" loopback ─────────────────────────────────────
  console.log('Test 4: "Search again" button loops back to search form');
  skip('"Search again" loopback', 'Action module — requires mod-menu UI interaction');
  skipped++;
  console.log('  Manual steps:');
  info('1. Complete Test 1 (successful search).');
  info('2. On the results form, click "Search again".');
  info('3. Expected: the search form reappears with an empty username field.');
  console.log('');

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped (action module)`);
  if (failed > 0) {
    console.log('\nAction required: fix failures before marking VERIFIED.');
    process.exit(1);
  } else {
    console.log('\nBLOCKER: Fix readSetting → settings.get before VERIFIED can be claimed.');
    console.log('After fix: complete manual steps above during live playtest.');
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
