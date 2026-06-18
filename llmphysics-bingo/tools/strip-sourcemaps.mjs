// Strip client sourcemaps after build.
//
// The @devvit/start/vite plugin force-emits *.js.map for the webview bundle and
// ignores `build.sourcemap: false`. Devvit uploads every file in `dist/client` as a
// webview asset, and the .map upload fails ("failed to upload webview asset
// game.js.map"). The maps have no value on the platform (debugging is via
// `devvit logs`), so we delete them — and the now-dangling //# sourceMappingURL
// comments in the .js files — before playtest/publish uploads the directory.

import { readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/client';

let removed = 0;
for (const file of readdirSync(dir)) {
  const full = join(dir, file);
  if (file.endsWith('.map')) {
    rmSync(full);
    removed++;
  } else if (file.endsWith('.js')) {
    const src = readFileSync(full, 'utf8');
    const stripped = src.replace(/\n?\/\/# sourceMappingURL=.*\.map\s*$/m, '');
    if (stripped !== src) writeFileSync(full, stripped);
  }
}

console.log(`[strip-sourcemaps] removed ${removed} .map file(s) from ${dir}`);
