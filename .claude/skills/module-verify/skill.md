---
name: module-verify
description: Use when verifying a llmphysics-bot module is production-ready before promoting to the publish branch. Covers trigger, action, and scheduler module types with automated Reddit API testing and devvit logs.
---

# module-verify

End-to-end verification for llmphysics-bot modules. **Claude runs everything.** No user involvement needed except one-time settings pre-configuration (documented below). Produces a structured pass/fail verdict and updates `verification-status.md`.

## Usage

`/module-verify <module-name>`

---

## 1. Session start — CLI & SDK version update

**Check Devvit CLI & SDK versions.** 

```bash
devvit --version
```

Compare to the last recorded versions in `verification-status.md`. If there's a new version:

```bash
cd llmphysics-bot && npm install devvit@latest && npx devvit update app
```
Note updated version for both CLI and SDK in `verification-status.md` at the end of the process. Only record version for the module you verify, not all modules. This way if you verify one module, then update CLI/SDK, you'll know which modules need re-verification.

- **No stored version in 'verification-status.md'** (first run) → record the version; proceed.

---

## 2. Staleness check

```bash
git hash-object src/server/trigger-modules/<module>.ts   # adjust path for module type
git hash-object scripts/verify-<module>.mjs
```

Compare both to the stored hashes in `verification-status.md`:

| Scenario | Action |
|---|---|
| Both match | Run tests — no re-analysis needed |
| Module hash changed | Re-read module source + test script; identify coverage gaps; flag "running against modified code" |
| Test script hash changed | Verify tests still cover the module fully; flag "running against modified tests" |
| No stored hashes | First run — proceed, record hashes on completion |

---

## 3. What Claude does autonomously

Every step below is run by Claude via Bash/API — no browser, no user action:

| Action | How |
|---|---|
| Start playtest | `cd llmphysics-bot && devvit playtest r/llmphysics_dev --show-timestamps > /tmp/pt.txt 2>&1 &` — wait for `Playtest ready` |
| Submit posts/comments | Reddit OAuth API via `~/.devvit/token` (AllHailSeizure, scope `*`) |
| Verify bot actions | `GET https://oauth.reddit.com/api/info?id=<fullname>` — reads `locked`, `removed`, reply count |
| Capture logs | Supabase MCP preferred (see §6); devvit logs CLI as fallback |
| Change global settings | `cd llmphysics-bot && devvit settings set <key>` (for `settings.global` keys like `geminiApiKey`) |

**Subreddit-level platform settings** (`settings.subreddit` in `devvit.json`) cannot be changed programmatically — they must be configured once via the Reddit installation settings page at `https://developers.reddit.com/r/llmphysics_dev/apps/llmphysics-bot` and then they persist until explicitly changed.

---

## 4. One-time settings pre-configuration (user does this once per module)

Before running verification for a trigger module with exemption logic, set these in the installation settings page:

| Module | Settings to set for testing |
|---|---|
| depth-cap | `depthCap = 5`, `depthCapIgnoreModerators = false`, `depthCapIgnoreContributors = false` |
| flood-moderator | `floodAssistantMaxPosts = 1`, `floodAssistantIgnoreModerators = false`, `floodAssistantIgnoreContributors = false` |
| self-response | `selfResponseIgnoreModerators = false`, `selfResponseIgnoreContributors = false` |
| length-moderator | Set `lengthModFlairId` to a real flair ID; `lengthModMaxUnhostedLength = 100` |

These values are persistent. Once set they stay set — no need to reconfigure between runs.

**Why not all defaults?** AllHailSeizure is a subreddit contributor (appears in approved users list). With default `ignoreContributors = true`, enforcement never fires on test comments. Both flags must be false to test the enforcement path.

---

## 5. Script design rule

**Scripts must be fully unattended for the automated portion.** Settings-dependent tests are encoded as flags — the script prints required settings at startup and accepts a flag per interactive scenario (e.g. `--settings-custom`). Claude drives the interactive portion through conversation: tells the user what to change, waits for confirmation, then runs the relevant flag.

Scripts never block on `readline` or prompt mid-run.

---

## 6. Log source

**Prefer Supabase MCP.** After tests trigger bot actions, query `bot_logs`:

```sql
SELECT level, module, message, action, reason, user_id, post_id, comment_id, created_at
FROM bot_logs
WHERE module = '<module-name>'
ORDER BY created_at DESC
LIMIT 50;
```

**Fall back to devvit logs CLI** only if `bot_logs` has no recent entries for this module (log helper not yet writing to Supabase, or Supabase MCP unavailable):

```bash
devvit logs r/llmphysics_dev llmphysics-bot --show-timestamps > /tmp/verify-logs.txt 2>&1 &
```

---

## 7. Test script pattern

Write `scripts/verify-<module>.mjs` using this structure:

```js
import { readFileSync } from 'fs';
import { homedir } from 'os';

// Auth
const outer = JSON.parse(readFileSync(homedir() + '/.devvit/token', 'utf8'));
const inner = JSON.parse(Buffer.from(outer.token, 'base64').toString());
const TOKEN = inner.accessToken; // AllHailSeizure, scope *
const UA = 'llmphysics-bot-verify/1.0 (by AllHailSeizure)';

async function reddit(method, path, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA } };
  if (body) { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = new URLSearchParams(body).toString(); }
  const res = await fetch(`https://oauth.reddit.com${path}`, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

async function submitPost(title) {
  const d = await reddit('POST', '/api/submit', { api_type: 'json', kind: 'self', sr: 'llmphysics_dev', title: `[verify] ${title} ${Date.now()}`, text: 'automated test' });
  const id = d.json?.data?.id;
  if (!id) throw new Error(JSON.stringify(d));
  return `t3_${id}`;
}

async function submitComment(parent, text = 'c') {
  await new Promise(r => setTimeout(r, 1300)); // Reddit rejects < ~1s between comments
  const d = await reddit('POST', '/api/comment', { api_type: 'json', thing_id: parent, text });
  const id = d.json?.data?.things?.[0]?.data?.id;
  if (!id) throw new Error(JSON.stringify(d));
  return `t1_${id}`;
}

async function getComment(fullname) {
  const d = await reddit('GET', `/api/info?id=${fullname}`);
  return d.data?.children?.[0]?.data;
}

// Test runner
let passed = 0, failed = 0;
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try { await fn(); console.log('PASS'); passed++; }
  catch (err) { console.log(`FAIL: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
```

**Wait 6–8 seconds after the final trigger** before checking state — the bot runs in the cloud and trigger-to-action latency is 3–5 seconds.

---

## 8. Running the full verification

```bash
# 1. Run automated tests
node scripts/verify-<module>.mjs --auto

# 2. For each settings-dependent test, tell the user what to change, wait for confirmation, then:
node scripts/verify-<module>.mjs --<test-flag>
```

---

## 9. Checklist

### Trigger modules
_(flood-moderator, depth-cap, self-response, length-moderator, chain-mop)_

- [ ] **Happy path** — build trigger condition via script; confirm expected action via `GET /api/info` (locked, removed, etc.) AND log entry
- [ ] **No-op path** — submit near-miss; confirm state unchanged and no enforcement log entry
- [ ] **Boundary** — test at cap - 1 (no fire) and cap (fires) in single chain
- [ ] **Settings: default** — confirm defaults produce expected behavior
- [ ] **Settings: custom** — verify one non-default setting takes effect (requires installation settings page change; document the change made and result)
- [ ] **Dedup** — submit identical trigger twice; second must produce `dedup_duplicate_trigger` warn and no action
- [ ] **Log check** — every log call uses snake_case first arg; data object second arg; no freeform strings
- [ ] **Regression cases** — run any module-specific cases from past bugs

### Action / menu modules
_(saved-responses, adversarial-reviewer, chain-mop-tool)_

- [ ] **Happy path** — invoke menu item; verify output via API read and log
- [ ] **Permission gate** — invoke as non-mod; verify rejection
- [ ] **Error path** — invoke with invalid input; verify graceful failure, no crash
- [ ] **Log check**

### Scheduler modules

- [ ] **Fires** — wait for scheduled job; verify via log
- [ ] **Idempotent** — trigger twice in window; no duplicate actions
- [ ] **Log check**

---

## 10. Code audit

- [ ] **Settings in devvit.json — BLOCKER** — all mod-configurable values in `devvit.json` under `settings.subreddit`, read via `(await settings.get<T>('key')) ?? default`. No `readSetting()` for anything a mod might configure.

- [ ] **Mod/contributor check — BLOCKER if wrong API used** — use `reddit.getModerators({ subredditName, username })` and `reddit.getApprovedUsers({ subredditName, username })` (listing calls). Do NOT use `user.getModPermissionsForSubreddit()` — returns empty in the cloud. Fetch user by `reddit.getUserById(cv2.author as 't2_${string}')` — `CommentV2.author` is a user ID, not a username.

- [ ] **No redundant I/O** — batch parallel settings reads in `Promise.all`

- [ ] **Error isolation** — non-critical failures caught and logged; don't block primary action

- [ ] **No partial-action bugs** — gate dependent actions (e.g. don't post removal comment if removal failed)

- [ ] **Comments explain WHY** — no comments that restate the code

- [ ] **Logging format** — snake_case event name, data object; no freeform strings

- [ ] **No dead code**

Flag: **BLOCKER** (breaks behavior) or **IMPROVEMENT** (quality). Fix blockers before `VERIFIED ✓`.

---

## 11. Triage logic on failure

Before debugging, diagnose:

| What changed | First step |
|---|---|
| Module hash changed | Review diff vs. test script — tests may not cover new logic |
| Devvit CLI version changed | Check changelog via `mcp__devvit-mcp__devvit_search` for breaking changes |
| Neither changed | Likely Reddit/Devvit server-side — search web for outages or known bugs before spending time debugging code |

State the diagnosis explicitly before any debugging. Don't burn time on code when the problem is outside the codebase.

---

## 12. Verdict

- All pass → `VERIFIED ✓` — safe to run `/module-promote`
- Any fail → `NOT READY ✗` — fix, re-run failing item

---

## 13. Recording results

After every verification run — pass or fail — update `llmphysics-bot/.documentation/verification-status.md`.

Create the file and `.documentation/` directory if they don't exist yet.

**Format — one `##` section per module, updated in-place:**

```markdown
# Verification Status

_Last updated: YYYY-MM-DD_
_Devvit CLI: X.Y.Z_
_Devvit SDK: X.Y.Z_

---

## <module-name>

**Last verified:** YYYY-MM-DD — VERIFIED ✓ / NOT READY ✗
**Last promoted:** YYYY-MM-DD — vX.X.X  _(fill in after promote; leave blank if not yet promoted)_
**Module hash:** `<output of git hash-object <module-file>>`
**Test script hash:** `<output of git hash-object scripts/verify-<module>.mjs>`
**Devvit CLI at verify:** X.Y.Z
**Devvit SDK at verify:** X.Y.Z

| Test | Description | Status |
|------|-------------|--------|
| Happy path | <one-line description> | PASS / FAIL / SKIP |
| No-op path | <one-line description> | PASS / FAIL / SKIP |
| Boundary | <one-line description> | PASS / FAIL / SKIP |
| Dedup | Duplicate trigger → warn, no action | PASS / FAIL / SKIP |
| Settings: default | Defaults produce expected behavior | PASS / FAIL / SKIP |
| Settings: custom | <setting changed and result> | PASS / FAIL / SKIP |
| Log format | snake_case events, data objects | PASS / FAIL / SKIP |
```

**Do NOT create dated verification files.** This file is the only record.

---

## 14. Tools

- **Reddit API** — `~/.devvit/token` is AllHailSeizure (scope `*`), valid until it expires (token refresh needed if HTTP 401). Use `Authorization: Bearer <token>` and `User-Agent: llmphysics-bot-verify/1.0`.
- **Supabase MCP** — primary log source. Query `bot_logs` table on project `eimdgqymjwfljtapnuyl`. Falls back to devvit logs CLI if no recent entries.
- **`devvit logs`** — fallback only: `cd llmphysics-bot && devvit logs r/llmphysics_dev llmphysics-bot --show-timestamps`. The `mcp__devvit-mcp__devvit_logs` MCP tool requires `npx` in PATH and often fails with `ENOENT` — use the Bash form.
- **`devvit settings set`** — sets **global**-scope settings only (e.g. `geminiApiKey`). Cannot set subreddit-level settings.
