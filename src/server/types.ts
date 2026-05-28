import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnPostSubmitRequest,
  OnPostFlairUpdateRequest,
  OnCommentCreateRequest,
  OnPostReportRequest,
  OnCommentReportRequest,
  OnModActionRequest,
  OnPostDeleteRequest,
  OnModMailRequest,
} from '@devvit/web/shared';

export type ModuleHandler<T> = (event: T) => Promise<void>;

export type AppInstallHandler      = ModuleHandler<OnAppInstallRequest>;
export type AppUpgradeHandler      = ModuleHandler<OnAppUpgradeRequest>;
export type PostSubmitHandler      = ModuleHandler<OnPostSubmitRequest>;
export type PostFlairUpdateHandler = ModuleHandler<OnPostFlairUpdateRequest>;
export type CommentCreateHandler   = ModuleHandler<OnCommentCreateRequest>;
export type PostReportHandler    = ModuleHandler<OnPostReportRequest>;
export type CommentReportHandler = ModuleHandler<OnCommentReportRequest>;
export type ModActionsHandler    = ModuleHandler<OnModActionRequest>;
export type PostDeleteHandler    = ModuleHandler<OnPostDeleteRequest>;
export type ModMailHandler       = ModuleHandler<OnModMailRequest>;

// ─── Command types ─────────────────────────────────────────────────────────────

export type ContentType = 'comment' | 'post' | 'both';

export interface CommandDefinition {
  commandName: string;
  contentType: ContentType;
  requiresArgument: boolean;
}

export type CommandEvent = OnCommentCreateRequest | OnPostSubmitRequest;
export type CommandHandler = (event: CommandEvent, argument: string | null) => Promise<void>;

export interface RegisteredCommand {
  definition: CommandDefinition;
  handler: CommandHandler;
}

// ─── Settings types ────────────────────────────────────────────────────────────

export interface SettingDef {
  key: string;
  defaultValue: string | number | boolean;
  field: object;
}

export interface SettingsMenu {
  key: string;
  label: string;
  settings: SettingDef[];
}

// ─── Reddit ID branded types ───────────────────────────────────────────────────

export type CommentId = `t1_${string}`;
export type PostId    = `t3_${string}`;
