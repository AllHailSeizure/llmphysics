# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
npm run build        # compile TypeScript → dist/server/index.js (must run before playtest)
devvit playtest r/llmphysics_dev   # upload bundle and stream logs (does NOT auto-build)
```

Playtest URL (re-add manually when a post opens in a new tab):
```
https://www.reddit.com/r/llmphysics_dev/?playtest=llmphysics-bot
```

There is no test runner. Validation is done manually via `devvit logs` during playtest.

---

## File Map

```
src/server/
├── index.ts                          # 9-line entry point, never changes
├── registry.ts                       # imports and wires all modules into trigger arrays
├── types.ts                          # shared TypeScript types for all modules
├── admin.ts                          # settings form routes (menu + form handlers)
├── settings-registry.ts              # single source of truth for all SettingDef arrays
├── helpers/
│   ├── command-helper.ts             # parseAndDispatch, runOnPost, runOnComment
│   ├── log-helper.ts                 # logger(), logZSet()
│   ├── redis-helper.ts               # flood post tracking (hashes + sorted set)
│   └── settings-helper.ts           # readSetting, writeSetting, readAllSettings, formatSignature
├── trigger-modules/
│   ├── depth-cap-moderator.ts        # locks deep comment chains (COMMENT_CREATE)
│   ├── flood-moderator.ts            # posting quota enforcement (POST_SUBMIT, MOD_ACTIONS, POST_DELETE)
│   ├── length-moderator.ts           # post length limits (POST_SUBMIT)
│   ├── report-moderator.ts           # auto-ignore reports on bot comments/posts
│   └── self-response-moderator.ts   # removes OP top-level comments (COMMENT_CREATE)
├── action-modules/
│   ├── mop-tool.ts                   # "Chain Mop" overflow menu item (comment context)
│   ├── quota-viewer.ts               # "Flood Quota" overflow menu item (subreddit context)
│   └── response-tool.ts             # "Saved Responses" overflow menu item
└── command-modules/
    └── define-command.ts             # !define [term] — Wikipedia lookup via Gemini
```

---

## Architecture

Reddit events → `devvit.json` → `POST /internal/triggers/<slug>` → `registry.ts` → `dispatch()` → each module's `run(event)`.

`index.ts` is 9 lines and never changes. `registry.ts` is the only file edited to add/remove modules.

### Three module types

**Trigger modules** (`trigger-modules/`) — activated by Reddit events. Export one or more `run(event)` functions typed to their trigger.

**Action modules** (`action-modules/`) — activated by overflow-menu clicks. Export `register(app: Hono)` that mounts Hono routes (`/internal/menu/<name>` and `/internal/forms/<name>`). Must also declare the menu item and form in `devvit.json`.

**Command modules** (`command-modules/`) — activated by `u/LLMPhysics-bot !commandName [arg]` in posts/comments. Side-effect imports: call `registerCommand()` at module scope, then add a bare `import './command-modules/my-command'` to `registry.ts`.

### Dispatch isolation

`dispatch()` wraps each module in try/catch. A thrown error is logged and execution continues with the next module in the array.

### Trigger arrays in `registry.ts`

```
POST_SUBMIT:    [runOnPost (commands), runQuotaCheck (flood), runLengthModerator]
COMMENT_CREATE: [runOnComment (commands), runDepthCapModerator, runSelfResponseModerator]
POST_REPORT:    [runOnPostReport (report-moderator)]
COMMENT_REPORT: [runOnCommentReport (report-moderator)]
MOD_ACTIONS:    [runFloodOnModAction]
POST_DELETE:    [runFloodOnPostDelete]
APP_INSTALL, APP_UPGRADE, MOD_MAIL: []  (empty, wired but unused)
```

Note: `flood-moderator.ts` exports **three** separate functions for different triggers: `runQuotaCheck`, `runOnModAction`, `runOnPostDelete`.

### Adding a module (2 lines in `registry.ts`)

```typescript
// Trigger module
import { run as myModule } from './trigger-modules/my-module';
const POST_SUBMIT: PostSubmitHandler[] = [...existing, myModule];

// Action module
import { register as registerMyModule } from './action-modules/my-module';
// inside registerAll(): registerMyModule(app);

// Command module
import './command-modules/my-command';   // side-effect — runs registerCommand() at module scope
```

---

## Redis Dedup Pattern

Every trigger module that processes content (posts/comments) uses Redis `SET NX` at the top to prevent duplicate event delivery from the platform:

```typescript
const dedupeKey = `bot:mymod:handled:${itemId}`;
const claimed = await redis.set(dedupeKey, '1', { nx: true });
if (!claimed) { log.warn('Duplicate trigger', { itemId }); return; }
await redis.expire(dedupeKey, 3600);
```

Dedup key prefixes in use:
- `bot:dcmod:handled:{commentId}` — depth-cap-moderator
- `bot:flood:handled:{postId}` — flood-moderator
- `bot:lenmod:handled:{postId}` — length-moderator
- `bot:srmod:handled:{commentId}` — self-response-moderator
- `bot:rf:comment:{commentId}` / `bot:rf:post:{postId}` — report-moderator
- `bot:cmd:{contentId}` — command-helper (per comment/post, not per command)

---

## Module enable/disable

Every trigger module checks its enabled flag as its **first line** and returns early if off:

```typescript
const enabled = await readSetting('myModEnabled', true);
if (!enabled) return;
```

Enable keys (all default `true`, stored in Redis via admin forms):
- `depthCapModEnabled`
- `floodModEnabled`
- `selfResponseModEnabled`
- `lengthModEnabled`
- `mopToolEnabled`
- `responseToolEnabled`
- `defineCommandEnabled`

To add a new enabled flag: add it to `DEFAULTS` in `settings-helper.ts`, add a `boolean` SettingDef in `settings-registry.ts` under the `modules` menu, and check it at the top of your module.

---

## Settings System

### Two-tier settings storage

**Redis settings** (runtime, editable via admin forms): read/written through `helpers/settings-helper.ts`. Stored under `settings:<key>`.

**Platform settings** (`devvit.json` `settings.global`): read via `settings.get<T>('key')` from `@devvit/web/server`. Used only for secrets. Currently: `geminiApiKey` (used by `define-command.ts`). Do NOT use `readSetting()` for these.

### `helpers/settings-helper.ts`

- `readSetting(key, defaultValue)` — reads from Redis, casts to the type of `defaultValue`
- `writeSetting(key, value)` — writes to Redis as a string
- `readAllSettings()` — reads every key in `DEFAULTS`
- `formatSignature(raw)` — superscripts each word and prepends `---`; returns `''` on empty input

**`DEFAULTS`** in `settings-helper.ts` is the authoritative list of Redis-backed settings. Every setting key must appear there. Current list includes all enabled flags, all flood/depth/length/self-response config, and `botSignature`.

### `settings-registry.ts`

Exports `SETTINGS_MENUS: SettingsMenu[]` — an ordered list of settings groups consumed by `admin.ts` to build forms. Each group has a `key`, `label`, and `settings: SettingDef[]`. Current groups:

| key | label | contents |
|-----|-------|----------|
| `modules` | Modules | all `*Enabled` toggles |
| `flood` | Flood Moderator | quota limits + ignore flags |
| `commenting` | Commenting | depth cap limits/ignores + self-response ignores |
| `posting` | Posting | length mod limits |
| `removal-messages` | Removal Messages | `botSignature` + all response text fields |

**Adding a new setting:**
1. Add key + default to `DEFAULTS` in `settings-helper.ts`
2. Add a `SettingDef` entry to the appropriate group in `settings-registry.ts`
3. If it's a platform secret, add it to `devvit.json` `settings.global` instead

### `admin.ts`

Mounts one menu route per settings group (`/internal/menu/bot-settings-<key>`) that returns `showForm`, and one form save handler per group (`/internal/forms/bot-settings-<key>`) that saves submitted values. All routes are generated dynamically from `SETTINGS_MENUS`. Boolean fields not present in submission (unchecked checkboxes) are saved as `false`.

---

## Command System

`helpers/command-helper.ts` exports `runOnPost` and `runOnComment` (registered in `POST_SUBMIT` and `COMMENT_CREATE` respectively). Both check for a `u/LLMPhysics-bot` mention (case-insensitive), then parse commands with:

```
/!(\w+)(?:\s+\[([^\]]+)\])?/g
```

Command lookup is **case-sensitive**. Unknown commands, wrong content-type, and missing required arguments are all silently skipped (logged at info/warn). A per-content Redis dedup key (`bot:cmd:{contentId}`) ensures each post/comment is only dispatched once even if delivered twice.

`registerCommand(definition, handler)` is called at module scope in each command module. The `commands` map is module-level and populated via side-effect imports.

### `!define [term]` command (`define-command.ts`)

- Content type: `comment` only
- Requires argument: yes
- Flow: Gemini API resolves term → canonical Wikipedia title → Wikipedia API fetches extract → replies with truncated extract + link
- Primary model: `gemini-2.5-flash-lite`; fallback on 429: `gemini-3.1-flash-lite`
- API key: `geminiApiKey` from platform settings (`settings.get<string>('geminiApiKey')`)
- Domains must be allowlisted in `devvit.json` `permissions.http.domains`

---

## Action Modules

### Multi-step form pattern (session via Redis)

Multi-step flows store state in Redis with a 5-minute TTL:

```typescript
const SESSION_TTL = 300;
async function setSession(user: string, data: MySession): Promise<void> {
  await redis.set(`bot:mymod:session:${user}`, JSON.stringify(data));
  await redis.expire(`bot:mymod:session:${user}`, SESSION_TTL);
}
```

The menu handler saves the session; each subsequent form handler reads and may update/delete it.

### Chain Mop (`mop-tool.ts`)

- Menu: comment overflow → `POST /internal/menu/chain-mop` → saves `targetId` in session
- Form: `POST /internal/forms/chain-mop` → reads session, collects subtree, removes/locks
- Operations: remove subtree post-order (deepest first), lock subtree, skip distinguished optional
- Adds a Reddit removal note via `reddit.addRemovalNote()`
- Session key: `bot:chainmod:session:{username}`
- Activity log: `bot:chainmod:log` (200 entries); depth-cap log: `bot:chainmod:depth-log` (200 entries)

### Saved Responses (`response-tool.ts`)

- Stored as JSON array in Redis under `bot:savedresponses`
- Each response: `{ id, title, body, location: 'post'|'comment'|'both' }`
- Apply flow: subreddit/comment/post menu → select response → preview/edit → submit as bot or moderator
- Manage flow: subreddit menu → New / Edit / Delete
- Template macros expanded by `expandMacros()`:
  - `{get_username}` → `u/<author>`
  - `{get_post_flair}` → post flair text (strips emoji)
  - `{modmail}` → markdown modmail link
- Can post comment as `APP` (bot account) or `USER` (acting mod)
- Session keys: `bot:savedresponses:apply:{username}`, `bot:savedresponses:edit:{username}`

### Quota Viewer (`quota-viewer.ts`)

- Subreddit overflow menu → `POST /internal/menu/quota-viewer`
- Two-step: search by username → display results
- Calls `evaluateFloodStatus()` from `redis-helper.ts` with current settings
- Shows each tracked post and whether it counts toward quota
- Only available when `floodModEnabled` is true

---

## Trigger Modules

### Depth Cap Moderator (`depth-cap-moderator.ts`)

- Trigger: `COMMENT_CREATE`
- Walks the ancestor chain up to `depthCap` steps to verify exact depth
- At depth == cap: replies with notice (distinguished + locked), locks the comment, reports it
- Reply before locking so the bot can post to an unlocked comment
- Respects `depthCapIgnoreModerators` and `depthCapIgnoreContributors` (note: these two keys are read but **not** in `DEFAULTS` — they default inline to `true`)
- Settings: `depthCapModEnabled`, `depthCap`, `depthCapIgnoreModerators`, `depthCapIgnoreContributors`, `depthCapResponse`

### Flood Moderator (`flood-moderator.ts`)

- Three exported handlers covering three trigger events:
  - `runQuotaCheck` (POST_SUBMIT): track post, evaluate quota, remove + comment if exceeded
  - `runOnModAction` (MOD_ACTIONS): mark post as mod-removed or auto-removed (bot) in Redis hash
  - `runOnPostDelete` (POST_DELETE): mark post as user-deleted (`source === 1` only)
- Quota logic lives entirely in `redis-helper.ts` (`evaluateFloodStatus`)
- Re-fetches post before removal to guard against double-removal
- Settings: `floodModEnabled`, `floodAssistantMaxPosts`, `floodAssistantWindowHours`, plus five ignore flags

### Length Moderator (`length-moderator.ts`)

- Trigger: `POST_SUBMIT`
- Two independent checks (both can apply):
  1. **Max unhosted length**: enforced only when post flair matches `lengthModFlairId` and `maxUnhostedLength > 0`
  2. **Min hosted length**: enforced when post body contains a URL and `minHostedLength > 0`
- `bodyLength()` counts non-whitespace characters
- `enforce()` helper: remove → lock → comment (distinguished, locked)
- Settings: `lengthModEnabled`, `lengthModFlairId`, `lengthModMaxUnhostedLength`, `lengthModMinHostedLength`, `lengthModMaxUnhostedComment`, `lengthModMinHostedComment`

### Self-Response Moderator (`self-response-moderator.ts`)

- Trigger: `COMMENT_CREATE`
- Only fires for **top-level comments** (`parentId.startsWith('t3_')`) where `commentAuthorId === post.authorId`
- Removes the comment and locks it; optionally replies with `selfResponseResponse`
- Respects `selfResponseIgnoreModerators` and `selfResponseIgnoreContributors`
- Settings: `selfResponseModEnabled`, `selfResponseResponse`, `selfResponseIgnoreModerators`, `selfResponseIgnoreContributors`

### Report Moderator (`report-moderator.ts`)

- Trigger: `POST_REPORT` and `COMMENT_REPORT`
- Auto-calls `ignoreReports()` on any post/comment authored by a bot account
- `BOT_AUTHORS` set: `{'AutoModerator', 'FloodAssistant', 'LLMPhysics-ModTeam', 'llmphysics-bot'}`
- No enable/disable setting — always active

---

## Redis Infrastructure (`redis-helper.ts`)

Flood post tracking uses a two-level structure:

```
flood:post:{postId}   — Hash: userId, createdAt (ms), isModerator, isApprovedUser,
                         isUserDeleted, isModRemoved, isAutoRemoved
flood:posts           — Global sorted set, score = createdAt ms, member = postId
```

- Hash TTL: 48 hours (longer than any quota window to survive setting changes)
- `evaluateFloodStatus()` prunes the sorted set to the current window, then fetches all hashes for matching posts. All exemption logic (`ignoreMods`, `ignoreDeleted`, etc.) is computed from hash flags — no Reddit API calls needed at evaluation time.
- `currentPostId` is excluded from the count so a new post isn't counted against itself while being evaluated.

---

## Logger

```typescript
const log = logger('my-module');   // call once at module scope
log.info('msg', { data });
log.warn('msg');
log.error('msg', err, { data });   // err is serialized to { message, stack }
```

All levels write to console (visible via `devvit logs`). Each level is also persisted to a Redis sorted set (`bot:log:info`, `bot:log:warn`, `bot:log:error`), capped at 500 entries (oldest evicted).

`logZSet(key, entry, maxEntries?)` writes an arbitrary object to a module-specific sorted set. Used by mop-tool (`bot:chainmod:log`, `bot:chainmod:depth-log`) and self-response-moderator (`bot:srmod:log`).

---

## `devvit.json` Sync Requirements

When adding a new action module, three things must stay in sync:

1. `menu.items[]` — declares the overflow menu item and maps to the menu endpoint
2. `forms{}` — maps each form name (returned as `showForm.name`) to its handler endpoint
3. The Hono routes in the module itself

Current menu item locations: `comment`, `post`, `subreddit`. The `postFilter: "none"` disables the default post-type filter.

When adding a new platform-level setting (secret or app-install-time), add it to `devvit.json` `settings.global` or `settings.subreddit`. Runtime per-subreddit settings that change without reinstalling should use the Redis settings system instead.

---

## Devvit Platform: Hard-Won Knowledge

**esbuild — no `--external` flags.** The platform does not expose packages at runtime. Bundle everything:
```
esbuild src/server/index.ts --bundle --platform=node --format=cjs --outfile=dist/server/index.js
```

**`createServer` from `@devvit/server`, not `serve` from `@hono/node-server`.** The Devvit version no-ops `listen()` during bundle evaluation to prevent port-binding failures. `serve()` will crash.

**The HTTP server runs in the cloud**, not locally. `devvit playtest` uploads the compiled bundle; the platform executes it. Port 5678 / the VS Code devtunnel is only the live-reload WebSocket (started with `--connect`).

**Form submissions** for action modules arrive as a JSON body at `POST /internal/forms/<name>`. Boolean fields come back as `true`/`false` booleans (not strings). Select fields come back as `string[]`.

**`devvit.json` `scripts.build` is never called by the CLI.** Always run `npm run build` manually before `devvit playtest`.

**`forUserType` in menu items:** `"moderator"` (mod-only) or `"user"` (all logged-in users). `"user"` does not bypass permission checks — `reddit.remove()` etc. still require moderator privileges.

**HTTP domains** must be declared in `devvit.json` `permissions.http.domains`. Currently: `en.wikipedia.org`, `generativelanguage.googleapis.com`.
