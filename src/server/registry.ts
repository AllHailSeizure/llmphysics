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
import { runQuotaCheck, runOnModAction as runFloodOnModAction, runOnPostDelete as runFloodOnPostDelete } from './trigger-modules/flood-moderator';
import { run as runDepthCapModerator } from './trigger-modules/depth-cap-moderator';

// ─── Command module imports ────────────────────────────────────────────────────
// import './command-modules/my-command';

// ─── Menu module imports ───────────────────────────────────────────────────────
import { register as registerQuotaViewer } from './action-modules/quota-viewer';

// ─── Trigger arrays ────────────────────────────────────────────────────────────

const APP_INSTALL:       AppInstallHandler[]      = [];
const APP_UPGRADE:       AppUpgradeHandler[]      = [];
const POST_SUBMIT:       PostSubmitHandler[]      = [runQuotaCheck];
const POST_FLAIR_UPDATE: PostFlairUpdateHandler[] = [];
const COMMENT_CREATE:    CommentCreateHandler[]   = [runDepthCapModerator];
const POST_REPORT:       PostReportHandler[]      = [];
const COMMENT_REPORT:    CommentReportHandler[]   = [];
const MOD_ACTIONS:       ModActionsHandler[]      = [runFloodOnModAction];
const POST_DELETE:       PostDeleteHandler[]      = [runFloodOnPostDelete];
const MOD_MAIL:          ModMailHandler[]         = [];

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
  ['app-install',       APP_INSTALL],
  ['app-upgrade',       APP_UPGRADE],
  ['post-submit',       POST_SUBMIT],
  ['post-flair-update', POST_FLAIR_UPDATE],
  ['comment-create',    COMMENT_CREATE],
  ['post-report',       POST_REPORT],
  ['comment-report',    COMMENT_REPORT],
  ['mod-action',        MOD_ACTIONS],
  ['post-delete',       POST_DELETE],
  ['mod-mail',          MOD_MAIL],
];

export function registerAll(app: Hono): void {
  for (const [slug, modules] of TRIGGER_ROUTES) {
    app.post(`/internal/triggers/${slug}`, async (c) => {
      await dispatch(slug, modules, await c.req.json());
      return c.json<TriggerResponse>({ status: 'ok' });
    });
  }
  // Menu modules — one line per verified module:
  registerQuotaViewer(app);
}
