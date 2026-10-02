#!/usr/bin/env node
/* Сборка статического сайта: пререндер всех публичных страниц на трех языках, PWA, карта сайта.
   Использование:
     node scripts/build.mjs                 → dist/ (адреса вида /challenges/run-100/, /uz/..., /en/...)
     node scripts/build.mjs --explicit      → ссылки с index.html (хостинги без автоиндекса)
     node scripts/build.mjs --demo          → принудительный демо-режим (без Supabase)
     node scripts/build.mjs --out=preview   → другая папка
   Каталог берется из базы Supabase (то, что редактирует админка), если она настроена; иначе — из content/challenges.json.
   Принудительно: CATALOG_SOURCE=json. Настройки — из окружения или .env (см. .env.example). */
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT = path.resolve(ROOT, args.out || 'dist');
const EXPLICIT = !!args.explicit || !!args.artifact;
const DEMO = !!args.demo || !!args.artifact;

/* ---------- Конфигурация ---------- */
const env = { ...process.env };
if (existsSync(path.join(ROOT, '.env'))) {
  for (const line of (await readFile(path.join(ROOT, '.env'), 'utf8')).split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const SITE_JSON = JSON.parse(await readFile(path.join(ROOT, 'content/site.json'), 'utf8'));
const supabaseUrl = DEMO ? '' : (env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseAnonKey = DEMO ? '' : env.SUPABASE_ANON_KEY || '';

/* ---------- Каталог ---------- */
async function loadCatalog() {
  const source = env.CATALOG_SOURCE || (supabaseUrl ? 'db' : 'json');
  if (source === 'db') {
    const q = 'select=slug,category,level,days,icon,next_start,proof,price_uzs,content&owner_id=is.null&published=is.true&visibility=eq.public&order=created_at';
    const res = await fetch(`${supabaseUrl}/rest/v1/challenges?${q}`, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } }).catch(e => ({ ok: false, statusText: e.message }));
    if (!res.ok) { console.error(`Не удалось загрузить каталог из Supabase (${res.status || ''} ${res.statusText}). Для сборки из JSON задайте CATALOG_SOURCE=json.`); process.exit(1); }
    const rows = await res.json();
    console.log(`  каталог: ${rows.length} челленджей из базы`);
    return rows.map(r => ({ slug: r.slug, category: r.category, level: r.level, days: r.days, icon: r.icon, nextStart: r.next_start, proof: r.proof, priceUzs: r.price_uzs, content: r.content }));
  }
  return JSON.parse(await readFile(path.join(ROOT, 'content/challenges.json'), 'utf8'));
}
const CHALLENGES_JSON = await loadCatalog();
const contentHash = createHash('sha1').update(JSON.stringify(CHALLENGES_JSON) + JSON.stringify(SITE_JSON)).digest('hex').slice(0, 6);

const config = {
  siteUrl: (env.SITE_URL || 'http://localhost:4173').replace(/\/$/, ''),
  supabaseUrl, supabaseAnonKey,
  sentryDsn: env.SENTRY_DSN || '',
  telegramClientId: env.TELEGRAM_CLIENT_ID || '',
  yandexMetrikaId: env.YANDEX_METRIKA_ID || '',
  gaId: env.GA_MEASUREMENT_ID || '',
  environment: DEMO ? 'demo' : env.ENVIRONMENT || (supabaseUrl ? 'production' : 'demo'),
  release: `${pkg.version}-${contentHash}`
};

/* ---------- Проверка контента ---------- */
const problems = [], slugs = new Set();
for (const c of CHALLENGES_JSON) {
  const ru = c.content?.ru;
  if (!/^[a-z0-9-]{2,60}$/.test(c.slug)) problems.push(`${c.slug}: недопустимый slug`);
  if (slugs.has(c.slug)) problems.push(`${c.slug}: повторяющийся slug`);
  slugs.add(c.slug);
  if (!SITE_JSON.categories[c.category]) problems.push(`${c.slug}: неизвестная категория ${c.category}`);
  if (!SITE_JSON.levels[c.level]) problems.push(`${c.slug}: неизвестный уровень ${c.level}`);
  if (!(c.days >= 1 && c.days <= 365)) problems.push(`${c.slug}: days вне диапазона 1–365`);
  if (!ru?.title || !ru?.phases?.length || ru.phases.some(p => !p.tasks?.length)) problems.push(`${c.slug}: нужен русский текст с фазами и заданиями`);
  for (const l of ['uz', 'en']) {
    const tr = c.content?.[l];
    if (tr?.phases && tr.phases.some((p, i) => p.tasks && ru?.phases?.[i] && p.tasks.length !== ru.phases[i].tasks.length)) problems.push(`${c.slug}: в переводе ${l} другое число заданий`);
  }
  if (c.nextStart && !/^\d{4}-\d{2}-\d{2}$/.test(c.nextStart)) problems.push(`${c.slug}: nextStart должен быть YYYY-MM-DD`);
}
if (problems.length) { console.error('Ошибки в каталоге:\n- ' + problems.join('\n- ')); process.exit(1); }

/* ---------- Модуль контента для браузера и шаблонов ---------- */
await writeFile(path.join(ROOT, 'src/js/content.js'), `/* Сгенерировано scripts/build.mjs — не редактируйте вручную. */
export const SITE = ${JSON.stringify(SITE_JSON)};
export const CHALLENGES = ${JSON.stringify(CHALLENGES_JSON)};
`);
const bust = '?t=' + Date.now();
const T = await import(pathToFileURL(path.join(ROOT, 'scripts/templates.mjs')).href + bust);
const { isoInTz } = await import(pathToFileURL(path.join(ROOT, 'src/js/lib/logic.js')).href);
const I18N = await import(pathToFileURL(path.join(ROOT, 'src/js/i18n/index.js')).href);

/* ---------- Спрайт иконок ---------- */
const sprite = (await readFile(path.join(ROOT, 'src/assets/icons.svg'), 'utf8')).replace(/<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->\s*/, '')
  .replace('<svg ', '<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden" ');

/* ---------- Content Security Policy ---------- */
const sentryHost = config.sentryDsn ? 'https://' + ((/@([^/]+)\//.exec(config.sentryDsn) || [])[1] || '') : '';
const csp = args['no-csp'] || args.artifact ? '' : [
  "default-src 'self'",
  `script-src 'self'${config.yandexMetrikaId ? ' https://mc.yandex.ru https://yastatic.net' : ''}${config.gaId ? ' https://www.googletagmanager.com' : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  `img-src 'self' data: blob:${supabaseUrl ? ' ' + supabaseUrl : ''}${config.yandexMetrikaId ? ' https://mc.yandex.ru' : ''}${config.gaId ? ' https://*.google-analytics.com https://*.googletagmanager.com' : ''}`,
  `connect-src 'self' ${[supabaseUrl, sentryHost, config.yandexMetrikaId ? 'https://mc.yandex.ru' : '', config.gaId ? 'https://*.google-analytics.com https://*.analytics.google.com' : ''].filter(Boolean).join(' ')}`,
  `frame-src${config.yandexMetrikaId ? ' https://mc.yandex.ru' : " 'none'"}`,
  "base-uri 'self'", "form-action 'self'", "object-src 'none'", "worker-src 'self'", "manifest-src 'self'"
].join('; ');

/* ---------- Рендер страниц ---------- */
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const today = isoInTz(new Date());
const year = new Date().getFullYear();
const rendered = [];

for (const lang of I18N.LANGS) {
  I18N.setLang(lang);
  const prefix = I18N.langPrefix(lang);
  const routes = [
    ['/', T.home], ['/challenges/', T.catalog],
    ...CHALLENGES_JSON.map(c => [`/challenges/${c.slug}/`, ctx => T.challenge(ctx, c)]),
    ...[['overview', '/dashboard/'], ['feed', '/dashboard/feed/'], ['activity', '/dashboard/activity/'], ['achievements', '/dashboard/achievements/'], ['my', '/dashboard/my/'], ['settings', '/dashboard/settings/']].map(([tab, p]) => [p, ctx => T.dashboard(ctx, tab)]),
    ...[['login', '/login/'], ['signup', '/signup/'], ['forgot', '/forgot-password/'], ['reset', '/reset-password/'], ['callback', '/auth/callback/'], ['telegram', '/auth/telegram/']].map(([m, p]) => [p, ctx => T.auth(ctx, m)]),
    ['/create/', T.create], ['/join/', T.join], ['/people/', T.people], ['/u/', T.person], ['/c/', T.custom], ['/certificate/', T.certificate], ['/pay/', T.pay],
    ['/privacy/', ctx => T.legal(ctx, 'privacy')], ['/terms/', ctx => T.legal(ctx, 'terms')], ['/offline/', T.offline]
  ];
  if (lang === 'ru') routes.push(['/admin/', T.admin]);
  for (const [p, fn] of routes) {
    const depth = (prefix + p).split('/').filter(Boolean).length;
    const root = '../'.repeat(depth);
    const ctx = { lang, root, base: root + prefix, explicit: EXPLICIT, today, config, sprite, csp, year };
    const page = fn(ctx);
    const html = T.layout(ctx, page);
    const file = path.join(OUT, prefix, page.path, 'index.html');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
    rendered.push({ lang, page });
  }
}
// 404 обслуживается с любого адреса: ссылки от корня сайта
I18N.setLang('ru');
{ const ctx = { lang: 'ru', root: '/', base: '/', explicit: false, today, config, sprite, csp, year }; await writeFile(path.join(OUT, '404.html'), T.layout(ctx, T.notFound(ctx))); }

/* ---------- Ассеты ---------- */
await cp(path.join(ROOT, 'src/js'), path.join(OUT, 'assets/js'), { recursive: true });
await cp(path.join(ROOT, 'src/css'), path.join(OUT, 'assets/css'), { recursive: true });
for (const f of await readdir(path.join(ROOT, 'src/assets'))) if (f !== 'icons.svg') await cp(path.join(ROOT, 'src/assets', f), path.join(OUT, 'assets', f), { recursive: true });
await writeFile(path.join(OUT, 'assets/js/config.js'), `/* Сгенерировано при сборке */\nwindow.RB_CONFIG = ${JSON.stringify({
  siteUrl: config.siteUrl, supabaseUrl, supabaseAnonKey, sentryDsn: config.sentryDsn, telegramClientId: config.telegramClientId,
  yandexMetrikaId: config.yandexMetrikaId, gaId: config.gaId, environment: config.environment, release: config.release
})};\n`);

/* ---------- PWA ---------- */
await writeFile(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: `${SITE_JSON.name} — ${SITE_JSON.tagline}`, short_name: SITE_JSON.name, description: SITE_JSON.description,
  lang: 'ru', dir: 'ltr', start_url: './dashboard/', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#0F172A', theme_color: '#0F172A', categories: ['health', 'productivity', 'lifestyle'],
  icons: [
    { src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'assets/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ],
  shortcuts: [
    { name: 'Кабинет', url: './dashboard/' }, { name: 'Каталог', url: './challenges/' }
  ]
}, null, 2));
const jsFiles = [];
async function walk(dir, rel = '') { for (const e of await readdir(dir, { withFileTypes: true })) { const r = rel + e.name; e.isDirectory() ? await walk(path.join(dir, e.name), r + '/') : jsFiles.push(r); } }
await walk(path.join(OUT, 'assets/js'));
const precache = ['offline/index.html', 'uz/offline/index.html', 'en/offline/index.html', 'dashboard/index.html', 'assets/css/styles.css', 'assets/favicon.svg', 'assets/icons/icon-192.png', ...jsFiles.map(f => 'assets/js/' + f)];
const sw = (await readFile(path.join(ROOT, 'src/sw.js'), 'utf8')).replace('__VERSION__', config.release).replace('__PRECACHE__', JSON.stringify(precache));
await writeFile(path.join(OUT, 'sw.js'), sw);

/* ---------- SEO ---------- */
const publicPages = rendered.filter(r => r.lang === 'ru' && !r.page.noindex);
const url = (l, p) => `${config.siteUrl}/${I18N.langPrefix(l)}${p.replace(/^\//, '')}`;
await writeFile(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${publicPages.flatMap(({ page }) => I18N.LANGS.map(l => `  <url><loc>${url(l, page.path)}</loc><lastmod>${today}</lastmod>${I18N.LANGS.map(a => `<xhtml:link rel="alternate" hreflang="${a}" href="${url(a, page.path)}"/>`).join('')}<priority>${page.path === '/' ? '1.0' : page.kind === 'challenge' ? '0.8' : '0.6'}</priority></url>`)).join('\n')}
</urlset>
`);
const disallow = ['/dashboard/', '/login/', '/signup/', '/forgot-password/', '/reset-password/', '/auth/', '/admin/', '/create/', '/join/', '/u/', '/c/', '/certificate/', '/pay/', '/offline/'];
await writeFile(path.join(OUT, 'robots.txt'), config.environment === 'staging' ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n${I18N.LANGS.flatMap(l => disallow.map(d => `Disallow: /${I18N.langPrefix(l)}${d.slice(1)}`)).join('\n')}\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);

/* ---------- Каталог для базы (первичное наполнение) ---------- */
if (!args.artifact) {
  const s = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
  await writeFile(path.join(ROOT, 'supabase/seed.sql'), `-- Первичное наполнение каталога из content/challenges.json (сгенерировано scripts/build.mjs).
-- Дальше каталог редактируется в админ-панели; повторный запуск обновит тексты официальных челленджей.
insert into public.challenges (slug, title, category, level, days, icon, next_start, proof, price_uzs, content) values
${JSON.parse(await readFile(path.join(ROOT, 'content/challenges.json'), 'utf8')).map(c => `  (${s(c.slug)}, ${s(c.content.ru.title)}, ${s(c.category)}, ${s(c.level)}, ${c.days}, ${s(c.icon)}, ${c.nextStart ? s(c.nextStart) + '::date' : 'null'}, ${s(c.proof || 'none')}, ${c.priceUzs || 0}, ${s(JSON.stringify(c.content))}::jsonb)`).join(',\n')}
on conflict (slug) do update set title = excluded.title, category = excluded.category, level = excluded.level, days = excluded.days,
  icon = excluded.icon, next_start = excluded.next_start, proof = excluded.proof, price_uzs = excluded.price_uzs, content = excluded.content, updated_at = now();
`);
}

/* ---------- Превью-артефакт: главная без собственного каркаса документа ---------- */
if (args.artifact) {
  const file = path.join(OUT, 'index.html');
  const html = await readFile(file, 'utf8');
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, '');
  const bodyM = /<body([^>]*)>([\s\S]*)<\/body>/.exec(html);
  const attrs = [...bodyM[1].matchAll(/(data-[a-z-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]);
  await writeFile(file, `${head}\n<script>document.documentElement.lang='ru';${attrs.map(([k, v]) => `document.body.setAttribute(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}</script>\n${bodyM[2]}`);
}

console.log(`✓ Собрано ${rendered.length + 1} страниц (${I18N.LANGS.join('/')}) в ${path.relative(ROOT, OUT) || '.'}/ · режим: ${supabaseUrl ? 'Supabase' : 'демо'} · релиз ${config.release}${EXPLICIT ? ' · явные ссылки' : ''}`);
