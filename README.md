# llmphysics-bot — Moderator Guide

A quick reference for moderators on what the bot does and how to use it.

---

## Automatic behaviours

These run on their own — you don't need to do anything.

### Self-response moderator

When the OP replies to their own post at the top level, the bot **removes and locks** that comment automatically. This keeps discussions from being dominated by the original poster's follow-ups.

### Depth cap

Comment chains are automatically locked once they reach the configured depth limit (default: 10, set in **Bot Settings**). Only the deepest comment gets locked — not the whole chain. The bot leaves a notice on the locked comment.

### Report filter

The bot's own comments get auto-ignored when reported. This stops mod queues from filling up with reports on bot messages.

### Flood assistant

If a user submits more posts in a 24-hour window than the configured limit (default: 1), the bot removes the extra posts automatically.

---

## Mod menu tools

These appear in the three-dot overflow menu on comments, posts, and the subreddit header.

### Chain Mop *(comment menu)*

Removes and/or locks a comment and all its replies. Opens a form where you choose whether to remove, lock, or both. Useful for cleaning up off-topic threads quickly.

### Apply saved response *(comment or post menu)*

Posts a pre-written response on the selected comment or post. You pick from your saved response library in the form that pops up. Good for recurring rule violations where you want consistent wording.

### Saved responses *(subreddit header menu)*

Manage your saved response library — add new responses, edit existing ones, or delete old ones.

### Bot Settings *(subreddit header menu)*

Configure the bot's behaviour for this subreddit:

| Setting | What it does | Default |
|---------|-------------|---------|
| **Bot signature** | Text appended to all bot comments | Standard "I am a bot" line |
| **Maximum comment chain depth** | Locks chains at this depth; 0 = disabled | 10 |
| **Depth cap notice** | Message posted when a chain hits the cap | Standard notice |

---

## !define command

Any user can trigger a definition by mentioning the bot in a comment:

```
u/LLMPhysics-bot !define [term]
```

The bot replies with a definition sourced from Wikipedia, resolved and summarised via Gemini. If Gemini can disambiguate the term (e.g. resolves "observer effect" to "Observer effect (physics)"), the reply title reflects that.

---

## Appeal system

When you use **Apply Saved Response** and trigger the appeal flow, the bot:

1. Locks the post
2. Sends a modmail to the post author: **"Your post has been locked"**
3. The modmail explains they can reply `!remove` to remove their post

When the author replies `!remove`:
- The bot removes their post
- Replies "Thanks!" to the modmail
- Archives the modmail conversation

The appeal window is **30 days**. Only the original post author can use the `!remove` reply.

---

## Settings location

**r/llmphysics → Mod Tools → llmphysics-bot** — or use the **Bot Settings** item in the subreddit overflow menu.
