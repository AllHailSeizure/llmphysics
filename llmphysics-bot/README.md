# llmphysics-bot

A modular Reddit moderation-assistance bot for [r/LLMPhysics](https://reddit.com/r/LLMPhysics), built on the [Devvit](https://developers.reddit.com/docs) platform.

**Version:** 2.15.2.1  
**Platform:** @devvit/web 0.13.2  
**Subreddit:** r/LLMPhysics

---

## Overview

`llmphysics-bot` automates common moderation tasks for r/LLMPhysics. It enforces posting rules, handles comment chains, provides AI-powered paper reviews, and gives moderators menu-driven tools accessible directly from the Reddit UI.

The architecture is intentionally modular: each capability is a self-contained TypeScript file. Adding a new feature means creating one file and adding one line to `registry.ts` — the entry point and core dispatch logic never need to change.

Moderators and users interact with the bot through:
- Reddit's overflow (three-dot) menu on posts and comments
- `!command [argument]` syntax in posts or comments that mention `u/LLMPhysics-bot`

---

## Architecture

```
Reddit event
    │
    ▼
devvit.json → /internal/triggers/<event>
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

**Trigger modules** export `run(event)` and are registered in arrays in `registry.ts`. Each module is isolated — errors in one do not stop others.

**Action modules** (menu items) export `register(app: Hono)` and mount their own routes, registered once at startup inside `registerAll()`.

**Command modules** call `registerCommand()` at module scope and are imported as side-effects in `registry.ts`.

```
src/server/
├── index.ts                         Entry point; creates Hono app
├── registry.ts                      Registers all modules
├── types.ts                         Shared types
├── settings-registry.ts             All settings definitions
├── admin.ts                         Settings form handlers
├── trigger-modules/
│   ├── flood-moderator.ts           Post quota enforcement
│   ├── depth-cap-moderator.ts       Comment depth enforcement
│   ├── self-response-moderator.ts   OP self-reply enforcement
│   ├── length-moderator.ts          Post length enforcement
│   └── report-moderator.ts          Bot-report ignorer
├── action-modules/
│   ├── adversarial-reviewer.ts      AI physics paper reviewer
│   ├── mop-tool.ts                  Chain Mop
│   ├── response-tool.ts             Saved Responses
│   └── quota-viewer.ts              Flood Quota Checker
├── command-modules/
│   └── define-command.ts            !define command
└── helpers/
    ├── command-helper.ts            Command dispatch
    ├── redis-helper.ts              Flood status tracking
    ├── settings-helper.ts           Settings read/write
    └── log-helper.ts                Structured logger
```

---

## Setup & Installation

### Prerequisites

- Node.js 18+
- Devvit CLI: `npm install -g devvit`
- A Reddit account with moderator access to your target subreddit
- A [Google Gemini API key](https://aistudio.google.com/) (required for Adversarial Reviewer and `!define` command)
- (Optional) A [Supabase](https://supabase.com/) project for PDF review processing

### Install dependencies

```bash
cd llmphysics-bot
npm install
```

### Build

```bash
npm run build
```

Runs `vite build`, compiling TypeScript into the dist bundle.

### Playtest (development)

```bash
npm run build
devvit playtest r/llmphysics_dev
```

Navigate to your dev subreddit with `?playtest=llmphysics-bot` appended to the URL. When posts open in new tabs, re-add the query parameter manually.

### Deploy to production

```bash
npm run build
devvit upload
```

Then install the app on your subreddit via the Devvit Developer Portal.

### Configure API keys

In the Devvit app settings panel (accessible via the subreddit's app settings), set:

| Setting key | Description |
|-------------|-------------|
| `geminiApiKey` | Google Gemini API key — required for Adversarial Reviewer and `!define` |
| `supabaseUrl` | Supabase project URL — required for PDF review processing (optional) |
| `supabaseServiceRoleKey` | Supabase service role key (optional) |

---

## Trigger Modules

### Flood Moderator

**File:** `src/server/trigger-modules/flood-moderator.ts`  
**Triggers:** `onPostSubmit`, `onModAction`, `onPostDelete`

Enforces a per-user post quota using a rolling time window. When a user submits a post that exceeds their quota, the bot removes it and optionally posts a distinguished, stickied removal comment.

Every post is tracked in Redis regardless of whether enforcement fires. This tracking data is shared with the Quota Viewer and the bingo app.

**Removal logic:**
1. On `onPostSubmit`, the post is tracked in Redis and the user's mod/contributor status is stored
2. The quota is evaluated using the user's recent posts in the window; bot-removed, mod-removed, deleted, or exempt users can be excluded
3. If quota is exceeded, the post is removed and a comment is posted
4. `onModAction` updates the hash flag when a mod removes a post (`isModRemoved`)
5. `onPostDelete` updates the hash flag when the author deletes a post (`isUserDeleted`)

**Redis keys:**
- `flood:post:{postId}` — Hash: `userId`, `createdAt`, `isModerator`, `isApprovedUser`, `isUserDeleted`, `isModRemoved`, `isAutoRemoved`
- `flood:posts` — Global sorted set, score = creation timestamp
- `bot:flood:handled:{postId}` — Dedup key, TTL 1 hour

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `floodModEnabled` | `true` | Enable/disable (tracking still runs when disabled) |
| `floodAssistantMaxPosts` | `1` | Max posts per window |
| `floodAssistantWindowHours` | `24` | Rolling window in hours |
| `floodAssistantIgnoreModerators` | `true` | Exempt moderators from quota |
| `floodAssistantIgnoreContributors` | `true` | Exempt approved submitters from quota |
| `floodAssistantIgnoreAutoRemoved` | `true` | Don't count bot-removed posts |
| `floodAssistantIgnoreRemoved` | `true` | Don't count mod-removed posts |
| `floodAssistantIgnoreDeleted` | `true` | Don't count user-deleted posts |
| `floodAssistantResponse` | `''` | Removal comment text (leave blank for silent removal) |

---

### Depth Cap Moderator

**File:** `src/server/trigger-modules/depth-cap-moderator.ts`  
**Trigger:** `onCommentCreate`

Locks comment chains that reach the configured maximum depth. When a comment at the depth cap is created, the bot replies with a notice (distinguished and locked), locks the triggering comment, and files a report on it.

Depth is measured by walking `parentId` links upward until a post ID (`t3_`) is found. A comment directly on a post is depth 1.

**Redis keys:**
- `bot:dcmod:handled:{commentId}` — Dedup key, TTL 1 hour
- `bot:chainmod:depth-log` — Audit log, capped at 200 entries

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `depthCapModEnabled` | `true` | Enable/disable |
| `depthCap` | `10` | Maximum comment depth |
| `depthCapIgnoreModerators` | `true` | Exempt moderators |
| `depthCapIgnoreContributors` | `true` | Exempt approved submitters |
| `depthCapResponse` | `''` | Notice text (uses a generic fallback if blank) |

---

### Self-Response Moderator

**File:** `src/server/trigger-modules/self-response-moderator.ts`  
**Trigger:** `onCommentCreate`

Removes and locks top-level comments where the commenter is the original post author. Only fires on direct replies to the post (depth 1) — replies within threads are not affected.

**Redis keys:**
- `bot:srmod:handled:{commentId}` — Dedup key, TTL 1 hour
- `bot:srmod:log` — Audit log, capped at 200 entries

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `selfResponseModEnabled` | `true` | Enable/disable |
| `selfResponseIgnoreModerators` | `true` | Exempt moderators |
| `selfResponseIgnoreContributors` | `true` | Exempt approved submitters |
| `selfResponseResponse` | `''` | Notice text (leave blank for silent removal) |

---

### Length Moderator

**File:** `src/server/trigger-modules/length-moderator.ts`  
**Triggers:** `onPostSubmit`, `onPostFlairUpdate`

Enforces two post length rules:

1. **Max unhosted length** — Posts with a specific flair template ID are removed if the body (whitespace-excluded) exceeds the configured character limit.
2. **Min hosted length** — Posts containing a URL are removed if the body is shorter than the configured minimum (enforces a summary requirement for link posts).

The flair-update trigger uses a separate dedup key so a post that passes on submit can still be caught if a moderator applies the restricted flair later.

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `lengthModEnabled` | `true` | Enable/disable |
| `lengthModFlairId` | `''` | Flair template ID that triggers max-length enforcement |
| `lengthModMaxUnhostedLength` | `0` | Character cap for flaired posts (0 = disabled) |
| `lengthModMinHostedLength` | `0` | Min chars for link posts (0 = disabled) |
| `lengthModMaxUnhostedComment` | `''` | Removal notice for posts exceeding max length |
| `lengthModMinHostedComment` | `''` | Removal notice for link posts below min length |

---

### Report Moderator

**File:** `src/server/trigger-modules/report-moderator.ts`  
**Triggers:** `onCommentReport`, `onPostReport`

Silently ignores reports on content authored by known bot accounts (`AutoModerator`, `FloodAssistant`, `LLMPhysics-ModTeam`, `llmphysics-bot`). This keeps bot moderation notices out of the mod report queue.

No configurable settings.

---

## Action Modules (Menu Items)

### Adversarial Reviewer

**File:** `src/server/action-modules/adversarial-reviewer.ts`  
**Menu location:** Post  
**Requires:** `geminiApiKey` setting

Generates an AI physics peer review of a Reddit post using Google Gemini. The review is posted as a distinguished comment.

**Flow:**
1. Moderator (or user) opens the three-dot menu on a post and selects "Request Adversarial Review"
2. The bot checks: is the reviewer enabled? Is the post removed/spam? Does the post have the required flair (if configured)? Has this post already been reviewed (7-day dedup lock)?
3. A per-user daily quota is enforced for non-moderators (1 review per day)
4. If the post links to a PDF from a known domain (arxiv, zenodo, vixra, figshare, or any `.pdf` URL), the review is offloaded to a Supabase Edge Function for full-document extraction. Otherwise a text-only review runs immediately via Gemini
5. Post authors (OP) with unrecognized URLs are shown a form prompting for a direct PDF link
6. The review comment is distinguished

**PDF polling:** The scheduler endpoint `/internal/scheduler/pdf-review-poll` polls Supabase for completed jobs and posts results. Jobs older than 1 hour are abandoned.

**LLM Reviewer Settings menu:** Moderators can configure a required flair ID and release dedup locks on individual posts to allow re-reviewing.

**Gemini fallback:** If Gemini 3.5 Flash is unavailable (429/503), the bot falls back to Gemini 3.1 Flash Lite.

**Redis keys:**
- `bot:adversarial:lock:{postId}` — Dedup lock, TTL 7 days
- `bot:adversarial:active-locks` — Sorted set of active lock postIds
- `bot:adversarial:pdfjobs` — Sorted set of pending PDF jobs
- `bot:adversarial:user:{userId}:{YYYY-MM-DD}` — Per-user daily quota, TTL 25 hours
- `bot:adversarial:pending-form:{userId}` — OP PDF prompt session, TTL 5 min

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `adversarialReviewerEnabled` | `false` | Enable/disable (off by default) |
| `adversarialReviewerFlairId` | `''` | Required flair ID (blank = any flair) |

---

### Chain Mop

**File:** `src/server/action-modules/mop-tool.ts`  
**Menu location:** Comment

Recursively removes and/or locks an entire comment subtree starting from the selected comment. Actions are applied deepest-first (post-order traversal).

A confirmation form lets the moderator choose: Remove, Lock, and/or Skip distinguished comments. Both actions can be applied simultaneously.

After removal, a Reddit removal note is attached to the root comment recording the moderator's name and the count removed.

**Redis keys:**
- `bot:chainmod:session:{username}` — Session data, TTL 5 min
- `bot:chainmod:log` — Audit log, capped at 200 entries

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `mopToolEnabled` | `true` | Enable/disable |

---

### Saved Responses

**File:** `src/server/action-modules/response-tool.ts`  
**Menu location:** Post and Comment

A library of templated moderation messages that can be applied to posts or comments. Create responses once; they're available from any menu going forward.

**Apply flow:** Menu → select response → confirm/edit message + options → post.

**Options when applying:**
- Post as **Bot** or **Moderator (you)**
- **Distinguish** comment (bot-posted only)
- **Lock** the target post or comment

**Manage flow (subreddit menu):** Choose New, Edit, or Delete.

**Template macros** (expanded at send time):

| Macro | Expands to |
|-------|-----------|
| `{get_username}` | `u/AuthorName` of the target |
| `{get_post_flair}` | Flair text of the post |
| `{modmail}` | Markdown link to subreddit modmail |

Responses have a `location` property (`both` / `post` / `comment`) that controls where they appear in menus.

**Redis keys:**
- `bot:savedresponses` — All saved responses (JSON array)
- `bot:savedresponses:log` — Audit log, capped at 200 entries
- `bot:savedresponses:apply:{username}` — Apply session, TTL 5 min
- `bot:savedresponses:edit:{username}` — Edit session, TTL 5 min

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `responseToolEnabled` | `true` | Enable/disable |

---

### Flood Quota Checker

**File:** `src/server/action-modules/quota-viewer.ts`  
**Menu location:** Subreddit

Lets moderators look up any user's current post quota status. Shows each tracked post, whether it counts toward the quota, and when the user's next posting slot opens.

**Flow:** Subreddit menu → Flood Quota Checker → enter username → view results → search again.

Requires the Flood Moderator to be enabled.

---

### Bot Settings

**File:** `src/server/admin.ts`  
**Menu location:** Subreddit (multiple items)

Five settings menu groups, each a separate subreddit menu item:

| Menu item | Settings |
|-----------|---------|
| Bot Settings: Modules | Enable/disable each module |
| Bot Settings: Flood | Quota limits and exemption flags |
| Bot Settings: Commenting | Depth cap limits and self-response flags |
| Bot Settings: Posting | Length moderator limits |
| Bot Settings: Removal Messages | Bot signature and all removal comment templates |

Settings are stored in Redis as `settings:{key}` string values.

---

## Commands

Commands are triggered by mentioning `u/LLMPhysics-bot` in a post or comment, followed by `!commandName` or `!commandName [argument]`.

**Syntax:**
```
u/LLMPhysics-bot !commandName
u/LLMPhysics-bot !commandName [argument]
```

Multiple commands can appear in a single post or comment and are all dispatched in order. The bot mention is case-insensitive; command names are case-sensitive.

### !define [term]

**File:** `src/server/command-modules/define-command.ts`  
**Content type:** Comment only  
**Requires argument:** Yes (`!define [term]`)

Looks up a physics, math, or AI term on Wikipedia and replies with a summary. The lookup flow:

1. Gemini resolves the user's search term to a canonical Wikipedia article title, applying physics-specific disambiguation (e.g., returns "Observer effect (physics)" not "Observer effect") and correcting spelling errors
2. The Wikipedia API fetches the article intro
3. The bot replies with the article title, a link to Wikipedia, and up to ~600 characters of the intro

If Gemini 2.5 Flash Lite is rate-limited (HTTP 429), the command falls back to Gemini 3.1 Flash Lite.

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `defineCommandEnabled` | `true` | Enable/disable |
| `defineCommandCategory` | `'physics, mathematics, and AI'` | Subject category used for Gemini disambiguation |
| `defineCommandSearchGrounding` | `true` | Use Google Search grounding in Gemini resolution |
| `geminiApiKey` | — | Required |

---

## All Settings Reference

| Key | Module | Type | Default |
|-----|--------|------|---------|
| `botSignature` | Global | string | `'I am a bot...'` |
| `floodModEnabled` | Flood | boolean | `true` |
| `floodAssistantMaxPosts` | Flood | number | `1` |
| `floodAssistantWindowHours` | Flood | number | `24` |
| `floodAssistantIgnoreModerators` | Flood | boolean | `true` |
| `floodAssistantIgnoreContributors` | Flood | boolean | `true` |
| `floodAssistantIgnoreAutoRemoved` | Flood | boolean | `true` |
| `floodAssistantIgnoreRemoved` | Flood | boolean | `true` |
| `floodAssistantIgnoreDeleted` | Flood | boolean | `true` |
| `floodAssistantResponse` | Flood | string | `''` |
| `depthCapModEnabled` | Depth Cap | boolean | `true` |
| `depthCap` | Depth Cap | number | `10` |
| `depthCapIgnoreModerators` | Depth Cap | boolean | `true` |
| `depthCapIgnoreContributors` | Depth Cap | boolean | `true` |
| `depthCapResponse` | Depth Cap | string | `''` |
| `selfResponseModEnabled` | Self-Response | boolean | `true` |
| `selfResponseIgnoreModerators` | Self-Response | boolean | `true` |
| `selfResponseIgnoreContributors` | Self-Response | boolean | `true` |
| `selfResponseResponse` | Self-Response | string | `''` |
| `lengthModEnabled` | Length | boolean | `true` |
| `lengthModFlairId` | Length | string | `''` |
| `lengthModMaxUnhostedLength` | Length | number | `0` |
| `lengthModMinHostedLength` | Length | number | `0` |
| `lengthModMaxUnhostedComment` | Length | string | `''` |
| `lengthModMinHostedComment` | Length | string | `''` |
| `adversarialReviewerEnabled` | AI Reviewer | boolean | `false` |
| `adversarialReviewerFlairId` | AI Reviewer | string | `''` |
| `mopToolEnabled` | Chain Mop | boolean | `true` |
| `responseToolEnabled` | Saved Responses | boolean | `true` |
| `defineCommandEnabled` | !define | boolean | `true` |
| `geminiApiKey` | AI features | string | — |
| `supabaseUrl` | PDF review | string | — |
| `supabaseServiceRoleKey` | PDF review | string | — |

### Bot Signature

The `botSignature` setting (under Bot Settings: Removal Messages) appends a formatted signature to all bot-generated comments. Each word is wrapped in Reddit's `^word` superscript syntax, preceded by a horizontal rule.

Example: setting `"I am a bot"` produces:

```
---

^I ^am ^a ^bot
```

Leave blank to post removal messages with no signature.

---

## Developer Guide

### Adding a Trigger Module

1. Create `src/server/trigger-modules/my-module.ts`:

```typescript
import type { OnPostSubmitRequest } from '@devvit/web/shared';
import { logger } from '../helpers/log-helper';

const log = logger('my-module');

export async function run(event: OnPostSubmitRequest): Promise<void> {
  // your logic
}
```

2. Add two lines to `src/server/registry.ts`:

```typescript
// At the top, with other imports:
import { run as myModule } from './trigger-modules/my-module';

// In the appropriate trigger array:
const POST_SUBMIT: PostSubmitHandler[] = [...existing, myModule];
```

### Adding a Menu Action Module

1. Create `src/server/action-modules/my-action.ts`:

```typescript
import type { Hono } from 'hono';

export function register(app: Hono): void {
  app.post('/internal/menu/my-action', async (c) => {
    // handler
  });
}
```

2. In `src/server/registry.ts`, import it and call inside `registerAll()`:

```typescript
import { register as registerMyAction } from './action-modules/my-action';
// inside registerAll():
registerMyAction(app);
```

3. Declare the menu item in `devvit.json`.

### Adding a Command Module

1. Create `src/server/command-modules/my-command.ts`:

```typescript
import { registerCommand } from '../helpers/command-helper';

registerCommand(
  { commandName: 'mycommand', contentType: 'comment', requiresArgument: true },
  async (event, argument) => {
    // argument is the string inside [brackets], or null
  }
);
```

2. Add a side-effect import in `src/server/registry.ts`:

```typescript
import './command-modules/my-command';
```

### Logger

```typescript
import { logger } from './helpers/log-helper';
const log = logger('my-module'); // call once at module scope

log.info('event happened', { postId });
log.warn('something looks off');
log.error('API call failed', err, { postId });
```

Output goes to `console` and Redis sorted sets (`bot:log:info`, `bot:log:warn`, `bot:log:error`), capped at 500 entries per level.

### Build & Deploy Cycle

```bash
npm run build                    # compile TypeScript
devvit playtest r/llmphysics_dev # upload + stream logs
devvit upload                    # deploy to production
```

### Common Mistakes

- Forgetting `npm run build` before `devvit playtest` — the CLI uploads `dist/`, not source
- Navigating to the subreddit without `?playtest=llmphysics-bot` in the URL — you'll see the production version
- Registering a command handler inside an async function — `registerCommand` must run at module scope before any events fire
- Using uppercase in command names — command lookup is case-sensitive

---

Created by u/AllHailSeizure for r/LLMPhysics.
