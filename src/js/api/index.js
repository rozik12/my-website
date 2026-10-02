/* Выбор бэкенда (Supabase или демо) и офлайн-очередь отметок. */
import { createSupabaseBackend } from './supabase-backend.js';
import { createMockBackend } from './mock-backend.js';
import { isoInTz } from '../lib/logic.js';

export const config = Object.freeze({ ...(globalThis.RB_CONFIG || {}) });

function pick() {
  if (config.supabaseUrl && config.supabaseAnonKey) {
    const root = document.body?.dataset.root || '';
    const authRedirect = config.siteUrl ? config.siteUrl.replace(/\/$/, '') + '/auth/callback/' : new URL(root + 'auth/callback/', location.href).href;
    return createSupabaseBackend({ ...config, authRedirect });
  }
  return createMockBackend();
}

const backend = pick();
export const isDemo = backend.kind === 'mock';

/* ---------- Офлайн-очередь отметок ----------
   Если сети нет, отметка сохраняется на устройстве и отправляется при подключении.
   Отметка засчитывается только за тот же день: сервер считает день сам, поэтому вчерашние из очереди не отправляются. */
const QKEY = 'rb.offline.queue';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch { return []; } };
const writeQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* */ } };
const isNetworkError = e => e && (e.code === 'network' || e.name === 'TypeError');

const realCheckIn = backend.checkIn.bind(backend);
backend.checkIn = async (slug, data) => {
  const queue = () => {
    if (data.photo) throw Object.assign(new Error('Фото можно отправить только при подключении к интернету'), { status: 0 });
    writeQ([...readQ().filter(x => x.slug !== slug), { slug, data, date: isoInTz(new Date()) }]);
    return { queued: true, day: null, done: null, streak: null, completed: false };
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return queue();
  try { return await realCheckIn(slug, data); }
  catch (e) { if (isNetworkError(e)) return queue(); throw e; }
};

/** Отправляет отложенные отметки. Возвращает { sent, dropped }. */
export async function flushQueue() {
  const q = readQ();
  if (!q.length || !backend.auth.user) return { sent: 0, dropped: 0 };
  const today = isoInTz(new Date());
  let sent = 0, dropped = 0;
  const rest = [];
  for (const item of q) {
    if (item.date !== today) { dropped++; continue; }
    try { await realCheckIn(item.slug, item.data); sent++; }
    catch (e) { if (isNetworkError(e)) rest.push(item); else dropped++; }
  }
  writeQ(rest);
  return { sent, dropped };
}
export const pendingCount = () => readQ().length;

export const api = backend;
