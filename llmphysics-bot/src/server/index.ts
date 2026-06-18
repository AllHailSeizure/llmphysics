import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/server';
import { registerAll } from './registry';

const app = new Hono();
registerAll(app);

createServer(getRequestListener(app.fetch.bind(app))).listen(getServerPort());
