/* Продакшен-сборка с Supabase: браузерный клиент работает с API Supabase.
   Сеть перехватывается фейковым Supabase в памяти — проверяются формат запросов, заголовки,
   работа с сессией и что Content-Security-Policy пропускает запросы к Supabase. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

const DIST = path.resolve('.e2e-prod');
const PORT = 4191;
const BASE = `http://localhost:${PORT}`;
const SB = 'https://fake-project.supabase.co';
let server, browser;

before(async () => { server = await startServer(DIST, PORT); browser = await chromium.launch(); });
after(async () => { await browser?.close(); server?.close(); });

function fakeSupabase() {
  const today = new Date().toLocaleDateString('en-CA');
  const state = {
    calls: [],
    profile: { id: 'u1', display_name: 'Ирина', city: '', timezone: 'UTC', public_profile: true },
    enrollments: [{ id: 1, challenge_slug: 'deep-work', start_date: today, status: 'active', completed_at: null, checkins: [] }]
  };
  const user = { id: 'u1', email: 'irina@example.com', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: { name: 'Ирина' } };
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  state.handler = async route => {
    const req = route.request(), url = new URL(req.url()), key = `${req.method()} ${url.pathname}`;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    state.calls.push({ key, body, auth: req.headers().authorization, apikey: req.headers().apikey, query: Object.fromEntries(url.searchParams) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const cors = { 'access-control-allow-origin': '*' };
    const send = r => route.fulfill({ ...r, headers: cors });
    switch (key) {
      case 'POST /auth/v1/token':
        if (body.password !== 'Secret123') return send(json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400));
        return send(json({ access_token: 'JWT-1', refresh_token: 'R-1', expires_in: 3600, token_type: 'bearer', user }));
      case 'GET /auth/v1/user': return send(json(user));
      case 'POST /auth/v1/logout': return send({ status: 204 });
      case 'GET /rest/v1/profiles': return send(json([state.profile]));
      case 'PATCH /rest/v1/profiles': Object.assign(state.profile, body); return send(json([state.profile]));
      case 'GET /rest/v1/enrollments': return send(json(state.enrollments));
      case 'GET /rest/v1/testimonials': return send(json([{ author_name: 'Олег', challenge_slug: 'read-20', text: 'Прочитал три книги за месяц, впервые за несколько лет.' }]));
      case 'POST /rest/v1/error_logs': return send({ status: 201 });
      case 'POST /rest/v1/rpc/challenge_stats': return send(json([{ slug: 'deep-work', participants: 42, avg_progress: 61, finish_rate: 70, active_today: 9 }]));
      case 'POST /rest/v1/rpc/platform_stats': return send(json({ participants: 42, checkins_24h: 17, completed: 12, finish_rate: 70 }));
      case 'POST /rest/v1/rpc/recent_activity': return send(json([]));
      case 'POST /rest/v1/rpc/leaderboard': return send(json([{ rank: 1, display_name: 'Ирина', done: 0, streak: 0, pct: 0, is_me: true }]));
      case 'POST /rest/v1/rpc/check_in':
        state.enrollments[0].checkins.push({ day_number: 1, checkin_date: today, mood: body.p_mood, note: body.p_note });
        return send(json({ day: 1, done: 1, streak: 1, completed: false }));
      case 'POST /rest/v1/rpc/cohorts_for': return send(json([]));
      case 'POST /rest/v1/rpc/is_admin': return send(json(false));
      default: state.unexpected = [...(state.unexpected || []), key]; return send(json({ message: 'unexpected ' + key }, 500));
    }
  };
  return state;
}

test('вход, кабинет и чекин через API Supabase; CSP не блокирует запросы', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const sb = fakeSupabase();
  await ctx.route(SB + '/**', sb.handler);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED/.test(m.text())) errors.push(m.text()); });

  await p.goto(BASE + '/'); await p.waitForSelector('html.js-ready');
  assert.equal(await p.isHidden('#demo-bar'), true, 'в продакшене нет демо-плашки');
  await p.waitForFunction(() => document.querySelector('[data-pstat="participants"]').textContent.trim() === '42');
  await p.waitForSelector('#reviews:not([hidden]) >> text=Прочитал три книги');

  await p.goto(BASE + '/login/'); await p.waitForSelector('html.js-ready');
  await p.fill('#email', 'irina@example.com'); await p.fill('#password', 'nope'); await p.click('button[type=submit]');
  await p.waitForSelector('#auth-err:not([hidden])');
  assert.match(await p.textContent('#auth-err'), /Неверная почта или пароль/);
  await p.fill('#password', 'Secret123'); await p.click('button[type=submit]');
  await p.waitForURL('**/dashboard/');
  await p.waitForSelector('.tracker');
  assert.match(await p.textContent('#dash-head h1'), /Ирина/);

  await p.goto(BASE + '/challenges/deep-work/'); await p.waitForSelector('html.js-ready');
  await p.waitForSelector('#join-card >> text=Вы участвуете');
  assert.equal((await p.textContent('#fact-participants')).trim(), '42');
  await p.click('#join-card [data-checkin]');
  await p.fill('#ci-note', 'Два часа без отвлечений');
  await p.click('#ci-form button[type=submit]');
  await p.waitForSelector('.day.is-done[data-day="1"]');

  const ci = sb.calls.find(c => c.key === 'POST /rest/v1/rpc/check_in');
  assert.deepEqual(ci.body, { p_slug: 'deep-work', p_mood: 4, p_note: 'Два часа без отвлечений', p_share: false, p_post: null, p_proof_url: null, p_photo_path: null });
  assert.equal(ci.auth, 'Bearer JWT-1', 'запрос с токеном пользователя');
  assert.ok(sb.calls.every(c => c.apikey), 'каждый запрос с apikey');
  assert.ok(sb.calls.some(c => c.key === 'PATCH /rest/v1/profiles' && c.body.timezone), 'часовой пояс браузера сохраняется в профиле');
  const signIn = sb.calls.find(c => c.key === 'POST /auth/v1/token');
  assert.equal(signIn.query.grant_type, 'password');
  assert.deepEqual(errors.filter(e => !/400/.test(e)), [], 'нет ошибок JS и нарушений CSP');
  await ctx.close();
});

test('регистрация отправляет ссылку подтверждения на страницу сайта', async () => {
  const ctx = await browser.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  let signup;
  await ctx.route(SB + '/**', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/auth/v1/signup') { signup = { query: Object.fromEntries(u.searchParams), body: JSON.parse(r.request().postData()) }; return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'u2', email: 'x@example.com' }) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
  });
  const p = await ctx.newPage();
  await p.goto(BASE + '/signup/'); await p.waitForSelector('html.js-ready');
  await p.fill('#name', 'Сергей'); await p.fill('#email', 'x@example.com'); await p.fill('#password', 'Strong123'); await p.check('#terms');
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Подтвердите почту');
  assert.equal(signup.query.redirect_to, 'https://rubikon.example.com/auth/callback/');
  assert.deepEqual(signup.body.data, { name: 'Сергей' });
  assert.equal(await p.isVisible('.demo-mail'), false, 'в продакшене нет демо-письма');
  await ctx.close();
});
