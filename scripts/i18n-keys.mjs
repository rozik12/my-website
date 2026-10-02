#!/usr/bin/env node
/* Собирает все русские строки интерфейса (ключи перевода) и проверяет словари uz/en.
   Ключ — любая строка в одинарных кавычках с кириллицей в коде интерфейса и тексты из content/site.json.
   Запуск: node scripts/i18n-keys.mjs [--missing uz|en] [--json] */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['content.js', 'mock-backend.js', 'admin.js', 'uz.js', 'en.js', 'monitor.js', 'i18n-keys.mjs', 'build.mjs', 'gen-icons.mjs', 'gen-og.mjs', 'serve.mjs']);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(m?js)$/.test(e.name) && !SKIP.has(e.name) && !p.endsWith(path.join('i18n', 'index.js'))) out.push(p);
  }
  return out;
}

export async function collectKeys() {
  const keys = new Set();
  const files = [...await walk(path.join(ROOT, 'src/js')), ...await walk(path.join(ROOT, 'scripts'))];
  for (const f of files) {
    const src = (await readFile(f, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
      const s = m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'");
      if (/[А-Яа-яЁё]/.test(s)) keys.add(s);
    }
  }
  // Сообщения сервера (SQL) и демо-бэкенда, которые показываются пользователю через t()
  for (const f of await readdir(path.join(ROOT, 'supabase/migrations'))) {
    for (const m of (await readFile(path.join(ROOT, 'supabase/migrations', f), 'utf8')).matchAll(/raise exception '([^']+)'/g)) keys.add(m[1]);
  }
  for (const m of (await readFile(path.join(ROOT, 'src/js/api/mock-backend.js'), 'utf8')).matchAll(/err\('([^']+)'/g)) if (/[А-Яа-яЁё]/.test(m[1])) keys.add(m[1]);
  ['Тяжело', 'С трудом', 'Нормально', 'Хорошо', 'Отлично', 'сум'].forEach(k => keys.add(k));
  const site = JSON.parse(await readFile(path.join(ROOT, 'content/site.json'), 'utf8'));
  [site.name, site.tagline, site.description].forEach(s => keys.add(s));
  Object.values(site.categories).forEach(c => { keys.add(c.label); keys.add(c.description); });
  Object.values(site.levels).forEach(l => { keys.add(l.label); keys.add(l.perDay); });
  site.faq.flat().forEach(s => keys.add(s));
  return [...keys].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = await collectKeys();
  const args = process.argv.slice(2);
  const lang = args[args.indexOf('--missing') + 1];
  if (args.includes('--missing')) {
    const dict = (await import(pathToFileURL(path.join(ROOT, `src/js/i18n/${lang}.js`)).href)).default;
    const miss = keys.filter(k => !(k in dict));
    console.log(args.includes('--json') ? JSON.stringify(miss, null, 1) : miss.join('\n'));
    console.error(`${lang}: нет перевода для ${miss.length} из ${keys.length}`);
  } else console.log(keys.length + ' ключей');
}
