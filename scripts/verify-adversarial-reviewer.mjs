/**
 * verify-adversarial-reviewer.mjs
 *
 * Usage:
 *   node scripts/verify-adversarial-reviewer.mjs --auto
 *   node scripts/verify-adversarial-reviewer.mjs --check-enabled <postFullname>
 */

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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

async function submitPost(title) {
  const d = await reddit('POST', '/api/submit', {
    api_type: 'json', kind: 'self', sr: 'llmphysics_dev',
    title: `[verify] ${title} ${Date.now()}`,
    text:  'Automated test post for adversarial reviewer verification.',
  });
  const id = d.json?.data?.id;
  if (!id) throw new Error(JSON.stringify(d));
  return `t3_${id}`;
}

async function getComments(postId) {
  const shortId = postId.replace('t3_', '');
  const d = await reddit('GET', `/r/llmphysics_dev/comments/${shortId}?limit=10`);
  return d[1]?.data?.children?.map(c => c.data) ?? [];
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try { await fn(); console.log('PASS'); passed++; }
  catch (err) { console.log(`FAIL: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const args = process.argv.slice(2);

// ── --auto ────────────────────────────────────────────────────────────────────
if (args.includes('--auto')) {
  console.log('\n=== Code audit ===');
  console.log('  [BLOCKER]     getModPermissionsForSubreddit() line 196 — returns empty in cloud; mods not exempt from daily quota');
  console.log('  [IMPROVEMENT] Missing MODULE descriptor export');
  console.log('  [IMPROVEMENT] fetchWithLogging log events are not snake_case ("FETCH START" etc.)');
  console.log('');

  console.log('=== Settings required ===');
  console.log('  adversarialReviewerEnabled  = ON   (install settings page)');
  console.log('  adversarialReviewerFlairId  = (blank — allow any flair)');
  console.log('');

  const postId  = await submitPost('adversarial reviewer toggle');
  const shortId = postId.replace('t3_', '');
  console.log(`Test post: https://www.reddit.com/r/llmphysics_dev/comments/${shortId}/?playtest=llmphysics-bot`);
  console.log(`Fullname:  ${postId}`);
  console.log('');
  console.log('--- Interactive test 1: Enabled path ---');
  console.log('1. Open the test post URL above.');
  console.log('2. Click "..." → "Request Adversarial Review".');
  console.log('3. Wait for a toast. Tell me what it said.');
  console.log('');
  console.log(`Then run:  node scripts/verify-adversarial-reviewer.mjs --check-enabled ${postId}`);
}

// ── --check-enabled ───────────────────────────────────────────────────────────
if (args.includes('--check-enabled')) {
  const postId = args[args.indexOf('--check-enabled') + 1];
  if (!postId) { console.error('Usage: --check-enabled <postFullname>'); process.exit(1); }

  console.log('\n=== Test 1: Enabled path ===');
  console.log('Waiting 8s for bot...');
  await new Promise(r => setTimeout(r, 8000));

  await test('Bot posted a distinguished review comment', async () => {
    const comments   = await getComments(postId);
    const botComment = comments.find(c =>
      c.author?.toLowerCase() === 'llmphysics-bot' && c.distinguished === 'moderator'
    );
    assert(botComment, 'No distinguished comment by LLMPhysics-bot found');
    assert(
      botComment.body?.includes('Adversarial Review'),
      `Comment body missing expected header: ${botComment.body?.slice(0, 120)}`
    );
  });

  console.log(`\nPassed: ${passed}  Failed: ${failed}`);

  if (!failed) {
    console.log('');
    console.log('--- Interactive test 2: Disabled path ---');
    console.log('1. Go to https://developers.reddit.com/r/llmphysics_dev/apps/llmphysics-bot');
    console.log('2. Set "Adversarial Reviewer — Enable" to OFF, save.');
    console.log('3. Click "..." → "Request Adversarial Review" on any post.');
    console.log('4. Expected toast: "Adversarial reviewer is disabled."');
    console.log('5. Confirm the toast text, then restore the toggle if desired.');
  }
}

if (!args.includes('--auto') && !args.includes('--check-enabled')) {
  console.log('Usage:');
  console.log('  node scripts/verify-adversarial-reviewer.mjs --auto');
  console.log('  node scripts/verify-adversarial-reviewer.mjs --check-enabled <postFullname>');
}
