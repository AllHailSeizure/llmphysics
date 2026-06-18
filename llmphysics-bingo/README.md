# llmphysics-bingo

A community bingo game for [r/LLMPhysics](https://reddit.com/r/LLMPhysics), built on the [Devvit](https://developers.reddit.com/docs) platform. Players each receive a unique 5×5 bingo card populated with subreddit-specific "events" — tiles that trigger when the community does the things they always do.

**Version:** 1.0.0  
**Platform:** @devvit/web 0.13.2  
**Subreddit:** r/LLMPhysics

---

## Overview

Each bingo game is tied to a Reddit post. When the game is created, each user who opens the post gets their own randomized 5×5 bingo card. Tiles are validated in batches by Google Gemini, which watches the post's comments, reports, and mod actions. Winners are announced automatically by a scheduled job.

The game state is entirely stored in Redis and is scoped to a game ID (the post ID). Events accumulate in a sorted set; a cron-driven batch validator processes them and marks tiles.

---

## Architecture

```
Reddit event (comment, report, mod action)
    │
    ▼
/internal/triggers/<event>
    │
    ▼
bingo.ts: capture*Event(event)
    │  appends to bot:bingo:game:{gameId}:events
    ▼
SCHEDULER (hourly, configurable)
    │
    ├──▶ validator.ts: runBatchValidation(geminiApiKey, gameId)
    │        reads all events + all pending tiles
    │        sends to Gemini gemini-3.1-flash-lite
    │        marks triggered tiles in Redis
    │
    └──▶ bingo.ts: announceWinners()
             checks all cards for win condition
             posts bingo/full-card announcement comments
```

**Tile validation** is not event-driven; all pending events are evaluated together each scheduler cycle. This is more efficient than per-event calls (35 tiles × N events in one Gemini request instead of N separate calls) and avoids hitting rate limits.

```
src/server/
├── index.ts         Routes: triggers, scheduler, menu items, API endpoint
├── bingo.ts         Game logic: card generation, win checking, winner announcement
├── tiles.ts         35 TileValidatorDefinition objects
├── validator.ts     Batch Gemini validation
└── settings.ts      readSetting / writeSetting helpers + defaults
```

---

## Setup & Installation

### Prerequisites

- Node.js 18+
- Devvit CLI: `npm install -g devvit`
- A Reddit account with moderator access to your subreddit
- A Google Gemini API key (from [Google AI Studio](https://aistudio.google.com/))

### Install dependencies

```bash
cd llmphysics-bingo
npm install
```

### Build

```bash
npm run build
```

Runs `vite build`.

### Playtest

```bash
npm run build
devvit playtest r/llmphysics_dev
```

### Deploy

```bash
npm run build
devvit upload
```

Then install on your subreddit via the Devvit Developer Portal.

---

## Game Lifecycle

1. A moderator opens the subreddit menu and selects **Create Bingo Post**
2. A Reddit Custom Post is created; the post ID becomes `gameId`, stored in `bot:bingo:current-game`
3. When a user opens the post, the app checks for their card. If none exists, it generates one and stores it in Redis
4. Community events (comments, reports, mod actions) are captured and appended to the event log
5. Each cron cycle, `runBatchValidation` processes all pending events and marks tiles
6. `announceWinners` checks all cards. First user to complete a row/column/diagonal gets a "Bingo!" comment. First user to complete the entire card gets a "Full Card!" comment
7. The game runs until it expires (8 days TTL)

---

## Card Generation

`generateCard(gameId, username)`:

1. Takes the pool of 35 tiles
2. Shuffles the pool
3. Selects the first 24 tiles
4. Inserts the FREE square at index 12 (center of the 5×5 grid)
5. Serializes the card to Redis: `bot:bingo:game:{gameId}:card:{username}`

Each user's card is randomized independently — no two cards are the same unless by coincidence.

---

## Tile Validation

**File:** `src/server/validator.ts`

### Event capture

Four handlers append to the event log:

| Handler | Trigger | Appended fields |
|---------|---------|-----------------|
| `captureCommentEvent` | `onCommentCreate` | type, author, body, postId, commentId |
| `capturePostEvent` | `onPostSubmit` | type, author, title, body, postId |
| `capturePostReportEvent` | `onPostReport` | type, postId, reportReason |
| `captureModActionEvent` | `onModAction` | type, action, moderator, targetId |

Events are stored in `bot:bingo:game:{gameId}:events` (sorted set, capped at 1000, score = timestamp).

### Batch validation

`runBatchValidation(geminiApiKey, gameId)`:

1. Fetches all events from Redis (up to 1000)
2. Reads which tiles are already triggered (skip those)
3. Fetches the first 50 comments on the game post for additional thread context
4. Constructs a prompt with:
   - All tile definitions (valueKey, displayName, description, examples, edge case guidelines)
   - All captured events
   - The sampled comment thread
5. Sends to `gemini-3.1-flash-lite` with `responseMimeType: 'application/json'`
6. Parses the response: `[{ "valueKey": "...", "triggeredBy": "username_or_null" }]`
7. For each triggered tile, writes `1` to `bot:bingo:game:{gameId}:value:{valueKey}`
8. Tracks self-trigger: if `triggeredBy` equals the game post author, stores in `bot:bingo:game:{gameId}:triggered-by:{valueKey}`. If a community member later triggers the same tile (non-null `triggeredBy` ≠ OP), the self-trigger restriction is removed

### Self-trigger rule

A tile that was triggered by the person whose card is being checked does **not** count toward their win. This prevents a user from winning by generating all the events themselves. The restriction is removed once someone else also triggers the tile.

---

## Win Checking

`checkWin(gameId, username)`:

Reads `bot:bingo:game:{gameId}:value:{valueKey}` for every tile on the user's card. Evaluates all 12 win lines:
- 5 rows
- 5 columns
- 2 diagonals

The FREE square always counts. Tiles marked `selfTriggered` for this user are excluded.

Returns the win type (`bingo`, `fullCard`) or `null`.

---

## Winner Announcement

`announceWinners(gameId)` (called every scheduler cycle):

1. Collects all known player usernames from `bot:bingo:game:{gameId}:players`
2. For each player, runs `checkWin`
3. Tracks which players have already been announced in `bot:bingo:game:{gameId}:announced-bingo` and `bot:bingo:game:{gameId}:announced-fullcard`
4. Posts a comment to the game post for each new winner (no duplicate announcements)

Winner message templates are configurable. The first player to win bingo gets `bingoFirstWinnerMessage`; subsequent bingo winners and full-card winners use separate message settings.

---

## Tile Definitions

**File:** `src/server/tiles.ts`

Each tile has:
- `valueKey` — Unique identifier used in all Redis keys
- `displayName` — Human-readable name
- `label` — Short label shown on the bingo card
- `gameDescription` — Rule description shown in the game UI
- `description` — Full description for Gemini's validation context
- `examples[]` — Concrete examples to guide validation
- `edgeCaseGuidelines` — Instructions for edge cases
- `relevantTypes` — Which event types can trigger this tile (`post`, `comment`, `modAction`)

### Full Tile List

**Post-triggered tiles (13)**

| valueKey | Description |
|----------|-------------|
| `tear-me-apart` | OP asks to be criticized ("tear this apart") |
| `coherence-drop` | Post is internally incoherent |
| `resonance-drop` | Post uses meaningless resonance language |
| `ontology-drop` | Post uses ontology/being/existence language inappropriately |
| `unrendered-latex` | Post contains unrendered LaTeX |
| `consciousness-drop` | Post invokes consciousness as a physics explanation |
| `framework-drop` | Post proposes a "new framework" |
| `cosmological-constant-drop` | Post mentions the cosmological constant problem |
| `hubble-tension-drop` | Post mentions the Hubble tension |
| `toroidal-drop` | Post proposes a toroidal universe |
| `fully-falsifiable-drop` | Post claims the theory is fully falsifiable |
| `emergent-drop` | Post claims something "emerges from" something else |
| `unfinished-work-disclaimer` | OP disclaims the post is unfinished |

**Comment-triggered tiles (18)**

| valueKey | Description |
|----------|-------------|
| `quarantine-discourse` | Comment advocates for removing posts like this |
| `explain-without-llm` | Comment challenges OP to explain without using an LLM |
| `thats-a-great-question` | Comment is an LLM-style sycophantic opener |
| `dunning-kruger-mention` | Comment invokes Dunning-Kruger |
| `not-even-wrong` | Comment says the post is "not even wrong" |
| `missing-the-joke` | Comment misses obvious satire/humor |
| `citation-needed` | Comment requests a citation |
| `physics-is-math` | Comment points out physics requires math |
| `op-cant-do-math` | Comment implies OP can't do the math |
| `llms-cant-do-math` | Comment points out LLMs can't do real math |
| `lean4-proof` | Comment or post involves Lean 4 proof |
| `two-person-war` | Two commenters argue extensively with each other |
| `em-dash-epidemic` | Suspicious em-dash usage suggesting LLM authorship |
| `commenter-did-you-read` | Comment implies OP didn't read a source |
| `op-did-you-read` | OP's comment implies commenter didn't read the post |

**Mod-action tile (1)**

| valueKey | Description |
|----------|-------------|
| `comment-purge` | 7+ comments removed from a single post in one mod session |

**Both post + comment**

`lean4-proof` and `em-dash-epidemic` can be triggered by either a post submission or a comment.

---

## Redis Key Reference

| Key | Type | Description |
|-----|------|-------------|
| `bot:bingo:current-game` | String | PostId of the active game |
| `bot:bingo:game:{gameId}:events` | Sorted set | All captured events (JSON), score = timestamp, capped 1000 |
| `bot:bingo:game:{gameId}:card:{username}` | String | JSON array of 25 tile valueKeys |
| `bot:bingo:game:{gameId}:players` | Set | All known player usernames |
| `bot:bingo:game:{gameId}:value:{valueKey}` | String | `"1"` if tile has been triggered |
| `bot:bingo:game:{gameId}:triggered-by:{valueKey}` | String | Username who self-triggered; `"community"` when cleared |
| `bot:bingo:game:{gameId}:announced-bingo` | Set | Usernames that have been announced as bingo winners |
| `bot:bingo:game:{gameId}:announced-fullcard` | Set | Usernames that have been announced as full-card winners |

All game keys use `GAME_TTL_SECS = 60 * 60 * 24 * 8` (8 days).

---

## Settings

| Key | Default | Description |
|-----|---------|-------------|
| `geminiApiKey` | — | Required. Gemini API key for batch validation |
| `bingoCronSchedule` | `'0 * * * *'` | Cron expression for scheduler runs (default: hourly) |
| `bingoFirstWinnerMessage` | `'🎉 First bingo!'` | Message posted for the first bingo winner |
| `bingoBingoMessage` | `'🎉 Bingo!'` | Message for subsequent bingo winners |
| `bingoFullCardMessage` | `'🏆 Full card!'` | Message for full-card winners |

Settings are configured via the **Bingo Settings** menu item (subreddit menu → moderators only).

### Test Event Injection

On dev subreddits, the Settings form includes a test panel that lets you inject synthetic events directly into the event log. This allows testing tile validation without needing real community activity.

---

## API Endpoint

`GET /api/bingo/state` — Returns the current bingo state for the authenticated user.

Currently gated to the `allhailseizure` account. Returns the user's card, which tiles are triggered, win status, and game metadata.

---

## Developer Guide

### Adding a tile

1. In `src/server/tiles.ts`, add a new `TileValidatorDefinition` object to the `TILES` array:

```typescript
{
  valueKey: 'my-new-tile',
  displayName: 'My New Tile',
  label: 'Short label',
  gameDescription: 'Shown on the card',
  description: 'Full description for Gemini — be specific about what counts and what does not',
  examples: [
    'Example comment that triggers this',
    'Another example',
  ],
  edgeCaseGuidelines: 'Describe borderline cases Gemini should handle',
  relevantTypes: ['comment'], // 'post', 'comment', 'modAction'
},
```

2. No other changes are needed. The card generator picks randomly from the full pool; the validator sends all tile definitions to Gemini automatically.

**Note:** The card pool is always 35 tiles. If you add more, the card generates from a 35+ pool; if you go below 24, card generation will fail. Aim to keep the pool at exactly 35.

### Modifying the Gemini prompt

The batch validation prompt is constructed in `runBatchValidation` in `src/server/validator.ts`. The prompt includes all tile definitions and all captured events. When adding new tile types, ensure the `description`, `examples`, and `edgeCaseGuidelines` fields are as specific as possible — Gemini's accuracy is entirely dependent on how well the tile is described.

### Scheduler

The scheduler endpoint `POST /internal/scheduler/bingo-batch-check` runs:
1. `runBatchValidation(geminiApiKey, gameId)`
2. `announceWinners(gameId)`

The schedule is configured as a cron expression via the `bingoCronSchedule` setting. Default is `'0 * * * *'` (every hour on the hour). Change this in settings if you need faster or slower validation.

### Build & Deploy Cycle

```bash
npm run build
devvit playtest r/llmphysics_dev
devvit upload
```

---

Created by u/AllHailSeizure for r/LLMPhysics.
