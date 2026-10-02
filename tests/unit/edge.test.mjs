/* Тесты логики Edge Functions: подписи Payme/Click, JSON-RPC, адреса оплаты, проверка id_token Telegram. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { md5 } from '../../supabase/functions/_shared/md5.js';
import { handlePayme } from '../../supabase/functions/_shared/payme.js';
import { handleClick, clickSign } from '../../supabase/functions/_shared/click.js';
import { handlePayments, paymeCheckoutUrl, clickCheckoutUrl } from '../../supabase/functions/_shared/payments.js';
import { verifyIdToken, handleTelegram } from '../../supabase/functions/_shared/telegram.js';
import { handleRebuild } from '../../supabase/functions/_shared/rebuild.js';

const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', PAYME_KEY: 'secret-key', PAYME_MERCHANT_ID: 'm123',
  CLICK_SERVICE_ID: '777', CLICK_MERCHANT_ID: '555', CLICK_SECRET_KEY: 'click-secret', SITE_URL: 'https://rubikon.uz', TELEGRAM_CLIENT_ID: '12345', TELEGRAM_CLIENT_SECRET: 'tgsecret', DEPLOY_HOOK_URL: 'https://hook.example/build' };

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, ...init, body: init.body });
    for (const [pattern, handler] of Object.entries(routes)) if (url.includes(pattern)) { const [status, body] = await handler(url, init); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); }
    return new Response('{}', { status: 404 });
  };
  return { impl, calls };
}

test('md5 совпадает с эталоном', () => {
  for (const s of ['', 'abc', 'Рубикон', '12345777secret1149000.0002026-10-02 10:00:00', 'x'.repeat(200)]) assert.equal(md5(s), createHash('md5').update(s).digest('hex'));
});

test('Payme: авторизация, разбор JSON, неизвестный метод, проксирование в SQL', async () => {
  const f = fakeFetch({ '/rpc/payme_rpc': (u, i) => [200, { result: { allow: true }, echo: JSON.parse(i.body) }] });
  const mk = (body, auth = 'Basic ' + btoa('Paycom:secret-key')) => new Request('https://x/payme', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body });
  let r = await (await handlePayme(mk('{"id":1,"method":"CheckPerformTransaction","params":{}}', 'Basic ' + btoa('Paycom:wrong')), ENV, { fetchImpl: f.impl })).json();
  assert.equal(r.error.code, -32504);
  r = await (await handlePayme(mk('{oops'), ENV, { fetchImpl: f.impl })).json();
  assert.equal(r.error.code, -32700);
  r = await (await handlePayme(mk('{"id":2,"method":"Hack","params":{}}'), ENV, { fetchImpl: f.impl })).json();
  assert.equal(r.error.code, -32601);
  r = await (await handlePayme(mk('{"id":3,"method":"CheckPerformTransaction","params":{"amount":100,"account":{"order_id":"5"}}}'), ENV, { fetchImpl: f.impl })).json();
  assert.equal(r.id, 3);
  assert.deepEqual(r.result, { allow: true });
  assert.equal(f.calls[0].headers.Authorization, 'Bearer service', 'SQL вызывается с ключом service_role');
  assert.deepEqual(JSON.parse(f.calls[0].body), { p_method: 'CheckPerformTransaction', p_params: { amount: 100, account: { order_id: '5' } } });
});

test('Click: подпись, обязательные поля, prepare и complete', async () => {
  const f = fakeFetch({ '/rpc/click_prepare': () => [200, { error: 0, error_note: 'Success', merchant_prepare_id: 9 }], '/rpc/click_complete': () => [200, { error: 0, error_note: 'Success', merchant_confirm_id: 9 }] });
  const base = { click_trans_id: '1001', service_id: '777', click_paydoc_id: '1', merchant_trans_id: '42', amount: '149000.00', action: '0', error: '0', error_note: 'ok', sign_time: '2026-10-02 10:00:00' };
  const send = p => handleClick(new Request('https://x/click', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p).toString() }), ENV, { fetchImpl: f.impl }).then(r => r.json());
  const sign = createHash('md5').update(`1001777click-secret42149000.0002026-10-02 10:00:00`).digest('hex');
  assert.equal(clickSign(base, 'click-secret'), sign);
  assert.equal((await send({ ...base, sign_string: 'bad' })).error, -1);
  assert.equal((await send({ ...base, sign_string: sign, amount: '' })).error, -8);
  assert.equal((await send({ ...base, action: '5', sign_string: sign })).error, -3);
  const prep = await send({ ...base, sign_string: sign });
  assert.deepEqual(prep, { click_trans_id: '1001', merchant_trans_id: '42', merchant_prepare_id: 9, error: 0, error_note: 'Success' });
  const comp = { ...base, action: '1', merchant_prepare_id: '9' };
  comp.sign_string = createHash('md5').update(`1001777click-secret429149000.0012026-10-02 10:00:00`).digest('hex');
  const r = await send(comp);
  assert.equal(r.error, 0); assert.equal(r.merchant_confirm_id, 9);
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { p_click_trans_id: 1001, p_order: '42', p_prepare_id: 9, p_amount: 149000, p_click_error: 0 });
});

test('Адреса оплаты Payme и Click', () => {
  const u = paymeCheckoutUrl({ merchantId: 'm1', orderId: 7, amountUzs: 149000, returnUrl: 'https://s/pay/?order=a' });
  assert.equal(atob(u.split('/').pop()), 'm=m1;ac.order_id=7;a=14900000;c=https://s/pay/?order=a');
  assert.ok(paymeCheckoutUrl({ merchantId: 'm', orderId: 1, amountUzs: 1, returnUrl: '', test: true }).startsWith('https://checkout.test.paycom.uz/'));
  const c = new URL(clickCheckoutUrl({ serviceId: '777', merchantId: '555', orderId: 7, amountUzs: 149000, returnUrl: 'https://s/pay/' }));
  assert.equal(c.searchParams.get('transaction_param'), '7');
  assert.equal(c.searchParams.get('amount'), '149000');
});

test('payments: требует вход, создает заказ от имени пользователя', async () => {
  const f = fakeFetch({ '/rpc/create_order': () => [200, { order_id: 11, public_id: 'pub-1', amount_uzs: 49000, provider: 'click' }] });
  const anon = await handlePayments(new Request('https://x', { method: 'POST', body: '{}' }), ENV, { fetchImpl: f.impl });
  assert.equal(anon.status, 401);
  const r = await (await handlePayments(new Request('https://x', { method: 'POST', headers: { authorization: 'Bearer USERJWT' }, body: JSON.stringify({ slug: 'english-15', provider: 'click' }) }), ENV, { fetchImpl: f.impl })).json();
  assert.equal(r.order, 'pub-1');
  assert.match(r.url, /^https:\/\/my\.click\.uz\/services\/pay\?/);
  assert.equal(f.calls[0].headers.Authorization, 'Bearer USERJWT');
  assert.equal(f.calls[0].headers.apikey, 'anon');
});

async function makeToken(claims, alg = 'RS256') {
  const params = alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' };
  const kp = await webcrypto.subtle.generateKey(params, true, ['sign', 'verify']);
  const jwk = { ...(await webcrypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg };
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg, kid: 'k1', typ: 'JWT' })}.${enc(claims)}`;
  const sig = await webcrypto.subtle.sign(alg === 'RS256' ? 'RSASSA-PKCS1-v1_5' : { name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(data));
  return { token: `${data}.${Buffer.from(sig).toString('base64url')}`, jwks: { keys: [jwk] } };
}

test('Telegram: проверка id_token (RS256 и ES256), издатель, аудитория, срок', async () => {
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://oauth.telegram.org', aud: '12345', sub: '777', name: 'Иван', iat: now, exp: now + 300 };
  for (const alg of ['RS256', 'ES256']) {
    const { token, jwks } = await makeToken(good, alg);
    assert.equal((await verifyIdToken(token, jwks, '12345')).sub, '777');
    await assert.rejects(() => verifyIdToken(token, jwks, '99999'), /другому приложению/);
    const tampered = token.split('.'); tampered[1] = Buffer.from(JSON.stringify({ ...good, sub: '1' })).toString('base64url');
    await assert.rejects(() => verifyIdToken(tampered.join('.'), jwks, '12345'), /Подпись/);
  }
  const old = await makeToken({ ...good, exp: now - 3600 });
  await assert.rejects(() => verifyIdToken(old.token, old.jwks, '12345'), /истек/);
  const bad = await makeToken({ ...good, iss: 'https://evil' });
  await assert.rejects(() => verifyIdToken(bad.token, bad.jwks, '12345'), /издатель/);
});

test('Telegram: обмен кода → пользователь → одноразовая ссылка входа', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { token, jwks } = await makeToken({ iss: 'https://oauth.telegram.org', aud: '12345', sub: '42', name: 'Аня', preferred_username: 'anya', iat: now, exp: now + 300 });
  const f = fakeFetch({
    'oauth.telegram.org/token': (u, i) => { assert.equal(i.headers.Authorization, 'Basic ' + btoa('12345:tgsecret')); assert.match(i.body, /code_verifier=v1/); return [200, { id_token: token }]; },
    'jwks.json': () => [200, jwks],
    '/auth/v1/admin/users': () => [422, { msg: 'exists' }],
    '/auth/v1/admin/generate_link': (u, i) => { assert.equal(JSON.parse(i.body).email, 'tg42@rubikon.uz'); return [200, { action_link: 'https://p.supabase.co/auth/v1/verify?token=x' }]; }
  });
  const req = body => new Request('https://x', { method: 'POST', body: JSON.stringify(body) });
  const bad = await handleTelegram(req({ code: 'c', code_verifier: 'v1', redirect_uri: 'https://evil/auth/telegram/' }), ENV, { fetchImpl: f.impl });
  assert.equal(bad.status, 400, 'чужой redirect_uri отклоняется');
  const r = await (await handleTelegram(req({ code: 'c', code_verifier: 'v1', redirect_uri: 'https://rubikon.uz/auth/telegram/' }), ENV, { fetchImpl: f.impl })).json();
  assert.equal(r.action_link, 'https://p.supabase.co/auth/v1/verify?token=x');
});

test('rebuild-site: только администратор', async () => {
  const mk = admin => fakeFetch({ '/rpc/is_admin': () => [200, admin], 'hook.example': () => [200, {}] });
  const req = () => new Request('https://x', { method: 'POST', headers: { authorization: 'Bearer U' } });
  assert.equal((await handleRebuild(req(), ENV, { fetchImpl: mk(false).impl })).status, 403);
  const f = mk(true);
  assert.equal((await handleRebuild(req(), ENV, { fetchImpl: f.impl })).status, 200);
  assert.ok(f.calls.some(c => c.url === ENV.DEPLOY_HOOK_URL));
});
