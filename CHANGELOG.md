# Changelog

All notable changes to llmphysics-bot. Format: `module(<scope>): description`.

---

## [Unreleased]

- Engineering standards baseline: ESLint, Prettier, MODULE descriptor, structured logging standard, settings naming convention, Redis key convention, hierarchical CLAUDE.md files

## [2.13.0] — settings platform migration + depth-cap-moderator

- `config(settings-platform)`: Migrate all module settings from Redis-backed admin forms to Devvit platform settings. Settings now managed via the Reddit app installation page. Removes 5 mod menu items (Module Toggles, Flood Settings, Comment Settings, Post Settings, Bot Messages). Fix all pre-existing ESLint errors.
- `module(depth-cap-moderator)`: Locks comment chains exceeding the configured depth. Per-comment dedup guard; moderator and approved-submitter exemptions; custom response message; depth-1 regression guard. ✓ Verified

## [2.12.0] — flood-moderator rewrite + quota-viewer

- `module(flood-moderator)`: Full rewrite based on reference app logic. Per-user post quota with rolling window; dedup guard; comprehensive ignore flags (mod, contributor, auto-removed, mod-removed, deleted); stickied removal comment support. ✓ Verified
- `module(quota-viewer)`: Companion moderator action to check a user's current flood quota and post history.

---

## [2.11.0] — Previously published (Adversarial LLM Reviewer)

- `module(adversarial-reviewer)`: PDF paper review pipeline with LLM critique; mod-menu triggered; Supabase review_jobs table

## [2.9.1] — Previously published

- `fix(length-moderator)`: Module toggle bugfix; trigger on flair change

## [2.9.0] — Previously published

- Flood Moderator, Depth Cap, Self-Response, Length Moderator, Chain Mop, Saved Responses, Define Command — initial verified versions

---

_Versions prior to 2.9.0 not reconstructed. Future entries added by `/module-promote`._
