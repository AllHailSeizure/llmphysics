# Test Pipeline

Manual end-to-end verification for all bot modules. Run with `devvit playtest` active.

## Pre-conditions

1. `devvit playtest` running — **Devvit: Playtest** build task
2. `depthCap` app setting = **5** (r/llmphysics_dev → mod tools → llmphysics-bot)
3. `floodassistant:maxPosts` = **1** (default)
4. Token fresh — if you get 401s, run **Devvit: Playtest** briefly to refresh `~/.devvit/token`

## Test accounts

| Account | Role |
|---------|------|
| `AllHailSeizure` | Test account — submits all posts/comments as OP |
| `llmphysics-bot` | The bot |

---

## Pipeline structure

```
POST 1  (AllHailSeizure = OP)
└── c1: "u/LLMPhysics-bot !define [observer effect]"   ← top-level OP comment
    ├─ SRM fires     → removes + locks c1
    └─ define fires  → bot posts c_bot (distinguished reply to c1)
        ├── [report c_bot → report-filter ignores it]
        ├── c3:  "Depth chain comment 1"
        │    └── c4 → c5   (depth 5 from root → depth-cap fires, locks c5 only)
        ├── [use Chain Mop menu item on c3 → removes c3 subtree]
        ├── [use Apply Saved Response menu item on c_bot]
        └── [use Start Appeal menu item on POST 1
             → locks post, modmails AllHailSeizure
             → AllHailSeizure replies `!remove` → post removed, conversation archived]

POST 2  (AllHailSeizure, same 24h window)
    flood-assistant fires → removes POST 2
```

---

## Module checklist

| Action | Module | Watch for in `devvit logs` | Also verify |
|--------|--------|---------------------------|-------------|
| Submit c1 | `self-response-moderator` | `OP top-level comment — removing and locking` | c1 removed + locked |
| Submit c1 | `command` → `define` | `Definition reply posted` | c_bot body contains "observer effect (physics)" |
| Report c_bot | `report-filter` | `Ignored bot comment report` | — |
| Submit c5 (depth 5) | `depth-cap-moderator` | `Depth cap reached` | c5 locked; c3/c4 NOT locked |
| Chain Mop on c3 | `chain-moderator` | `Chain mop triggered` | c3 + subtree removed |
| Apply Saved Response on c_bot | `saved-responses` | `Saved response applied` | bot reply on c_bot |
| Reply `!remove` to modmail | `appeal-moderator` | `Appeal: post removed` | post removed; modmail archived |
| Submit POST 2 | `flood-assistant` | `Flood post removed` | post removed |

---

## Gotchas (hard-won)

**depthCap default is 10, not 5.** Must be set to 5 in mod tools before testing or depth-cap never fires during the test chain.

**Depth-cap locks the deepest comment only.** c5 gets locked. c3 and c4 do not. If the whole chain is locked, something is wrong.

**c_bot is a reply to c1, not a top-level comment.** When searching the thread for the bot's define reply, scope the search to c1's replies — c1's own body contains "observer effect" and matches first if you search the full thread.

**Submit comments with pauses between them.** Posting too fast (< 2s apart) can cause Reddit to silently drop a comment — the API returns 200 but with no data instead of an error.

**AllHailSeizure is a mod, so sees removed comment bodies.** A non-mod account sees `[removed]` for c1. Matters if you ever test with a non-mod account.

**Report-filter only ignores reports on bot-authored comments.** `BOT_AUTHORS` in `report-filter.ts` must contain the bot's exact Reddit username.

**Token expires between sessions.** HTTP 401 at step 1 means a stale token. Run **Devvit: Playtest** briefly to refresh `~/.devvit/token`.

**`devvit logs` needs ~3 seconds to warm up.** After starting the process, wait before submitting content or early events won't be captured.
