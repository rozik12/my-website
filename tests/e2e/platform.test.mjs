/* Сквозные сценарии платформы v4: языки, потоки и чат, лента, свои челленджи по коду,
   оплата (демо), сертификат, админка, PWA. Сборка — .e2e-dist в демо-режиме. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

const DIST = path.resolve('.e2e-dist');
const PORT = 4192;
const BASE = `http://localhost:${PORT}`;
const DB = 'rb.mock.db.v2';
let server, browser;

before(async () => { server = await startServer(DIST, PORT); browser = await chromium.launch(); });
after(async () => { await browser?.close(); server?.close(); });

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|ERR_INTERNET_DISCONNECTED|404 \(Not Found\)/.test(m.text())) p.errors.push(m.text()); });
  p.open = async url => { await p.goto(BASE + url); await p.waitForSelector('html.js-ready'); };
  return p;
}
async function login(p, email = 'demo@rubikon.app', password = 'Demo1234') {
  await p.open('/login/');
  await p.fill('#email', email); await p.fill('#password', password); await p.click('button[type=submit]');
  await p.waitForURL(u => !u.pathname.startsWith('/login'));
  await p.waitForSelector('html.js-ready');
}
async function signup(p, name, email) {
  await p.open('/signup/');
  await p.fill('#name', name); await p.fill('#email', email); await p.fill('#password', 'Strong123'); await p.check('#terms');
  await p.click('button[type=submit]');
  await p.waitForSelector('.demo-mail a');
  await p.open('/auth/callback/');
  await p.waitForSelector('text=Готово, вы вошли');
}
const db = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), DB);
const CYR = /[А-Яа-яЁё]/;

test('языки: uz и en — переведенный интерфейс и контент, hreflang, переключатель', async () => {
  for (const [lang, word] of [['uz', 'Chellenjlar'], ['en', 'Challenges']]) {
    const raw = await readFile(path.join(DIST, lang, 'challenges', 'run-100', 'index.html'), 'utf8');
    assert.match(raw, new RegExp(`<html lang="${lang}"`));
    assert.match(raw, /hreflang="ru"/); assert.match(raw, /hreflang="uz"/); assert.match(raw, /hreflang="en"/);
    const p = await page();
    for (const url of [`/${lang}/`, `/${lang}/challenges/`, `/${lang}/challenges/run-100/`, `/${lang}/challenges/mvp-14/`]) {
      await p.open(url);
      await p.waitForLoadState('networkidle');
      const text = await p.evaluate(() => {
        // Пользовательский контент (имена, отзывы, лента) может быть на любом языке — исключаем его
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('blockquote, figcaption b, [lang], .feed, .post, .lb, .avatar, .ticker, script, svg').forEach(n => n.remove());
        return clone.innerText;
      });
      const bad = text.split('\n').filter(l => CYR.test(l));
      assert.deepEqual(bad, [], `${url}: кириллица в интерфейсе`);
    }
    await p.open(`/${lang}/`);
    assert.match(await p.textContent('nav'), new RegExp(word));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

test('поток: запись в общий старт, чат потока и рейтинг', async () => {
  const p = await page();
  await login(p);
  await p.open('/challenges/cold-shower/');
  await p.waitForSelector('#cohort-box:not([hidden])');
  await p.click('#cohort-box [data-open-tab]');
  await p.waitForSelector('#chat-log');
  await p.fill('#chat-input', 'Всем привет из e2e!');
  await p.click('#chat-form button[type=submit]');
  await p.waitForSelector('#chat-log >> text=Всем привет из e2e!');
  await p.click('#t-rating');
  await p.waitForSelector('#lb tr, #lb li');
  // Запись на будущий поток другого челленджа
  await p.open('/challenges/run-100/');
  await p.waitForSelector('input[name=cohort]');
  await p.click('#join');
  await p.waitForSelector('#join-card >> text=Вы в потоке');
  const e = (await db(p)).enrollments.find(x => x.slug === 'run-100' && x.cohortId);
  assert.ok(e, 'участие привязано к потоку');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('чекин с подтверждением, публикация в ленте, реакция и комментарий', async () => {
  const p = await page();
  await signup(p, 'Марина Лента', 'feed.user@example.com');
  await p.open('/challenges/pushups-100/');
  await p.click('#join');
  await p.waitForSelector('#join-card [data-checkin]');
  await p.click('#join-card [data-checkin]');
  await p.waitForSelector('#ci-form');
  await p.fill('#ci-link', 'https://example.com/workout');
  await p.check('#ci-share');
  await p.fill('#ci-post', 'Первые 40 отжиманий!');
  await p.click('#ci-form button[type=submit]');
  await p.waitForSelector('#toast >> text=День 1 засчитан');
  const k = (await db(p)).checkins.at(-1);
  assert.equal(k.proofUrl, 'https://example.com/workout');
  assert.ok(k.shared);
  // Лента челленджа
  await p.click('#t-feed');
  await p.waitForSelector('#feed-list >> text=Первые 40 отжиманий!');
  const btn = p.locator('#feed-list [data-react]').first();
  await btn.click();
  await p.waitForFunction(() => document.querySelector('#feed-list [data-react]')?.getAttribute('aria-pressed') === 'true');
  await p.locator('#feed-list [data-comments]').first().click();
  const input = p.locator('#feed-list .comment-form input').first();
  await input.fill('Так держать!');
  await input.press('Enter');
  await p.waitForSelector('#feed-list .comment >> text=Так держать!');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('свой закрытый челлендж: создание, вступление по коду, отчет организатора', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.open = async url => { await p.goto(BASE + url); await p.waitForSelector('html.js-ready'); };
  await login(p);
  await p.open('/create/');
  await p.fill('#f-title', 'Спринт отдела e2e');
  await p.fill('#f-short', 'Две недели ежедневной активности с отчетом.');
  await p.fill('#f-goal', 'Проверить, что командные челленджи работают от начала до конца.');
  await p.fill('#f-days', '14');
  await p.fill('#f-tasks', '10 звонков\nОтчет в CRM');
  await p.click('#create-form button[type=submit]');
  await p.waitForURL('**/c/?id=*'); await p.waitForSelector('html.js-ready');
  await p.waitForSelector('#organizer-box:not([hidden])');
  const custom = Object.values((await p.evaluate(k => JSON.parse(localStorage.getItem(k)), DB)).custom).find(c => Object.values(c.content)[0].title === 'Спринт отдела e2e');
  assert.ok(custom?.inviteCode?.length === 8, 'выдан код приглашения');
  // Выходим и регистрируем участника — тот же браузер, общая демо-база
  await p.click('[data-dd=user]'); await p.click('[data-action=logout]'); await p.waitForURL(BASE + '/');
  await signup(p, 'Коллега Тестов', 'colleague@example.com');
  await p.open('/join/');
  await p.fill('#code', custom.inviteCode.toLowerCase());
  await p.click('#join-form button[type=submit]');
  await p.waitForURL('**/c/?id=*'); await p.waitForSelector('html.js-ready');
  await p.waitForSelector('#join-card [data-checkin]');
  await p.click('#join-card [data-checkin]');
  await p.click('#ci-form button[type=submit]');
  await p.waitForSelector('#toast >> text=День 1 засчитан');
  // Организатор видит участника в отчете и выгружает CSV
  await p.click('[data-dd=user]'); await p.click('[data-action=logout]'); await p.waitForURL(BASE + '/');
  await login(p);
  await p.open(`/c/?id=${custom.slug}`);
  await p.waitForSelector('#organizer-box >> text=Коллега Тестов');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csv')]);
  const csv = await readFile(await dl.path(), 'utf8');
  assert.match(csv, /Коллега Тестов/);
  await ctx.close();
});

test('платный челлендж: оплата (демо) открывает доступ, сертификат за финиш', async () => {
  const p = await page();
  await signup(p, 'Платный Тест', 'payer@example.com');
  await p.open('/challenges/mvp-14/');
  await p.waitForSelector('#join-card [data-pay=payme]');
  assert.equal(await p.isVisible('#join'), false, 'без оплаты кнопки вступления нет');
  await p.click('#join-card [data-pay=payme]');
  await p.waitForURL('**/pay/?order=*');
  await p.waitForSelector('text=Оплата прошла');
  await p.open('/challenges/mvp-14/');
  await p.waitForSelector('#join');
  const order = (await db(p)).orders.at(-1);
  assert.equal(order.status, 'paid');
  // Сертификат демо-аккаунта за пройденный челлендж
  await p.click('[data-dd=user]'); await p.click('[data-action=logout]'); await p.waitForURL(BASE + '/');
  await login(p);
  const state = await db(p), me = state.users['demo@rubikon.app'].id;
  const done = state.enrollments.find(e => e.userId === me && e.slug === 'detox-7' && e.status === 'completed');
  await p.open(`/certificate/?id=${done.publicId}`);
  await p.waitForSelector('canvas');
  assert.match(await p.textContent('main'), /Подлинный сертификат/);
  assert.match(await p.title(), /Алексей Смирнов/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('админка: доступна только администратору, модерация и пользователи', async () => {
  const p = await page();
  await signup(p, 'Обычный Пользователь', 'plain@example.com');
  await p.open('/admin/');
  await p.waitForSelector('text=Нет доступа');
  await p.click('[data-dd=user]'); await p.click('[data-action=logout]'); await p.waitForURL(BASE + '/');
  await login(p);
  await p.open('/admin/');
  for (const sec of ['challenges', 'moderation', 'users', 'orders', 'errors', 'overview']) {
    await p.click(`[data-sec=${sec}]`);
    await p.waitForTimeout(150);
  }
  await p.click('[data-sec=users]');
  await p.waitForSelector('#u-list >> text=Обычный Пользователь');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('PWA: манифест, service worker и офлайн-страница', async () => {
  const manifest = JSON.parse(await readFile(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
  const p = await page();
  await p.open('/');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForSelector('html.js-ready');
  await p.context().setOffline(true);
  await p.goto(BASE + '/challenges/'); // предкэширован
  assert.match(await p.textContent('h1'), /Челленджи|Каталог/);
  await p.goto(BASE + '/privacy/'); // не открывался — офлайн-страница
  assert.match(await p.textContent('body'), /Нет подключения/);
  await p.context().setOffline(false);
  await p.context().close();
});
