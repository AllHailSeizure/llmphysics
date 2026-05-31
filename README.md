# llmphysics-bot  2.13.0 — Moderator Guide

A modular moderation-assistance bot for [r/LLMPhysics](https://reddit.com/r/LLMPhysics), built on the [Devvit](https://developers.reddit.com/docs) platform.

---

## 1. Moderator Onboarding: How the Bot Works

This bot is designed to keep r/LLMPhysics clean and focused. It handles repetitive janitorial work automatically while providing powerful tools for manual intervention.

### Automatic Cleanup
You don't need to lift a finger for these. The bot performs the following tasks in the background:
*   **Self-Response Moderator:** Prevents the original poster from cluttering the top-level comment section by locking and removing their own follow-up comments.
*   **Depth Cap:** Keeps conversations readable. Once a thread exceeds the configured depth limit, the bot automatically locks the deepest branch.
*   **Flood Assistant:** Protects the sub from spam by limiting the number of posts a user can submit within a 24-hour window.
*   **Length Moderator:** Ensures post quality by enforcing character limits based on post flair or content type.
*   **Report Filter:** Keeps your mod queue clean by automatically ignoring reports on the bot's own activity.

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

*   **Flood Quota** _(Subreddit overflow menu)_:
    *   **What it does:** Look up any user's current post count against the flood quota, including which posts count toward the limit and when their next post opportunity opens.

---

## 2. Settings Guide (v2.13.0)
Moderators configure all bot settings via the **Reddit app installation settings page** at `https://developers.reddit.com/r/YOUR_SUBREDDIT/apps/llmphysics-bot`. Settings are grouped by module and take effect immediately.

### Module toggles
Enable or disable each module independently:
*   **Depth Cap — Enable**
*   **Flood Moderator — Enable**
*   **Self-Response Moderator — Enable**
*   **Length Moderator — Enable**
*   **Chain Mop — Enable**
*   **Saved Responses — Enable**
*   **Define Command — Enable**
*   **Adversarial Reviewer — Enable**

### Flood Moderator
*   **Max posts per window** / **Window (hours):** Quota limits.
*   **Ignore flags:** Exemptions for Moderators, Approved Submitters, auto-removed, mod-removed, and deleted posts.
*   **Flood removal message:** Text posted when a user exceeds their quota.

### Depth Cap
*   **Maximum comment depth:** Depth at which chains are locked (0 = disabled).
*   **Ignore moderators / Ignore approved submitters:** Exemption flags.
*   **Depth cap triggered comment:** Text posted when the cap fires.

### Self-Response Moderator
*   **Ignore moderators / Ignore approved submitters:** Exemption flags.
*   **Self-response removal message:** Text posted on enforcement.

### Length Moderator
*   **Restricted flair template ID:** Flair that triggers the length limit.
*   **Max unhosted length / Min hosted length:** Character count thresholds (0 = disabled).
*   **Over-length / Under-length removal messages:** Text posted on each enforcement.

### Define Command
*   **Subject category:** Domain used for Wikipedia disambiguation (default: "physics, mathematics, and AI").
*   **Search grounding:** Enables Google Search grounding for term resolution.

### Adversarial Reviewer
*   **Required flair template ID:** Restrict reviews to posts with this flair (blank = any flair).

### General
*   **Bot signature:** Appended to all bot comments as superscript. Leave blank to disable.
*   **Adversarial Reviewer — Required flair template ID:** (also appears here for convenience)
## 3. Interaction Commands

Any user can trigger a definition by mentioning the bot in a comment:





