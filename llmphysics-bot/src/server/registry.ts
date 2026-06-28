import type { Hono } from 'hono';
import {
  initBotCore,
  runOnPost, runOnComment,
  runQuotaCheck, runFloodOnModAction, runFloodOnPostDelete,
  runLengthModerator, runLengthFlairUpdate,
  runDepthCapModerator, runSelfResponseModerator,
  runOnPostReport, runOnCommentReport,
  registerAdversarialReviewer, registerMopTool,
  registerResponseTool, registerQuotaViewer, registerAdmin,
} from '@llmphysics/bot-core';
import '@llmphysics/bot-core/command-modules/define-command';

// ─── Deployment identity ──────────────────────────────────────────────────────

initBotCore({
  botMention:   'u/LLMPhysics-bot',
  botUsername:  'llmphysics-bot',
  devSubreddit: 'llmphysics_dev',
  userAgent:    'llmphysics-bot/1.0 (Reddit bot; r/llmphysics)',
  botAuthors:   new Set(['AutoModerator', 'FloodAssistant', 'LLMPhysics-ModTeam', 'llmphysics-bot']),
});

// ─── Trigger arrays ───────────────────────────────────────────────────────────

export const POST_SUBMIT    = [runOnPost, runQuotaCheck, runLengthModerator];
export const POST_FLAIR     = [runLengthFlairUpdate];
export const COMMENT_CREATE = [runOnComment, runDepthCapModerator, runSelfResponseModerator];
export const POST_REPORT    = [runOnPostReport];
export const COMMENT_REPORT = [runOnCommentReport];
export const MOD_ACTIONS    = [runFloodOnModAction];
export const POST_DELETE    = [runFloodOnPostDelete];

// ─── Action + admin modules ───────────────────────────────────────────────────

export function registerAll(app: Hono): void {
  registerAdversarialReviewer(app);
  registerMopTool(app);
  registerResponseTool(app);
  registerQuotaViewer(app);
  registerAdmin(app);
}
