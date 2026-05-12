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

## Architecture

Reddit events → `devvit.json` → `POST /internal/triggers/<slug>` → `registry.ts` → `dispatch()` → each module's `run(event)`.

`index.ts` is 9 lines and never changes. `registry.ts` is the only file edited to add/remove modules.

### Three module types

**Trigger modules** (`trigger-modules/`) — activated by Reddit events. Export a single `run(event)` typed to their trigger.

**Action modules** (`action-modules/`) — activated by overflow-menu clicks. Export `register(app: Hono)` that mounts Hono routes (`/internal/menu/<name>` and `/internal/forms/<name>`). Must also declare the menu item in `devvit.json`.

**Command modules** (`command-modules/`) — activated by `u/LLMPhysics-bot !commandName [arg]` in posts/comments. Side-effect imports: call `registerCommand()` at module scope, then add a bare `import './command-modules/my-command'` to `registry.ts`.

### Dispatch isolation

`dispatch()` wraps each module in try/catch. A thrown error is logged and execution continues with the next module in the array.

### Module enable/disable

Every trigger module checks its enabled flag as its **first line** and returns early if off:

```typescript
const enabled = await readSetting('myModEnabled', true);
if (!enabled) return;
```

Naming convention: `<camelCasePrefix>Enabled` (e.g. `depthCapModEnabled`, `floodModEnabled`, `selfResponseModEnabled`, `lengthModEnabled`). Add the key to `DEFAULTS` in `settings-helper.ts` (default `true`) and a `boolean` field in `admin.ts`.

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

## Settings System

Runtime settings are stored in Redis under `settings:<key>`. All reads/writes go through `helpers/settings-helper.ts`:

- `readSetting(key, defaultValue)` — reads from Redis, casts to the type of `defaultValue`
- `writeSetting(key, value)` — writes to Redis as a string
- `readAllSettings()` — reads every key in `DEFAULTS`
- `formatSignature(raw)` — superscripts each word and prepends `---`; returns `''` on empty input

**Adding a new setting:** add it to `DEFAULTS` in `settings-helper.ts`, add a form field in `admin.ts`, and (if platform-level) add it to `devvit.json`.

The `admin.ts` settings form is a two-route pair: `POST /internal/menu/bot-settings` returns `showForm`, and `POST /internal/forms/bot-settings` saves submitted values. This pattern is reused by all action modules.

---

## Command System

`helpers/command-helper.ts` exports `runOnPost` and `runOnComment` (registered in `POST_SUBMIT` and `COMMENT_CREATE` respectively). Both check for a `u/LLMPhysics-bot` mention (case-insensitive), then parse `!commandName` and `!commandName [argument]` with:

```
/!(\w+)(?:\s+\[([^\]]+)\])?/g
```

Command lookup is **case-sensitive**. Unknown commands, wrong content-type, and missing required arguments are all silently skipped (logged at info/warn).

---

## Logger

```typescript
const log = logger('my-module');   // call once at module scope
log.info('msg', { data });
log.warn('msg');
log.error('msg', err, { data });   // err is serialized to { message, stack }
```

All levels write to console (visible via `devvit logs`). Each level is also persisted to a Redis sorted set (`bot:log:info`, `bot:log:warn`, `bot:log:error`), capped at 500 entries (oldest evicted).

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
