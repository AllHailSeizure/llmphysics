---
name: module-new
description: Use when creating a new llmphysics-bot module from scratch. Runs a Socratic spec-building conversation, writes a ROADMAP entry for sign-off, then implements the full module end-to-end.
---

# module-new

Two phases: **Clarify** (build the spec with the user) → **Implement** (full autonomous execution). Code does not start until the spec is signed off.

## Usage

`/module-new`

Optionally kick off with a description: `/module-new "removes comments that contain slurs"`

---

## Phase 1 — Clarify

Ask the user questions until every item in the table below is answered. Don't ask them all at once — group related questions naturally (2–3 per message). If the user's initial description already answers some, skip those.

| Item | Question |
|---|---|
| **Goal** | What does this module do in one sentence? What does "working correctly" look like to a mod or user? |
| **Trigger** | What Reddit event(s) start it? (post submit, comment submit, report, mod action, scheduled?) |
| **Action** | What does it do when triggered? (remove, comment, log, approve, lock, flair?) |
| **Exemptions** | Who should be exempt? Mods? Approved submitters? Specific users? |
| **Settings** | What should mods be able to configure? Any numeric thresholds, templates, toggles beyond the enable/disable? |
| **Disabled state** | When the module is off, should it silently skip, or show a toast? |
| **Idempotency** | What if the same event fires twice? Should the action happen again or be deduplicated? |
| **Failure mode** | What if a Reddit API call fails mid-action? Should it abort silently, log, or escalate? |
| **Redis state** | What does it need to remember between events? For how long? (TTL?) |
| **Integration** | Does it interact with any existing module? Could it conflict? |
| **Test: success** | Name one concrete thing I can do in r/llmphysics_dev that proves it's working. |
| **Test: failure** | Name one thing that should NOT happen — the bug you most want to prevent. |
| **Test: automation** | Can the test run fully unattended, or does it require mid-test settings changes? |

Once all items are answered, move to Phase 2.

---

## Phase 2 — Spec sign-off

Write a ROADMAP entry using the answers. Append it to `llmphysics-bot/ROADMAP.md` under a new section:

```
## <Module Name> — Queued

**Goal:** <one sentence from Phase 1>

**Spec highlights:**
- Trigger: <events>
- Action: <what it does>
- Exemptions: <who is exempt>
- Settings: <list>
- Redis: <keys and TTLs>
- Edge cases: <idempotency, failure handling, integration notes>

**Milestones:**
- [ ] Implement module file (full, not stubbed)
- [ ] Wire registry, settings, devvit.json
- [ ] npm run build — zero errors
- [ ] Playtest
- [ ] Verify (automated + interactive)
- [ ] Publish via /module-promote

**Testing plan:**
- Automated: <what the verify script will check>
- Interactive: <what requires a settings change mid-test>
```

Show the entry to the user and say: **"Does this spec look right? Say 'go' to start implementation."**

Do not write any module code until the user confirms.

---

## Phase 3 — Implement

Execute in order. Mark ROADMAP milestones complete as you go.

### 1. Create module file

Write the **full implementation** — not a scaffold with TODO stubs. The module should be functionally complete before playtest.

**Trigger module** → `src/server/trigger-modules/<name>.ts`
**Action module** → `src/server/action-modules/<name>.ts`
**Scheduler module** → `src/server/action-modules/<name>.ts` (with POST route at `/internal/scheduler/<name>`)

Every module must export:

```typescript
export const MODULE = {
  name: '<name>',           // kebab-case, matches filename
  type: 'trigger',          // 'trigger' | 'action' | 'scheduler'
  description: '<sentence ending with period.>',
  triggers: ['onPostSubmit'],
  redisKeys: ['<name>:<type>:<scope>'],
  settings: ['<camelName>.enabled'],
} as const;
```

Code quality standards from CLAUDE.md:
- Batch all independent `readSetting` calls in a single `Promise.all`
- Wrap each distinct action (Redis write, API call, comment post) in its own try/catch
- A non-critical action failure must never prevent the primary action from completing
- Log with `log()` helper: first arg = snake_case event name, second = data object
- Toast with `toast()` helper: never inline

### 2. Wire everything

- **registry.ts**: add trigger to the appropriate handler array, or add `registerMyModule(app)` call
- **settings-helper.ts**: add `'<camelName>.enabled': true` to DEFAULTS
- **settings-registry.ts**: add boolean field to `SETTINGS_MENUS.modules` (or new group if >2 sub-settings)
- **devvit.json**: add menu item + form entry (action modules only)

### 3. Build

```bash
npm run build
```

Zero TypeScript errors before proceeding.

### 4. CHANGELOG

Add under `[Unreleased]`:
```
- `module(<name>)`: <description> — pending verification
```

### 5. GitHub issue

```
/project-tracker wip <name>
```

### 6. Playtest

Use `/devvit-cli` skill. Stream logs and confirm the module fires correctly on a test event.

### 7. Verify

Write `scripts/verify-<name>.mjs` following the same pattern as existing verify scripts. Run automated tests first:

```bash
node scripts/verify-<name>.mjs --auto
```

For settings-dependent tests, present a table:

| Test | Settings change needed | Expected outcome |
|---|---|---|
| … | … | … |

Walk the user through each: instruct the change → run the specific test → confirm → instruct reset → next.

### 8. Promote

Once all tests pass, invoke `/module-promote`.

---

## Naming reference

| Context | Format | Example |
|---|---|---|
| File name | kebab-case | `spam-filter.ts` |
| `MODULE.name` | kebab-case | `spam-filter` |
| Setting keys | camelCase module prefix | `spamFilter.enabled` |
| Redis keys | `<module>:<type>:<scope>` | `spam-filter:count:user:{userId}` |
| Label (UI) | Title Case noun | `Spam Filter` |
| Description | Sentence ending with period | `Removes posts flagged as spam.` |
