import type { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { logger } from './logger';
import type {
  AppInstallHandler,
  AppUpgradeHandler,
  PostSubmitHandler,
  CommentCreateHandler,
  PostReportHandler,
  CommentReportHandler,
  ModActionsHandler,
  ModMailHandler,
  ModuleHandler,
} from './types';

// ─── Trigger module imports ────────────────────────────────────────────────────
// Add one import line per new trigger module, e.g.:
// import { run as spamFilter } from './action-modules/spam-filter';
import { runOnComment, runOnPost } from './command';
import { runOnCommentReport, runOnPostReport } from './trigger-modules/report-filter';

// ─── Command module imports ────────────────────────────────────────────────────
// Add one import line per new command module (side-effect: registers the command), e.g.:
// import './command-modules/score-command';
import './command-modules/define';

// ─── Menu module imports ───────────────────────────────────────────────────────
// Add one import line per new menu module, e.g.:
// import { register as registerMyModule } from './action-modules/my-module';
import { register as registerChainModerator } from './action-modules/chain-moderator';
import { register as registerSavedResponses } from './action-modules/saved-responses';
import { register as registerAdmin } from './admin';
import { run as runDepthCapModerator } from './trigger-modules/depth-cap-moderator';
import { run as runSelfResponseModerator } from './trigger-modules/self-response-moderator';
import { run as runAppealModerator } from './action-modules/appeal';
import { run as runFloodAssistant } from './trigger-modules/flood-assistant';

// ─── Trigger arrays ────────────────────────────────────────────────────────────
// Add the imported run() to the appropriate array (one line per module).

const APP_INSTALL:    AppInstallHandler[]    = [];
const APP_UPGRADE:    AppUpgradeHandler[]    = [];
const POST_SUBMIT:    PostSubmitHandler[]    = [runOnPost, runFloodAssistant];
const COMMENT_CREATE: CommentCreateHandler[] = [runOnComment, runDepthCapModerator, runSelfResponseModerator];
const POST_REPORT:    PostReportHandler[]    = [runOnPostReport];
const COMMENT_REPORT: CommentReportHandler[] = [runOnCommentReport];
const MOD_ACTIONS:    ModActionsHandler[]    = [];
const MOD_MAIL:       ModMailHandler[]       = [runAppealModerator];

// ─── Dispatch ──────────────────────────────────────────────────────────────────

const log = logger('registry');

async function dispatch<T>(trigger: string, modules: ModuleHandler<T>[], event: T): Promise<void> {
  for (const mod of modules) {
    try {
      await mod(event);
    } catch (err) {
      log.error(`Module threw in ${trigger}`, err, { handler: mod.name });
    }
  }
}

// ─── registerAll ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = ModuleHandler<any>;

const TRIGGER_ROUTES: Array<[string, AnyHandler[]]> = [
  ['app-install',    APP_INSTALL],
  ['app-upgrade',    APP_UPGRADE],
  ['post-submit',    POST_SUBMIT],
  ['comment-create', COMMENT_CREATE],
  ['post-report',    POST_REPORT],
  ['comment-report', COMMENT_REPORT],
  ['mod-action',     MOD_ACTIONS],
  ['mod-mail',       MOD_MAIL],
];

export function registerAll(app: Hono): void {
  for (const [slug, modules] of TRIGGER_ROUTES) {
    app.post(`/internal/triggers/${slug}`, async (c) => {
      await dispatch(slug, modules, await c.req.json());
      return c.json<TriggerResponse>({ status: 'ok' });
    });
  }

  // Menu modules — add one line per new menu module
  registerChainModerator(app);
  registerSavedResponses(app);
  registerAdmin(app);
}
