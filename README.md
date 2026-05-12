# llmphysics-bot  2.7.0 — Moderator Guide

A modular moderation-assistance bot for [r/LLMPhysics](https://reddit.com/r/LLMPhysics), built on the [Devvit](https://developers.reddit.com/docs) platform.

---

## 1. Moderator Onboarding: How the Bot Works

This bot is designed to keep r/LLMPhysics clean and focused. It handles repetitive janitorial work automatically while providing powerful tools for manual intervention.

### Automatic Cleanup
You don't need to lift a finger for these. The bot performs the following tasks in the background:
*   **Self-Response Moderator:** Prevents the original poster from cluttering the top-level comment section by locking and removing their own follow-up comments.
*   **Depth Cap:** Keeps conversations readable. Once a thread exceeds the configured depth limit, the bot automatically locks the deepest branch.
*   **Flood Assistant:** Protects the sub from spam by limiting the number of posts a user can submit within a 24-hour window.
*   **Report Filter:** Keeps your mod queue clean by automatically ignoring reports on the bot's own activity (in active testing, may not be 100% reliable).

### Manual Moderation Tools
Available via the **Mod Shield** icon on posts and comments:

*   **Chain Mop:**
    *   **What it does:** Recursively removes and/or locks an entire conversation thread.
    *   **Pro-tip:** You can choose to **ignore distinguished comments** during the mop, ensuring you don't accidentally remove your own or your fellow moderators' notes.

*   **Saved Responses:**
    *   **What it does:** Standardizes your community outreach.
    *   **Flexible Deployment:** When applying a response, you can choose to post **as yourself** or **as the bot**.
    *   **Distinguish:** You have full control to toggle the distinguish status on your response.
    *   **Efficiency:** You can select to **lock the target comment** simultaneously when posting your response, saving you an extra step during rule enforcement.

---

## 2. Bot Settings Reference

Moderators can manage bot behavior in the **Bot Settings** menu (found under the Subreddit header overflow menu).

### Global Settings
*   **Bot Signature:** Appended to all bot comments in superscript with a horizontal rule for professional identification. Leave blank to disable.

### Chain Moderation
*   **Maximum Comment Chain Depth:** Limits how deep a conversation can go. (Default: 10; 0 to disable).
*   **Depth Cap Notice:** The custom message the bot posts when it locks a chain at the depth limit.

### Flood Assistant
*   **Flood Assistant Triggered Comment:** The message the bot posts when it removes a submission due to flood limits.

### Self-Response Moderator
*   **Self-Response Triggered Comment:** The message the bot posts when it locks and removes an OP's top-level self-reply.

---

## 3. Interaction Commands

Any user can trigger a definition by mentioning the bot in a comment:

```
u/LLMPhysics-bot !define [term]
```

The bot replies with a definition - it uses Gemini search grounding to find the most relevant Wikipedia article, and quotes directly from the page.

##4. Future Features

LLMPhysics-bot is in active development by u/AllHailSeizure. Any feedback is welcome. Current features being worked on include:
    -Active/Reactive appeal
    -LLMPhysics Bingo game
    -LLM response detection










