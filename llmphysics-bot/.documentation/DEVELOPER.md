# llmphysics-bot

> A modular Reddit moderation-assistance bot for [r/LLMPhysics](https://reddit.com/r/LLMPhysics), built on the [Devvit](https://developers.reddit.com/docs) platform.

**Version:** 2.5.1
**Platform:** @devvit/web v0.12.22+  
**Subreddit:** r/LLMPhysics

---

## Overview

`llmphysics-bot` is a moderation-assistance bot for r/LLMPhysics that automates common moderation tasks such as recursive comment removal and locking. It is architected so that new capabilities can be added by creating a single `.ts` file and registering it in `registry.ts` — the core dispatch and entry-point files never need to change. Moderators (and users) interact with the bot through Reddit's overflow menu (three-dot) and through `!command` syntax typed directly in posts or comments that mention `u/LLMPhysics-bot`.

---

## Architecture

```
Reddit event
    │
    ▼
devvit.json  →  /internal/triggers/<event>
    │
    ▼
src/server/index.ts  (Hono route)
    │
    ▼  dispatch(registry.<TRIGGER_ARRAY>, event)
    │
    ├──▶ module A  run(event)   ← try/catch, errors logged, continues
    ├──▶ module B  run(event)
    └──▶ module C  run(event)
```

- Each trigger module is a self-contained `.ts` file exporting a single `run(event)` function typed to its trigger. It imports only what it needs (`reddit`, `redis`, `logger`, shared types) and has zero knowledge of other modules.
- Errors thrown by one module are caught and logged; all remaining modules in the array still run.
- `registry.ts` is the **only** file edited to add or remove trigger modules — `index.ts` and `devvit.json` are untouched for new modules on existing trigger types.
- Menu (action) modules export `register(app: Hono)` instead of `run(event)` and are mounted once at startup inside `registerAll()` in `registry.ts`.

---

## Active Trigger Modules

### `command.ts` — Command dispatcher for posts and comments

| Field | Value |
|-------|-------|
| **Trigger** | New post submitted / New comment created |
| **Array** | `POST_SUBMIT`, `COMMENT_CREATE` |
| **File** | `src/server/command.ts` |

**What it does:**

`command.ts` is registered in both `POST_SUBMIT` (as `runOnPost`) and `COMMENT_CREATE` (as `runOnComment`). When a post is submitted, it checks the post title and selftext combined; when a comment is created, it checks the comment body. If the text contains `u/LLMPhysics-bot` (case-insensitive), it scans for `!commandName` patterns using `COMMAND_PATTERN` and dispatches each match to the handler registered under that command name. Commands are registered by importing command-module files as side effects; the command map lives in memory for the lifetime of the server process.

**Abilities & Settings:**

- Parses one or more commands from a single post/comment in a single pass
- Validates command existence, content-type compatibility, and argument presence before dispatching
- Silently ignores unknown commands (logged as info), wrong content-type (logged as info), and missing required arguments (logged as warn) — no reply is sent to the user
- `BOT_MENTION` constant: `'u/LLMPhysics-bot'` — change here to rename the trigger mention
- `COMMAND_PATTERN` regex: `/!(\w+)(?:\s+\[([^\]]+)\])?/g` — matches `!commandName` and optional `!commandName [argument]`

**Common Mistakes:**

- Forgetting to mention `u/LLMPhysics-bot` in the post/comment — commands typed without the mention are completely invisible to the bot
- The bot mention check uses `toLowerCase()` but the command map lookup does not — `!Remove` will not match a command registered as `remove`
- Passing an argument without brackets (`!remove reason`) will not parse; the argument must be in square brackets (`!remove [reason]`)
- `runOnPost` concatenates `post.title` and `post.selftext` — `post.selftext` can be `undefined` for link posts; the code guards this with `?? ''`, so this is safe, but commands that try to read selftext from the event still need to guard against it
- A command-module file must call `registerCommand(...)` at module scope (not inside an async function) to ensure it registers before any events fire

---

### Unoccupied Trigger Arrays

These arrays are declared in `registry.ts` and wired to Hono routes, but contain no modules yet. They are ready to accept new modules with a single import + array-push in `registry.ts`.

| Array | Trigger | Endpoint | Notes |
|-------|---------|----------|-------|
| `APP_INSTALL` | `onAppInstall` | /internal/triggers/a-pp-in-st-al-l | Ready for future modules |
| `APP_UPGRADE` | `onAppUpgrade` | /internal/triggers/a-pp-up-gr-ad-e | Ready for future modules |
| `MOD_ACTIONS` | `onModAction` | /internal/triggers/m-od-ac-ti-on | Ready for future modules |

---

## Menu Action Modules

### `comment-moderator.ts` — Recursive comment chain removal and locking

| Field | Value |
|-------|-------|
| **Menu label(s)** | "Remove comment chain" / "Lock comment chain" |
| **Location** | comment |
| **Visibility** | user (visible to all logged-in Reddit users) |
| **Endpoint(s)** | `/internal/menu/remove-comment-chain`, `/internal/menu/lock-comment-chain` |
| **Redis key** | `bot:chainmod:log` |

**What it does:**

**Remove comment chain:** When triggered, the module identifies the acting moderator via `reddit.getCurrentUsername()`, then recursively collects the entire comment subtree below (and including) the target comment using a post-order traversal — deepest children are collected and removed first so that parent removal never orphans a fetch. After removal, it attaches a removal note to the root comment recording which moderator triggered the action and how many comments were removed. The result is displayed to the triggering user as a toast (`"Removed N comments."`).

**Lock comment chain:** Similarly collects all replies recursively and calls `comment.lock()` on each one that is not already locked, working deepest-first. The total number of newly locked comments is returned as a toast (`"Locked N comments."`). Unlike removal, lock failures on individual comment fetches are caught and skipped rather than stopping the chain.

Both actions append a structured entry to the Redis sorted set `bot:chainmod:log` (scored by Unix timestamp), capped at 200 entries (FIFO eviction via `zRemRangeByRank`). Each entry records: `{ ts, action, targetId, by, count }`.

**Abilities & Settings:**

- `CHAIN_LOG_KEY = 'bot:chainmod:log'` — Redis key for the action audit log
- `MAX_LOG_ENTRIES = 200` — maximum entries kept in the sorted set; oldest are evicted when exceeded
- Log entries record action type (`remove_chain` or `lock_chain`), target comment ID, acting moderator username, and comment count
- Errors during individual comment removals are caught and logged as warnings; the chain operation continues
- Returns a success toast on completion or a neutral toast if the top-level operation throws

**Common Mistakes:**

- Using this on a thread with thousands of nested replies — the recursive fetch calls `comment.replies.all()` at every depth level and can hit Devvit's platform timeout on very deep or wide threads
- Expecting the removal note to appear instantly in the mod log; it may lag slightly due to Reddit API propagation
- Assuming the Redis log persists forever — it is capped at `MAX_LOG_ENTRIES = 200` entries (FIFO eviction)
- The menu items appear for all logged-in users (`"forUserType": "user"`), but the underlying `reddit.remove()` and `comment.lock()` calls require moderator permissions — non-mods who trigger it will see an error response
- Not rebuilding (`npm run build`) after changing the module — the server runs the compiled bundle, not the TypeScript source
- Note: `src/server/modules/comment-moderator.ts` exists in the repo but is **not** imported by `registry.ts` and is not active. The live file is `src/server/action-modules/comment-moderator.ts`.

---

## Command System

The command system allows moderators (or users) to invoke bot actions by typing commands in posts or comments that mention the bot.

### Trigger condition

The body of the post or comment **must** contain `u/LLMPhysics-bot` (case-insensitive). Without this mention, `parseAndDispatch` returns immediately without parsing any commands.

### Syntax

```
u/LLMPhysics-bot !commandName
u/LLMPhysics-bot !commandName [argument]
```

Multiple commands can appear in a single post or comment and all will be dispatched in order.

### Regex

`command.ts` uses `COMMAND_PATTERN` to extract commands:

```
/!(\w+)(?:\s+\[([^\]]+)\])?/g
```

- Group 1: command name (word characters only)
- Group 2: optional argument enclosed in `[square brackets]`

### Registration

Command modules register themselves at module scope by calling:

```typescript
registerCommand(definition: CommandDefinition, handler: CommandHandler): void
```

Importing the module file in `registry.ts` as a side-effect import (`import './command-modules/my-command'`) causes `registerCommand` to run before any events arrive.

### `CommandDefinition` fields (from `types.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `commandName` | `string` | The name after `!` — case-sensitive |
| `contentType` | `'comment' \| 'post' \| 'both'` | Where the command is valid |
| `requiresArgument` | `boolean` | If true, the command is skipped when no `[argument]` is present |

### `CommandHandler` signature

```typescript
type CommandHandler = (event: CommandEvent, argument: string | null) => Promise<void>;
```

`argument` is `null` when `requiresArgument` is `false` and no argument was supplied.

### Dispatch behavior

| Situation | Behavior |
|-----------|----------|
| Unknown command | Logged as `info`, silently ignored |
| Wrong `contentType` | Logged as `info`, silently skipped |
| Missing required argument | Logged as `warn`, silently skipped |
| Duplicate registration | Logged as `warn`, second registration overwrites first |

### Common Mistakes

- Forgetting the `u/LLMPhysics-bot` mention — commands typed without the mention are completely ignored
- Using `!CommandName` (capital first letter) — command lookup is case-sensitive (`commands.get(commandName)`)
- Passing an argument without brackets (`!remove reason`) won't parse — must be `!remove [reason]`
- Importing a command module in `registry.ts` without the side-effect syntax: `import './command-modules/my-command'` is correct; `import { something } from './command-modules/my-command'` only works if the file also calls `registerCommand` at module scope
- Setting `requiresArgument: true` without guarding `argument` being `null` in the handler — TypeScript types it as `string | null` even after the guard in `parseAndDispatch`

---

## Configuration

### `devvit.json`

| Key | Value | Description |
|-----|-------|-------------|
| `name` | `"llmphysics-bot"` | App slug used in playtest URLs and platform identifiers |
| `server.entry` | `"index.js"` | Compiled entry point; the platform resolves this to `dist/server/index.js` after `npm run build` |
| `permissions.redis` | `true` | Grants access to the `redis` API from `@devvit/web/server` |
| `permissions.reddit.enable` | `true` | Grants access to the `reddit` API from `@devvit/web/server` |

#### Triggers

| Trigger name | Reddit event | Endpoint |
|--------------|-------------|----------|
| `onAppInstall` | Bot installed on subreddit | `/internal/triggers/app-install` |
| `onAppUpgrade` | Bot version updated | `/internal/triggers/app-upgrade` |
| `onPostSubmit` | New post submitted | `/internal/triggers/post-submit` |
| `onCommentCreate` | New comment created | `/internal/triggers/comment-create` |
| `onPostReport` | Post reported by a user | `/internal/triggers/post-report` |
| `onCommentReport` | Comment reported by a user | `/internal/triggers/comment-report` |
| `onModAction` | A moderator took an action | `/internal/triggers/mod-action` |

#### Menu items

| Label | Location | `forUserType` | Endpoint |
|-------|----------|--------------|----------|
| Remove comment chain | comment | user | `/internal/menu/remove-comment-chain` |
| Lock comment chain | comment | user | `/internal/menu/lock-comment-chain` |

#### `scripts.build`

`devvit.json` declares `"scripts": { "build": "npm run build" }`, but **the Devvit CLI never calls `scripts.build`**. You must run `npm run build` yourself before each playtest.

---

### `package.json`

#### Scripts

**`build`:**

```bash
esbuild src/server/index.ts --bundle --platform=node --format=cjs --outfile=dist/server/index.js
```

- `--bundle`: includes all `import`ed modules in a single file — no `--external` flags are used
- `--platform=node`: targets the Node.js runtime the Devvit platform provides
- `--format=cjs`: outputs CommonJS (required by the platform)
- `--outfile=dist/server/index.js`: output path the platform reads

**`dev`:**

```bash
devvit playtest r/llmphysics_dev
```

Uploads the compiled bundle and begins monitoring logs. Does **not** compile TypeScript — run `npm run build` first.

#### Key dependencies

| Package | Purpose |
|---------|---------|
| `@devvit/web` | Core platform APIs: `reddit`, `redis`, trigger types, `createServer`, `getServerPort` |
| `hono` | Lightweight HTTP framework for routing trigger and menu endpoints |
| `@hono/node-server` | Provides `getRequestListener` to bridge Hono to Node's `http.createServer` |
| `esbuild` | Bundles TypeScript source into a single CJS file for the platform |
| `typescript` | Type-checking at build time |
| `@devvit/shared-types` | Supplementary type definitions for Devvit platform payloads |

**Common Mistakes:**

- Adding `--external:@devvit/web` or similar to the esbuild command — the platform does not expose these packages at runtime; the server will crash with `"Cannot find module"`
- Using `serve()` from `@hono/node-server` instead of `createServer` from `@devvit/server` — the Devvit version wraps `listen()` to no-op during bundle evaluation, preventing port binding; `serve()` will attempt to bind a port and fail
- Forgetting to run `npm run build` before `devvit playtest` — the CLI uploads whatever is in `dist/`, not the TypeScript source
- Navigating to the subreddit without `?playtest=llmphysics-bot` in the URL — you'll get the production version, not your local playtest build

---

## Logger

`logger(moduleName)` returns a scoped structured logger. Call it once at module scope.

```typescript
const log = logger('my-module');
log.info('something happened', { postId });
log.warn('approaching a limit');
log.error('Reddit API failed', err, { postId });
```

### Log format

```
[ISO timestamp][LEVEL][module-name] message {data}
```

Example:
```
[2026-04-29T14:23:01.042Z][INFO][comment-moderator] Chain removed {"targetId":"t1_abc","count":5,"by":"AllHailSeizure"}
```

### Output channels

| Level | Console | Redis |
|-------|---------|-------|
| `info` | `console.log` | Yes — `bot:log:info` |
| `warn` | `console.warn` | Yes — `bot:log:warn` |
| `error` | `console.error` | Yes — `bot:log:error` |

All console output is visible via `devvit logs` during a playtest session.

### Redis persistence

Logs are stored in sorted sets keyed by level (`bot:log:info`, `bot:log:warn`, `bot:log:error`), scored by Unix timestamp (milliseconds). Each level is capped at **500 entries**; when the cap is exceeded, the oldest entry is evicted via `zRemRangeByRank`. Log failures are silently swallowed — a Redis outage will never crash the bot.

`log.error()` accepts `(message, error, data?)`. The `Error` object is serialized to `{ message, stack }` automatically.

### Common Mistakes

- Calling `logger('my-module')` inside a loop or per-request — call it once at module scope and reuse the instance
- Expecting Redis log entries to persist indefinitely — they are capped at 500 per level (oldest evicted first)
- Logging sensitive data (user IDs, post content) — Redis logs may be accessed later via a mod dashboard

---

## Development Guide

### Adding a Trigger Module

```
1. Create src/server/modules/my-module.ts
   - Export a single async run(event: <TriggerType>Request): Promise<void>
   - Import only what you need: reddit, redis, logger, shared types
   - No knowledge of other modules

2. Open src/server/registry.ts and add two lines:
   import { run as myModule } from './modules/my-module';   // top of file
   export const POST_SUBMIT = [...existing, myModule];       // add to array
```

### Adding a Menu Action Module

```
1. Create src/server/action-modules/my-action.ts
   - Export register(app: Hono): void
   - Inside register(), use app.post('/internal/menu/my-action', ...) to handle the endpoint
   - Declare the menu item in devvit.json under menu.items (label, location, forUserType, endpoint)

2. Open src/server/registry.ts and add:
   import { register as registerMyAction } from './action-modules/my-action';
   // inside registerAll(), after the trigger routes:
   registerMyAction(app);
```

### Adding a Command Module

```
1. Create src/server/command-modules/my-command.ts
   - At module scope, call:
     registerCommand(
       { commandName: 'foo', contentType: 'both', requiresArgument: false },
       async (event, arg) => { /* handler */ }
     );

2. Open src/server/registry.ts and add under "Command module imports":
   import './command-modules/my-command';   // side-effect import — runs registerCommand
```

### Build & Deploy Cycle

```bash
npm run build                             # compile TypeScript → dist/server/index.js
devvit playtest r/llmphysics_dev          # upload to platform and stream logs
```

Test at:

```
https://www.reddit.com/r/llmphysics_dev/?playtest=llmphysics-bot
```

When clicking posts that open in a new tab, the `?playtest=` parameter is lost — re-add it manually. Use `devvit playtest --connect` to have the CLI auto-inject the parameter into the URL it prints.

---

Created by u/AllHailSeizure for r/LLMPhysics.
