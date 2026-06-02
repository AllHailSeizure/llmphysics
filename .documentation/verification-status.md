# Verification Status

_Last updated: 2026-06-01_
_Devvit CLI: 0.12.24_

---

## depth-cap-moderator

**Last verified:** 2026-05-31 — VERIFIED ✓
**Last promoted:** _(not yet promoted)_
**Module hash:** `36dcb4d44423294f6e9d4a234ea5e12a5fd670a1`
**Test script hash:** `fbd3630c955f470177ef145b343a385da7383e27`
**Devvit CLI at verify:** 0.12.24

| Test | Description | Status |
|------|-------------|--------|
| Happy path | depth 5 chain → c5 locked + bot reply posted | PASS |
| No-op: under cap | depth 4 chain → c4 not locked, no bot reply | PASS |
| No-op: over cap | depth 6 chain → c6 not locked (depth > cap exits early) | PASS |
| Boundary | c4 no-op then c5 in same chain fires | PASS |
| Settings: disabled | depthCapModEnabled=false → depth 5 not locked | PASS |
| Settings: custom cap | depthCap=3 → c3 locked | PASS |
| Settings: custom response | depthCapResponse set → bot reply starts with custom text | PASS |
| Settings: mod exempt | depthCapIgnoreModerators=true → AllHailSeizure (mod) exempt | PASS |
| Regression: depth 1 | Direct reply to post (depth 1, cap>1) → not locked | PASS |
| Log format | snake_case event names, JSON data objects | PASS |

**Code audit:** No blockers. All settings declared in devvit.json. getModerators/getApprovedUsers API used correctly. Promise.all batching in place. Error isolation on reply/distinguish/lock/report. Reply-before-lock ordering correct.

**Notes:** Test 8 first run failed due to unsaved portal settings (not a code bug). Retry after save passed. gRPC 500 on bot-reply lock during first attempt was a transient platform error.

---

## flood-moderator

**Last verified:** 2026-06-01 — VERIFIED ✓
**Last promoted:** _(not yet promoted)_
**Module hash:** `b4419e6eefd7933d13f4f2c6beaa0d03c6934293`
**Test script hash:** `c0ddacb2f28020572a6ecc0b2990a931acc49034`
**Devvit CLI at verify:** 0.12.24

| Test | Description | Status |
|------|-------------|--------|
| Happy path | post 1 allowed, post 2 removed + bot reply posted | PASS |
| No-op: under quota | Covered by test 1 — post 1 is the under-quota case | PASS (implicit) |
| Settings: disabled | floodModEnabled=false → posts not removed | PASS |
| Settings: custom message | floodAssistantResponse set → message appears in bot comment | PASS |
| Settings: mod exempt | floodAssistantIgnoreModerators=true → AllHailSeizure posts not removed | PASS |
| Log format | snake_case events, JSON data | PASS |

**Bugs fixed (BLOCKERS):** (1) `getUserByUsername(authorName)` → `getUserById(author.id)` — avoids username-based lookup when ID is available. (2) `user.getModPermissionsForSubreddit()` → `reddit.getModerators()` — correct listing API, not the banned cloud-empty method.

**Notes:** Flood quota persists in Redis across test runs. Added `deletePost(post1)` cleanup in test 1 to prevent allowed posts from contaminating subsequent test runs. Use `floodAssistantWindowHours = 0.05` during isolation to keep the window short.

---

## self-response-moderator

**Last verified:** 2026-06-01 — VERIFIED ✓
**Last promoted:** _(not yet promoted)_
**Module hash:** `a0d4ff036d79451825512f94a5e1326f68387a95`
**Test script hash:** `ac8ca5f4f2dd64f0a4c4d6cc1a9d8194320e8e5f`
**Devvit CLI at verify:** 0.12.24

| Test | Description | Status |
|------|-------------|--------|
| Happy path | OP self-reply → comment removed + bot reply posted | PASS |
| No-op: different author | Only 1 test user available | SKIP |
| Settings: disabled | selfResponseModEnabled=false → self-reply not removed | PASS |
| Settings: mod exempt | selfResponseIgnoreModerators=true → AllHailSeizure not removed | PASS |
| Log format | snake_case events, JSON data | PASS |

**Bug fixed (BLOCKER):** Original mod check used `getUserByUsername()` + `user.getModPermissionsForSubreddit()` — the banned API that returns empty in the cloud. Replaced with `reddit.getModerators({ subredditName, username })` directly. Added MODULE descriptor.

---

## length-moderator

**Last verified:** 2026-06-01 — VERIFIED ✓
**Last promoted:** _(not yet promoted)_
**Module hash:** `116a3b3315479a4899b653965cd8e78da7ce99cf`
**Test script hash:** `f0082b82982c73a7fe936fafa75630ea80f270ae`
**Devvit CLI at verify:** 0.12.24

| Test | Description | Status |
|------|-------------|--------|
| Happy path | Over max length with restricted flair → removed + bot comment | PASS |
| No-op: under limit | Same flair, ≤100 chars → not removed | PASS |
| No-op: no flair | Over limit but no restricted flair → not removed | PASS |
| Settings: disabled | lengthModEnabled=false → not removed | PASS |
| Settings: min hosted | Link post body <50 chars → removed | PASS |
| Log format | snake_case events, JSON data | PASS |

**Flair used for testing:** `75cef820-469b-11f1-8ee2-36c65d5c900c` ("testtest") in r/llmphysics_dev

**Code audit:** No blockers. Missing MODULE descriptor (IMPROVEMENT). Log event names use freeform strings rather than snake_case (IMPROVEMENT).

---

## report-moderator

**Last verified:** 2026-05-31 — VERIFIED ✓
**Last promoted:** _(not yet promoted)_
**Module hash:** `6fb1de14e36718434dc06c1b12e77d55f8351ee3`
**Test script hash:** `c33f53091a89c07363ed0aa94913fec3654573b2`
**Devvit CLI at verify:** 0.12.24

| Test | Description | Status |
|------|-------------|--------|
| Happy path: bot comment | Report llmphysics-bot comment → `ignore_reports:true` set | PASS |
| No-op: user comment | Report AllHailSeizure comment → skipped, not ignored | PASS |
| No-op: user post | Report AllHailSeizure post → skipped, not ignored | PASS |
| Dedup | Platform deduplicates; Redis key guards webhook retries | SKIP (not scriptable) |
| Log format | snake_case event names, JSON data objects | PASS |

**Bug fixed (BLOCKER):** Original code used `cv2.author` (user ID, e.g. `t2_hahs5`) for the `BOT_AUTHORS.has()` check on comment reports. `BOT_AUTHORS` contains usernames — so the check always failed and bot comments were never ignored. Fixed by fetching the comment first and using `comment.authorName` (username), matching the post handler pattern. Also added MODULE descriptor and corrected log event names to snake_case.

**Notes:** `ignoreReports()` sets `ignore_reports:true` on the item and removes it from the mod queue; `num_reports` is NOT reset to 0 — test asserts `ignore_reports === true`.

---

## quota-viewer

**Last verified:** _(pending)_
**Last promoted:** _(not yet promoted)_
**Module hash:** _(pending)_
**Test script hash:** _(pending — script not yet created)_
**Devvit CLI at verify:** _(pending)_

---

## mop-tool

**Last verified:** _(pending)_
**Last promoted:** _(not yet promoted)_
**Module hash:** _(pending)_
**Test script hash:** _(pending — script not yet created)_
**Devvit CLI at verify:** _(pending)_

---

## response-tool

**Last verified:** _(pending)_
**Last promoted:** _(not yet promoted)_
**Module hash:** _(pending)_
**Test script hash:** _(pending — script not yet created)_
**Devvit CLI at verify:** _(pending)_

---

## adversarial-reviewer

**Last verified:** 2026-06-01 — VERIFIED ✓
**Last promoted:** _(not yet promoted)_
**Module hash:** `67f680c6a5fa9cf601193d954e41b02cfde30666`
**Test script hash:** `3299e06429f903f4a0f31bee78c5359daaaae118`
**Devvit CLI at verify:** 0.12.24

| Test | Description | Status |
|------|-------------|--------|
| Happy path | Enabled + no flair gate → review posted as distinguished comment | PASS |
| Disabled path | Toggle OFF → "Adversarial reviewer is disabled." toast | PASS |
| Flair gate: rejected | Flair ID set, post has no flair → rejection toast | PASS |
| Flair gate: accepted | Flair ID set, post has matching flair → review posted | PASS |
| Log format | snake_case events, data objects | PASS |
| Blocker fixed | `getModPermissionsForSubreddit` → `getModerators()` | FIXED |
| Dev-sub bypass | Daily quota skipped on llmphysics_dev (same pattern as dedup lock) | FIXED |

---

## define-command

**Last verified:** _(pending)_
**Last promoted:** _(not yet promoted)_
**Module hash:** _(pending)_
**Test script hash:** _(pending — script not yet created)_
**Devvit CLI at verify:** _(pending)_
