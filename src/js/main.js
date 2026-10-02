/* Точка входа для всех страниц. Страница задается атрибутом <body data-page="…">, язык — <html lang>. */
import { setLang } from './i18n/index.js';
setLang(document.documentElement.lang);

const { installMonitor, report } = await import('./monitor.js');
const { initShell } = await import('./ui/shell.js');
const { initConsent } = await import('./analytics.js');
installMonitor();

const PAGES = {
  home: () => import('./pages/home.js'),
  catalog: () => import('./pages/catalog.js'),
  challenge: () => import('./pages/challenge.js'),
  dashboard: () => import('./pages/dashboard.js'),
  auth: () => import('./pages/auth.js'),
  create: () => import('./pages/create.js'),
  join: () => import('./pages/join.js'),
  people: () => import('./pages/people.js'),
  person: () => import('./pages/people.js'),
  certificate: () => import('./pages/certificate.js'),
  pay: () => import('./pages/pay.js'),
  admin: () => import('./pages/admin.js')
};

try {
  initShell();
  initConsent();
  const load = PAGES[document.body.dataset.page];
  if (load) await (await load()).init();
} catch (e) {
  report(e, { phase: 'boot', page: document.body.dataset.page });
} finally {
  document.documentElement.classList.add('js-ready');
}

// PWA: service worker (не в демо-превью внутри песочницы)
if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
  navigator.serviceWorker?.register((document.body.dataset.root || '') + 'sw.js').catch(() => {});
}
