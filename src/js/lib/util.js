/* Утилиты без DOM и без зависимости от языка: используются в браузере и при сборке. */

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Детерминированный генератор псевдослучайных чисел (обложки, аватары). */
export function rng(str) {
  let s = [...String(str)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Ссылка на страницу сайта относительно текущей.
 * path — канонический путь вида '/challenges/run-100/'; base — префикс до корня языковой версии ('', '../', '../../uz/').
 * explicit — добавлять 'index.html' (для хостингов без автоиндекса).
 */
export function link(path, base = '', explicit = false) {
  const [p0, hash = ''] = path.split('#');
  const [p, query = ''] = p0.split('?');
  let rel = p.replace(/^\//, '');
  if (explicit && (rel === '' || rel.endsWith('/'))) rel += 'index.html';
  const out = (base + rel) || './';
  return out + (query ? '?' + query : '') + (hash ? '#' + hash : '');
}

export const initials = name => String(name || '?').trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
export const hueOf = name => Math.floor(rng(String(name || ''))() * 360);
export const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
