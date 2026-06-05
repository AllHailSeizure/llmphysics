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
- [ ] Brainstorm and write ~10 tile definitions (label, description, examples, edge cases) — in conversation first
- [ ] Populate `TILE_VALIDATORS` in `src/server/helpers/tile-validator-helper.ts`
- [ ] Add `MODULE` descriptor to `src/server/action-modules/bingo-game.ts`
- [ ] `npm run build` — confirm zero TypeScript errors
- [ ] Playtest: create bingo post → inject test events → confirm tiles mark → win detection fires
- [ ] Publish via `/module-promote`

**Testing plan:**
- Automated: inject test events via bingo settings form, check Redis tile marks via devvit logs
- Interactive: create a real bingo post, trigger a tile via a real comment, confirm it marks on card UI
