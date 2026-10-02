/* Страница челленджа: запись (с потоком и оплатой), прогресс, отметки, лента, рейтинг, чат потока, отчет организатора. */
import { api } from '../api/index.js';
import { CHALLENGES } from '../content.js';
import { currentDay, streak, progressPct, dayTasks, startStatus, diffDays } from '../lib/logic.js';
import { t, tn, num, money, date, localize } from '../i18n/index.js';
import { icon, bar, ring, avatar, empty, esc, ago } from '../ui/markup.js';
import { challengeView } from '../ui/views.js';
import { $, $$, ctx, href, toast, confetti, withBusy, copyText, Modal } from '../ui/runtime.js';
import { checkInDialog, requireLogin } from '../ui/shell.js';
import { mountFeed } from '../ui/feed.js';
import { hydrateCards, resetStats } from './common.js';
import { report } from '../monitor.js';
import { track } from '../analytics.js';

export async function init() {
  const custom = document.body.dataset.custom === '1';
  const slug = custom ? new URLSearchParams(location.search).get('id') : document.body.dataset.slug;
  let raw = CHALLENGES.find(x => x.slug === slug);

  if (custom) {
    const app = $('#app');
    if (!slug) { app.innerHTML = `<section class="wrap section">${empty('search-x', t('Челлендж не найден'), t('Проверьте ссылку или вступите по коду приглашения.'), `<a class="btn btn-primary" href="${href('/join/')}">${t('Ввести код')}</a>`)}</section>`; return; }
    raw = await api.challengeInfo(slug).catch(() => null);
    if (!raw) {
      app.innerHTML = `<section class="wrap section">${empty('lock', t('Нет доступа к челленджу'), api.auth.user ? t('Это закрытый челлендж. Вступите по коду приглашения от организатора.') : t('Войдите, чтобы открыть закрытый челлендж.'),
        api.auth.user ? `<a class="btn btn-primary" href="${href('/join/')}">${t('Ввести код')}</a>` : `<a class="btn btn-primary" href="${href('/login/')}">${t('Войти')}</a>`)}</section>`;
      app.setAttribute('aria-busy', 'false');
      return;
    }
    raw = { ...raw, custom: true };
    $('#main').innerHTML = challengeView(ctx, raw);
    document.title = `${localize(raw).title} · ${t('Рубикон')}`;
  }

  const c = localize(raw);
  const tasks = dayTasks(c);
  let enrollment = null, finished = null, paid = false, cohorts = [], lbOrder = 'progress', lbCohortOnly = false, chosenCohort = null;
  const isOwner = !!raw.isOwner;

  async function loadMine() {
    cohorts = custom ? [] : await api.cohorts(slug).catch(() => []);
    if (!api.auth.user) { enrollment = finished = null; paid = false; return; }
    const [mine, paidSlugs] = await Promise.all([api.myEnrollments(), c.priceUzs ? api.myPaidSlugs() : Promise.resolve([])]);
    const my = mine.filter(e => e.slug === slug);
    enrollment = my.find(e => e.status === 'active') || null;
    finished = my.find(e => e.status === 'completed') || null;
    paid = paidSlugs.includes(slug);
  }
  const cur = () => currentDay(enrollment.startDate, c.days, ctx.today);
  const notStarted = () => enrollment && ctx.today < enrollment.startDate;

  /* ---------- Карточка записи ---------- */
  function renderJoin() {
    const card = $('#join-card');
    let html = '';
    if (enrollment && notStarted()) {
      html = `<p class="eyebrow">${icon('timer')}${t('Вы в потоке')}</p>
        <p class="join-day">${t('Старт {date}', { date: date(enrollment.startDate, { year: false }) })}</p>
        <div class="countdown mono" id="countdown" data-target="${enrollment.startDate}">${['дн', 'ч', 'мин', 'сек'].map(u => `<div><b>--</b><span>${t(u)}</span></div>`).join('')}</div>
        <p class="muted small">${t('Первое задание откроется в день старта. А пока загляните в чат потока.')}</p>
        <button class="btn-link small danger-link" id="leave">${t('Покинуть челлендж')}</button>`;
    } else if (enrollment) {
      const d = cur(), done = enrollment.checkins.map(k => k.day), doneToday = done.includes(d);
      html = `
        <div class="row-between"><p class="eyebrow">${icon('circle-check')}${t('Вы участвуете')}</p><span class="streak-fire mono" title="${t('Серия')}">${icon('flame')}${streak(done, d)}</span></div>
        <div class="join-progress">${ring(progressPct(done.length, c.days), 84)}
          <div><p class="join-day mono">${t('День {n}', { n: d })}<span class="muted"> / ${c.days}</span></p><p class="muted small">${t('Выполнено: {n}', { n: tn(done.length, 'день') })}</p></div></div>
        <div class="today-task ${doneToday ? 'is-done' : ''}"><span class="today-check">${icon(doneToday ? 'check' : 'circle')}</span>
          <div><p class="small muted">${t('Задание на сегодня')}</p><p>${esc(tasks[d - 1].task)}</p></div></div>
        <div class="join-actions">
          ${doneToday ? `<a class="btn btn-ghost" href="${href('/dashboard/')}">${icon('layout-dashboard')}${t('Открыть кабинет')}</a>` : `<button class="btn btn-primary btn-lg" data-checkin>${icon('check')}${t('Отметить день {n}', { n: d })}</button>`}
          <button class="btn-link small danger-link" id="leave">${t('Покинуть челлендж')}</button>
        </div>`;
    } else {
      const needPay = c.priceUzs > 0 && !paid;
      html = `
        <p class="eyebrow">${icon(needPay ? 'wallet' : 'radio')}${needPay ? t('Платный челлендж') : t('Запись открыта')}</p>
        <p class="join-price">${c.priceUzs ? money(c.priceUzs) : t('Бесплатно')}${paid ? ` <span class="tag tag-live">${icon('check')}${t('Оплачено')}</span>` : ''}</p>
        ${cohorts.length ? `<fieldset class="cohort-pick"><legend class="field-label">${t('Когда начать')}</legend>
          ${cohorts.map((h, i) => `<label class="check cohort-opt"><input type="radio" name="cohort" value="${h.id}" ${i === 0 ? 'checked' : ''}>
            <span><b>${h.startDate > ctx.today ? t('Общий поток с {date}', { date: date(h.startDate, { year: false }) }) : t('Поток идет с {date}', { date: date(h.startDate, { year: false }) })}</b><span class="muted small">${h.title ? esc(h.title) + ' · ' : ''}${tn(h.participants, 'участник')} · ${t('чат и рейтинг потока')}</span></span></label>`).join('')}
          <label class="check cohort-opt"><input type="radio" name="cohort" value=""><span><b>${t('Сегодня, в своем темпе')}</b><span class="muted small">${t('Без общего чата')}</span></span></label>
        </fieldset>` : `<p class="muted small">${t('Старт в любой день: первый день откроется сразу после записи.')}</p>`}
        ${finished ? `<p class="small note-ok">${icon('trophy')}${t('Вы уже прошли этот челлендж {date}. Можно пройти снова.', { date: date(finished.completedAt.slice(0, 10)) })}</p>` : ''}
        ${needPay ? `<div class="pay-btns"><button class="btn btn-primary btn-lg btn-block" data-pay="payme" data-busy="${t('Переходим к оплате…')}">${t('Оплатить через Payme')}</button>
            <button class="btn btn-ghost btn-lg btn-block" data-pay="click" data-busy="${t('Переходим к оплате…')}">${t('Оплатить через Click')}</button></div>
            <p class="muted small">${t('После оплаты доступ откроется автоматически.')}</p>`
          : `<button class="btn btn-primary btn-lg btn-block" id="join" data-busy="${t('Записываем…')}">${finished ? t('Пройти снова') : t('Участвовать')} ${icon('arrow-right')}</button>`}
        <ul class="perks small">
          <li>${icon('check')}${t('План на {n} в кабинете', { n: tn(c.days, 'день') })}</li>
          <li>${icon('check')}${t('Лента, рейтинг и чат потока')}</li>
          <li>${icon('check')}${t('Сертификат и {xp} XP за финиш', { xp: 250 + c.days * 5 })}</li>
        </ul>`;
    }
    if (isOwner && raw.inviteCode) {
      const joinUrl = new URL(href(`/join/?code=${raw.inviteCode}`), location.href).href;
      html += `<div class="divider"></div><p class="eyebrow">${icon('key-round')}${t('Приглашение')}</p>
        <div class="invite"><span class="mono invite-code">${raw.inviteCode}</span><button class="btn btn-ghost btn-sm" data-copy="${esc(joinUrl)}">${icon('copy')}${t('Скопировать ссылку')}</button></div>
        <p class="muted small">${t('Отправьте ссылку или код участникам: вступить можно на странице «Вступить по коду».')}</p>`;
    }
    html += `<div class="confirm" id="confirm" hidden><p class="small">${t('Прогресс по этому челленджу будет удален без возможности восстановления.')}</p>
        <div class="cta-row"><button class="btn btn-danger btn-sm" id="leave-yes" data-busy="${t('Удаляем…')}">${t('Покинуть')}</button><button class="btn btn-ghost btn-sm" id="leave-no">${t('Остаться')}</button></div></div>`;
    if (!custom) html += `<div class="divider"></div>
      <div class="row-between small"><span class="muted">${t('Средний прогресс потока')}</span><span class="mono" data-stat="avg">—</span></div>
      <div data-stat-bar="avg">${bar(0, 'primary', t('Средний прогресс участников'))}</div>`;
    html += `<button class="btn-link small" data-copy="${esc(location.href)}">${icon('link')}${t('Скопировать ссылку')}</button>`;
    card.innerHTML = html;
    bindJoin();
    startCountdown();
  }

  function renderSticky() {
    const sb = $('#sticky-cta');
    const act = sb.querySelector('[data-act]');
    if (enrollment && !notStarted()) {
      const doneToday = enrollment.checkins.some(k => k.day === cur());
      sb.querySelector('[data-sub]').textContent = t('День {n} из {total}', { n: cur(), total: c.days });
      act.outerHTML = doneToday ? `<a class="btn btn-ghost btn-sm" data-act href="${href('/dashboard/')}">${t('Кабинет')}</a>` : `<button class="btn btn-primary btn-sm" data-act data-checkin>${t('Отметить')}</button>`;
    } else if (!enrollment) {
      act.outerHTML = `<button class="btn btn-primary btn-sm" data-act data-goto-join>${c.priceUzs && !paid ? t('Оплатить') : t('Участвовать')}</button>`;
    } else act.outerHTML = `<span data-act class="muted small">${t('Старт {date}', { date: date(enrollment.startDate, { year: false }) })}</span>`;
    $$('[data-checkin]', sb).forEach(b => b.addEventListener('click', openCheckin));
    $$('[data-goto-join]', sb).forEach(b => b.addEventListener('click', () => $('#join-card').scrollIntoView({ behavior: 'smooth', block: 'center' })));
  }

  /* ---------- План по дням ---------- */
  function renderTasks() {
    const d = enrollment && !notStarted() ? cur() : 0;
    const notes = Object.fromEntries((enrollment?.checkins || []).map(k => [k.day, k]));
    $('#tasks-count').textContent = enrollment ? `${enrollment.checkins.length}/${c.days}` : tn(c.days, 'день');
    $('#tasks-hint').hidden = !!enrollment;
    $$('.day[data-day]').forEach(li => {
      const n = +li.dataset.day, k = notes[n];
      const isDone = !!k, missed = d && !isDone && n < d, today = d && n === d, locked = enrollment && (!d || n > d);
      li.className = `day ${isDone ? 'is-done' : ''} ${missed ? 'is-missed' : ''} ${today ? 'is-today' : ''}`;
      $('.day-check', li).innerHTML = icon(isDone ? 'check' : missed ? 'x' : locked ? 'lock' : 'circle');
      $('.day-act', li).innerHTML = today && !isDone ? `<button class="btn btn-primary btn-sm" data-checkin>${t('Отметить')}</button>`
        : today && isDone ? `<button class="btn-link small" data-undo data-busy="…">${t('Отменить')}</button>` : missed ? `<span class="tag tag-miss">${t('Пропуск')}</span>` : '';
      const noteEl = $('.day-note', li);
      const bits = [];
      if (k?.note) bits.push(`${icon('message-square')}${esc(k.note)}`);
      if (k?.photo) bits.push(`${icon('camera')}${t('фото')}`);
      if (k?.proofUrl) bits.push(`${icon('link')}${t('ссылка')}`);
      if (k?.shared) bits.push(`${icon('messages-square')}${t('в ленте')}`);
      noteEl.innerHTML = bits.join(' · '); noteEl.hidden = !bits.length;
    });
    $$('.phase').forEach(ph => {
      const days = $$('.day[data-day]', ph).map(li => +li.dataset.day);
      $('[data-phase-count]', ph).textContent = enrollment ? `${days.filter(x => notes[x]).length}/${days.length}` : '';
      if (d) ph.open = d >= days[0] && d <= days[days.length - 1];
    });
    $$('#tasks [data-checkin]').forEach(b => b.addEventListener('click', openCheckin));
    $$('#tasks [data-undo]').forEach(b => b.addEventListener('click', () => withBusy(b, async () => {
      try { await api.undo(slug); toast(t('Отметка снята')); await refresh(); } catch (e) { toast(t(e.message), 'error'); }
    })));
  }

  /* ---------- Поток, отчет организатора, отзыв ---------- */
  async function renderCohortBox() {
    const box = $('#cohort-box');
    if (!enrollment?.cohortId) { box.hidden = true; return; }
    const h = cohorts.find(x => x.id === enrollment.cohortId);
    const r = await api.cohortResults(enrollment.cohortId).catch(() => null);
    box.hidden = false;
    box.innerHTML = `<h2>${icon('users')}${t('Ваш поток')}</h2>
      <p class="muted small">${h ? (h.title ? esc(h.title) + ' · ' : '') + t('старт {date}', { date: date(h.startDate) }) : t('Общий старт {date}', { date: date(enrollment.startDate) })}</p>
      ${r ? `<div class="mini-stats"><div><b class="mono">${num(r.participants)}</b><span class="muted small">${t('участников')}</span></div><div><b class="mono">${r.avg_progress}%</b><span class="muted small">${t('средний прогресс')}</span></div><div><b class="mono">${num(r.finished)}</b><span class="muted small">${t('финишировали')}</span></div></div>
        ${r.top?.length ? `<p class="small muted">${t('Лидеры')}: ${r.top.map(x => `<b>${esc(x.name)}</b> (${x.done})`).join(', ')}</p>` : ''}` : ''}
      <button class="btn btn-ghost btn-sm" data-open-tab="chat">${icon('message-circle')}${t('Открыть чат потока')}</button>`;
    $('[data-open-tab]', box).addEventListener('click', () => openTab('chat'));
  }

  async function renderOrganizer() {
    const box = $('#organizer-box');
    if (!isOwner) { box.hidden = true; return; }
    const rows = await api.organizerReport(slug).catch(() => []);
    box.hidden = false;
    box.innerHTML = `<div class="row-between wrap-row"><h2>${icon('clipboard-list')}${t('Отчет организатора')}</h2>
        <div class="cta-row"><a class="btn btn-ghost btn-sm" href="${href(`/create/?id=${slug}`)}">${icon('pencil')}${t('Редактировать')}</a><button class="btn btn-ghost btn-sm" id="csv">${icon('download')}CSV</button></div></div>
      ${rows.length ? `<div class="table-scroll"><table><thead><tr><th>${t('Участник')}</th><th class="num">${t('Выполнено')}</th><th class="num">${t('Серия')}</th><th>${t('Последняя отметка')}</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.name)}${r.status === 'completed' ? ` <span class="tag tag-live">${t('финиш')}</span>` : ''}</td><td class="num mono">${r.done} · ${r.pct}%</td><td class="num mono">${r.streak}</td><td class="muted">${r.last_checkin ? date(r.last_checkin, { year: false }) : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="muted small">${t('Пока никто не вступил. Отправьте участникам код приглашения.')}</p>`}
      <button class="btn-link small danger-link" id="del-ch">${t('Удалить челлендж')}</button>`;
    $('#csv').addEventListener('click', () => {
      const head = [t('Участник'), t('Старт'), t('Статус'), t('Выполнено дней'), '%', t('Серия'), t('Последняя отметка')];
      const lines = [head, ...rows.map(r => [r.name, r.start_date, r.status, r.done, r.pct, r.streak, r.last_checkin || ''])].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${slug}-report.csv` });
      document.body.appendChild(a); a.click(); a.remove();
    });
    $('#del-ch').addEventListener('click', () => Modal.open({
      title: t('Удалить челлендж?'), size: 'sm',
      body: `<p>${t('Челлендж и прогресс всех участников будут удалены без возможности восстановления.')}</p><div class="cta-row mt"><button class="btn btn-danger" id="del-yes" data-busy="${t('Удаляем…')}">${t('Удалить')}</button><button class="btn btn-ghost" data-close>${t('Отмена')}</button></div>`,
      onMount: m => $('#del-yes', m).addEventListener('click', e => withBusy(e.currentTarget, async () => { await api.deleteMyChallenge(slug); location.href = href('/dashboard/my/'); }))
    }));
  }

  function renderReview() {
    const box = $('#review-box');
    if (!finished) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `
      <h2 class="h-sm">${icon('award')}${t('Челлендж пройден')}</h2>
      <a class="btn btn-primary" href="${href(`/certificate/?id=${finished.publicId}`)}">${icon('award')}${t('Открыть сертификат')}</a>
      ${custom ? '' : `<p class="muted small">${t('Расскажите, что получилось, — отзыв появится на сайте после модерации.')}</p>
      <form class="form" id="review-form">
        <label class="field" for="review-text"><span>${t('Ваш отзыв')}</span><textarea id="review-text" rows="3" minlength="20" maxlength="600" required placeholder="${t('От 20 до 600 символов')}"></textarea></label>
        <p class="form-error" id="review-err" role="alert" hidden></p>
        <div><button class="btn btn-ghost" type="submit" data-busy="${t('Отправляем…')}">${t('Отправить на модерацию')}</button></div>
      </form>`}`;
    const f = $('#review-form'); if (!f) return;
    f.addEventListener('submit', e => {
      e.preventDefault();
      const text = $('#review-text').value.trim(), errEl = $('#review-err');
      if (text.length < 20) { errEl.textContent = t('Отзыв должен быть не короче 20 символов.'); errEl.hidden = false; return; }
      withBusy($('button', f), async () => {
        try { await api.submitTestimonial(slug, text); f.outerHTML = `<p class="note-ok">${icon('circle-check')}${t('Спасибо! Отзыв отправлен на модерацию.')}</p>`; }
        catch (x) { errEl.textContent = t(x.message); errEl.hidden = false; }
      });
    });
  }

  /* ---------- Действия ---------- */
  function openCheckin() {
    if (!api.auth.user) return requireLogin(t('Войдите, чтобы отмечать дни'));
    if (!enrollment || notStarted()) return;
    checkInDialog(raw, cur(), tasks[cur() - 1].task, () => refresh());
  }

  async function join(btn) {
    if (!api.auth.user) return requireLogin(t('Войдите или зарегистрируйтесь, чтобы вступить в челлендж'));
    const pick = $('input[name=cohort]:checked');
    const cohortId = pick && pick.value ? +pick.value : null;
    await withBusy(btn, async () => {
      try { await api.join(slug, cohortId); confetti(); track('join_challenge', { challenge: slug }); toast(t('Вы в потоке! План по дням уже в кабинете.')); await refresh(); }
      catch (e) { toast(t(e.message) || t('Не удалось записаться. Попробуйте еще раз.'), 'error'); if (!e.status) report(e, { action: 'join' }); }
    });
  }

  async function pay(btn) {
    if (!api.auth.user) return requireLogin(t('Войдите, чтобы оплатить челлендж'));
    await withBusy(btn, async () => {
      try {
        const r = await api.createPayment(slug, btn.dataset.pay);
        track('begin_checkout', { challenge: slug, provider: btn.dataset.pay, value: c.priceUzs });
        if (r.url) { location.href = r.url; return; }
        location.href = href(`/pay/?order=${r.order}`);
      } catch (e) { toast(t(e.message), 'error'); if (!e.status) report(e, { action: 'payment' }); }
    });
  }

  function bindJoin() {
    const j = $('#join'); if (j) j.addEventListener('click', () => join(j));
    $$('#join-card [data-pay]').forEach(b => b.addEventListener('click', () => pay(b)));
    $$('#join-card [data-checkin]').forEach(b => b.addEventListener('click', openCheckin));
    const leave = $('#leave');
    if (leave) {
      leave.addEventListener('click', () => { $('#confirm').hidden = false; });
      $('#leave-no').addEventListener('click', () => { $('#confirm').hidden = true; });
      $('#leave-yes').addEventListener('click', e => withBusy(e.currentTarget, async () => {
        try { await api.leave(slug); toast(t('Вы покинули челлендж')); await refresh(); } catch (x) { toast(t(x.message), 'error'); }
      }));
    }
    $$('#join-card [data-copy]').forEach(b => b.addEventListener('click', async () => toast(await copyText(b.dataset.copy) ? t('Ссылка скопирована') : t('Скопируйте ссылку из адресной строки'))));
  }

  let cdTimer;
  function startCountdown() {
    clearInterval(cdTimer);
    const cd = $('#countdown'); if (!cd) return;
    const target = Date.parse(cd.dataset.target + 'T00:00:00'), cells = $$('b', cd);
    const tick = () => {
      const s = Math.max(0, Math.floor((target - Date.now()) / 1000));
      [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60].forEach((v, i) => { cells[i].textContent = String(v).padStart(2, '0'); });
      if (s === 0) { clearInterval(cdTimer); refresh(); }
    };
    tick(); cdTimer = setInterval(tick, 1000);
  }

  /* ---------- Вкладки: лента, рейтинг, чат ---------- */
  let feedApi = null, chatTimer = null, chatLast = 0;
  function openTab(name) {
    $$('[role=tab][data-tab]').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $$('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
    clearInterval(chatTimer);
    if (name === 'feed') {
      if (!feedApi) feedApi = mountFeed($('#feed-list'), $('#feed-more'), before => api.feed(slug, { before }), {
        emptyHtml: empty('messages-square', t('Лента пока пустая'), t('Отметьте день и включите «Поделиться в ленте потока» — ваша запись появится здесь первой.')) });
      feedApi.reload();
    }
    if (name === 'rating') renderLeaderboard();
    if (name === 'chat') { loadChat(); chatTimer = setInterval(loadChat, 8000); }
  }
  $$('[role=tab][data-tab]').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));

  async function renderLeaderboard() {
    const box = $('#lb');
    try {
      const rows = await api.leaderboard(slug, lbOrder, lbCohortOnly && enrollment?.cohortId ? enrollment.cohortId : null);
      box.innerHTML = rows.length ? rows.map(x => `
        <li class="lb-row ${x.me ? 'me' : ''}">
          <span class="lb-place mono ${x.rank <= 3 ? 'top top-' + x.rank : ''}">${x.rank}</span>${avatar(x.name, 'avatar-sm')}
          <span class="lb-name">${x.me ? t('Вы') : x.userId ? `<a href="${href(`/u/?id=${x.userId}`)}">${esc(x.name)}</a>` : esc(x.name)}</span>
          <span class="lb-streak mono small" title="${t('Серия')}">${icon('flame')}${x.streak}</span>
          <span class="lb-bar">${bar(x.pct, x.me ? 'success' : 'primary')}</span><span class="mono small lb-pct">${x.pct}%</span>
        </li>`).join('') : `<li class="muted small lb-empty">${icon('users')}${t('В потоке пока никого. Вступите первым — и окажетесь на вершине рейтинга.')}</li>`;
    } catch (e) { box.innerHTML = `<li class="muted small">${t('Не удалось загрузить рейтинг.')}</li>`; report(e, { action: 'leaderboard' }); }
  }
  $$('[data-lb]').forEach(b => b.addEventListener('click', () => {
    $$('[data-lb]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
    lbOrder = b.dataset.lb; renderLeaderboard();
  }));

  async function loadChat() {
    if (!enrollment?.cohortId) return;
    const log = $('#chat-log');
    const msgs = await api.chat(enrollment.cohortId, chatLast).catch(() => []);
    if (!chatLast && !msgs.length) log.innerHTML = `<p class="muted small chat-empty">${t('Сообщений пока нет. Поздоровайтесь с потоком!')}</p>`;
    if (msgs.length) {
      const first = !chatLast;
      $('.chat-empty', log)?.remove();
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.insertAdjacentHTML('beforeend', msgs.map(m => `<div class="msg ${m.mine ? 'mine' : ''}">${m.mine ? '' : avatar(m.author, 'avatar-xs')}<div class="msg-body">${m.mine ? '' : `<b class="small">${esc(m.author)}</b>`}<p>${esc(m.text)}</p><span class="muted small">${ago(m.at)}</span></div>
        ${m.mine ? '' : `<button class="icon-btn icon-btn-sm" data-report="message" data-id="${m.id}" aria-label="${t('Пожаловаться')}">${icon('flag')}</button>`}</div>`).join(''));
      chatLast = msgs[msgs.length - 1].id;
      if (atBottom || first) log.scrollTop = log.scrollHeight;
    }
  }
  $('#chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#chat-input'), text = input.value.trim(); if (!text || !enrollment?.cohortId) return;
    withBusy($('#chat-form button'), async () => {
      try { await api.sendMessage(enrollment.cohortId, text); input.value = ''; await loadChat(); $('#chat-log').scrollTop = 1e9; }
      catch (x) { toast(t(x.message), 'error'); }
    });
  });

  async function refresh() {
    try { await loadMine(); } catch (e) { report(e, { action: 'my_enrollments' }); }
    $('#t-chat').hidden = !enrollment?.cohortId;
    renderJoin(); renderSticky(); renderTasks(); renderReview(); renderCohortBox(); renderOrganizer();
    if (!custom) { resetStats(); hydrateCards(); }
  }

  if (!custom) hydrateCards().then(stats => {
    const s = stats[slug];
    $('#fact-participants').textContent = s ? num(s.participants) : '—';
    $('#fact-finish').textContent = s && s.finish !== null ? s.finish + '%' : t('нет данных');
  });
  else { $('#fact-participants').textContent = '—'; $('#fact-finish').textContent = '—'; }

  const card = $('#join-card'), sticky = $('#sticky-cta');
  if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => sticky.classList.toggle('show', !en.isIntersecting && en.boundingClientRect.top < 0)).observe(card);

  await refresh();
  if (location.hash === '#feed' || location.hash === '#chat' || location.hash === '#rating') openTab(location.hash.slice(1));
}
