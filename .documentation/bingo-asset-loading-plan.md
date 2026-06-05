# Plan: Fix Bingo Asset Loading

## Context

The bingo game board renders correctly (React component, text labels, grid layout) but all images are broken — tile backgrounds, logo, and board background all show as missing. The cause is how Vite handles SVG imports at build time vs. how Devvit serves client files at runtime.

**Root cause:** Devvit Web's client post system supports **HTML/CSS/JS only** (documented explicitly in the Devvit Web overview). SVG files are not served. Vite's default `assetsInlineLimit` is 4096 bytes — all five SVGs exceed this limit (tile SVGs ~4.4KB, logo 37KB, background 156KB), so Vite emits them as separate `.svg` files and references them via `new URL('filename.svg', import.meta.url).href` in `game.js`. Devvit ignores those SVG files at upload time. The image URLs 404 at runtime.

The Devvit media docs confirm: static images must be **"bundled with your app's client assets"** (as opposed to runtime media uploads to Reddit's CDN).

**Evidence:**
- Devvit Web overview: "HTML/CSS/JS only"
- `dist/client/game.js` contains `new URL(\`tile-inactive.svg\`,import.meta.url).href` (not data URIs)
- All five SVGs exist in `dist/client/` but are separate files Devvit won't serve
- The React component renders fine; only `<img src={...}>` and CSS `background-image` are broken

## Fix

### 1. Raise `assetsInlineLimit` in [vite.config.ts](llmphysics-bot/vite.config.ts)

```typescript
import { devvit } from '@devvit/start/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [devvit(), react()],
  build: {
    assetsInlineLimit: 512 * 1024, // 512KB — inline all SVGs as data URIs
  },
});
```

This forces Vite to embed all five SVGs (total ~206KB raw) as base64 data URIs inside `game.js`. No separate file requests needed.

**Trade-off:** `game.js` grows from ~3KB to ~280KB (compressed transfer will be much less). `jsx-runtime.js` is already 305KB, so this is acceptable.

### 2. Rebuild

```bash
npm run build
```

Verify that `dist/client/game.js` now contains `data:image/svg+xml;base64,...` strings instead of `new URL(...)` references. The SVG files will still be copied to `dist/client/` (Vite doesn't suppress them) but they'll be unreferenced dead copies.

### 3. Playtest

```
devvit playtest r/llmphysics_dev
```

Open the bingo post and confirm tile images, logo, and background all render.

## Verification

- `dist/client/game.js` contains `data:image/svg+xml` (not `new URL`)
- Bingo board shows tile images (inactive = grey, active = coloured)
- Logo renders in header
- Board background renders
