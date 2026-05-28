import type { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { logger } from './helpers/log-helper';
import type {
  AppInstallHandler,
  AppUpgradeHandler,
  PostSubmitHandler,
  PostFlairUpdateHandler,
  CommentCreateHandler,
  PostReportHandler,
  CommentReportHandler,
  ModActionsHandler,
  PostDeleteHandler,
  ModMailHandler,
  ModuleHandler,
} from './types';

// ─── Trigger module imports ────────────────────────────────────────────────────
// Add one import line per new trigger module, e.g.:
// import { run as spamFilter } from './action-modules/spam-filter';
import { runOnComment, runOnPost } from './helpers/command-helper';
import { runOnCommentReport, runOnPostReport } from './trigger-modules/report-moderator';
import { run as runLengthModerator, runOnFlairUpdate as runLengthFlairUpdate } from './trigger-modules/length-moderator';

// ─── Command module imports ────────────────────────────────────────────────────
// Add one import line per new command module (side-effect: registers the command), e.g.:
// import './command-modules/score-command';
import './command-modules/define-command';

// ─── Menu module imports ───────────────────────────────────────────────────────
// Add one import line per new menu module, e.g.:
// import { register as registerMyModule } from './action-modules/my-module';
import { register as registerAdversarialReviewer } from './action-modules/adversarial-reviewer';
import { register as registerMopTool } from './action-modules/mop-tool';
import { register as registerResponseTool } from './action-modules/response-tool';
import { register as registerQuotaViewer } from './action-modules/quota-viewer';
import { register as registerBingoGame, captureCommentEvent, capturePostEvent, capturePostReportEvent, captureModActionEvent } from './action-modules/bingo-game';
import { register as registerAdmin } from './admin';
import { run as runDepthCapModerator } from './trigger-modules/depth-cap-moderator';
import { run as runSelfResponseModerator } from './trigger-modules/self-response-moderator';
import { runQuotaCheck, runOnModAction as runFloodOnModAction, runOnPostDelete as runFloodOnPostDelete } from './trigger-modules/flood-moderator';

// ─── Trigger arrays ────────────────────────────────────────────────────────────
// Add the imported run() to the appropriate array (one line per module).

const APP_INSTALL:       AppInstallHandler[]    = [];
const APP_UPGRADE:       AppUpgradeHandler[]    = [];
const POST_SUBMIT:       PostSubmitHandler[]    = [runOnPost, runQuotaCheck, runLengthModerator, capturePostEvent];
const POST_FLAIR_UPDATE: PostFlairUpdateHandler[] = [runLengthFlairUpdate];
const COMMENT_CREATE:    CommentCreateHandler[] = [runOnComment, runDepthCapModerator, runSelfResponseModerator, captureCommentEvent];
const POST_REPORT:    PostReportHandler[]    = [runOnPostReport, capturePostReportEvent];
const COMMENT_REPORT: CommentReportHandler[] = [runOnCommentReport];
const MOD_ACTIONS:    ModActionsHandler[]    = [runFloodOnModAction, captureModActionEvent];
const POST_DELETE:    PostDeleteHandler[]    = [runFloodOnPostDelete];
const MOD_MAIL:       ModMailHandler[]       = [];

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
  ['post-submit',       POST_SUBMIT],
  ['post-flair-update', POST_FLAIR_UPDATE],
  ['comment-create',    COMMENT_CREATE],
  ['post-report',    POST_REPORT],
  ['comment-report', COMMENT_REPORT],
  ['mod-action',     MOD_ACTIONS],
  ['post-delete',    POST_DELETE],
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
  registerAdversarialReviewer(app);
  registerMopTool(app);
  registerResponseTool(app);
  registerQuotaViewer(app);
  registerBingoGame(app);
  registerAdmin(app);
}
