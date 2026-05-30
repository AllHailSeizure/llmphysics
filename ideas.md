# Ideas & Parked Concepts

_Append with `/project-tracker idea "<text>"` or edit directly. Stays on `develop` only._

## New Modules

- [2026-05-29] **audit-logger** — Supabase-backed `moderation_events` table. Append-only write on any bot action (removal, lock, comment). All modules write to it as a side-effect. Makes bot history queryable via MCP. Free tier has ~490 MB headroom. Build as a standalone module with a shared `logEvent()` helper.

## Improvements to Existing Modules

## Experiments

## Shared Post-Tracker Module

**Status:** parked — revisit if a third module needs heavy post-state access.

The bingo module currently piggybacks on the flood moderator's `flood:post:{postId}` Redis hash to stamp posts with a game ID. The idea: promote this into a dedicated post-tracker trigger module that owns the post hash lifecycle and exposes neutral shared infrastructure, so flood shrinks to pure quota logic.

**Why parked:** only two consumers makes it premature abstraction. The hash fields (`isModerator`, `isApprovedUser`, `is*Removed`, `isUserDeleted`) exist purely for flood's quota ignore-flags — it's not actually a neutral record. Current fix: symbols renamed to be post-centric (`trackPost`, `postKey`), and `tagPostWithGame()` sets its own TTL.
