# llmphysics-bot Roadmap

> **Process contract:** Before starting any new module, write its ROADMAP entry first.
> Use `/module-new` — it will ask clarifying questions and produce the spec.
> If the goal can't be stated in one sentence, the scope isn't ready.
> Implementation doesn't start until the spec is signed off.

---

## Bingo — In Progress

**Goal:** A weekly community bingo game where tiles are marked by real subreddit activity, validated by Gemini, with automated winner announcements.

**Spec highlights:**
- Tiles marked globally (any user can trigger a tile for everyone's card)
- Self-trigger exclusion: if only the card owner triggered a tile, it doesn't count toward *their* win (but stays marked for others)
- Winner detection runs hourly via scheduler; announces first bingo, subsequent bingos, and full card separately
- Event queue: all subreddit events appended to Redis sorted set, batch-validated by Gemini each hour
- Mod controls: create bingo post, configure winner message templates, inject test events, run batch manually

**Milestones:**
- [x] Brainstorm and write ~10 tile definitions (label, description, examples, edge cases) — in conversation first
- [x] Populate `TILE_VALIDATORS` in `src/server/helpers/tile-validator-helper.ts`
- [x] Add `MODULE` descriptor to `src/server/action-modules/bingo-game.ts`
- [x] `npm run build` — confirm zero TypeScript errors
- [x] Playtest: create bingo post → inject test events → confirm tiles mark → win detection fires
- [x] Publish via `/module-promote`
- [x] Migrate settings to app
    - [ ] Scheduler settings 
- [x] Set up tile trigger tracking
    - [x] Against when triggered
    - [ ] Against specified backlogs
            - [ ] vs. Monte Carlo of cards possibly?
        - [ ] Determime ideal length of time for scheduler
- [ ] Tune tiles against real events in the sub
    - [ ] Deterministic evaluators for the 3 counting tiles (em-dash, echo-chamber, 7-removed) — code counts, no LLM
    - [ ] (parked → ideas.md) scope→prefilter→adjudicate pipeline for semantic tiles, only if one proves flaky
- [ ] Finish UI 
    -[x] Background
    -[x] Tiling
    -[x] Titling
    -[ ] Post launch image
    -[ ] Modal stlying
- [ ] Monitor live on LLMPhysics
- [ ] Publish