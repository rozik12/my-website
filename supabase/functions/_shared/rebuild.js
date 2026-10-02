/* Пересборка сайта после правок каталога: только для администратора, вызывает Deploy Hook хостинга. */
import { supa, json, fail, bearer, CORS } from './core.js';

export async function handleRebuild(req, env, { fetchImpl = fetch } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = bearer(req);
  if (!token) return fail('Требуется вход', 401);
  const isAdmin = await supa(env, { token, fetchImpl }).rpc('is_admin').catch(() => false);
  if (isAdmin !== true) return fail('Нужны права администратора', 403);
  if (!env.DEPLOY_HOOK_URL) return fail('Не задан DEPLOY_HOOK_URL — пересоберите сайт вручную', 503);
  const r = await fetchImpl(env.DEPLOY_HOOK_URL, { method: 'POST' });
  return r.ok ? json({ ok: true }) : fail('Хостинг не принял запрос на сборку', 502);
}
