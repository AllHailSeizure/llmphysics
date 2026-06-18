# r/LLMPhysics Bot — Moderator Onboarding Guide

Welcome to the moderation team! This guide explains everything the bot can do and how to use it. No technical knowledge required.

---

## What is the bot?

`u/LLMPhysics-bot` is a helper that runs automatically in the background and also gives you tools in the Reddit menu. It handles routine moderation tasks so you don't have to.

There are two ways to interact with it:
1. **Automatic rules** — the bot watches posts and comments and takes action on its own
2. **Menu tools** — tools you trigger yourself from the three-dot (⋯) menu on posts, comments, or the subreddit

---

## Automatic Rules

### Posting Quota (Flood Moderator)

The bot limits how often a user can post. By default, a user can post once every 24 hours. If someone posts more than that, their extra post is automatically removed.

**What you'll see:** Removed posts with a bot comment explaining why.

**Exemptions:** By default, moderators and approved submitters are not subject to the quota. Bot-removed posts, mod-removed posts, and deleted posts don't count against the quota either — so there's no penalty for submitting something that gets removed.

**You don't need to do anything** for this to work. But if you want to look up a specific user's quota status, see "Flood Quota Checker" below.

---

### Comment Depth Cap (Depth Cap Moderator)

When a comment thread gets too deep (more than 10 replies deep by default), the bot locks it and replies with a notice explaining that the thread has reached its limit.

**What you'll see:** A distinguished bot comment at the bottom of deep threads, with the deepest comment locked.

**Why it exists:** Very long reply chains are hard to follow and often go off-topic. This keeps discussions manageable.

---

### OP Self-Replies (Self-Response Moderator)

If the original poster (OP) replies directly to their own post at the top level, the bot removes and locks that reply.

**Why it exists:** On r/LLMPhysics, posts are meant to be critiqued by others. OP jumping in to defend their post as a top-level comment tends to derail the discussion before it starts.

**Top-level only:** The bot only catches direct replies to the post. If OP replies within a thread (replying to someone else's comment), that's fine.

---

### Post Length Limits (Length Moderator)

The bot can enforce minimum and maximum post lengths. This is currently configured for two rules:

1. Posts with a specific flair that are too long get removed
2. Link posts (posts with a URL) that don't have enough explanation text get removed

**What you'll see:** Removed posts with a bot comment explaining the length issue.

---

### Ignoring Bot Reports (Report Moderator)

The bot silently dismisses reports on content posted by known bot accounts (`AutoModerator`, `FloodAssistant`, etc.). This keeps the mod report queue clean — you won't see bot moderation notices flagged as reports.

---

## Menu Tools

These tools are available from the three-dot (⋯) menu. You'll see them on posts, comments, or the subreddit menu depending on which tool it is.

---

### Chain Mop

**Where:** Three-dot menu on any comment

Removes and/or locks an entire comment chain starting from the comment you picked. It goes all the way down — every reply, and every reply to those replies.

**How to use:**
1. Find the top comment of the thread you want to clean up
2. Click the three-dot menu on that comment
3. Click "Chain Mop"
4. A form will appear — check the boxes for what you want to do:
   - **Remove comments** — removes them (users can see they were removed)
   - **Lock comments** — prevents any further replies
   - **Skip distinguished** — leaves moderator-distinguished comments alone
5. Click confirm

**After:** A note is added to the top comment recording your name and how many comments were removed.

**Use it when:** A thread has gone completely off the rails and you want to clean it all up at once instead of removing comments one by one.

---

### Saved Responses

**Where:** Three-dot menu on posts and comments (for applying a response); subreddit menu (for managing your library)

A library of pre-written moderation messages. Instead of retyping the same explanation every time you remove something, you save it once and apply it with a few clicks.

**Applying a saved response:**
1. Open the three-dot menu on the post or comment
2. Click "Apply Saved Response"
3. Select the response you want from the list
4. Edit the message if needed for this specific situation
5. Choose options:
   - **Post as:** "Bot" (the message comes from `u/LLMPhysics-bot`) or "Moderator" (the message comes from you)
   - **Distinguish:** Makes the comment appear as a mod comment (only available when posting as Bot)
   - **Lock target:** Locks the post or comment you're responding to
6. Click confirm

**Managing your library (add, edit, delete):**
1. Open the subreddit menu (top of the subreddit page)
2. Click "Saved Responses"
3. Choose New, Edit, or Delete

**Template shortcuts** you can use in your saved responses:

| Type this | What it becomes |
|-----------|----------------|
| `{get_username}` | The username of the post/comment author |
| `{get_post_flair}` | The post's flair text |
| `{modmail}` | A link to the subreddit modmail |

**Example saved response using shortcuts:**
> "Hi {get_username}, your post has been removed because it doesn't meet the requirements for the {get_post_flair} flair. Please feel free to reach out via {modmail} if you have questions."

---

### Flood Quota Checker

**Where:** Subreddit menu

Lets you look up any user's current posting quota status.

**How to use:**
1. Open the subreddit menu
2. Click "Flood Quota Checker"
3. Type in a username
4. The bot will show you:
   - Their recent posts and whether each one counts toward the quota
   - How many quota-eligible posts they have in the window
   - When their quota resets and they can post again

**Use it when:** A user asks why their post was removed, or you want to check if someone is close to their limit before approving their post.

---

### Adversarial Reviewer (AI Paper Review)

**Where:** Three-dot menu on posts

Generates an AI physics review of the post using Google Gemini. The review is written from the perspective of a skeptical physicist and is posted as a distinguished comment.

**How to use:**
1. Open the three-dot menu on a post
2. Click "Request Adversarial Review"
3. The bot processes the request (this may take a moment, especially for PDF posts)
4. The review is posted as a distinguished comment

**For PDF papers:** If the post links to a paper on arxiv, zenodo, or similar sites, the bot can read the actual PDF and review the full document. This takes longer (the bot sends the job to an external service and polls for results — usually a few minutes).

**Limits:**
- Each post can only be reviewed once (7-day lockout)
- Non-moderators can only request one review per day
- If a required flair is configured, only posts with that flair can be reviewed

**Note:** The Adversarial Reviewer is disabled by default and needs to be enabled in settings.

---

### Bot Settings

**Where:** Subreddit menu (five separate menu items)

Settings for every part of the bot. You probably won't need to change these often, but they're here if something needs adjusting.

| Menu item | What it controls |
|-----------|----------------|
| **Bot Settings: Modules** | Turn individual features on or off |
| **Bot Settings: Flood** | How many posts are allowed, over what time window, and which users are exempt |
| **Bot Settings: Commenting** | Comment depth limit and self-reply enforcement |
| **Bot Settings: Posting** | Post length limits |
| **Bot Settings: Removal Messages** | The text in bot comments (removal reasons, notices, etc.) and the bot's signature |

**Tip on removal messages:** If a removal message field is left blank, the bot removes silently without posting a comment. If you want the bot to explain why something was removed, add the text in the relevant field.

---

## User Commands

Users can trigger certain bot features by mentioning `u/LLMPhysics-bot` in a post or comment and adding a command.

**How it works:**
```
u/LLMPhysics-bot !commandName [argument]
```

The bot will respond in the same thread.

---

### !define [term]

**Who can use it:** Anyone (in comments only)

**What it does:** Looks up a physics, math, or AI term on Wikipedia and replies with a summary.

**Example:**
> `u/LLMPhysics-bot !define [Bekenstein-Hawking entropy]`

The bot will reply with the Wikipedia article title, a link, and a ~600-character summary.

**Useful for:** Settling quick terminology questions in a thread, or giving context to readers who aren't familiar with a term.

---

## Common Questions

**Q: A post was removed but I don't know why.**
Check the mod log — the bot always logs its actions. You can also check if there's a bot comment on the removed post explaining the reason.

**Q: The bot removed something it shouldn't have.**
You can approve the post or comment manually. The bot won't re-remove something that a moderator has approved.

**Q: A user is complaining their post was removed unfairly.**
Use the Flood Quota Checker to see if the quota removal was justified. If you want to make an exception, approve the post — this also flags the user as "approved" for future quota evaluation.

**Q: I want to change the removal message text.**
Go to subreddit menu → Bot Settings: Removal Messages → update the relevant field and save.

**Q: How do I turn off a feature?**
Go to subreddit menu → Bot Settings: Modules → toggle off the module you want to disable.

**Q: The bot responded to a `!define` command with the wrong Wikipedia article.**
The bot uses AI to resolve terms, so occasionally it misidentifies the intended article. You can delete the bot's comment. There's no way to "correct" a specific lookup — just let users know they can try rephrasing.

---

## Quick Reference

| I want to... | Tool |
|-------------|------|
| Clean up a derailed comment thread | Chain Mop (comment menu) |
| Post a pre-written mod message | Saved Responses (post/comment menu) |
| Check how many posts a user has made | Flood Quota Checker (subreddit menu) |
| Get an AI review of a physics paper | Adversarial Reviewer (post menu) |
| Change the quota limits | Bot Settings: Flood (subreddit menu) |
| Change the depth cap | Bot Settings: Commenting (subreddit menu) |
| Change a removal message | Bot Settings: Removal Messages (subreddit menu) |
| Turn off a module | Bot Settings: Modules (subreddit menu) |

---

If you have questions not answered here, reach out to u/AllHailSeizure.
