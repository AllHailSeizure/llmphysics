# Devvit upload intermittently fails: "You must be logged in to upload a new app version" (auth is valid)

**Account:** u/AllHailSeizure
**Apps:** llmphysics-bingo (also reproduces context on llmphysics-bot)
**CLI:** @devvit/cli 0.13.3 (also tested `@devvit/cli@latest`) · node v24.14.1 · Windows 10 (win32-x64)

## Symptom
`devvit playtest` (and `devvit upload`) uploads the WebView assets successfully, then hangs ~1–2 min on **"Finishing upload…"** and fails with:

> Something went wrong... You must be logged in to upload a new app version.

It is **intermittent**: a successful deploy went through ~3 hours before a failing streak, and this has been on-and-off for about a week. During a failing streak it fails on every attempt for hours.

## Key diagnostic
- `devvit list apps` (a portal **read**) **succeeds** and shows my apps with correct install counts.
- Only the **create-app-version** step (the upload finalize) is rejected. Reads work, the write does not.

## Ruled out (everything client-side)
- **Auth state:** deleted the entire `~/.devvit` folder and did a fresh `login --copy-paste`; `whoami` returns `u/AllHailSeizure` afterward. Still fails.
- **`DEVVIT_AUTH_TOKEN` override:** not set at Process/User/Machine scope; not in any project `.env`.
- **Network:** `www.reddit.com` and `developers.reddit.com` both return HTTP 200 from this machine.
- **CLI version:** `npx -y @devvit/cli@latest playtest` fails identically to pinned 0.13.3.
- **Stale processes:** killed all lingering devvit Node workers and freed port 5678; still fails.

Earlier in the same streak the CLI also surfaced transient `read ECONNRESET` (on a `.map` asset) and `"CheckIfMediaExists" failed after 3 attempts. First error: fetch failed.`

## Questions
1. Is there a **server-side rate limit / throttle on app-version creation** that a burst of `playtest` uploads can trip? If so, what's the window?
2. Does "You must be logged in to upload a new app version" map to anything **other than auth** server-side (e.g. a failed/throttled backend call surfaced as an auth error)?
3. Any known incident affecting the app-version-create endpoint over the past week?

Happy to provide request IDs / timestamps / verbose logs.
