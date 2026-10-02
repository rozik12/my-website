import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient, humanAuthError, ApiError } from '../../src/js/api/supabase-client.js';

function memStorage() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; }
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    const r = routes[key];
    if (!r) return new Response(JSON.stringify({ msg: 'not found' }), { status: 404 });
    const [status, body] = typeof r === 'function' ? r(u, init) : r;
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  };
  return { impl, calls };
}
const session = (exp = Math.floor(Date.now() / 1000) + 3600) => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, expires_at: exp, user: { id: 'u1', email: 'a@b.co' } });

test('signUp с подтверждением почты: сессии нет, redirect_to передан', async () => {
  const f = fakeFetch({ 'POST /auth/v1/signup': [200, { id: 'u1', email: 'a@b.co' }] });
  const c = createSupabaseClient({ url: 'https://x.supabase.co', anonKey: 'ANON', fetchImpl: f.impl, storage: memStorage() });
  const r = await c.auth.signUp({ email: 'a@b.co', password: 'Demo1234', name: 'А', redirectTo: 'https://site/auth/callback/' });
  assert.equal(r.needsConfirmation, true);
  assert.equal(c.auth.user, null);
  assert.equal(new URL(f.calls[0].url).searchParams.get('redirect_to'), 'https://site/auth/callback/');
  assert.deepEqual(f.calls[0].body.data, { name: 'А' });
  assert.equal(f.calls[0].headers.apikey, 'ANON');
});

test('signIn сохраняет сессию и шлет токен в запросах к данным', async () => {
  const f = fakeFetch({
    'POST /auth/v1/token': [200, session()],
    'POST /rest/v1/rpc/check_in': [200, { day: 1 }]
  });
  const storage = memStorage();
  const c = createSupabaseClient({ url: 'https://x.supabase.co', anonKey: 'ANON', fetchImpl: f.impl, storage });
  await c.auth.signIn({ email: 'a@b.co', password: 'x' });
  assert.equal(c.auth.user.id, 'u1');
  assert.ok(storage.getItem('rb.auth.session'));
  await c.db.rpc('check_in', { p_slug: 'a' });
  assert.equal(f.calls[1].headers.Authorization, 'Bearer AT');
});

test('просроченный токен обновляется один раз даже при параллельных запросах', async () => {
  let refreshes = 0;
  const f = fakeFetch({
    'POST /auth/v1/token': (u) => { assert.equal(u.searchParams.get('grant_type'), 'refresh_token'); refreshes++; return [200, { ...session(), access_token: 'AT2' }]; },
    'GET /rest/v1/enrollments': [200, []]
  });
  const storage = memStorage();
  storage.setItem('rb.auth.session', JSON.stringify({ ...session(Math.floor(Date.now() / 1000) - 10) }));
  const c = createSupabaseClient({ url: 'https://x.supabase.co', anonKey: 'ANON', fetchImpl: f.impl, storage });
  await Promise.all([c.db.select('enrollments'), c.db.select('enrollments')]);
  assert.equal(refreshes, 1);
  assert.ok(f.calls.filter(x => x.url.includes('/rest/')).every(x => x.headers.Authorization === 'Bearer AT2'));
});

test('недействительный refresh-токен завершает сессию', async () => {
  const f = fakeFetch({ 'POST /auth/v1/token': [400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }], 'GET /rest/v1/profiles': [200, []] });
  const storage = memStorage();
  storage.setItem('rb.auth.session', JSON.stringify(session(1)));
  const c = createSupabaseClient({ url: 'https://x.supabase.co', anonKey: 'ANON', fetchImpl: f.impl, storage });
  await c.db.select('profiles');
  assert.equal(c.auth.session, null);
  assert.equal(storage.getItem('rb.auth.session'), null);
});

test('ссылка из письма: токены из фрагмента и ошибки', async () => {
  const f = fakeFetch({ 'GET /auth/v1/user': [200, { id: 'u9', email: 'n@b.co' }] });
  const c = createSupabaseClient({ url: 'https://x.supabase.co', anonKey: 'ANON', fetchImpl: f.impl, storage: memStorage() });
  const r = await c.auth.fromUrlFragment('#access_token=T&refresh_token=R&expires_in=3600&token_type=bearer&type=recovery');
  assert.equal(r.type, 'recovery');
  assert.equal(c.auth.user.id, 'u9');
  await assert.rejects(() => c.auth.fromUrlFragment('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'), e => e.code === 'otp_expired');
  assert.equal(await c.auth.fromUrlFragment(''), null);
});

test('ошибки сети и сервера', async () => {
  const c = createSupabaseClient({ url: 'https://x.supabase.co', anonKey: 'A', fetchImpl: () => Promise.reject(new TypeError('fail')), storage: memStorage() });
  await assert.rejects(() => c.db.rpc('x'), e => e instanceof ApiError && e.code === 'network');
  const f = fakeFetch({ 'POST /auth/v1/token': [400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }] });
  const c2 = createSupabaseClient({ url: 'https://x.supabase.co', anonKey: 'A', fetchImpl: f.impl, storage: memStorage() });
  await assert.rejects(() => c2.auth.signIn({ email: 'a', password: 'b' }), e => e.status === 400 && humanAuthError(e) === 'Неверная почта или пароль.');
});

test('humanAuthError: понятные сообщения', () => {
  assert.match(humanAuthError({ code: 'email_not_confirmed' }), /не подтверждена/);
  assert.match(humanAuthError({ message: 'Email rate limit exceeded' }), /попыток|писем/);
  assert.match(humanAuthError({ message: '???' }), /Что-то пошло не так/);
});
