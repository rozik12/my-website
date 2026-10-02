/* Вход через Telegram (OpenID Connect): обмен кода на id_token, проверка подписи по JWKS,
   создание пользователя Supabase и выдача одноразовой ссылки входа (magic link). */
import { supa, json, fail, CORS } from './core.js';

const ISSUER = 'https://oauth.telegram.org';
const b64urlToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const decodePart = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

const ALGS = {
  RS256: { imp: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, ver: { name: 'RSASSA-PKCS1-v1_5' } },
  ES256: { imp: { name: 'ECDSA', namedCurve: 'P-256' }, ver: { name: 'ECDSA', hash: 'SHA-256' } },
  EdDSA: { imp: { name: 'Ed25519' }, ver: { name: 'Ed25519' } }
};

/** Проверяет id_token. jwks — { keys: [...] }. Возвращает полезную нагрузку или бросает ошибку. */
export async function verifyIdToken(idToken, jwks, clientId, now = Date.now() / 1000) {
  const [h, p, s] = String(idToken).split('.');
  if (!s) throw new Error('Неверный формат токена');
  const header = decodePart(h), payload = decodePart(p);
  const alg = ALGS[header.alg];
  if (!alg) throw new Error('Неподдерживаемый алгоритм подписи: ' + header.alg);
  const jwk = jwks.keys.find(k => k.kid === header.kid) || (jwks.keys.length === 1 ? jwks.keys[0] : null);
  if (!jwk) throw new Error('Ключ подписи не найден');
  const key = await crypto.subtle.importKey('jwk', jwk, alg.imp, false, ['verify']);
  const ok = await crypto.subtle.verify(alg.ver, key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('Подпись токена неверна');
  if (payload.iss !== ISSUER) throw new Error('Неверный издатель токена');
  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud)];
  if (!aud.includes(String(clientId))) throw new Error('Токен выдан другому приложению');
  if (!(payload.exp > now - 60)) throw new Error('Срок действия токена истек');
  return payload;
}

export async function handleTelegram(req, env, { fetchImpl = fetch } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body; try { body = await req.json(); } catch { return fail('Неверный запрос'); }
  const site = (env.SITE_URL || '').replace(/\/$/, '');
  if (!env.TELEGRAM_CLIENT_ID || !env.TELEGRAM_CLIENT_SECRET) return fail('Вход через Telegram не настроен', 503);
  if (body?.redirect_uri !== `${site}/auth/telegram/`) return fail('Неверный адрес возврата');
  if (!body?.code || !body?.code_verifier) return fail('Нет кода авторизации');

  const tokenRes = await fetchImpl(`${ISSUER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(`${env.TELEGRAM_CLIENT_ID}:${env.TELEGRAM_CLIENT_SECRET}`) },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: body.code, redirect_uri: body.redirect_uri, code_verifier: body.code_verifier }).toString()
  });
  if (!tokenRes.ok) return fail('Telegram отклонил код авторизации. Попробуйте войти еще раз.', 401);
  const tokens = await tokenRes.json();
  let claims;
  try {
    const jwks = await (await fetchImpl(`${ISSUER}/.well-known/jwks.json`)).json();
    claims = await verifyIdToken(tokens.id_token, jwks, env.TELEGRAM_CLIENT_ID);
  } catch (e) { return fail('Не удалось проверить вход через Telegram: ' + e.message, 401); }

  const email = `tg${claims.sub}@${new URL(site).hostname}`;
  const db = supa(env, { fetchImpl });
  try {
    await db.adminCreateUser({ email, email_confirm: true, user_metadata: { name: claims.name || claims.preferred_username || 'Telegram', telegram_id: claims.sub, telegram_username: claims.preferred_username || null, provider: 'telegram' } });
  } catch (e) { if (e.status !== 422 && e.status !== 400) return fail('Не удалось создать аккаунт', 500); } // уже существует — входим
  try {
    const link = await db.adminGenerateLink({ type: 'magiclink', email, redirect_to: body.redirect_to || `${site}/auth/callback/` });
    const action = link.action_link || link.properties?.action_link;
    if (!action) throw new Error('no link');
    return json({ action_link: action });
  } catch { return fail('Не удалось выполнить вход', 500); }
}
