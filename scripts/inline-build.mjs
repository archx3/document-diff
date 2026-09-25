// Produces single-file builds from dist/ (run after `vite build`):
//   dist-single/collate.html       a complete page that works offline from disk
//   dist-single/collate.body.html  the same page without <html>/<head>/<body>,
//                                  for hosts that wrap pages in their own skeleton
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const out = 'dist-single';
const page = readFileSync(join(dist, 'index.html'), 'utf8');
const asset = (href) => readFileSync(join(dist, href.replace(/^\.?\//, '')), 'utf8');

const CSS_LINK = /<link rel="stylesheet"[^>]*href="(\.?\/?assets\/[^"]+\.css)"[^>]*>\s*/g;
const JS_TAG = /<script type="module"[^>]*src="(\.?\/?assets\/[^"]+\.js)"[^>]*><\/script>\s*/g;
const PRELOAD = /<link rel="modulepreload"[^>]*>\s*/g;

// Split the small, asset-free index.html before anything is inlined.
const head = /<head>([\s\S]*?)<\/head>/.exec(page)[1];
const body = /<body>([\s\S]*?)<\/body>/.exec(page)[1];
const styles = [...head.matchAll(CSS_LINK)].map((m) => `<style>\n${asset(m[1])}\n</style>`);
const scripts = [...(head + body).matchAll(JS_TAG)].map((m) => {
  const js = asset(m[1])
    .replace(/<\/script/gi, '<\\/script')
    .replace(/\/\/# sourceMappingURL=\S+\s*$/, '');
  return `<script type="module">\n${js}\n</script>`;
});
const strip = (s) => s.replace(CSS_LINK, '').replace(JS_TAG, '').replace(PRELOAD, '');
const headRest = strip(head).trim();
const bodyRest = strip(body).trim();

const full = `<!doctype html>
<html lang="en">
<head>
${headRest}
${styles.join('\n')}
</head>
<body>
${bodyRest}
${scripts.join('\n')}
</body>
</html>
`;

const fragment = `${headRest
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join('\n')}
${styles.join('\n')}
${bodyRest}
${scripts.join('\n')}
`;

for (const s of [full, fragment]) if (/(src|href)="\.?\/?assets\//.test(s)) throw new Error('Unresolved asset reference');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'collate.html'), full);
writeFileSync(join(out, 'collate.body.html'), fragment);
console.log(`wrote ${out}/collate.html (${Math.round(full.length / 1024)} KB) and ${out}/collate.body.html`);
