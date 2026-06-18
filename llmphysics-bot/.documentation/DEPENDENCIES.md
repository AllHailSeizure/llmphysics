# Dependencies

All dependencies are managed via `package.json` and installed with `npm install`.

---

## Runtime dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@devvit/web` | ^0.12.0 | Devvit platform API — `redis`, `reddit`, `scheduler`, and trigger/event types |
| `@hono/node-server` | ^2.0.0 | `getRequestListener()` adapter used in `index.ts` to bridge Hono ↔ `@devvit/server` |
| `hono` | ^4.0.0 | HTTP routing framework (`Hono` class, route handlers) |

## Dev dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@devvit/shared-types` | ^0.12.20 | TypeScript event payload types (`OnModMailRequest`, `OnCommentCreateRequest`, etc.) |
| `@types/node` | ^20.0.0 | Node.js type definitions |
| `esbuild` | ^0.28.0 | Bundles `src/server/index.ts` → `dist/server/index.js` (CJS, platform=node) |
| `typescript` | ^5.0.0 | TypeScript compiler |

---

## Transitive `@devvit/*` packages

Installed automatically as dependencies of `@devvit/web`. Not declared directly in `package.json`.

| Package | Version |
|---------|---------|
| `@devvit/cache` | 0.12.20 |
| `@devvit/client` | 0.12.20 |
| `@devvit/media` | 0.12.20 |
| `@devvit/metrics` | 0.12.20 |
| `@devvit/notifications` | 0.12.20 |
| `@devvit/payments` | 0.12.20 |
| `@devvit/protos` | 0.12.20 |
| `@devvit/public-api` | 0.12.20 |
| `@devvit/realtime` | 0.12.20 |
| `@devvit/reddit` | 0.12.20 |
| `@devvit/redis` | 0.12.20 |
| `@devvit/server` | 0.12.20 |
| `@devvit/shared` | 0.12.20 |
| `@devvit/web-view-scripts` | 0.12.20 |
