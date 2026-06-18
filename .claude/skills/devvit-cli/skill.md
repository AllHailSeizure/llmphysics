---
name: devvit-cli
description: Use when running Devvit CLI operations for llmphysics-bot: upload, publish, or playtest. Embeds the correct flags, build order, and error-recovery patterns.
---

# devvit-cli

Devvit CLI operations for llmphysics-bot. Always build before uploading. Prefer `--version` to target an exact version number; use `--bump` when you don't need a specific version.


**Working directory**: Depending on project; always use  `Set-Location D:\Libraries\Reddit\llmphysics\llmphysics-bot` (for llmphysics-bot) OR `Set-Location D:\Libraries\Reddit\llmphysics\llmphysics-bingo` (for llmphysics-bingo) before any devvit command. Use the absolute path — never rely on a relative `cd`.

## Usage

`/devvit-cli <command>`  
Commands: `upload` · `publish` · `playtest`

---

## Authentication — read this before debugging auth errors

How the CLI actually resolves credentials (verified against @devvit/cli 0.13.3 source, June 2026):

1. **`DEVVIT_AUTH_TOKEN` env var wins over everything.** The CLI checks `process.env.DEVVIT_AUTH_TOKEN` BEFORE reading the token file. It also loads the project `.env` via dotenv. A stale value in either place silently hijacks auth — `devvit login` will report success (it writes the file) but every command keeps using the stale env token.
2. Only if no env var: reads `C:\Users\nateb\.devvit\token`.
3. **`You must be logged in` has TWO causes that print the same message — diagnose, don't assume.** Run `npx devvit whoami` and `npx devvit list apps` (small authenticated reads). If they FAIL → real auth problem, nuke (below). If they WORK but the upload still dies on `Finishing upload...`/`Uploading WebView assets...` with `ECONNRESET` or `CheckIfMediaExists ... fetch failed` → it's the **NETWORK**, not auth — nuking will NOT help; switch to the mobile hotspot. `bingo` (web-view assets, many MB) fails on weak connections far more than `bot`. (Both failure modes hit in June 2026; the network one masquerading as auth cost a week.)
4. **`whoami` passing does NOT prove uploads work** — it only proves credentials exist; the heavy asset upload can still fail on the connection.
5. **Only nuke auth when `whoami`/`list apps` GENUINELY FAIL.** For a real auth failure, `devvit logout` + `devvit login` is not a full reset — delete the entire `~/.devvit` folder, then log in fresh (script below). Do NOT run this for the network case in #3: confirmed June 2026 — ~10 upload failures cleared the instant the machine switched to a mobile hotspot, with auth untouched. Nuking the network case wastes effort (and once, a week).

**The fix script:** `D:\Libraries\Reddit\llmphysics\scripts\nuke-devvit-auth.ps1`
- Local session: `.\nuke-devvit-auth.ps1` (opens browser OAuth — user completes it)
- Remote session: `.\nuke-devvit-auth.ps1 -CopyPaste` — the CLI prints an auth URL and waits for a code. Claude relays the URL to the user, the user opens it in any browser, authorizes, and gives the code back to paste into the prompt. This works without a browser on the machine running the CLI.


---

## playtest

```powershell
Set-Location D:\Libraries\Reddit\llmphysics\llmphysics-bot
npm run build
npx devvit playtest r/llmphysics_dev --show-timestamps
```

- The bundle is ~23MB. The `AppVersion/Create` upload takes 20–90 seconds. Use a **250+ second timeout** for the full startup sequence.
- The CLI always tries to bind a WebSocket server on port 5678. If another playtest session holds that port you get an EADDRINUSE warning — that warning is benign and does NOT block the upload. The usual cause of `fetch failed` / `You must be logged in` at the upload step is a weak connection, not the port (see Authentication §). Still, kill stale sessions (`netstat -ano | findstr :5678`, then `taskkill /F /PID <pid>`): the non-TTY exit leaves the Node worker alive, so they accumulate.
- The non-TTY exit path does NOT kill the process — the event loop stays alive via file watchers and the log subscription WebSocket. Playtest runs correctly from Claude Code.
- On success: "✓ Playtest ready" appears in stdout with the subreddit URL.

---

## upload (private pre-publish smoke test)

```powershell
Set-Location D:\Libraries\Reddit\llmphysics\llmphysics-bot
npm run build
npx devvit upload --bump <minor|patch|major>
```

- Uploaded version is only visible to you; only installable on r/llmphysics_dev (<200 members)
- Run `/module-verify` against the uploaded version before publishing
- Note the exact `--bump` value used — publish must use the same one

## publish (goes live)

```powershell
Set-Location D:\Libraries\Reddit\llmphysics\llmphysics-bot

# Exact version (preferred — no arithmetic needed):
npx devvit publish --version 2.15.2

# Relative bump (when exact version doesn't matter):
npx devvit publish --bump <minor|patch|major>
```

- `--version` sets the Devvit app version directly — no need to align package.json or worry about double-bumps
- If using `--bump`: must use the same flag as the upload step
- **Double-bump warning (--bump only):** `npx devvit upload --bump minor` bumps once (e.g. 2.12.0 → 2.13.0), then `npx devvit publish --bump minor` bumps again (2.13.0 → 2.14.0). Two bumps per release cycle.
- The version shown in `npx devvit publish` output is authoritative — use that for tagging and docs
- After publish: `git tag v<version>` → merge `publish → master` → `git push origin master --tags`

---

## Version bump reference

| Change | Flag |
|---|---|
| New module | `--bump minor` |
| Bug fix | `--bump patch` |
| Breaking architecture change | `--bump major` |

---

## Common error patterns

| Symptom | Recovery |
|---|---|
| `AppVersion already exists` | Do NOT bump version. A prior session left a lingering state. Wait a few minutes and retry; or check `npx devvit list apps` |
| Build fails before playtest | Fix TypeScript errors — never playtest a broken build |
| `spawn npx ENOENT` (devvit-mcp) | Fall back to PowerShell: `npx devvit logs r/llmphysics_dev llmphysics-bot --since 5m --show-timestamps` |
| Playtest uploads but logs silent | Check `npx devvit logs` separately; the bundled log stream can fall behind |
| Module not responding | Confirm build was run after latest code change; confirm `registry.ts` wires the module |
| `You must be logged in` (incl. `...to upload a new app version`) | **Suspect the NETWORK first** (confirmed root cause, June 2026). If `whoami` + `list apps` work but the upload dies at `Finishing upload...` (often near `ECONNRESET` / `fetch failed`), it's the connection, not auth — switch to a fast/stable network (mobile hotspot) and retry, do NOT touch auth. ONLY if `whoami`/`list apps` actually fail is it auth → `scripts\nuke-devvit-auth.ps1` (`-CopyPaste` remote) + check `DEVVIT_AUTH_TOKEN` in env/`.env`. See Authentication §. |
| `No project devvit.yaml config file found` | Wrong working directory. Ensure you ran `Set-Location D:\Libraries\Reddit\llmphysics\llmphysics-bot` with the absolute path before the devvit command. |
