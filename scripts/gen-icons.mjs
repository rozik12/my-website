#!/usr/bin/env node
/* Генерирует SVG-спрайт src/assets/icons.svg из иконок Lucide (пакет react-icons/lu).
   Иконки хранятся вместе с сайтом — без внешних CDN. Запуск: npm run icons
   Берутся все строки в кавычках в коде и контенте, совпадающие с именем иконки Lucide. */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const lu = require('react-icons/lu');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(m?js|json)$/.test(e.name) && e.name !== 'content.js') out.push(p);
  }
  return out;
}

const files = [...await walk(path.join(ROOT, 'src/js')), ...await walk(path.join(ROOT, 'scripts')), ...await walk(path.join(ROOT, 'content'))];
const names = new Set();
for (const f of files) {
  const src = await readFile(f, 'utf8');
  for (const m of src.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g)) names.add(m[1]);
}
const toComp = n => 'Lu' + n.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
const used = [...names].filter(n => lu[toComp(n)]).sort();

const symbols = used.map(n => {
  const svg = renderToStaticMarkup(React.createElement(lu[toComp(n)]));
  const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<symbol id="i-${n}" viewBox="${viewBox}">${inner}</symbol>`;
});

await writeFile(path.join(ROOT, 'src/assets/icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg">\n<!-- Lucide icons (ISC License), сгенерировано scripts/gen-icons.mjs -->\n${symbols.join('\n')}\n</svg>\n`);
console.log(`✓ Спрайт: ${used.length} иконок`);
