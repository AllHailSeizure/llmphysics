import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/server';
import type { TriggerResponse } from '@devvit/web/shared';
import {
  capturePostEvent,
  captureCommentEvent,
  capturePostReportEvent,
  captureCommentReportEvent,
  captureModActionEvent,
  getBingoState,
  getBingoStats,
  createBingoPost,
  bingoSchedulerRun,
  getBingoSettings,
  postBingoSettings,
  resolveTestEvent,
  runTestValidation,
  clearTestBatch,
  getSimulation,
  runSimulationFetchDay,
} from './bingo';

const app = new Hono();

// ─── Trigger routes ───────────────────────────────────────────────────────────

app.post('/internal/triggers/post-submit', async (c) => {
  await capturePostEvent(await c.req.json());
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/triggers/comment-create', async (c) => {
  await captureCommentEvent(await c.req.json());
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/triggers/post-report', async (c) => {
  await capturePostReportEvent(await c.req.json());
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/triggers/comment-report', async (c) => {
  await captureCommentReportEvent(await c.req.json());
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/triggers/mod-action', async (c) => {
  await captureModActionEvent(await c.req.json());
  return c.json<TriggerResponse>({ status: 'ok' });
});

// ─── HTTP routes ──────────────────────────────────────────────────────────────

app.get('/api/bingo/state', (c) => getBingoState(c));
app.get('/api/bingo/stats', (c) => getBingoStats(c));
app.post('/internal/menu/create-bingo-post', (c) => createBingoPost(c));
app.post('/internal/scheduler/bingo-batch-check', (c) => bingoSchedulerRun(c));
app.get('/api/bingo/settings', (c) => getBingoSettings(c));
app.post('/api/bingo/settings', (c) => postBingoSettings(c));
app.post('/api/bingo/test/resolve', (c) => resolveTestEvent(c));
app.post('/api/bingo/test/run', (c) => runTestValidation(c));
app.post('/api/bingo/test/clear', (c) => clearTestBatch(c));
app.get('/api/bingo/simulation', (c) => getSimulation(c));
app.post('/api/bingo/simulation/fetch-day', (c) => runSimulationFetchDay(c));

createServer(getRequestListener(app.fetch.bind(app))).listen(getServerPort());
