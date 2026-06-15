# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

Parked ideas and future concepts: see [ideas.md](ideas.md).

## Commands

```bash
npm run build        # compile TypeScript → dist/server/index.cjs + dist/client/ (Vite)
devvit playtest r/llmphysics_dev   # upload bundle and stream logs (does NOT auto-build)
```

Playtest URL (re-add manually when a post opens in a new tab):
```
https://www.reddit.com/r/llmphysics_dev/?playtest=llmphysics-bot
```

There is no test runner. Validation is done manually via `devvit logs` during playtest.

---

## Live Observability

Two MCP tools are available for live observation during development and testing. Use them instead of reading log files or guessing state.

### Bot logs — Devvit MCP / CLI

**Via Bash (reliable):**
```bash
devvit logs r/llmphysics_dev llmphysics-bot --since 30m --show-timestamps
```
Key flags: `--since` (e.g. `5m`, `1h`), `-j` (JSON output), `--show-timestamps`.

**Via MCP tool** (`mcp__devvit-mcp__devvit_logs`):
```
{ subreddit: "llmphysics_dev", app: "llmphysics-bot", since: "30m" }
```
Note: this tool requires `npx` in the MCP server's PATH. If it fails with `spawn npx ENOENT`, fall back to the Bash form above.

### Supabase — PDF review job state

**MCP tool:** `mcp__plugin_supabase_supabase__execute_sql`  
**Project ID:** `eimdgqymjwfljtapnuyl`

Useful queries:
```sql
-- Current review queue state
SELECT post_id, pdf_url, status, error, created_at, updated_at
FROM review_jobs ORDER BY created_at DESC LIMIT 20;

-- Jobs stuck in 'processing' or 'queued'
SELECT post_id, status, created_at FROM review_jobs
WHERE status IN ('queued', 'processing')
ORDER BY created_at;

-- Recent failures
SELECT post_id, error, updated_at FROM review_jobs
WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 10;
```

Use this any time a PDF review doesn't appear — check the job status before assuming a bot bug.

---

## Build System: Vite + React

The project uses **Vite** (via `@devvit/start/vite`) to build both the Node.js server and the React webview client in one pass. The `@vitejs/plugin-react` plugin handles JSX transpilation.

- **Server:** Outputs to `dist/server/index.cjs` (CommonJS, required by Devvit runtime)
- **Client:** Outputs to `dist/client/` (bundled React + HTML entrypoints)

**Key file:** `vite.config.ts` — the `devvit()` plugin auto-discovers client entrypoints from `devvit.json` `post.entrypoints`. If you add a new HTML/TSX pair, Vite finds it automatically.

---

## MVP-First Development

Build the minimal core first, confirm it works end-to-end, then add the next layer. Propose explicit phases in plan mode and get agreement before moving on. Never build backend + data layer + frontend + scheduler all at once — if something breaks you can't isolate where.

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
const enabled = (await settings.get<boolean>('myModEnabled')) ?? true;
if (!enabled) return;
```

Naming convention: `<camelCasePrefix>Enabled` (e.g. `depthCapModEnabled`, `floodModEnabled`). Declare in `devvit.json` under `settings.subreddit` with `"type": "boolean"` and `"defaultValue": true`.

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

**Action modules also require `devvit.json` entries** for the menu item to appear and the form callback to work. Add one object to `menu.items` (with `label`, `description`, `forUserType`, `location`, `endpoint`) and one key-value pair to `forms` (name → Hono route path).

### Custom Post Type (Webview) Modules

Modules that render a React webview in a post (e.g. bingo card, interactive game) follow this 4-touch pattern:

**1. Client files** (`src/client/`)
```
src/client/
  ├── splash.html / splash.tsx   # inline (feed) view
  └── game.html / game.tsx        # expanded view (optional)
```
Each `.html` is a minimal shell that loads the corresponding `.tsx`:
```html
<div id="root"></div>
<script type="module" src="./splash.tsx"></script>
```
`.tsx` files use `@devvit/web/client` for navigation (`requestExpandedMode`) and `@devvit/web/server` on the server for data APIs (via plain `fetch()`).

**2. Server routes** (`src/server/action-modules/my-module.ts`)
```typescript
export function register(app: Hono): void {
  app.get('/api/my-data', async (c) => { /* fetch data */ });
  app.post('/internal/menu/create-my-post', async (c) => {
    await reddit.submitCustomPost({ title: '...', entry: 'default' });
    return c.json({ showToast: { text: 'Posted!', appearance: 'success' } });
  });
}
```
The `entry` parameter in `submitCustomPost()` must match a key in `devvit.json` `post.entrypoints` (usually `"default"` for inline).

**3. devvit.json entries**
```json
"post": {
  "dir": "dist/client",
  "entrypoints": {
    "default": { "entry": "splash.html", "inline": true, "height": "regular" },
    "game": { "entry": "game.html", "height": "tall" }
  }
},
"menu": {
  "items": [{
    "label": "Create My Post",
    "forUserType": "moderator",
    "location": "subreddit",
    "endpoint": "/internal/menu/create-my-post"
  }]
}
```

**4. Register in `registry.ts`**
```typescript
import { register as registerMyModule } from './action-modules/my-module';
// inside registerAll(): registerMyModule(app);
```

---

## Settings System

Runtime settings are stored in Redis under `settings:<key>`. All reads/writes go through `helpers/settings-helper.ts`:

- `readSetting(key, defaultValue)` — reads from Redis, casts to the type of `defaultValue`
- `writeSetting(key, value)` — writes to Redis as a string
- `readAllSettings()` — reads every key in `DEFAULTS`
- `formatSignature(raw)` — superscripts each word and prepends `---`; returns `''` on empty input

**Settings** are declared in `devvit.json` under `settings.subreddit` (mod-editable via the Reddit Developer Portal installation page) or `settings.global` (secrets like `geminiApiKey`). Read via `import { settings } from '@devvit/web/server'` → `(await settings.get<T>('key')) ?? defaultValue`.

**Adding a new setting:** add a key to `devvit.json` `settings.subreddit` with `type`, `label`, `helpText`, and `defaultValue`. Then read it in the module with `settings.get<T>()`. No other files need to change.

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

**Vite bundles everything into CommonJS.** The platform requires the server entry (`dist/server/index.cjs`) to be CommonJS. The `@devvit/start/vite` plugin handles this automatically. Do not use ESM syntax in the server code.

**No `--external` flags during bundling.** The platform does not expose packages at runtime. Vite bundles all dependencies into the server output.

**Client webview has CSP restrictions.** The iframe sandbox allows only `fetch()` calls back to the app's own server. External API calls must go through server-side routes (e.g., `/api/external-data` → `fetch()` to external API on the server).

**The HTTP server runs in the cloud**, not locally. `devvit playtest` uploads the compiled bundle; the platform executes it. Port 5678 / the VS Code devtunnel is only the live-reload WebSocket (started with `--connect`).

**Form submissions** for action modules arrive as a JSON body at `POST /internal/forms/<name>`. Boolean fields come back as `true`/`false` booleans (not strings). Select fields come back as `string[]`.

**`devvit.json` `scripts.build` is never called by the CLI.** Always run `npm run build` manually before `devvit playtest`.

**`forUserType` in menu items:** `"moderator"` (mod-only) or `"user"` (all logged-in users). `"user"` does not bypass permission checks — `reddit.remove()` etc. still require moderator privileges.

**Client context is available synchronously.** In `.tsx` files, `context.userId`, `context.postId`, etc. are available immediately (no fetch needed). This data is injected by the Devvit platform into the iframe and is different from server-side `context`.

**NEVER auto-bump the version to work around deployment errors.** If `devvit playtest` fails with "AppVersion already exists," ask first before changing `package.json` version. The issue is usually environmental (lingering process, platform state) and will resolve itself or needs manual investigation — not a version bump band-aid.

