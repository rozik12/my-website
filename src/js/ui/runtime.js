/* Поведение интерфейса в браузере: ссылки, модальные окна, уведомления, конфетти, подсказки, счетчики. */
import { link as rawLink } from '../lib/util.js';
import { num, langPrefix, t } from '../i18n/index.js';
import { icon } from './markup.js';
import { isoInTz } from '../lib/logic.js';

const body = document.body;
export const ctx = {
  root: body.dataset.root || '',                                   // до корня сайта (ассеты)
  lang: document.documentElement.lang || 'ru',
  explicit: body.dataset.explicit === '1',
  get base() { return this.root + langPrefix(this.lang); },        // до корня языковой версии
  get today() { return isoInTz(new Date()); }
};
export const href = path => rawLink(path, ctx.base, ctx.explicit);
export const go = path => { location.href = href(path); };
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Уведомления ---------- */
let toastTimer;
export function toast(msg, tone = 'success') {
  const t = $('#toast');
  t.className = `toast toast-${tone}`;
  t.innerHTML = `${icon(tone === 'error' ? 'circle-alert' : 'circle-check')}<span></span>`;
  t.querySelector('span').textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }, tone === 'error' ? 5000 : 3200);
}

/* ---------- Кнопка в состоянии загрузки ---------- */
export async function withBusy(btn, fn) {
  if (!btn || btn.disabled) return;
  const html = btn.innerHTML;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${btn.dataset.busy || t('Подождите…')}`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = html; }
}

/* ---------- Модальные окна ---------- */
let prevFocus = null;
export const Modal = {
  open({ title, body: content, size = 'md', onMount }) {
    Modal.close(true);
    const root = $('#modal-root');
    prevFocus = document.activeElement;
    root.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
        <header class="modal-head"><h2 id="modal-title">${title}</h2>
          <button class="icon-btn" data-close aria-label="${t('Закрыть')}">${icon('x')}</button></header>
        <div class="modal-body">${content}</div>
      </div>`;
    root.hidden = false;
    body.classList.add('modal-open');
    requestAnimationFrame(() => root.classList.add('show'));
    $$('[data-close]', root).forEach(el => el.addEventListener('click', () => Modal.close()));
    const modal = $('.modal', root);
    if (onMount) onMount(modal);
    const first = $('.modal-body input, .modal-body textarea, .modal-body button', root);
    (first || modal).focus();
    return modal;
  },
  close(instant) {
    const root = $('#modal-root');
    if (!root || root.hidden) return;
    root.classList.remove('show');
    body.classList.remove('modal-open');
    const done = () => { root.hidden = true; root.innerHTML = ''; };
    instant ? done() : setTimeout(done, 200);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') Modal.close();
  // Удерживаем фокус внутри модального окна
  if (e.key === 'Tab' && !$('#modal-root').hidden) {
    const f = $$('#modal-root .modal button, #modal-root .modal input, #modal-root .modal textarea, #modal-root .modal a[href], #modal-root .modal select').filter(el => !el.disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});

/* ---------- Конфетти ---------- */
export function confetti() {
  if (reduced()) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  body.appendChild(cv);
  const g = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; g.scale(dpr, dpr);
  const colors = ['#3B82F6', '#60A5FA', '#10B981', '#34D399', '#F59E0B', '#F1F5F9'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4,
    s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .3,
    c: colors[Math.floor(Math.random() * colors.length)]
  }));
  const t0 = performance.now();
  (function frame(t) {
    const k = (t - t0) / 2200;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.globalAlpha = Math.max(0, 1 - k); g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore();
    }
    k < 1 ? requestAnimationFrame(frame) : cv.remove();
  })(t0);
}

/* ---------- Счетчики ---------- */
export function countTo(el, to, suffix = '') {
  if (to === null || to === undefined) { el.textContent = '—'; return; }
  if (reduced()) { el.textContent = num(to) + suffix; return; }
  const from = Math.round(to * 0.6), t0 = performance.now(), dur = 900;
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = num(Math.round(from + (to - from) * e)) + suffix;
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

/* ---------- Подсказки для графиков ---------- */
let tipEl;
export const Tip = {
  show(html, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; tipEl.setAttribute('role', 'tooltip'); body.appendChild(tipEl); }
    tipEl.innerHTML = html; tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.min(innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
    tipEl.style.top = Math.max(8, y - h - 12) + 'px';
  },
  hide() { if (tipEl) tipEl.hidden = true; },
  bind(root) {
    $$('[data-tip]', root).forEach(el => {
      const show = () => { const r = el.getBoundingClientRect(); Tip.show(el.dataset.tip, r.left + r.width / 2, r.top); };
      el.addEventListener('mouseenter', show); el.addEventListener('focus', show);
      el.addEventListener('mouseleave', Tip.hide); el.addEventListener('blur', Tip.hide);
    });
  }
};

/* ---------- Копирование ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
