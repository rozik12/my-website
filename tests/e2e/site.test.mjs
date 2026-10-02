/* Сквозные тесты в настоящем браузере (Playwright + node:test).
   Сайт собирается в .e2e-dist в демо-режиме (без Supabase) — сценарии проходят полностью в браузере.
   Запуск: npm run test:e2e */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

const DIST = path.resolve('.e2e-dist');
const PORT = 4190;
const BASE = `http://localhost:${PORT}`;
const CHALLENGES = JSON.parse(await readFile('content/challenges.json', 'utf8'));
const PUBLIC = ['/', '/challenges/', ...CHALLENGES.map(c => `/challenges/${c.slug}/`), '/privacy/', '/terms/'];
const PRIVATE = ['/login/', '/signup/', '/forgot-password/', '/reset-password/', '/auth/callback/', '/dashboard/'];

let server, browser;
before(async () => {
  server = await startServer(DIST, PORT);
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** Новая чистая сессия; собирает ошибки JS и консоли (кроме недоступных внешних шрифтов). */
async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ru-RU', ...opts });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  // Переход и ожидание инициализации скриптов страницы
  p.open = async url => { await p.goto(BASE + url); await p.waitForSelector('html.js-ready'); };
  p.ready = () => p.waitForSelector('html.js-ready');
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|404 \(Not Found\)/.test(m.text())) p.errors.push(m.text()); });
  return p;
}
const settle = p => p.waitForLoadState('networkidle').then(() => p.waitForTimeout(250));

test('страницы открываются без ошибок и без горизонтальной прокрутки', async () => {
  for (const vp of [{ width: 1280, height: 860 }, { width: 375, height: 740 }]) {
    const p = await page({ viewport: vp });
    for (const url of [...PUBLIC, ...PRIVATE]) {
      await p.open(url); await settle(p);
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= vp.width, `${url} шире экрана ${vp.width}px: ${w}px`);
    }
    assert.deepEqual(p.errors, [], `ошибки на ширине ${vp.width}`);
    await p.context().close();
  }
});

test('SEO: метаданные, разметка и карта сайта', async () => {
  const p = await page();
  for (const url of PUBLIC) {
    await p.open(url);
    const m = await p.evaluate(() => ({
      title: document.title,
      desc: document.querySelector('meta[name=description]')?.content || '',
      canonical: document.querySelector('link[rel=canonical]')?.href || '',
      h1: document.querySelectorAll('h1').length,
      og: document.querySelector('meta[property="og:title"]')?.content,
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent),
      robots: document.querySelector('meta[name=robots]')?.content || ''
    }));
    assert.ok(m.title.length >= 10 && m.title.length <= 90, `${url}: длина title ${m.title.length}`);
    assert.ok(m.desc.length >= 50, `${url}: короткий description`);
    assert.ok(m.canonical.endsWith(url), `${url}: canonical ${m.canonical}`);
    assert.equal(m.h1, 1, `${url}: должен быть ровно один h1`);
    assert.ok(m.og, `${url}: og:title`);
    assert.equal(m.robots, '', `${url}: публичная страница не должна быть noindex`);
    m.ld.forEach(j => assert.doesNotThrow(() => JSON.parse(j), `${url}: JSON-LD`));
  }
  // Контент челленджа есть в HTML без JavaScript — его видят поисковики
  const raw = await readFile(path.join(DIST, 'challenges', CHALLENGES[1].slug, 'index.html'), 'utf8');
  assert.ok(raw.includes(CHALLENGES[1].content.ru.goal.replace(/"/g, '&quot;')) && raw.includes(CHALLENGES[1].content.ru.phases[0].tasks[0]), 'цель и задания пререндерены');
  for (const url of PRIVATE) {
    await p.open(url);
    assert.match(await p.getAttribute('meta[name=robots]', 'content'), /noindex/, `${url}: закрытая страница должна быть noindex`);
  }
  const sitemap = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
  CHALLENGES.forEach(c => assert.ok(sitemap.includes(`/challenges/${c.slug}/</loc>`), `sitemap: ${c.slug}`));
  assert.ok(!sitemap.includes('/dashboard/'), 'кабинет не в карте сайта');
  assert.match(await readFile(path.join(DIST, 'robots.txt'), 'utf8'), /Disallow: \/dashboard\//);
  await p.context().close();
});

test('регистрация → подтверждение почты → вступление → чекин → кабинет', async () => {
  const p = await page();
  await p.open('/signup/');
  await p.fill('#name', 'Тест Тестов');
  await p.fill('#email', 'new.user@example.com');
  await p.fill('#password', 'простой');
  await p.check('#terms');
  await p.click('button[type=submit]');
  assert.match(await p.textContent('#auth-err'), /Пароль должен содержать/);
  await p.fill('#password', 'Strong123');
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Подтвердите почту');
  // Неподтвержденный аккаунт не может войти
  await p.open('/login/');
  await p.fill('#email', 'new.user@example.com'); await p.fill('#password', 'Strong123'); await p.click('button[type=submit]');
  await p.waitForSelector('#auth-err:not([hidden])');
  assert.match(await p.textContent('#auth-err'), /не подтверждена/);
  assert.equal(await p.isVisible('#resend'), true, 'предлагается отправить письмо повторно');
  await p.click('#resend');
  // «Письмо» → ссылка подтверждения
  await p.open('/auth/callback/');
  await p.waitForSelector('text=Готово, вы вошли');
  // Вступление и чекин
  await p.open('/challenges/deep-work/');
  await p.click('#join');
  await p.waitForSelector('#join-card >> text=Вы участвуете');
  await p.click('#join-card [data-checkin]');
  await p.click('.mood:nth-child(6)'); // «Отлично»
  await p.fill('#ci-note', 'Закрыл важную задачу');
  await p.click('#ci-form button[type=submit]');
  await p.waitForSelector('#toast >> text=День 1 засчитан');
  await p.waitForSelector('.day.is-done[data-day="1"]');
  assert.match(await p.textContent('.day[data-day="1"] .day-note'), /Закрыл важную задачу/);
  // Кабинет
  await p.open('/dashboard/');
  await p.waitForSelector('.tracker');
  assert.match(await p.textContent('#dash-head h1'), /Тест Тестов/);
  assert.match(await p.textContent('.plan'), /Все задания выполнены/);
  await p.open('/dashboard/activity/');
  await p.waitForSelector('.hm-cell.l1');
  assert.match(await p.textContent('.journal'), /Закрыл важную задачу/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('вход: ошибка неверного пароля, вход демо-аккаунтом, возврат на исходную страницу, выход', async () => {
  const p = await page();
  await p.open('/dashboard/achievements/');
  await p.waitForURL('**/login/'); await p.ready();
  assert.match(await p.textContent('#auth-reason'), /Войдите/);
  await p.fill('#email', 'demo@rubikon.app'); await p.fill('#password', 'wrong'); await p.click('button[type=submit]');
  await p.waitForSelector('#auth-err:not([hidden])');
  assert.match(await p.textContent('#auth-err'), /Неверная почта или пароль/);
  await p.fill('#password', 'Demo1234'); await p.click('button[type=submit]');
  await p.waitForURL('**/dashboard/achievements/');
  await p.waitForSelector('.badge.on');
  await p.click('[data-dd=user]');
  await p.click('[data-action=logout]');
  await p.waitForURL(BASE + '/');
  await p.waitForSelector('#user-zone >> text=Войти');
  await p.context().close();
});

test('восстановление пароля и вход с новым паролем', async () => {
  const p = await page();
  await p.open('/forgot-password/');
  await p.fill('#email', 'demo@rubikon.app'); await p.click('button[type=submit]');
  await p.waitForSelector('text=Проверьте почту');
  await p.click('.demo-mail a');
  await p.waitForURL('**/reset-password/'); await p.ready();
  await p.fill('#password', 'NewPass99'); await p.fill('#password2', 'NewPass98'); await p.click('button[type=submit]');
  assert.match(await p.textContent('#auth-err'), /не совпадают/);
  await p.fill('#password2', 'NewPass99'); await p.click('button[type=submit]');
  await p.waitForURL('**/dashboard/');
  await p.click('[data-dd=user]'); await p.click('[data-action=logout]'); await p.waitForURL(BASE + '/');
  await p.open('/login/');
  await p.fill('#email', 'demo@rubikon.app'); await p.fill('#password', 'NewPass99'); await p.click('button[type=submit]');
  await p.waitForURL('**/dashboard/');
  await p.context().close();
});

test('каталог: фильтры, поиск, пустой результат и сброс', async () => {
  const p = await page();
  await p.open('/challenges/'); await settle(p);
  const visible = () => p.$$eval('#list .ch-card', els => els.filter(e => !e.hidden).length);
  assert.equal(await visible(), 9, 'первая страница — 9 карточек');
  await p.click('[data-filter=cat] [data-v=sport]');
  assert.equal(await visible(), CHALLENGES.filter(c => c.category === 'sport').length);
  await p.click('[data-filter=level] [data-v=hard]');
  assert.equal(await visible(), CHALLENGES.filter(c => c.category === 'sport' && c.level === 'hard').length);
  await p.fill('#q', 'несуществующее');
  await p.waitForSelector('#empty:not([hidden])');
  await p.click('#reset-empty');
  assert.equal(await visible(), 9);
  while (await p.isVisible('#more')) await p.click('#more');
  assert.equal(await visible(), CHALLENGES.length);
  // Переход из плитки направления сразу фильтрует каталог
  await p.open('/challenges/?cat=business'); await settle(p);
  assert.equal(await visible(), CHALLENGES.filter(c => c.category === 'business').length);
  await p.context().close();
});

test('мониторинг: необработанная ошибка попадает в журнал, повтор не дублируется', async () => {
  const p = await page();
  await p.open('/'); await settle(p);
  p.errors = [];
  await p.evaluate(() => { for (let i = 0; i < 3; i++) setTimeout(() => { throw new Error('e2e-boom'); }); });
  await p.waitForTimeout(300);
  const logged = await p.evaluate(() => JSON.parse(localStorage.getItem('rb.mock.db.v2')).errors.filter(e => e.message === 'e2e-boom'));
  assert.equal(logged.length, 1);
  assert.ok(logged[0].url.startsWith(BASE) && logged[0].release, 'в отчете есть адрес и версия');
  await p.context().close();
});

test('доступность: подписи полей, имена кнопок, язык, фокус в модальном окне', async () => {
  const p = await page();
  for (const url of ['/', '/challenges/', '/challenges/run-100/', '/signup/', '/login/']) {
    await p.open(url); await settle(p);
    const r = await p.evaluate(() => ({
      lang: document.documentElement.lang,
      unlabeled: [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(el => !(el.labels?.length || el.getAttribute('aria-label'))).map(el => el.id),
      nameless: [...document.querySelectorAll('button, a[href]')].filter(el => !(el.textContent.trim() || el.getAttribute('aria-label'))).map(el => el.outerHTML.slice(0, 80))
    }));
    assert.equal(r.lang, 'ru');
    assert.deepEqual(r.unlabeled, [], `${url}: поля без подписи`);
    assert.deepEqual(r.nameless, [], `${url}: кнопки и ссылки без имени`);
  }
  await p.open('/'); await settle(p);
  await p.keyboard.press('Control+k');
  await p.waitForSelector('#pal-q');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'pal-q', 'фокус переходит в поиск');
  await p.keyboard.type('бег');
  await p.keyboard.press('Enter');
  await p.waitForURL('**/challenges/run-100/');
  await p.context().close();
});
