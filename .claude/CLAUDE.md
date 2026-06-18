# CLAUDE.md — Devvit Workspace

Workspace conventions: `d:/Reddit/Devvit/`

## CLI Flag Convention

Unix-style flags for all slash commands, agents, and scripts:

| Form | Example |
|------|---------|
| `-x` | `-v` |
| `--word` | `--verbose` |
| `-x <val>` / `--word <val>` | `-s llmphysics_dev` |

**Rules:**
- Both short (`-x`) and long (`--word`) forms required; always equivalent
- Boolean flags off by default
- Value flags use space, not `=` (e.g. `-s mydev`)
- `-h` / `--help` mandatory for all commands
- No positional-only arguments

**Correct:** `/playtest -r -v -s llmphysics_dev` or `/playtest --reinstall --verbose --sub llmphysics_dev`
**Incorrect:** `/playtest -reinstall -verbose` (single-dash long words), `/playtest reinstall verbose` (bare positional)

## Git Workflow

| Branch | Where | Purpose |
|---|---|---|
| `develop` | Local only | Sandbox — never pushed |
| `publish` | Local + remote | Finished, verified modules only |
| `master` | Local + remote | Integration point; merged from publish |
| `origin/master` | Remote only | Deployed state |

- Stay on `develop` — all code visible, full context
- Stash with `-m` notes when switching focus: `git stash push -u -m "what you were doing"`
- Use `git checkout develop -- <files>` to stage specific files onto `publish` (not cherry-pick — develop is always messy)
- Merge `publish` → `master` → push to deploy

### Publish commit standard

A publish commit MUST contain exactly: the module file, registry/index changes for that module only, any shared helper this module exclusively introduced.

**Smell check:** "If I stripped out `<module>` files, would any diff remain?" If yes, stop.

### Commit message format (`publish` and `master` only; `develop` is freeform)

```
<type>(<scope>): <description>

type: module | fix | config | chore
scope: kebab-case module name or area
```

Examples: `module(flood-moderator): add verified — v2.3.0` · `fix(depth-cap): off-by-one in threshold`

### Version bump rules

Use `devvit publish --version <x.y.z>` to target an exact version. Use `--bump <flag>` when the exact number doesn't matter.

| Change | Flag |
|---|---|
| New module added | `--bump minor` |
| Bug fix to existing module | `--bump patch` |
| Breaking architecture change | `--bump major` |

---

## Code Standards (llmphysics-bot)

### Module descriptor — every module exports this

```typescript
export const MODULE = {
  name: 'module-name',           // kebab-case, matches file name
  type: 'trigger',               // 'trigger' | 'action' | 'scheduler'
  description: 'One sentence.',
  triggers: ['onPostSubmit'],    // Devvit event names handled
  redisKeys: [                   // all keys the module reads/writes
    'module-name:count:user:{userId}',
  ],
  settings: ['moduleName.enabled'],
} as const;
```

### Settings naming

| What | Format | Example |
|---|---|---|
| Module toggle | `<module>.enabled` | `floodModerator.enabled` |
| Sub-setting | `<module>.<noun>` | `floodModerator.maxPosts` |
| Ignore flag | `<module>.ignore<Group>` | `floodModerator.ignoreModerators` |
| Global | `bot.<noun>` | `bot.signature` |

Migration: alias old keys when reading; write new keys going forward; document retirement in CHANGELOG.

### Settings labels & descriptions

- **Toggle label:** module noun only — `"Flood Moderator"`, `"Depth Cap"`
- **Sub-setting label:** relative noun phrase — `"Maximum posts"`, `"Rolling window (minutes)"`
- **Description:** complete sentence, ends with period, third-person declarative — `"Limits posts per user within a rolling time window."`
- **Boolean description:** describe the enabled state — `"Moderators are exempt from the post quota."`

### Toast messages

Always use object form. Complete sentence. First word capitalised. Ends with period.

```typescript
{ text: 'Removed 2 comments.', appearance: 'success' }
{ text: 'Flood Moderator is disabled. Enable it in bot settings.', appearance: 'critical' }
```

Use the `toast()` helper in `helpers/` — never construct toast objects inline.

### Settings menu taxonomy

New settings go into an existing group. New groups require updating this table.

| Group key | Purpose |
|---|---|
| `modules` | Enable/disable toggle for every module |
| `flood-moderator` | Flood Moderator sub-settings |
| `depth-cap` | Depth Cap + Self-Response sub-settings |
| `posting` | Length Moderator sub-settings |
| `adversarial-reviewer` | Adversarial Reviewer sub-settings |
| `removal-messages` | Bot signature + removal message templates |

Rule: toggle only → `modules` · >2 sub-settings → own group · ≤2 sub-settings → nearest categorical group.

### Redis key naming

`<module>:<type>:<scope>` in kebab-case.

- **module:** `flood-moderator`, `saved-responses`, `depth-cap`
- **type:** `count`, `session`, `log`, `index`, `dedup`, `cache`
- **scope:** `global`, `user:{userId}`, `post:{postId}`, `comment:{commentId}`

Examples: `flood-moderator:count:user:t2_abc` · `saved-responses:session:user:t2_abc`

### Structured logging

Use the `log()` helper in `helpers/` — never freeform `console.log` strings in module code.

```typescript
log({ module: MODULE.name, event: 'post_submit', action: 'removed', userId, postId, reason: 'quota_exceeded' });
```

---

## Working with Claude Code

Keep all code on `develop` — switching branches breaks both your context and mine. Call me out if I'm drifting into infrastructure ceremony instead of building. I'll do the same for you.

### Interactive vs automated testing

Verify scripts cover two kinds of tests:
- **Automated** — I run these myself via script
- **Settings-dependent** — require mid-test settings changes; these happen in conversation, not in the terminal

**Script design:** scripts must be fully unattended (no readline, no prompts, no pausing for user input). If a test requires a settings change, it gets its own script invocation or a dedicated flag — never a blocking prompt inside a longer run.

**Conversation pattern for settings-dependent tests:**
1. I run the automated portion: `node scripts/verify-<module>.mjs --auto`
2. For each settings-dependent test, I say in chat: "Go to the settings page and set X to Y, then tell me when it's done."
3. User confirms → I run the script for that specific test → check results → instruct reset → next test
4. User never needs to touch the terminal for the interactive portion

---

## Devvit Reference

See `llmphysics-bot/CLAUDE.md` for architecture, module patterns, and deployment details.
