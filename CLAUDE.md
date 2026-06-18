# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace layout

Three apps live at the root:

- `llmphysics-bot/` — Devvit moderation bot (no "post" permission; fast deployments)
- `llmphysics-bingo/` — Devvit bingo game (requires "post" permission; deployed separately)
- `supabase/` — Supabase CLI project (project: eimdgqymjwfljtapnuyl; bot_logs + review_jobs schema)

Workspace tooling:
- `scripts/` — PowerShell/bash helpers for playtest, publish, port management
- `.claude/CLAUDE.md` — Claude Code behavior preferences for this workspace

The detailed app guides live in each app's `CLAUDE.md`. Read the relevant one before touching source files.

## Commands

From `llmphysics-bot/`:
```bash
npm run build                        # compile TypeScript → dist/server/index.cjs
devvit playtest r/llmphysics_dev     # upload bundle and stream logs
devvit publish                       # submit to Devvit platform
```

From `llmphysics-bingo/`:
```bash
npm run build
devvit playtest r/llmphysics_dev
devvit publish
```

## Devvit upload/playtest failures — READ BEFORE RETRYING

`"You must be logged in to upload a new app version"` has **two unrelated causes** that print the **same** message. Do not assume auth. **Diagnose first:**

```powershell
Set-Location D:\Libraries\Reddit\llmphysics\llmphysics-bot   # or -bingo
npx devvit whoami        # small authenticated read
npx devvit list apps     # small authenticated read
```

- **If those FAIL → it's auth.** Fix: run `scripts\nuke-devvit-auth.ps1` (add `-CopyPaste` in remote/headless sessions). `devvit logout` + re-login is NOT enough; the script deletes the whole `~/.devvit` folder. Also confirm no `DEVVIT_AUTH_TOKEN` is set in env or any `.env` — it silently overrides the token file.
- **If those WORK but the upload still dies on `Finishing upload...` / `Uploading WebView assets...` with `ECONNRESET`, `read ECONNRESET`, or `CheckIfMediaExists failed ... fetch failed` → it's the NETWORK, not auth.** Nuking auth will not help. Switch to the mobile hotspot (known-good upload path; the home network drops large uploads). `bingo` ships web-view assets (many MB) and fails on a weak connection far more than `bot`.

The one-line rule: **if the small read commands work, stop touching auth — it's the connection.**

### Do NOT pile up background node processes

- Run **one** playtest/upload attempt at a time. Never spawn a new attempt while another is still spinning.
- The CLI binds a WebSocket on port 5678 and leaves watchers alive; stacked attempts cause EADDRINUSE and make errors worse, not better.
- Before retrying, kill stragglers with `scripts\kill-devvit.ps1` (surgically kills only devvit node processes + frees port 5678 — does NOT touch VS Code/esbuild/vitest node).
- A failed upload is NOT a reason to immediately retry. Diagnose with the read commands above first. Retry spirals (this happened: 8 attempts in one session) just stack zombie processes and obscure the real error.

## Git branches

| Branch | Location | Purpose |
|---|---|---|
| `develop` | Local only | Sandbox — never pushed |
| `publish` | Local + remote | Finished, verified modules only — one at a time |
| `master` | Local + remote | Integration point; merged from publish |
| `origin/master` | Remote | Deployed state |

Work on `develop`. Cherry-pick verified modules to `publish`. Merge `publish` → `master` → `origin/master` to deploy.

## Git tag convention

- `bot/v2.x.x` — llmphysics-bot releases
- `bingo/v1.x.x` — llmphysics-bingo releases
