/* Крупные представления, общие для пререндера и браузера.
   challengeView — страница челленджа: официальные пререндерятся, свои и закрытые рисуются в браузере. */
import { SITE, CHALLENGES } from '../content.js';
import { dayTasks } from '../lib/logic.js';
import { t, tn, money, localize, date } from '../i18n/index.js';
import { esc, link } from '../lib/util.js';
import { icon, card, cover, catChip, levelChip, startTag, priceTag, proofTag, catLabel } from './markup.js';

export const faqBlock = (items, id = '') => `<div class="faq"${id ? ` id="${id}"` : ''}>${items.map(([q, a], i) =>
  `<details class="faq-item" ${i === 0 && id ? 'open' : ''}><summary>${esc(t(q))}${icon('plus', 'faq-ic')}</summary><p class="muted">${esc(t(a))}</p></details>`).join('')}</div>`;

export function challengeView(ctx, raw) {
  const c = localize(raw);
  const H = p => link(p, ctx.base, ctx.explicit);
  const tasks = dayTasks(c);
  const phases = [...new Set(tasks.map(x => x.phaseIndex))];
  const related = raw.custom ? [] : CHALLENGES.filter(x => x.category === c.category && x.slug !== c.slug).slice(0, 3);
  return `
  <section class="wrap"><nav class="crumbs" aria-label="${t('Навигационная цепочка')}"><a href="${H('/')}">${t('Главная')}</a>${icon('chevron-right')}${raw.custom ? `<a href="${H('/dashboard/my/')}">${t('Мои челленджи')}</a>` : `<a href="${H('/challenges/')}">${t('Каталог')}</a>`}${icon('chevron-right')}<span>${esc(c.title)}</span></nav></section>
  <section class="wrap">${cover(c, 180, 'cover-hero')}</section>
  <section class="wrap detail-hero" data-slug="${c.slug}">
    <div class="detail-main">
      <div class="ch-chips">${catChip(c.category)}${levelChip(c.level)}${raw.custom ? `<span class="tag">${icon('lock')}${t('Закрытый челлендж')}</span>` : startTag(c, ctx.today)}${priceTag(c)}${proofTag(c)}</div>
      <h1>${esc(c.title)}</h1>
      ${c.short ? `<p class="lead">${esc(c.short)}</p>` : ''}
      <div class="facts">
        <div class="fact">${icon('calendar-days')}<span class="muted small">${t('Длительность')}</span><b>${tn(c.days, 'день')}</b></div>
        <div class="fact">${icon('users')}<span class="muted small">${t('Участники')}</span><b class="mono" id="fact-participants">—</b></div>
        <div class="fact">${icon('flag')}<span class="muted small">${t('Доходят до финиша')}</span><b class="mono" id="fact-finish">—</b></div>
        <div class="fact">${icon(c.priceUzs ? 'wallet' : 'clock')}<span class="muted small">${c.priceUzs ? t('Стоимость') : t('В день')}</span><b>${c.priceUzs ? money(c.priceUzs) : t(SITE.levels[c.level].perDay)}</b></div>
      </div>
    </div>
    <aside class="glass join-card" id="join-card" aria-live="polite">
      <p class="eyebrow">${icon('radio')}${t('Запись открыта')}</p><p class="join-price">${c.priceUzs ? money(c.priceUzs) : t('Бесплатно')}</p>
      <a class="btn btn-primary btn-lg btn-block" href="${H('/signup/')}">${t('Участвовать')} ${icon('arrow-right')}</a>
    </aside>
  </section>

  <section class="wrap">
    <div class="tabs tabs-inline" role="tablist" aria-label="${t('Разделы челленджа')}">
      <button class="tab active" role="tab" aria-selected="true" aria-controls="tab-program" id="t-program" data-tab="program">${icon('list-checks')}${t('Программа')}</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="tab-feed" id="t-feed" data-tab="feed">${icon('messages-square')}${t('Лента')}</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="tab-rating" id="t-rating" data-tab="rating">${icon('trophy')}${t('Рейтинг')}</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="tab-chat" id="t-chat" data-tab="chat" hidden>${icon('message-circle')}${t('Чат потока')}</button>
    </div>
  </section>

  <section class="wrap tab-panel detail-grid" id="tab-program" role="tabpanel" aria-labelledby="t-program">
    <div class="detail-col">
      ${c.goal ? `<article class="card block"><h2>${icon('target')}${t('Цель')}</h2><p>${esc(c.goal)}</p></article>` : ''}
      ${c.rules?.length ? `<article class="card block"><h2>${icon('shield-check')}${t('Правила')}</h2><ul class="rules">${c.rules.map(r => `<li>${icon('check')}<span>${esc(r)}</span></li>`).join('')}</ul></article>` : ''}
      <article class="card block" id="cohort-box" hidden></article>
      <article class="card block" id="organizer-box" hidden></article>
      <article class="card block" id="review-box" hidden></article>
    </div>
    <article class="card block tasks-block" id="tasks">
      <div class="row-between"><h2>${icon('list-checks')}${t('Задания по дням')}</h2><span class="mono small muted" id="tasks-count">${tn(c.days, 'день')}</span></div>
      <p class="muted small" id="tasks-hint">${t('Вступите в челлендж, чтобы отмечать выполненные дни.')}</p>
      ${phases.map(pi => {
        const items = tasks.filter(x => x.phaseIndex === pi);
        return `<details class="phase" ${pi === 0 ? 'open' : ''}>
          <summary><span>${esc(c.phases[pi].title)}</span><span class="mono small muted" data-phase-count></span><span class="muted small mono">${t('Дни {a}–{b}', { a: items[0].day, b: items[items.length - 1].day })}</span>${icon('chevron-down', 'chev')}</summary>
          <ol class="days">${items.map(x => `<li class="day" data-day="${x.day}"><span class="day-check" aria-hidden="true">${icon('circle')}</span><span class="mono day-n">${String(x.day).padStart(2, '0')}</span><span class="day-task">${esc(x.task)}<span class="day-note muted small" hidden></span></span><span class="day-act"></span></li>`).join('')}</ol>
        </details>`;
      }).join('')}
    </article>
  </section>

  <section class="wrap tab-panel" id="tab-feed" role="tabpanel" aria-labelledby="t-feed" hidden>
    <div class="feed-col"><div id="feed-list" class="posts"><p class="muted small">${t('Загружаем ленту…')}</p></div>
    <div class="center"><button class="btn btn-ghost" id="feed-more" hidden>${t('Показать еще')}</button></div></div>
  </section>

  <section class="wrap tab-panel" id="tab-rating" role="tabpanel" aria-labelledby="t-rating" hidden>
    <article class="card block feed-col">
      <div class="row-between wrap-row"><h2>${icon('trophy')}${t('Рейтинг потока')}</h2>
        <div class="seg seg-sm" role="group" aria-label="${t('Сортировка рейтинга')}"><button class="seg-btn active" data-lb="progress" aria-pressed="true">${t('Прогресс')}</button><button class="seg-btn" data-lb="streak" aria-pressed="false">${t('Серия')}</button></div></div>
      <ol class="lb" id="lb"><li class="muted small">${t('Загружаем рейтинг…')}</li></ol>
      <p class="muted small">${t('В рейтинге показываются участники с публичным профилем.')}</p>
    </article>
  </section>

  <section class="wrap tab-panel" id="tab-chat" role="tabpanel" aria-labelledby="t-chat" hidden>
    <article class="card block feed-col chat">
      <div class="chat-log" id="chat-log" aria-live="polite"></div>
      <form class="chat-form" id="chat-form"><label class="sr-only" for="chat-input">${t('Сообщение')}</label>
        <input id="chat-input" maxlength="1000" autocomplete="off" placeholder="${t('Напишите участникам потока…')}">
        <button class="btn btn-primary" type="submit" aria-label="${t('Отправить')}">${icon('send')}</button></form>
    </article>
  </section>

  ${raw.custom ? '' : `<section class="wrap section-sm"><h2 class="h-sm">${t('Вопросы о челлендже')}</h2>${faqBlock(SITE.faq.slice(1, 4))}</section>`}
  ${related.length ? `<section class="wrap section-sm"><div class="row-between"><h2 class="h-sm">${t('Похожие челленджи')}</h2><a class="btn-link small" href="${H('/challenges/')}">${t('Весь каталог')} ${icon('arrow-right')}</a></div><div class="grid cards mt">${related.map(r => card(r, ctx)).join('')}</div></section>` : ''}

  <div class="sticky-cta" id="sticky-cta"><div><b>${esc(c.title)}</b><span class="muted small" data-sub>${tn(c.days, 'день')} · ${catLabel(c.category)}</span></div><a class="btn btn-primary btn-sm" data-act href="${H('/signup/')}">${t('Участвовать')}</a></div>`;
}

export { date };
