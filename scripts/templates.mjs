/* Шаблоны страниц для пререндера. ctx = { lang, root, base, explicit, today, config, sprite, csp, year }.
   page.path — путь без языкового префикса ('/challenges/run-100/'). */
import { SITE, CHALLENGES } from '../src/js/content.js';
import { esc, link } from '../src/js/lib/util.js';
import { dayTasks, startStatus } from '../src/js/lib/logic.js';
import { t, tn, date, localize, LANGS, LANG_NAMES, langPrefix } from '../src/js/i18n/index.js';
import { icon, card, levelBars, dayGrid, catLabel } from '../src/js/ui/markup.js';
import { challengeView, faqBlock } from '../src/js/ui/views.js';

const H = (ctx, p) => link(p, ctx.base, ctx.explicit);
const abs = (ctx, lang, p) => `${ctx.config.siteUrl}/${langPrefix(lang)}${p.replace(/^\//, '')}`;
const OG_LOCALE = { ru: 'ru_RU', uz: 'uz_UZ', en: 'en_US' };

/* ---------- Общий каркас ---------- */
export function layout(ctx, page) {
  const { config, lang } = ctx;
  const url = abs(ctx, lang, page.path);
  const title = page.path === '/' ? `${t(SITE.name)} — ${t(SITE.tagline)}` : `${page.title} · ${t(SITE.name)}`;
  const desc = page.description || t(SITE.description);
  const alts = page.noindex ? '' : [...LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${esc(abs(ctx, l, page.path))}">`), `<link rel="alternate" hreflang="x-default" href="${esc(abs(ctx, 'ru', page.path))}">`].join('\n');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${ctx.csp ? `<meta http-equiv="Content-Security-Policy" content="${esc(ctx.csp)}">` : ''}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${ctx.config.environment === 'staging' ? '<meta name="robots" content="noindex, nofollow">\n' : ''}${page.noindex ? (ctx.config.environment === 'staging' ? '' : '<meta name="robots" content="noindex, nofollow">') : `<link rel="canonical" href="${esc(url)}">\n${alts}`}
<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:site_name" content="${t(SITE.name)}">
<meta property="og:locale" content="${OG_LOCALE[lang]}">
<meta property="og:title" content="${esc(page.ogTitle || title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(config.siteUrl + '/assets/og.png')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0F172A">
<link rel="manifest" href="${ctx.root}manifest.webmanifest">
<link rel="icon" href="${ctx.root}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${ctx.root}assets/icons/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;600;700&family=Onest:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap&subset=cyrillic,latin-ext">
<link rel="stylesheet" href="${ctx.root}assets/css/styles.css?v=${config.release}">
${page.jsonld ? page.jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n') : ''}
<script src="${ctx.root}assets/js/config.js?v=${config.release}"></script>
<script type="module" src="${ctx.root}assets/js/main.js?v=${config.release}"></script>
</head>
<body data-page="${page.kind}" data-path="${page.path}" data-root="${ctx.root}" data-explicit="${ctx.explicit ? 1 : 0}"${page.attrs || ''}>
${ctx.sprite}
<a class="skip" href="#main">${t('Перейти к содержимому')}</a>
<div class="scroll-progress" id="scroll-progress" aria-hidden="true"></div>
<div class="demo-bar" id="demo-bar" hidden>${icon('flask-conical')}<span><b>${t('Демо-режим')}:</b> ${t('данные хранятся только в этом браузере, письма и оплата имитируются.')} ${t('Вход')}: <span class="mono">demo@rubikon.app</span> / <span class="mono">Demo1234</span></span><button class="btn-link small" data-action="demo-reset">${t('Сбросить демо')}</button></div>
<div class="offline-bar" id="offline-bar" hidden>${icon('wifi-off')}${t('Нет подключения к интернету. Отметки сохранятся и отправятся, когда связь вернется.')}</div>
${header(ctx, page)}
<main id="main" tabindex="-1">
${page.body}
</main>
${footer(ctx, page)}
<div class="consent" id="consent" role="dialog" aria-live="polite" aria-label="${t('Файлы cookie')}" hidden>
  <p class="small">${t('Мы используем cookie для аналитики, чтобы понимать, что улучшать. Без вашего согласия аналитика не загружается.')} <a class="btn-link" href="${H(ctx, '/privacy/')}">${t('Подробнее')}</a></p>
  <div class="cta-row"><button class="btn btn-primary btn-sm" data-consent="yes">${t('Разрешить')}</button><button class="btn btn-ghost btn-sm" data-consent="no">${t('Только необходимые')}</button></div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<div class="modal-root" id="modal-root" hidden></div>
<noscript><div class="noscript">${t('Для отметок и личного кабинета включите JavaScript.')}</div></noscript>
</body>
</html>`;
}

function header(ctx, page) {
  const nav = [['/', 'home', 'house', 'Главная'], ['/challenges/', 'catalog', 'layout-grid', 'Челленджи'], ['/people/', 'people', 'users', 'Люди'], ['/dashboard/', 'dashboard', 'layout-dashboard', 'Кабинет']];
  const active = page.nav || page.kind;
  return `<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="logo" href="${H(ctx, '/')}" aria-label="${t(SITE.name)} — ${t('на главную')}"><span class="logo-mark" aria-hidden="true"><span></span><span></span><span></span></span><span class="logo-text">${t(SITE.name)}</span></a>
    <nav class="nav" id="nav" aria-label="${t('Основная навигация')}">
      ${nav.map(([p, k, ic, l]) => `<a href="${H(ctx, p)}" class="${active === k ? 'active' : ''}"${active === k ? ' aria-current="page"' : ''}>${icon(ic)}${t(l)}${k === 'dashboard' ? '<span class="nav-count mono" id="nav-count"></span>' : ''}</a>`).join('')}
    </nav>
    <div class="top-actions">
      <button class="search-btn" data-action="search" aria-label="${t('Поиск')} (Ctrl K)">${icon('search')}<span class="hide-md">${t('Поиск')}</span><kbd class="hide-md">Ctrl K</kbd></button>
      ${langSwitch(ctx, page)}
      <div class="user-zone" id="user-zone"><a class="btn btn-ghost btn-sm" href="${H(ctx, '/login/')}">${t('Войти')}</a></div>
      <button class="burger icon-btn" id="burger" aria-label="${t('Меню')}" aria-expanded="false" aria-controls="nav">${icon('menu', 'i-open')}${icon('x', 'i-close')}</button>
    </div>
  </div>
</header>`;
}

function langSwitch(ctx, page) {
  const target = l => link(page.path, ctx.root + langPrefix(l), ctx.explicit);
  return `<div class="dd lang-dd">
    <button class="icon-btn lang-btn" data-dd="lang" aria-label="${t('Язык')}: ${LANG_NAMES[ctx.lang]}" aria-expanded="false" aria-haspopup="menu"><span class="mono">${ctx.lang.toUpperCase()}</span></button>
    <div class="dd-menu dd-lang" data-menu="lang" role="menu" hidden>
      ${LANGS.map(l => `<a class="dd-item ${l === ctx.lang ? 'active' : ''}" role="menuitem" hreflang="${l}" lang="${l}" href="${target(l)}" data-lang-link="${l}">${l === ctx.lang ? icon('check') : '<span class="ic"></span>'}${LANG_NAMES[l]}</a>`).join('')}
    </div>
  </div>`;
}

function footer(ctx, page) {
  return `<footer class="footer">
  <div class="wrap footer-inner">
    <div class="footer-brand">
      <a class="logo" href="${H(ctx, '/')}"><span class="logo-mark" aria-hidden="true"><span></span><span></span><span></span></span><span class="logo-text">${t(SITE.name)}</span></a>
      <p class="muted small">${t('Челленджи и марафоны для тех, кто доводит дела до конца.')}</p>
      <button class="btn btn-ghost btn-sm" id="install-btn" hidden>${icon('download')}${t('Установить приложение')}</button>
    </div>
    <div class="footer-cols">
      <div><p class="footer-h">${t('Платформа')}</p><a href="${H(ctx, '/challenges/')}">${t('Каталог')}</a><a href="${H(ctx, '/create/')}">${t('Создать свой челлендж')}</a><a href="${H(ctx, '/join/')}">${t('Вступить по коду')}</a><a href="${H(ctx, '/#how')}">${t('Как это работает')}</a></div>
      <div><p class="footer-h">${t('Направления')}</p>${Object.keys(SITE.categories).map(k => `<a href="${H(ctx, '/challenges/?cat=' + k)}">${catLabel(k)}</a>`).join('')}</div>
      <div><p class="footer-h">${t('Документы')}</p><a href="${H(ctx, '/terms/')}">${t('Условия использования')}</a><a href="${H(ctx, '/privacy/')}">${t('Конфиденциальность')}</a><button class="btn-link footer-link" data-action="consent-settings">${t('Настройки cookie')}</button><span class="muted small mono">${SITE.supportEmail}</span></div>
    </div>
  </div>
  <div class="wrap footer-bottom muted small"><span>© ${ctx.year} ${t(SITE.name)}</span><span class="footer-langs">${LANGS.map(l => `<a href="${link(page.path, ctx.root + langPrefix(l), ctx.explicit)}" hreflang="${l}" lang="${l}" class="${l === ctx.lang ? 'active' : ''}">${LANG_NAMES[l]}</a>`).join(' · ')}</span><span class="mono">v${ctx.config.release}</span></div>
</footer>`;
}

/* ---------- Главная ---------- */
export function home(ctx) {
  const featured = CHALLENGES.slice(0, 6);
  const soon = CHALLENGES.filter(c => startStatus(c.nextStart, ctx.today).kind !== 'rolling').sort((a, b) => a.nextStart.localeCompare(b.nextStart)).slice(0, 6);
  const demo = localize(CHALLENGES[0]);
  const nextSoon = soon[0] && localize(soon[0]);
  const body = `
  <section class="hero wrap">
    <div class="hero-copy">
      ${nextSoon ? `<a class="pill" href="${H(ctx, `/challenges/${nextSoon.slug}/`)}"><span class="pill-new">${t('Скоро')}</span>${t('Поток «{title}» стартует {date}', { title: esc(nextSoon.title), date: date(nextSoon.nextStart, { year: false }) })} ${icon('arrow-right')}</a>` : ''}
      <h1>${t('Доведите цель до финиша.')} <span class="accent">${t('День за днём.')}</span></h1>
      <p class="lead">${t('Челленджи и марафоны с планом по дням, потоком участников и честной статистикой. Спорт, бизнес, учеба, привычки — одна система для любой цели.')}</p>
      <div class="cta-row">
        <a class="btn btn-primary btn-lg" href="${H(ctx, '/challenges/')}">${t('Выбрать челлендж')} ${icon('arrow-right')}</a>
        <a class="btn btn-ghost btn-lg" href="${H(ctx, '/create/')}">${icon('plus')}${t('Создать свой')}</a>
      </div>
      <div id="platform-stats">
        <dl class="hero-stats">
          <div><dt>${t('Участников')}</dt><dd class="mono" data-pstat="participants">—</dd></div>
          <div><dt>${t('Доходят до финиша')}</dt><dd class="mono" data-pstat="finish">—</dd></div>
          <div><dt>${t('Чекинов за сутки')}</dt><dd class="mono" data-pstat="checkins">—</dd></div>
        </dl>
      </div>
    </div>
    <div class="hero-visual" aria-label="${t('Как выглядит трекер челленджа')}">
      <div class="glass streak-card">
        <div class="row-between"><span class="chip chip-cat">${icon(demo.icon)}${catLabel(demo.category)}</span><span class="streak-fire mono" title="${t('Серия')}">${icon('flame')}11</span></div>
        <h3>${esc(demo.title)}</h3>
        <p class="muted small">${t('Пример: день 18 из {days} · серия 11 дней', { days: demo.days })}</p>
        ${dayGrid(demo.days, Array.from({ length: 17 }, (_, i) => i + 1).filter(d => d !== 6), 18, { cols: 10 })}
        <div class="today-task"><span class="today-check">${icon('circle')}</span><div><p class="small muted">${t('Задание дня {n}', { n: 18 })}</p><p>${esc(dayTasks(demo)[17].task)}</p></div><span class="btn btn-primary btn-sm" aria-hidden="true">${t('Отметить')}</span></div>
      </div>
      <div class="glass float-badge fb-1">${icon('trophy')}<div><b>${t('Бейдж «Неделя огня»')}</b><span class="small muted">${t('7 дней без пропусков')}</span></div></div>
      <div class="glass float-badge fb-2">${icon('messages-square')}<div><b>${t('Поток рядом')}</b><span class="small muted">${t('лента, реакции и чат')}</span></div></div>
    </div>
  </section>

  <section class="feed" id="feed" aria-label="${t('Последние отметки участников')}" hidden><div class="feed-track"></div></section>

  <section class="wrap section" id="categories">
    <div class="section-head row-between wrap-row"><div><p class="eyebrow">${t('Направления')}</p><h2>${t('Цели любого масштаба')}</h2></div><a class="btn btn-ghost" href="${H(ctx, '/challenges/')}">${t('Весь каталог')} ${icon('arrow-right')}</a></div>
    <div class="cats">${Object.entries(SITE.categories).map(([k, v]) => {
      const n = CHALLENGES.filter(c => c.category === k).length;
      return `<a class="cat-tile cat-t-${k} reveal" href="${H(ctx, '/challenges/?cat=' + k)}">
        <span class="ch-icon cat-${k}">${icon(v.icon)}</span><h3>${catLabel(k)}</h3><p class="muted small">${t(v.description)}</p>
        <div class="cat-foot"><span class="mono small">${tn(n, 'челлендж')}</span><span class="mono small muted" data-cat-count="${k}" hidden></span></div></a>`;
    }).join('')}</div>
  </section>

  <section class="wrap section" id="how">
    <div class="section-head"><p class="eyebrow">${t('Как это работает')}</p><h2>${t('Четыре шага от решения до результата')}</h2></div>
    <ol class="steps">${[
      ['target', 'Выберите цель', 'Фильтруйте каталог по категории, сложности и длительности — или создайте свой челлендж для себя и команды.'],
      ['user-plus', 'Вступите в поток', 'Стартуйте вместе с потоком в общий день или в своем темпе. План по дням появится в личном кабинете.'],
      ['circle-check', 'Отмечайте день', 'Выполните задание, приложите фото или ссылку и поделитесь в ленте потока. Серия растет.'],
      ['medal', 'Финишируйте', 'Получите сертификат, бейдж и опыт. Поделитесь результатом и выберите следующий рубеж.']
    ].map(([ic, ti, d], i) => `<li class="step reveal"><span class="step-n mono">${String(i + 1).padStart(2, '0')}</span><span class="step-ic">${icon(ic)}</span><h3>${t(ti)}</h3><p class="muted">${t(d)}</p></li>`).join('')}</ol>
  </section>

  <section class="wrap section">
    <div class="section-head row-between wrap-row">
      <div><p class="eyebrow">${t('Челленджи')}</p><h2>${t('Популярное и скоро старт')}</h2></div>
      <div class="seg" role="tablist" aria-label="${t('Подборка')}">
        <button class="seg-btn active" role="tab" aria-selected="true" data-tab="featured">${icon('star')}${t('Подборка')}</button>
        <button class="seg-btn" role="tab" aria-selected="false" data-tab="soon">${icon('calendar-days')}${t('Скоро старт')}</button>
      </div>
    </div>
    <div class="grid cards" data-panel="featured">${featured.map(c => card(c, ctx)).join('')}</div>
    <div class="grid cards" data-panel="soon" hidden>${soon.map(c => card(c, ctx)).join('')}</div>
  </section>

  <section class="wrap section">
    <div class="teams-band card">
      <div><p class="eyebrow">${icon('building-2')}${t('Для команд и компаний')}</p><h2>${t('Закрытые челленджи для своей команды')}</h2>
        <p class="muted">${t('Соберите свой челлендж за пять минут, пригласите коллег по коду и смотрите прогресс каждого в отчете организатора с выгрузкой в CSV.')}</p></div>
      <div class="cta-row"><a class="btn btn-primary" href="${H(ctx, '/create/')}">${icon('plus')}${t('Создать челлендж')}</a><a class="btn btn-ghost" href="${H(ctx, '/join/')}">${icon('key-round')}${t('У меня есть код')}</a></div>
    </div>
  </section>

  <section class="wrap section" id="reviews" hidden>
    <div class="section-head"><p class="eyebrow">${t('Отзывы участников')}</p><h2>${t('Результаты, которые довели до конца')}</h2></div>
    <div class="grid quotes" id="quotes"></div>
  </section>

  <section class="wrap section faq-wrap" id="faq">
    <div class="section-head"><p class="eyebrow">${t('Вопросы')}</p><h2>${t('Частые вопросы')}</h2><p class="muted">${t('Не нашли ответ? Напишите нам:')} <span class="mono select-all">${SITE.supportEmail}</span></p></div>
    ${faqBlock(SITE.faq, 'faq-list')}
  </section>

  <section class="wrap section">
    <div class="cta-band"><div><h2>${t('Начните сегодня')}</h2><p class="muted">${t('Большинство челленджей стартуют в любой день: первое задание откроется сразу после записи.')}</p></div>
      <div class="cta-row"><a class="btn btn-primary btn-lg" href="${H(ctx, '/challenges/')}">${t('Выбрать челлендж')} ${icon('arrow-right')}</a><a class="btn btn-ghost btn-lg" href="${H(ctx, '/signup/')}">${t('Создать аккаунт')}</a></div></div>
  </section>`;
  return {
    path: '/', kind: 'home', title: t('Главная'), body,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: t(SITE.name), url: abs(ctx, ctx.lang, '/'), inLanguage: ctx.lang },
      { '@context': 'https://schema.org', '@type': 'Organization', name: t(SITE.name), url: ctx.config.siteUrl + '/', email: SITE.supportEmail, logo: ctx.config.siteUrl + '/assets/icons/icon-512.png' },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: SITE.faq.map(([q, a]) => ({ '@type': 'Question', name: t(q), acceptedAnswer: { '@type': 'Answer', text: t(a) } })) }
    ]
  };
}

/* ---------- Каталог ---------- */
export function catalog(ctx) {
  const count = cat => CHALLENGES.filter(c => cat === 'all' || c.category === cat).length;
  const cats = [['all', t('Все'), 'layout-grid'], ...Object.entries(SITE.categories).map(([k, v]) => [k, catLabel(k), v.icon])];
  const body = `
  <section class="wrap page-head">
    <nav class="crumbs" aria-label="${t('Навигационная цепочка')}"><a href="${H(ctx, '/')}">${t('Главная')}</a>${icon('chevron-right')}<span>${t('Каталог')}</span></nav>
    <h1>${t('Челленджи')}</h1>
    <p class="lead">${t('{n} с понятным финишем и планом по дням. Выберите направление, уровень и длительность.', { n: tn(CHALLENGES.length, 'челлендж') })}</p>
  </section>
  <section class="wrap">
    <div class="toolbar">
      <label class="search" for="q">${icon('search')}<span class="sr-only">${t('Поиск по каталогу')}</span><input id="q" type="search" placeholder="${t('Поиск: бег, чтение, продажи…')}" autocomplete="off"></label>
      <button class="btn btn-ghost filters-toggle" id="ftoggle" aria-expanded="false" aria-controls="fpanel">${icon('sliders-horizontal')}${t('Фильтры')}<span class="nav-count mono" id="fcount"></span></button>
      <label class="select" for="sort">${icon('arrow-up-down')}<span class="sr-only">${t('Сортировка')}</span>
        <select id="sort"><option value="popular">${t('Популярные')}</option><option value="soon">${t('Ближайший старт')}</option><option value="short">${t('Короткие')}</option><option value="finish">${t('Чаще доходят до финиша')}</option></select></label>
      <div class="seg view-toggle" role="group" aria-label="${t('Вид')}"><button class="seg-btn icon-only active" data-view="grid" aria-label="${t('Сеткой')}">${icon('layout-grid')}</button><button class="seg-btn icon-only" data-view="list" aria-label="${t('Списком')}">${icon('list')}</button></div>
    </div>
    <div class="filters glass" id="fpanel">
      <div class="filter-group"><span class="filter-label">${t('Категория')}</span><div class="chips" data-filter="cat">
        ${cats.map(([k, l, ic]) => `<button class="fchip ${k === 'all' ? 'active' : ''}" data-v="${k}">${icon(ic)}${l}<span class="fchip-n mono">${count(k)}</span></button>`).join('')}</div></div>
      <div class="filter-group"><span class="filter-label">${t('Сложность')}</span><div class="chips" data-filter="level">
        <button class="fchip active" data-v="all">${t('Любая')}</button>${Object.entries(SITE.levels).map(([k, v]) => `<button class="fchip lv-${k}" data-v="${k}">${levelBars(k)}${t(v.label)}</button>`).join('')}</div></div>
      <div class="filter-group"><span class="filter-label">${t('Длительность')}</span><div class="chips" data-filter="dur">
        ${[['all', 'Любая'], ['short', 'До 14 дней'], ['month', '15–30 дней'], ['long', 'Больше 30']].map(([k, l]) => `<button class="fchip ${k === 'all' ? 'active' : ''}" data-v="${k}">${t(l)}</button>`).join('')}</div></div>
      <div class="filter-group"><span class="filter-label">${t('Цена')}</span><div class="chips" data-filter="price">
        ${[['all', 'Любая'], ['free', 'Бесплатные'], ['paid', 'Платные']].map(([k, l]) => `<button class="fchip ${k === 'all' ? 'active' : ''}" data-v="${k}">${t(l)}</button>`).join('')}</div></div>
    </div>
    <div class="row-between result-bar"><p class="muted small" id="count" aria-live="polite">${t('Найдено: {n}', { n: CHALLENGES.length })}</p><button class="btn-link small" id="reset-top" hidden>${icon('rotate-ccw')}${t('Сбросить фильтры')}</button></div>
    <div class="grid cards" id="list">${CHALLENGES.map(c => card(c, ctx)).join('')}</div>
    <div id="empty" hidden><div class="empty">${icon('search-x')}<h3>${t('Ничего не найдено')}</h3><p class="muted">${t('Попробуйте другую категорию, уровень или длительность.')}</p><button class="btn btn-ghost" id="reset-empty">${icon('rotate-ccw')}${t('Сбросить фильтры')}</button></div></div>
    <div class="center"><button class="btn btn-ghost" id="more" hidden>${t('Показать еще')}</button></div>
  </section>`;
  return {
    path: '/challenges/', kind: 'catalog', title: t('Каталог челленджей'), body,
    description: t('{n} с планом по дням: спорт, бизнес, привычки и саморазвитие. Бесплатные и платные программы, общие потоки и старт в любой день.', { n: tn(CHALLENGES.length, 'челлендж') }),
    jsonld: [{ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: CHALLENGES.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(ctx, ctx.lang, `/challenges/${c.slug}/`), name: localize(c).title })) }]
  };
}

/* ---------- Челлендж ---------- */
export function challenge(ctx, raw) {
  const c = localize(raw);
  const url = abs(ctx, ctx.lang, `/challenges/${c.slug}/`);
  return {
    path: `/challenges/${c.slug}/`, kind: 'challenge', nav: 'catalog', title: c.title, ogType: 'article', body: challengeView(ctx, raw),
    attrs: ` data-slug="${c.slug}"`,
    description: `${c.short} ${tn(c.days, 'день')}. ${c.goal}`.slice(0, 300),
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'Course', name: c.title, description: c.goal, url, inLanguage: ctx.lang,
        provider: { '@type': 'Organization', name: t(SITE.name), sameAs: ctx.config.siteUrl + '/' },
        educationalLevel: t(SITE.levels[c.level].label), isAccessibleForFree: !c.priceUzs,
        offers: { '@type': 'Offer', price: c.priceUzs || 0, priceCurrency: 'UZS', category: c.priceUzs ? 'Paid' : 'Free' },
        hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: `P${c.days}D`, ...(c.nextStart ? { startDate: c.nextStart } : {}) }
      },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('Главная'), item: abs(ctx, ctx.lang, '/') },
        { '@type': 'ListItem', position: 2, name: t('Каталог'), item: abs(ctx, ctx.lang, '/challenges/') },
        { '@type': 'ListItem', position: 3, name: c.title, item: url }] }
    ]
  };
}

/* ---------- Страницы, которые рисуются в браузере ---------- */
const shell = (inner) => `<div id="app" aria-busy="true"><section class="wrap section"><div class="center"><span class="spinner spinner-lg" aria-hidden="true"></span></div></section></div>${inner || ''}`;

export function dashboard(ctx, tab) {
  const tabs = [['overview', '/dashboard/', 'Обзор', 'layout-dashboard'], ['feed', '/dashboard/feed/', 'Лента друзей', 'messages-square'], ['activity', '/dashboard/activity/', 'Активность', 'activity'],
    ['achievements', '/dashboard/achievements/', 'Достижения', 'award'], ['my', '/dashboard/my/', 'Мои челленджи', 'pencil-ruler'], ['settings', '/dashboard/settings/', 'Настройки', 'settings']];
  const cur = tabs.find(x => x[0] === tab);
  const body = `
  <section class="wrap page-head dash-head" id="dash-head"><div class="profile"><div class="skeleton sk-avatar"></div><div class="profile-info"><div class="skeleton sk-line w40"></div><h1 class="skeleton sk-title"><span class="sr-only">${t('Личный кабинет')}</span></h1><div class="skeleton sk-line w60"></div></div></div></section>
  <nav class="wrap tabs" aria-label="${t('Разделы кабинета')}">${tabs.map(([k, p, l, ic]) => `<a href="${H(ctx, p)}" class="tab ${k === tab ? 'active' : ''}"${k === tab ? ' aria-current="page"' : ''}>${icon(ic)}${t(l)}</a>`).join('')}</nav>
  <div id="dash" aria-busy="true"><section class="wrap stats">${'<div class="stat card skeleton-card"><div class="skeleton sk-line w60"></div><div class="skeleton sk-title w40"></div></div>'.repeat(4)}</section></div>`;
  return { path: cur[1], kind: 'dashboard', title: `${t(cur[2])} · ${t('Кабинет')}`, body, noindex: true, attrs: ` data-tab="${tab}"` };
}

export function simplePage(ctx, { path, kind, title, h1, lead, nav = 'none', noindex = true, attrs = '' }) {
  const body = `<section class="wrap page-head"><h1>${h1 || title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</section>${shell()}`;
  return { path, kind, title, body, noindex, nav, attrs };
}

export const create = ctx => simplePage(ctx, { path: '/create/', kind: 'create', title: t('Конструктор челленджа'), lead: t('Соберите свой челлендж: план по дням, правила и подтверждение. Пригласите друзей или коллег по коду.') });
export const join = ctx => simplePage(ctx, { path: '/join/', kind: 'join', title: t('Вступить по коду'), lead: t('Введите код приглашения от организатора закрытого челленджа.') });
export const people = ctx => ({ ...simplePage(ctx, { path: '/people/', kind: 'people', nav: 'people', title: t('Люди'), lead: t('Находите друзей, подписывайтесь и следите за их прогрессом в ленте.') }), noindex: false, description: t('Участники Рубикона: находите друзей и единомышленников, подписывайтесь и поддерживайте друг друга.') });
export const person = ctx => simplePage(ctx, { path: '/u/', kind: 'person', nav: 'people', title: t('Профиль участника'), h1: `<span id="person-name">${t('Профиль участника')}</span>` });
export const custom = ctx => ({ path: '/c/', kind: 'challenge', nav: 'none', title: t('Челлендж'), noindex: true, attrs: ' data-custom="1"', body: shell() });
export const certificate = ctx => ({ path: '/certificate/', kind: 'certificate', title: t('Сертификат'), noindex: true, nav: 'none', body: shell() });
export const pay = ctx => simplePage(ctx, { path: '/pay/', kind: 'pay', title: t('Оплата'), h1: t('Статус оплаты') });
export const admin = ctx => ({ path: '/admin/', kind: 'admin', title: 'Админ-панель', noindex: true, nav: 'none', body: `<section class="wrap page-head"><h1>Админ-панель</h1></section>${shell()}` });
export const offline = ctx => ({ path: '/offline/', kind: 'offline', title: t('Нет подключения'), noindex: true, nav: 'none',
  body: `<section class="wrap section"><div class="empty">${icon('wifi-off')}<h1 class="h-sm">${t('Нет подключения к интернету')}</h1><p class="muted">${t('Эта страница еще не сохранена на устройстве. Откройте кабинет — он доступен без сети, если вы заходили в него раньше.')}</p><a class="btn btn-primary" href="${H(ctx, '/dashboard/')}">${t('Открыть кабинет')}</a></div></section>` });

/* ---------- Вход и регистрация ---------- */
const passField = (id, label, auto, extra = '') => `
  <label class="field" for="${id}"><span>${label}</span>
    <span class="pass-wrap"><input id="${id}" type="password" data-pass required autocomplete="${auto}" ${extra}>${id === 'password' ? `<button type="button" class="pass-eye" id="toggle-pass" aria-label="${t('Показать пароль')}" aria-pressed="false">${icon('eye')}</button>` : ''}</span></label>`;
const socialButtons = () => `
  <div class="social">
    <button type="button" class="btn btn-ghost btn-block" data-social="google">${icon('globe')}${t('Продолжить с Google')}</button>
    <button type="button" class="btn btn-ghost btn-block" data-social="telegram">${icon('send')}${t('Продолжить с Telegram')}</button>
  </div>
  <p class="or"><span>${t('или по почте')}</span></p>`;

export function auth(ctx, mode) {
  const forms = {
    login: {
      path: '/login/', title: t('Вход'), h: t('Вход в Рубикон'), sub: t('Продолжите свои челленджи с того же места.'),
      form: `${socialButtons()}
        <label class="field" for="email"><span>${t('Электронная почта')}</span><input id="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
        ${passField('password', t('Пароль'), 'current-password')}
        <div class="row-between small"><span></span><a class="btn-link" href="${H(ctx, '/forgot-password/')}">${t('Забыли пароль?')}</a></div>
        <p class="form-error" id="auth-err" role="alert" tabindex="-1" hidden></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-busy="${t('Входим…')}">${t('Войти')}</button>
        <button class="btn btn-ghost btn-block" type="button" id="resend" data-busy="${t('Отправляем…')}" hidden>${t('Отправить письмо подтверждения еще раз')}</button>
        <p class="muted small center-text">${t('Впервые здесь?')} <a class="btn-link" href="${H(ctx, '/signup/')}">${t('Создать аккаунт')}</a></p>
        <p class="demo-hint small" id="demo-hint" hidden>${icon('flask-conical')}${t('Демо-вход')}: <span class="mono">demo@rubikon.app</span> / <span class="mono">Demo1234</span></p>`
    },
    signup: {
      path: '/signup/', title: t('Регистрация'), h: t('Создать аккаунт'), sub: t('Бесплатно. Подтверждение придет на почту.'),
      form: `${socialButtons()}
        <label class="field" for="name"><span>${t('Имя')}</span><input id="name" required maxlength="60" autocomplete="name" placeholder="${t('Как вас показывать в рейтинге')}"></label>
        <label class="field" for="email"><span>${t('Электронная почта')}</span><input id="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
        ${passField('password', t('Пароль'), 'new-password', 'minlength="8" aria-describedby="pw-hint"')}
        <div class="pw-meter" id="pw-meter" aria-hidden="true"><span></span><span></span><span></span></div>
        <p class="muted small" id="pw-hint">${t('Не меньше 8 символов, строчные и заглавные латинские буквы, цифра')}</p>
        <label class="check" for="terms"><input type="checkbox" id="terms"><span>${t('Принимаю {terms} и {privacy}', { terms: `<a class="btn-link" href="${H(ctx, '/terms/')}">${t('условия')}</a>`, privacy: `<a class="btn-link" href="${H(ctx, '/privacy/')}">${t('политику конфиденциальности')}</a>` })}</span></label>
        <p class="form-error" id="auth-err" role="alert" tabindex="-1" hidden></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-busy="${t('Создаем аккаунт…')}">${t('Создать аккаунт')}</button>
        <p class="muted small center-text">${t('Уже есть аккаунт?')} <a class="btn-link" href="${H(ctx, '/login/')}">${t('Войти')}</a></p>`
    },
    forgot: {
      path: '/forgot-password/', title: t('Восстановление пароля'), h: t('Восстановить пароль'), sub: t('Пришлем ссылку для смены пароля.'),
      form: `
        <label class="field" for="email"><span>${t('Электронная почта')}</span><input id="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
        <p class="form-error" id="auth-err" role="alert" tabindex="-1" hidden></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-busy="${t('Отправляем…')}">${t('Отправить ссылку')}</button>
        <p class="muted small center-text"><a class="btn-link" href="${H(ctx, '/login/')}">${t('Вернуться ко входу')}</a></p>`
    },
    reset: {
      path: '/reset-password/', title: t('Новый пароль'), h: t('Новый пароль'), sub: t('Придумайте новый пароль для входа.'),
      form: `${passField('password', t('Новый пароль'), 'new-password')}${passField('password2', t('Повторите пароль'), 'new-password')}
        <p class="form-error" id="auth-err" role="alert" tabindex="-1" hidden></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-busy="${t('Сохраняем…')}">${t('Сохранить пароль')}</button>`
    },
    callback: { path: '/auth/callback/', title: t('Подтверждение'), h: t('Проверяем ссылку…'), sub: t('Секунду, выполняем вход.'), form: `<div class="center"><span class="spinner spinner-lg" aria-hidden="true"></span></div>` },
    telegram: { path: '/auth/telegram/', title: 'Telegram', h: t('Вход через Telegram'), sub: t('Секунду, выполняем вход.'), form: `<div class="center"><span class="spinner spinner-lg" aria-hidden="true"></span></div>` }
  };
  const f = forms[mode];
  const body = `
  <section class="wrap auth-wrap">
    <div class="card auth-card" id="auth-card">
      <h1 class="h-auth">${f.h}</h1>
      <p class="muted">${f.sub}</p>
      <p class="auth-reason small" id="auth-reason" hidden></p>
      ${['callback', 'telegram'].includes(mode) ? f.form : `<form class="form" id="auth-form" novalidate>${f.form}</form>`}
    </div>
  </section>`;
  return { path: f.path, kind: 'auth', title: f.title, body, noindex: true, attrs: ` data-mode="${mode}"`, nav: 'none' };
}

/* ---------- Юридические страницы (шаблон) ---------- */
export function legal(ctx, kind) {
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? [
    ['Какие данные мы собираем', 'Адрес электронной почты и имя при регистрации; при входе через Google или Telegram — имя и идентификатор аккаунта; данные об участии, отметки, оценки самочувствия, заметки, фото и ссылки подтверждения; сообщения в чате потока и комментарии; часовой пояс и язык; технические данные об ошибках.'],
    ['Зачем', 'Чтобы вести ваш прогресс, показывать ленту и рейтинг потока, обрабатывать оплату, отправлять письма подтверждения и восстановления пароля, а также исправлять ошибки сайта.'],
    ['Кто видит ваши данные', 'Другие участники видят имя, прогресс и публикации, которыми вы поделились, если в настройках включен публичный профиль. Заметки к отметкам видите только вы. Платежные данные карты обрабатывают Payme и Click — мы их не получаем.'],
    ['Аналитика и cookie', 'Аналитика (Яндекс Метрика, Google Analytics) загружается только после вашего согласия. Изменить решение можно по ссылке «Настройки cookie» внизу страницы.'],
    ['Где хранятся данные', 'Укажите страну размещения серверов и обработчиков данных вашего проекта. Если ваши пользователи — граждане Узбекистана, проверьте требования о локализации персональных данных.'],
    ['Удаление', 'Аккаунт и все связанные данные удаляются сразу: Кабинет → Настройки → Удалить аккаунт.'],
    ['Контакты', 'По вопросам о данных пишите на адрес поддержки, указанный внизу страницы.']
  ] : [
    ['Сервис', 'Рубикон — платформа челленджей и марафонов. Часть челленджей бесплатна, часть — платная; цена указана на странице челленджа.'],
    ['Оплата и возврат', 'Оплата через Payme или Click открывает доступ к челленджу. Условия возврата укажите здесь перед запуском.'],
    ['Аккаунт', 'Вы отвечаете за сохранность пароля. Один человек — один аккаунт.'],
    ['Правила поведения', 'Запрещены оскорбления, спам и публикация чужих персональных данных. Публикации, нарушающие правила, скрываются модераторами, а аккаунт может быть заблокирован.'],
    ['Свои челленджи', 'Организатор закрытого челленджа видит имена и прогресс участников, вступивших по его коду.'],
    ['Здоровье', 'Спортивные и пищевые челленджи не заменяют консультацию врача. Перед нагрузками оцените свое состояние.'],
    ['Изменения', 'Мы можем обновлять условия и сообщим о существенных изменениях по почте.']
  ];
  const title = isPrivacy ? t('Политика конфиденциальности') : t('Условия использования');
  const body = `
  <section class="wrap page-head legal">
    <h1>${title}</h1>
    <p class="legal-note small">${icon('triangle-alert')}${t('Шаблон. Перед запуском согласуйте текст с юристом и укажите реквизиты владельца сайта.')}</p>
    ${sections.map(([h, p]) => `<h2 class="h-sm">${t(h)}</h2><p class="muted">${t(p)}</p>`).join('')}
  </section>`;
  return { path: isPrivacy ? '/privacy/' : '/terms/', kind: 'legal', title, body, nav: 'none', description: title + ' — ' + SITE.name + '. ' + t(sections[0][1]).slice(0, 120) };
}

export function notFound(ctx) {
  const body = `<section class="wrap section"><div class="empty">${icon('map')}<h1 class="h-sm">${t('Страница не найдена')}</h1><p class="muted">${t('Возможно, ссылка устарела. Начните с каталога.')}</p><a class="btn btn-primary" href="${H(ctx, '/challenges/')}">${t('К каталогу')}</a></div></section>`;
  return { path: '/404.html', kind: 'notfound', title: t('Страница не найдена'), body, noindex: true, nav: 'none' };
}
