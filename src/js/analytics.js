/* Аналитика с согласием на cookie: Яндекс Метрика и/или Google Analytics 4.
   Счетчики загружаются только после согласия. Идентификаторы задаются при сборке (YANDEX_METRIKA_ID, GA_MEASUREMENT_ID). */
import { config } from './api/index.js';

const KEY = 'rb.consent';
const enabled = () => !!(config.yandexMetrikaId || config.gaId);
let loaded = false;

export const consent = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

function loadScript(src) {
  const s = document.createElement('script');
  s.async = true; s.src = src;
  document.head.appendChild(s);
}

function load() {
  if (loaded || !enabled()) return;
  loaded = true;
  if (config.yandexMetrikaId) {
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    loadScript('https://mc.yandex.ru/metrika/tag.js');
    window.ym(+config.yandexMetrikaId, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  }
  if (config.gaId) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', config.gaId, { anonymize_ip: true });
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.gaId)}`);
  }
}

/** Событие воронки: sign_up, login, join_challenge, check_in, complete_challenge, purchase, create_challenge. */
export function track(event, params = {}) {
  if (!loaded) return;
  try {
    if (config.yandexMetrikaId && window.ym) window.ym(+config.yandexMetrikaId, 'reachGoal', event, params);
    if (config.gaId && window.gtag) window.gtag('event', event, params);
  } catch { /* аналитика не должна ломать страницу */ }
}

export function initConsent() {
  const banner = document.getElementById('consent');
  const set = v => { try { localStorage.setItem(KEY, v); } catch { /* */ } banner.hidden = true; if (v === 'yes') load(); };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-consent]');
    if (b) set(b.dataset.consent);
    if (e.target.closest('[data-action="consent-settings"]') && enabled()) banner.hidden = false;
  });
  if (!enabled()) return;
  const c = consent();
  if (c === 'yes') load();
  else if (!c) banner.hidden = false;
}
