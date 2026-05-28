# llmphysics-bot  2.8.2 — Moderator Guide

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

---

## 2. Settings Guide (v2.8.1)
Moderators can manage all bot behaviors in the **Bot Settings** menu (found under the Subreddit header overflow menu). Settings are organized into five main categories:

### Modules
Enable or disable specific features:
*   **Depth Cap Moderator**
*   **Flood Moderator**
*   **Self-Response Moderator**
*   **Length Moderator**
*   **Chain Mop**
*   **Saved Responses**
*   **Define Command**

### 

### Flood Moderator
Manage spam controls:
*   **Max posts per window:** The limit of submissions allowed for a single user within the defined timeframe.
*   **Time window (hours):** The rolling duration (in hours) to enforce the post limit.
*   **Ignore flags:** Toggle automatic exemptions for Moderators, Approved Submitters, and various types of removed/deleted posts to prevent over-moderation of legitimate activity.

### Commenting
Configure settings for comment interactions:
*   **Depth cap:** Maximum allowed depth for conversation branches before they are automatically locked.
*   **Ignore flags:** Toggle exemptions (Moderators/Approved Submitters) for both the **Depth Cap** and **Self-Response** modules.

### Posting
Configure settings for post requirements:
*   **Flair template ID for max length posts:** Specify the Reddit flair template ID that triggers these character limits.
*   **Max unhosted length:** The maximum allowed character count for posts bearing the specified flair.
*   **Min hosted length:** The minimum allowed character count required for link (hosted) posts to ensure quality discussions.

### Removal Messages
Customize the text users receive when content is removed or restricted:
*   **Bot signature:** The identifier appended to all bot comments (automatically formatted as superscript). Leave blank to disable.
*   **Custom responses:** Tailored messages for Flood, Depth Cap, Self-Response, and Length-based removals.
## 3. Interaction Commands

Any user can trigger a definition by mentioning the bot in a comment:





