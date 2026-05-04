import type { Context, MiddlewareHandler } from 'hono';
import type { Hono } from 'hono';
import { redis, reddit } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { readAllSettings, writeSetting } from '../app-settings';
import { readAllSettings, writeSetting, readSetting } from '../app-settings';
import { appealKey, APPEAL_INDEX_KEY, type AppealRecord } from './appeal';
import { CLIENT_BUNDLE } from '../generated/client-bundle';
import { logger } from '../logger';

const log = logger('admin');
const SESSION_TTL = 7200;

// ─── Session helpers ───────────────────────────────────────────────────────────

type Session = { username: string; subredditName: string };

function sessionKey(token: string): string {
  return `admin:session:${token}`;
}

async function createSession(username: string, subredditName: string): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '');
  await redis.set(sessionKey(token), JSON.stringify({ username, subredditName }));
  await redis.expire(sessionKey(token), SESSION_TTL);
  return token;
}

async function getSession(token: string): Promise<Session | null> {
  const raw = await redis.get(sessionKey(token));
  return raw ? (JSON.parse(raw) as Session) : null;
}

async function sessionOfContext(c: Context): Promise<Session | null> {
  const token = c.req.header('X-Session-Token') ?? c.req.query('session') ?? '';
  return token ? getSession(token) : null;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

const requireSession: MiddlewareHandler = async (c, next) => {
  const token = c.req.header('X-Session-Token') ?? c.req.query('session') ?? '';
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const session = await getSession(token);
  if (!session) return c.json({ error: 'Session expired or invalid' }, 401);
  await next();
};

// ─── Saved responses helpers ───────────────────────────────────────────────────

const SAVED_KEY = 'bot:savedresponses';
type ResponseLocation = 'post' | 'comment' | 'both';
type SavedResponse = { id: string; title: string; body: string; location: ResponseLocation };

async function loadResponses(): Promise<SavedResponse[]> {
  const raw = await redis.get(SAVED_KEY);
  return raw ? (JSON.parse(raw) as SavedResponse[]) : [];
}

async function saveResponses(responses: SavedResponse[]): Promise<void> {
  await redis.set(SAVED_KEY, JSON.stringify(responses));
}

// ─── HTML shell ────────────────────────────────────────────────────────────────

function adminHtml(): string {
  const safeBundle = CLIENT_BUNDLE.replace(/<\/script>/gi, '<\\/script>');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>llmphysics-bot — Mod Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#f6f7f8;min-height:100vh;color:#1a1a1a}
#root{padding:1.5rem}
</style>
</head>
<body>
<div id="root"></div>
<script>${safeBundle}</script>
</body>
</html>`;
}

// ─── register ─────────────────────────────────────────────────────────────────

export function register(app: Hono): void {

  // ── Menu item: open admin panel ──────────────────────────────────────────────
  app.post('/internal/menu/admin-open', async (c) => {
    const req = await c.req.json<MenuItemRequest>();
    const username = (await reddit.getCurrentUsername()) ?? '';
    const subreddit = await reddit.getSubredditById(req.targetId as `t5_${string}`);
    if (!subreddit) {
      return c.json<UiResponse>({ showToast: 'Could not identify subreddit.' });
    }
    const subredditName = subreddit.name;

    const mods = reddit.getModerators({ subredditName });
    const modList = await mods.all();
    const isMod = modList.some(m => m.username === username);
    if (!isMod) {
      return c.json<UiResponse>({ showToast: 'You are not a moderator of this subreddit.' });
    }

    const baseUrl = (await readSetting('appealBaseUrl', '')).trim();
    if (!baseUrl) {
      return c.json<UiResponse>({ 
        showToast: 'Admin panel URL not configured. Please set the App Base URL in subreddit settings.' 
      });
    }

    const token = await createSession(username, subredditName);
    const origin = new URL(c.req.url).origin;
    log.info('Admin session created', { username, subredditName });
    return c.json<UiResponse>({ navigateTo: `${origin}/admin?session=${token}` });
    return c.json<UiResponse>({ navigateTo: `${baseUrl}/admin?session=${token}` });
  });

  // ── SPA shell ────────────────────────────────────────────────────────────────
  app.get('/admin', async (c) => {
    const token = c.req.query('session') ?? c.req.header('X-Session-Token') ?? '';
    if (!token || !(await getSession(token))) {
      return c.html('<p style="font-family:sans-serif;padding:2rem;color:#c00">Session expired. Please reopen from the mod menu.</p>', 401);
    }
    return c.html(adminHtml());
  });

  // ── API middleware: all /api/* routes require a valid session ────────────────
  app.use('/api/*', requireSession);

  // ── Settings ─────────────────────────────────────────────────────────────────
  app.get('/api/settings', async (c) => {
    const settings = await readAllSettings();
    return c.json(settings);
  });

  app.post('/api/settings', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const ALLOWED = ['botSignature', 'depthCap', 'depthCapNotice', 'appealBaseUrl'];
    for (const key of ALLOWED) {
      if (key in body) {
        const v = body[key];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          await writeSetting(key, v);
        }
      }
    }
    const session = await sessionOfContext(c);
    log.info('Settings updated', { by: session?.username });
    return c.json({ ok: true });
  });

  // ── Saved responses ───────────────────────────────────────────────────────────
  app.get('/api/saved-responses', async (c) => {
    return c.json(await loadResponses());
  });

  app.post('/api/saved-responses', async (c) => {
    const { title, body, location = 'both' } = await c.req.json<{ title: string; body: string; location?: ResponseLocation }>();
    const responses = await loadResponses();
    const entry: SavedResponse = { id: crypto.randomUUID().replace(/-/g, ''), title, body, location };
    responses.push(entry);
    await saveResponses(responses);
    return c.json(entry, 201);
  });

  app.put('/api/saved-responses/:id', async (c) => {
    const id = c.req.param('id');
    const { title, body, location } = await c.req.json<{ title: string; body: string; location?: ResponseLocation }>();
    const responses = await loadResponses();
    const idx = responses.findIndex(r => r.id === id);
    if (idx === -1) return c.json({ error: 'Not found' }, 404);
    responses[idx] = { id, title, body, location: location ?? responses[idx].location ?? 'both' };
    await saveResponses(responses);
    return c.json(responses[idx]);
  });

  app.delete('/api/saved-responses/:id', async (c) => {
    const id = c.req.param('id');
    const responses = await loadResponses();
    const filtered = responses.filter(r => r.id !== id);
    if (filtered.length === responses.length) return c.json({ error: 'Not found' }, 404);
    await saveResponses(filtered);
    return c.json({ ok: true });
  });

  // ── Appeals ──────────────────────────────────────────────────────────────────
  app.get('/api/appeals', async (c) => {
    const indexEntries = await redis.zRange(APPEAL_INDEX_KEY, 0, -1);
    const results: (AppealRecord & { postId: string })[] = [];
    for (const entry of indexEntries) {
      const postId = entry.member;
      const raw = await redis.get(appealKey(postId));
      if (!raw) continue;
      results.push({ postId, ...(JSON.parse(raw) as AppealRecord) });
    }
    return c.json(results);
  });

  // ── Logs ─────────────────────────────────────────────────────────────────────
  app.get('/api/logs', async (c) => {
    const LEVELS = ['info', 'warn', 'error'] as const;
    const limit = Number(c.req.query('limit') ?? '200');
    const entries: unknown[] = [];
    for (const level of LEVELS) {
      const raw = await redis.zRange(`bot:log:${level}`, 0, -1);
      for (const entry of raw) {
        try { entries.push(JSON.parse(entry.member)); } catch { /* skip */ }
      }
    }
    entries.sort((a: unknown, b: unknown) => ((b as { ts: number }).ts ?? 0) - ((a as { ts: number }).ts ?? 0));
    return c.json(entries.slice(0, limit));
  });
}
