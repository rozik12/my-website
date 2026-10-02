/* Общие помощники Edge Functions (работают в Deno и Node 20+, без зависимостей). */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers } });
export const fail = (message, status = 400) => json({ message }, status);

/** Клиент PostgREST/Auth с заданным ключом (service_role или токен пользователя). */
export function supa(env, { token, fetchImpl = fetch } = {}) {
  const url = env.SUPABASE_URL.replace(/\/$/, '');
  const key = token ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = token || env.SUPABASE_SERVICE_ROLE_KEY;
  const call = async (path, { method = 'POST', body } = {}) => {
    const res = await fetchImpl(url + path, { method, headers: { apikey: key, Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) { const e = new Error(data?.message || data?.msg || `HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
    return data;
  };
  return {
    rpc: (fn, args = {}) => call(`/rest/v1/rpc/${fn}`, { body: args }),
    user: () => call('/auth/v1/user', { method: 'GET' }),
    adminCreateUser: body => call('/auth/v1/admin/users', { body }),
    adminGenerateLink: body => call('/auth/v1/admin/generate_link', { body })
  };
}

export const bearer = req => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
export const b64 = s => btoa(unescape(encodeURIComponent(s)));
