// Builds the single-file offline shell: one esbuild IIFE bundle + CSS inlined
// into public/index.html (no CDN, no external file), plus public/sw.js.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const res = await build({
  entryPoints: [new URL('src/main.js', root).pathname],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['safari16', 'chrome111'],
  legalComments: 'none',
  write: false,
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(new URL('src/style.css', root), 'utf8');
const html = readFileSync(new URL('src/index.template.html', root), 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);
mkdirSync(new URL('public/', root), { recursive: true });
writeFileSync(new URL('public/index.html', root), html);
const { SW_SOURCE } = await import(new URL('src/pwa/sw.js', root).href);
writeFileSync(new URL('public/sw.js', root), `// Generated from src/pwa/sw.js\n${SW_SOURCE.trim()}\n`);
console.log(`public/index.html ${(html.length / 1024).toFixed(1)} kB (js ${(js.length / 1024).toFixed(1)} kB, css ${(css.length / 1024).toFixed(1)} kB) + public/sw.js`);
