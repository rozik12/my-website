/* Мониторинг ошибок клиента.
   1) Пишет ошибки в таблицу error_logs (Supabase) — видно в Table Editor.
   2) Если задан SENTRY_DSN — отправляет событие в Sentry через Envelope API (без SDK).
   Дедупликация и лимит: не больше 10 отчетов за сессию, одинаковые ошибки — один раз. */
import { api, config } from './api/index.js';

const seen = new Set();
let sent = 0;
const LIMIT = 10;

function parseDsn(dsn) {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn || '');
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}

function uuid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 32);
}

function toSentry(err, ctx, dsn) {
  const id = uuid();
  const event = {
    event_id: id, timestamp: Date.now() / 1000, platform: 'javascript', level: 'error',
    release: config.release, environment: config.environment || 'production',
    request: { url: location.href, headers: { 'User-Agent': navigator.userAgent } },
    user: api.auth.user ? { id: api.auth.user.id } : undefined,
    tags: { page: document.body?.dataset.page, backend: api.kind },
    exception: { values: [{ type: err.name || 'Error', value: String(err.message || err), stacktrace: undefined }] },
    extra: { ...ctx, stack: err.stack }
  };
  const body = [JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
  const url = `https://${dsn.host}/api/${dsn.project}/envelope/?sentry_key=${dsn.key}&sentry_version=7`;
  return fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true });
}

export function report(err, ctx = {}) {
  try {
    if (!err) return;
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
    const sig = (e.message + '|' + (e.stack || '').split('\n')[1]).slice(0, 300);
    if (seen.has(sig) || sent >= LIMIT) return;
    seen.add(sig); sent++;
    const payload = {
      message: String(e.message).slice(0, 2000),
      stack: String(e.stack || '').slice(0, 8000),
      url: location.href.slice(0, 1000),
      user_agent: navigator.userAgent.slice(0, 500),
      release: String(config.release || 'dev').slice(0, 60)
    };
    api.logError(payload).catch(() => {});
    const dsn = parseDsn(config.sentryDsn);
    if (dsn) toSentry(e, ctx, dsn).catch(() => {});
    if (config.environment !== 'production') console.error('[monitor]', e, ctx);
  } catch { /* мониторинг не должен ломать страницу */ }
}

export function installMonitor() {
  window.addEventListener('error', ev => {
    // Ошибки загрузки ресурсов (картинки, шрифты) не шлем — только исключения JS
    if (ev.error || ev.message) report(ev.error || new Error(ev.message), { source: ev.filename, line: ev.lineno, col: ev.colno });
  });
  window.addEventListener('unhandledrejection', ev => {
    const r = ev.reason;
    // Сетевые ошибки и ожидаемые ответы API не являются багами
    if (r && r.name === 'ApiError' && (r.code === 'network' || (r.status >= 400 && r.status < 500))) return;
    report(r instanceof Error ? r : new Error('Unhandled rejection: ' + String(r)), { kind: 'unhandledrejection' });
  });
}
