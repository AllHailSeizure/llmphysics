import type { Hono } from 'hono';
import type { ModuleHandler } from '@llmphysics/bot-core';
import {
  initBotCore, logger,
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

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const log = logger('registry');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = ModuleHandler<any>;

async function dispatch<T>(trigger: string, modules: ModuleHandler<T>[], event: T): Promise<void> {
  for (const mod of modules) {
    try {
      await mod(event);
    } catch (err) {
      log.error(`Module threw in ${trigger}`, err, { handler: mod.name });
    }
  }
}

// ─── Trigger routes ───────────────────────────────────────────────────────────

const TRIGGER_ROUTES: Array<[string, AnyHandler[]]> = [
  ['post-submit',        POST_SUBMIT],
  ['post-flair-update',  POST_FLAIR],
  ['comment-create',     COMMENT_CREATE],
  ['post-report',        POST_REPORT],
  ['comment-report',     COMMENT_REPORT],
  ['mod-action',         MOD_ACTIONS],
  ['post-delete',        POST_DELETE],
];

// ─── Action + admin modules ───────────────────────────────────────────────────

export function registerAll(app: Hono): void {
  // Wire trigger routes
  for (const [slug, handlers] of TRIGGER_ROUTES) {
    app.post(`/internal/triggers/${slug}`, async (c) => {
      const event = await c.req.json();
      await dispatch(slug, handlers, event);
      return c.json({ status: 'ok' });
    });
  }

  // Register action and admin modules
  registerAdversarialReviewer(app);
  registerMopTool(app);
  registerResponseTool(app);
  registerQuotaViewer(app);
  registerAdmin(app);
}
