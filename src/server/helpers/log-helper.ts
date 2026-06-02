const MAX_LOG_ENTRIES = 500;

type LogLevel = 'info' | 'warn' | 'error';

function fmt(level: LogLevel, module: string, message: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  const suffix = extra !== undefined ? ' ' + JSON.stringify(extra) : '';
  return `[${ts}][${level.toUpperCase()}][${module}] ${message}${suffix}`;
}

function extractLogFields(extra?: unknown): {
  action?: string;
  reason?: string;
  user_id?: string;
  post_id?: string;
  comment_id?: string;
  extra?: Record<string, unknown>;
} {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {};
  const { action, reason, userId, postId, commentId, ...rest } = extra as Record<string, unknown>;
  const result: ReturnType<typeof extractLogFields> = {};
  if (typeof action === 'string') result.action = action;
  if (typeof reason === 'string') result.reason = reason;
  if (typeof userId === 'string') result.user_id = userId;
  if (typeof postId === 'string') result.post_id = postId;
  if (typeof commentId === 'string') result.comment_id = commentId;
  if (Object.keys(rest).length > 0) result.extra = rest;
  return result;
}

async function persistToSupabase(level: LogLevel, module: string, message: string, extra?: unknown): Promise<void> {
  try {
    const { settings } = await import('@devvit/web/server');
    const supabaseUrl = (await settings.get<string>('supabaseUrl')) || '';
    const supabaseKey = (await settings.get<string>('supabaseServiceKey')) || '';
    if (!supabaseUrl || !supabaseKey) return;

    const fields = extractLogFields(extra);
    const body: Record<string, unknown> = { level, module, message };
    if (fields.action !== undefined) body.action = fields.action;
    if (fields.reason !== undefined) body.reason = fields.reason;
    if (fields.user_id !== undefined) body.user_id = fields.user_id;
    if (fields.post_id !== undefined) body.post_id = fields.post_id;
    if (fields.comment_id !== undefined) body.comment_id = fields.comment_id;
    if (fields.extra !== undefined) body.extra = fields.extra;

    await fetch(`${supabaseUrl}/rest/v1/bot_logs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(body),
    });
  } catch {
    // never let a Supabase write failure break the bot
  }
}

async function persist(level: LogLevel, module: string, message: string, extra?: unknown): Promise<void> {
  try {
    const { redis } = await import('@devvit/web/server');
    const ts = Date.now();
    const entry = JSON.stringify({ ts, level, module, message, extra });
    const key = `bot:log:${level}`;
    await redis.zAdd(key, { score: ts, member: entry });
    await redis.zRemRangeByRank(key, 0, -(MAX_LOG_ENTRIES + 1));
  } catch {
    // never let logging break the bot
  }
  void persistToSupabase(level, module, message, extra);
}

export async function logZSet(key: string, entry: object, maxEntries = MAX_LOG_ENTRIES): Promise<void> {
  try {
    const { redis } = await import('@devvit/web/server');
    const ts = Date.now();
    await redis.zAdd(key, { score: ts, member: JSON.stringify({ ts, ...entry }) });
    await redis.zRemRangeByRank(key, 0, -(maxEntries + 1));
  } catch {
    // never let logging break the bot
  }
}

export function logger(module: string) {
  return {
    info(message: string, data?: unknown): void {
      console.log(fmt('info', module, message, data));
      void persist('info', module, message, data);
    },

    warn(message: string, data?: unknown): void {
      console.warn(fmt('warn', module, message, data));
      void persist('warn', module, message, data);
    },

    error(message: string, err?: unknown, data?: unknown): void {
      const errInfo = err instanceof Error
        ? { message: err.message, stack: err.stack }
        : err;
      console.error(fmt('error', module, message, { ...((data as object) ?? {}), error: errInfo }));
      void persist('error', module, message, { ...((data as object) ?? {}), error: errInfo });
    },
  };
}
