---
name: project-tracker
description: Use when logging a bug, marking a module as work-in-progress, closing a resolved issue, or capturing a new idea for llmphysics-bot. Routes to GitHub Issues or ideas.md depending on type.
---

# project-tracker

Two-track tracking for llmphysics-bot:
- **Bugs + WIP modules** → GitHub Issues on `AllHailSeizure/llmphysics-bot`
- **Ideas, experiments, brainstorming** → `llmphysics-bot/ideas.md` (develop branch, edit any time)

## Usage

`/project-tracker <subcommand>`

---

## bug — unexpected behavior in a verified module

```
/project-tracker bug <module-name> "<description>"
```

Creates a GitHub Issue via GitHub MCP with:
- Title: `[bug] <module-name>: <description>`
- Label: `bug`
- Body template:
  ```
  **Module:** <module-name>
  **Observed:** <what happened>
  **Expected:** <what should have happened>
  **Steps to reproduce:** (fill in)
  **Regression test to add to module-verify:** (fill in after fix)
  ```

## wip — module exists but is not production-ready

```
/project-tracker wip <module-name>
```

Creates a GitHub Issue with:
- Title: `[wip] <module-name> — not production-ready`
- Label: `module-wip`
- Body: brief status note about what's incomplete

## close — resolve a bug or wip issue

```
/project-tracker close <issue-number> "<resolution summary>"
```

Adds a resolution comment to the issue and closes it via GitHub MCP.

## idea — new module, improvement, or experiment

```
/project-tracker idea "<text>"
```

Appends to `llmphysics-bot/ideas.md` under the matching section:
- "New Modules" — net-new functionality
- "Improvements to Existing Modules" — enhancements to verified modules
- "Experiments" — uncertain / research-stage ideas

Ask which section if unclear. Append with today's date prefix: `- [2026-05-28] <text>`

## list ideas

```
/project-tracker list ideas
```

Read and print `llmphysics-bot/ideas.md`.

---

## GitHub labels (pre-created)

| Label | Color | Use for |
|---|---|---|
| `bug` | red | Unexpected behavior in verified module |
| `module-wip` | yellow | Unverified or incomplete module |
| `enhancement` | teal | Improvement to existing verified module |

## GitHub MCP tools

- Create issue: `mcp__github__create_issue` (owner: `AllHailSeizure`, repo: `llmphysics-bot`)
- Update/close: `mcp__github__update_issue`
- Comment: `mcp__github__add_issue_comment`
