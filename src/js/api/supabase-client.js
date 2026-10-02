/* Минимальный клиент Supabase (Auth + PostgREST) на fetch, без зависимостей.
   Покрывает: регистрацию с подтверждением почты, вход, выход, восстановление пароля,
   обновление сессии, запросы к таблицам и RPC. Сессия хранится в localStorage. */

const STORAGE_KEY = 'rb.auth.session';

export class ApiError extends Error {
  constructor(message, { status = 0, code = '' } = {}) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}

export function createSupabaseClient({ url, anonKey, fetchImpl = (...a) => fetch(...a), storage = safeStorage() }) {
  const base = url.replace(/\/$/, '');
  let session = read();
  let refreshing = null;
  const listeners = new Set();

  function read() { try { return JSON.parse(storage.getItem(STORAGE_KEY)) || null; } catch { return null; } }
  function write(s) {
    session = s;
    try { s ? storage.setItem(STORAGE_KEY, JSON.stringify(s)) : storage.removeItem(STORAGE_KEY); } catch { /* приватный режим */ }
    listeners.forEach(fn => fn(s));
  }
  function toSession(r) {
    if (!r || !r.access_token) return null;
    return { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (+r.expires_in || 3600), user: r.user || null };
  }

  async function request(path, { method = 'GET', body, query, token, headers = {} } = {}) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    let res;
    try {
      res = await fetchImpl(base + path + qs, {
        method,
        headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw new ApiError('Нет соединения с сервером. Проверьте интернет и попробуйте еще раз.', { code: 'network' });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const code = data?.error_code || data?.code || data?.error || '';
      const msg = data?.msg || data?.message || data?.error_description || data?.hint || `Ошибка ${res.status}`;
      throw new ApiError(msg, { status: res.status, code: String(code) });
    }
    return data;
  }

  async function validToken() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    if (!refreshing) {
      refreshing = request('/auth/v1/token', { method: 'POST', query: { grant_type: 'refresh_token' }, body: { refresh_token: session.refresh_token } })
        .then(r => { write(toSession(r)); return session.access_token; })
        .catch(e => { if (e.status === 400 || e.status === 401) write(null); throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  const auth = {
    get session() { return session; },
    get user() { return session?.user || null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async signUp({ email, password, name, redirectTo, captchaToken }) {
      const r = await request('/auth/v1/signup', {
        method: 'POST', query: redirectTo ? { redirect_to: redirectTo } : undefined,
        body: { email, password, data: { name }, ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}) }
      });
      const s = toSession(r);
      if (s) write(s);
      // Если включено подтверждение почты, сессии нет: пользователь должен перейти по ссылке из письма.
      // Supabase не раскрывает, существует ли адрес: при повторной регистрации приходит пользователь без identities.
      return { needsConfirmation: !s, user: r.user || r };
    },

    async signIn({ email, password, captchaToken }) {
      const r = await request('/auth/v1/token', {
        method: 'POST', query: { grant_type: 'password' },
        body: { email, password, ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}) }
      });
      write(toSession(r));
      return session.user;
    },

    async signOut() {
      const t = session?.access_token;
      write(null);
      if (t) { try { await request('/auth/v1/logout', { method: 'POST', token: t }); } catch { /* сессия уже недействительна */ } }
    },

    resendConfirmation({ email, redirectTo }) {
      return request('/auth/v1/resend', { method: 'POST', query: redirectTo ? { redirect_to: redirectTo } : undefined, body: { type: 'signup', email } });
    },

    resetPassword({ email, redirectTo, captchaToken }) {
      return request('/auth/v1/recover', {
        method: 'POST', query: redirectTo ? { redirect_to: redirectTo } : undefined,
        body: { email, ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}) }
      });
    },

    async updateUser(attrs) {
      const user = await request('/auth/v1/user', { method: 'PUT', token: await validToken(), body: attrs });
      if (session) write({ ...session, user });
      return user;
    },

    /** Адрес входа через OAuth-провайдера Supabase (Google и др.). Возврат — на redirectTo с токенами во фрагменте. */
    oauthUrl(provider, redirectTo) {
      return `${base}/auth/v1/authorize?${new URLSearchParams({ provider, redirect_to: redirectTo })}`;
    },

    /** Разбирает фрагмент ссылки из письма: #access_token=…&type=signup|recovery или #error=… */
    async fromUrlFragment(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      if (p.get('error') || p.get('error_code')) {
        throw new ApiError(p.get('error_description') || 'Ссылка недействительна', { code: p.get('error_code') || p.get('error') });
      }
      if (!p.get('access_token')) return null;
      const s = toSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in'), expires_at: +p.get('expires_at') || undefined });
      s.user = await request('/auth/v1/user', { token: s.access_token });
      write(s);
      return { type: p.get('type') || 'signup', user: s.user };
    }
  };

  async function authed() { return (await validToken().catch(() => null)) || undefined; }

  const db = {
    async select(table, query = {}) { return request(`/rest/v1/${table}`, { query, token: await authed() }); },
    async insert(table, row, { returning = false } = {}) {
      return request(`/rest/v1/${table}`, { method: 'POST', body: row, token: await authed(), headers: { Prefer: returning ? 'return=representation' : 'return=minimal' } });
    },
    async update(table, match, patch) {
      return request(`/rest/v1/${table}`, { method: 'PATCH', query: match, body: patch, token: await authed(), headers: { Prefer: 'return=representation' } });
    },
    async rpc(fn, args = {}) { return request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, token: await authed() }); }
  };

  const files = {
    /** Загрузка файла в бакет: POST /storage/v1/object/{bucket}/{path} */
    async upload(bucket, path, blob, contentType) {
      const token = await authed();
      let res;
      try {
        res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': contentType, 'x-upsert': 'true' }, body: blob
        });
      } catch { throw new ApiError('Нет соединения с сервером. Проверьте интернет и попробуйте еще раз.', { code: 'network' }); }
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(d.message || d.error || `Ошибка загрузки ${res.status}`, { status: res.status, code: d.error || '' }); }
      return path;
    },
    publicUrl: (bucket, path) => `${base}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`
  };

  /** Вызов Edge Function: POST /functions/v1/{name} */
  async function invoke(name, body) {
    return request(`/functions/v1/${name}`, { method: 'POST', body, token: await authed() });
  }

  return { auth, db, storage: files, invoke, base };
}

function safeStorage() {
  try { const k = '__rb_test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
  catch { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
}

/** Понятные сообщения для кодов ошибок Supabase Auth. */
export function humanAuthError(e) {
  const code = e?.code || '', msg = String(e?.message || '');
  const map = {
    invalid_credentials: 'Неверная почта или пароль.',
    email_not_confirmed: 'Почта еще не подтверждена. Откройте письмо со ссылкой или отправьте его повторно.',
    user_already_exists: 'Аккаунт с этой почтой уже есть. Войдите или восстановите пароль.',
    email_exists: 'Аккаунт с этой почтой уже есть. Войдите или восстановите пароль.',
    weak_password: 'Пароль слишком простой: нужно не меньше 8 символов, строчные и заглавные латинские буквы и цифра.',
    over_email_send_rate_limit: 'Слишком много писем за короткое время. Подождите минуту и попробуйте снова.',
    over_request_rate_limit: 'Слишком много попыток. Подождите немного и попробуйте снова.',
    otp_expired: 'Ссылка из письма устарела. Запросите новую.',
    captcha_failed: 'Проверка «я не робот» не пройдена. Попробуйте еще раз.',
    same_password: 'Новый пароль совпадает со старым.',
    signup_disabled: 'Регистрация временно закрыта.',
    network: msg
  };
  if (map[code]) return map[code];
  if (/invalid login credentials/i.test(msg)) return map.invalid_credentials;
  if (/email not confirmed/i.test(msg)) return map.email_not_confirmed;
  if (/already registered/i.test(msg)) return map.user_already_exists;
  if (/password/i.test(msg) && /(weak|short|at least|characters)/i.test(msg)) return map.weak_password;
  if (/rate limit/i.test(msg)) return map.over_request_rate_limit;
  return 'Что-то пошло не так. Попробуйте еще раз через минуту.';
}
