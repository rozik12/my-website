/* Личный кабинет: Обзор · Лента друзей · Активность · Достижения · Мои челленджи · Настройки. */
import { api } from '../api/index.js';
import { CHALLENGES } from '../content.js';
import { summarize, activityByDate, badges, levelTitle, dayTasks, addDaysIso, passwordProblems } from '../lib/logic.js';
import { t, tn, num, date, monthShort, localize, LANGS, LANG_NAMES } from '../i18n/index.js';
import { esc } from '../lib/util.js';
import { icon, bar, ring, avatar, dayGrid, empty, levelChip, catLabel, MOODS } from '../ui/markup.js';
import { $, $$, ctx, href, toast, withBusy, Tip, copyText } from '../ui/runtime.js';
import { checkInDialog, requireLogin, humanAuthError } from '../ui/shell.js';
import { mountFeed } from '../ui/feed.js';
import { shareStreakCard } from './certificate.js';
import { report } from '../monitor.js';

const TAB = document.body.dataset.tab || 'overview';

/* ---------- Тепловая карта (26 недель) ---------- */
function heatmap(act) {
  const weeks = 26, td = ctx.today;
  const dow = (new Date(td + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const start = addDaysIso(td, -(weeks - 1) * 7 - dow);
  let cols = '', months = '', lastM = -1, active = 0, total = 0;
  for (let w = 0; w < weeks; w++) {
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const day = addDaysIso(start, w * 7 + d);
      if (day > td) { cells += '<span class="hm-cell future"></span>'; continue; }
      const n = act[day] || 0;
      if (n) { active++; total += n; }
      cells += `<span class="hm-cell l${Math.min(3, n)}" data-tip="${date(day, { year: false })}: ${n ? tn(n, 'чекин') : t('нет отметок')}"></span>`;
    }
    const m = +addDaysIso(start, w * 7).slice(5, 7) - 1;
    months += `<span>${m !== lastM ? monthShort(m) : ''}</span>`; lastM = m;
    cols += `<div class="hm-col">${cells}</div>`;
  }
  const dn = [t('Пн'), '', t('Ср'), '', t('Пт'), '', ''];
  return { active, total, html: `
    <div class="hm-scroll"><div class="hm">
      <div class="hm-months" style="--weeks:${weeks}">${months}</div>
      <div class="hm-body"><div class="hm-days small muted">${dn.map(x => `<span>${x}</span>`).join('')}</div>
        <div class="hm-grid" role="img" aria-label="${t('Активность за полгода')}: ${active} / ${total}">${cols}</div></div>
    </div></div>
    <div class="hm-legend small muted">${t('Меньше')}<span class="hm-cell l0"></span><span class="hm-cell l1"></span><span class="hm-cell l2"></span><span class="hm-cell l3"></span>${t('Больше')}</div>` };
}

/* ---------- Чекины по неделям (12 недель) ---------- */
function weekly(act) {
  const N = 12, td = ctx.today, dow = (new Date(td + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const start0 = addDaysIso(td, -dow - (N - 1) * 7);
  const data = Array.from({ length: N }, (_, w) => { const s = addDaysIso(start0, w * 7); let v = 0; for (let d = 0; d < 7; d++) v += act[addDaysIso(s, d)] || 0; return { s, v }; });
  const maxV = Math.max(...data.map(d => d.v)), top = Math.max(4, Math.ceil(maxV / 4) * 4);
  const W = 940, H = 240, L = 32, R = 8, T = 16, B = 28, bw = (W - L - R) / N, barW = Math.min(28, bw * 0.56);
  const y = v => T + (H - T - B) * (1 - v / top);
  let g = '', bars = '', labels = '';
  [0, top / 2, top].forEach(v => { g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'axis' : 'grid'}"/><text x="${L - 8}" y="${y(v)}" class="tick" text-anchor="end" dominant-baseline="central">${v}</text>`; });
  data.forEach((d, i) => {
    const x = L + i * bw + (bw - barW) / 2, y0 = y(0), y1 = y(d.v), rr = Math.min(4, y0 - y1), cur = i === N - 1;
    if (d.v > 0) bars += `<path d="M${x} ${y0} V${y1 + rr} Q${x} ${y1} ${x + rr} ${y1} H${x + barW - rr} Q${x + barW} ${y1} ${x + barW} ${y1 + rr} V${y0} Z" class="bar-mark ${cur ? 'cur' : ''}"/>`;
    if (d.v > 0 && (cur || d.v === maxV)) bars += `<text x="${x + barW / 2}" y="${y1 - 6}" text-anchor="middle" class="val">${d.v}</text>`;
    bars += `<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" class="hit" tabindex="0" data-tip="<b>${date(d.s, { year: false, short: true })} – ${date(addDaysIso(d.s, 6), { year: false, short: true })}</b><br>${tn(d.v, 'чекин')}${cur ? ' · ' + t('текущая неделя') : ''}"/>`;
    if (i % 2 === (N - 1) % 2) labels += `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" class="tick">${date(d.s, { year: false, short: true })}</text>`;
  });
  const sum = data.reduce((a, d) => a + d.v, 0);
  return { sum, avg: (sum / N).toFixed(1), html: `
    <div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('Чекины по неделям')}: ${sum}">${g}${bars}${labels}</svg></div>
    <details class="table-view"><summary class="small muted">${t('Показать таблицей')}</summary>
      <table><thead><tr><th>${t('Неделя с')}</th><th class="num">${t('Чекины')}</th></tr></thead><tbody>${data.map(d => `<tr><td>${date(d.s, { year: false })}</td><td class="num mono">${d.v}</td></tr>`).join('')}</tbody></table></details>` };
}

/* ---------- Разделы ---------- */
function overview(sum) {
  const s = sum.stats, startedActive = sum.active.filter(a => !a.notStarted), left = startedActive.filter(a => !a.doneToday).length;
  return `
  <section class="wrap stats">
    ${[['flame', 'Текущая серия', tn(s.currentStreak, 'день'), 'warn'], ['circle-check', 'Чекинов всего', num(s.totalCheckins), 'success'],
       ['gauge', 'Выполнение плана', s.rate + '%', 'primary'], ['trophy', 'Завершено челленджей', num(s.finished), 'primary']]
      .map(([ic, l, v, tone]) => `<div class="stat card"><span class="stat-ic tone-${tone}">${icon(ic)}</span><span class="muted small">${t(l)}</span><b class="mono">${v}</b></div>`).join('')}
  </section>
  ${startedActive.length ? `<section class="wrap section-sm"><div class="card plan">
    <div class="row-between wrap-row">
      <div><h2 class="h-sm">${t('План на сегодня')}</h2><p class="muted small">${date(ctx.today)}</p></div>
      <span class="tag ${left ? 'tag-hot' : 'tag-live'}">${left ? `${icon('clock')}${t('Осталось {n} из {total}', { n: left, total: startedActive.length })}` : `${icon('party-popper')}${t('Все задания выполнены')}`}</span>
    </div>
    <ul class="plan-list">${startedActive.map(a => `
      <li class="plan-item ${a.doneToday ? 'is-done' : ''}">
        <span class="today-check">${icon(a.doneToday ? 'check' : 'circle')}</span>
        <div class="plan-main"><b>${esc(dayTasks(a.challenge)[a.cur - 1].task)}</b><span class="muted small">${esc(a.challenge.title)} · ${t('день {n}', { n: a.cur })}</span></div>
        ${a.doneToday ? `<button class="btn-link small" data-undo="${a.slug}" data-busy="…">${t('Отменить')}</button>` : `<button class="btn btn-primary btn-sm" data-check="${a.slug}">${t('Отметить')}</button>`}
      </li>`).join('')}</ul></div></section>` : ''}
  <section class="wrap section-sm">
    <div class="row-between"><h2 class="h-sm">${t('Текущие челленджи')}</h2><span class="muted small">${t('Активных: {n}', { n: sum.active.length })}</span></div>
    <div class="trackers">${sum.active.length ? sum.active.map(a => {
      const url = a.challenge.custom ? href(`/c/?id=${a.slug}`) : href(`/challenges/${a.slug}/`);
      return `
      <article class="card tracker">
        <header class="tracker-head">
          <span class="ch-icon cat-${a.challenge.category}">${icon(a.challenge.icon || 'target')}</span>
          <div class="tracker-title"><a href="${url}"><h3>${esc(a.challenge.title)}</h3></a>
            <p class="muted small">${a.notStarted ? t('Старт {date}', { date: date(a.startDate, { year: false }) }) : t('День {n} из {total}', { n: a.cur, total: a.challenge.days })} ${levelChip(a.challenge.level)}</p></div>
          ${ring(a.pct, 56)}
        </header>
        ${dayGrid(a.challenge.days, a.done, a.notStarted ? 0 : a.cur, { compact: true, cols: a.challenge.days > 30 ? 15 : Math.min(a.challenge.days, 15) })}
        <div class="tracker-foot small">
          <span class="streak-fire mono">${icon('flame')}${t('Серия {n}', { n: a.streak })}</span>
          ${a.streak >= 3 ? `<button class="btn-link" data-share-streak="${a.slug}">${icon('share-2')}${t('Поделиться')}</button>` : `<span class="muted">${t('Осталось {n}', { n: tn(Math.max(0, a.challenge.days - a.cur), 'день') })}</span>`}
          <a class="btn-link" href="${url}">${t('План')} ${icon('arrow-right')}</a>
        </div>
      </article>`;
    }).join('') : empty('compass', t('Нет активных челленджей'), t('Выберите программу в каталоге — трекер появится здесь.'), `<a class="btn btn-primary" href="${href('/challenges/')}">${t('Перейти в каталог')}</a>`)}
    </div>
  </section>`;
}

function feedTab() {
  return `<section class="wrap section-sm dash-feed">
    <div class="feed-col"><div class="row-between wrap-row"><h2 class="h-sm">${t('Лента друзей')}</h2><a class="btn btn-ghost btn-sm" href="${href('/people/')}">${icon('user-plus')}${t('Найти друзей')}</a></div>
      <div id="feed-list" class="posts mt"></div><div class="center"><button class="btn btn-ghost" id="feed-more" hidden>${t('Показать еще')}</button></div></div>
  </section>`;
}

function activity(sum, enrollments, bySlug) {
  const act = activityByDate(enrollments), hm = heatmap(act), wk = weekly(act);
  const journal = enrollments.flatMap(e => e.checkins.map(k => ({ c: bySlug[e.slug], ...k, date: k.date || addDaysIso(e.startDate, k.day - 1) }))).filter(j => j.c)
    .sort((a, b) => b.date.localeCompare(a.date) || b.day - a.day);
  const moodCount = [1, 2, 3, 4, 5].map(m => journal.filter(j => j.mood === m).length), moodMax = Math.max(1, ...moodCount);
  return `
  <section class="wrap section-sm act-grid">
    <article class="card block act-wide"><div><h2 class="h-sm">${t('Активность')}</h2><p class="muted small">${t('{days} активных дней и {n} за полгода', { days: hm.active, n: tn(hm.total, 'чекин') })}</p></div>${hm.html}</article>
    <article class="card block act-wide">
      <div class="row-between wrap-row"><div><h2 class="h-sm">${t('Чекины по неделям')}</h2><p class="muted small">${t('Последние 12 недель · в среднем {n} в неделю', { n: wk.avg })}</p></div><span class="mono big-sm">${wk.sum}</span></div>
      ${wk.html}
    </article>
    <article class="card block"><h2 class="h-sm">${t('Самочувствие')}</h2><p class="muted small">${t('Оценки из {n}', { n: tn(journal.length, 'чекин') })}</p>
      <div class="moods-dist">${MOODS.slice().reverse().map(([v, ic, l]) => `
        <div class="dist-row" tabindex="0" data-tip="<b>${t(l)}</b><br>${tn(moodCount[v - 1], 'чекин')}">
          <span class="small mood-l">${icon(ic)}${t(l)}</span><div class="dist-track"><span style="--w:${Math.round(moodCount[v - 1] / moodMax * 100)}%"></span></div><span class="mono small">${moodCount[v - 1]}</span>
        </div>`).join('')}</div></article>
    <article class="card block"><h2 class="h-sm">${t('Дневник')}</h2>
      <ul class="journal">${journal.slice(0, 6).map(j => {
        const m = MOODS[(j.mood || 3) - 1];
        return `<li><span class="journal-mood" title="${t(m[2])}">${icon(m[1])}</span><div><b class="small">${esc(j.c.title)} · ${t('день {n}', { n: j.day })}</b>
          <p class="muted small">${j.note ? esc(j.note) : t('Без заметки')} · ${date(j.date, { year: false })}</p></div></li>`;
      }).join('') || `<li class="muted small">${t('Записей пока нет. Отметьте день с заметкой — она появится здесь.')}</li>`}</ul></article>
  </section>
  <section class="wrap section-sm">
    <div class="row-between"><h2 class="h-sm">${t('История')}</h2><span class="muted small">${t('Завершено: {n}', { n: sum.finished.length })}</span></div>
    ${sum.finished.length ? `<div class="card history"><div class="table-scroll"><table>
      <thead><tr><th>${t('Челлендж')}</th><th>${t('Категория')}</th><th>${t('Финиш')}</th><th class="num">${t('Длительность')}</th><th class="num">${t('Сертификат')}</th></tr></thead>
      <tbody>${sum.finished.map(f => `<tr>
        <td><a href="${href(`/challenges/${f.slug}/`)}" class="hist-name"><span class="ch-icon sm cat-${f.challenge.category}">${icon(f.challenge.icon || 'target')}</span>${esc(f.challenge.title)}</a></td>
        <td class="muted">${catLabel(f.challenge.category)}</td><td class="muted">${f.completedAt ? date(f.completedAt.slice(0, 10)) : '—'}</td>
        <td class="num mono">${tn(f.challenge.days, 'день')}</td>
        <td class="num"><a class="btn-link small" href="${href(`/certificate/?id=${f.publicId}`)}">${icon('award')}${t('Открыть')}</a></td></tr>`).join('')}</tbody></table></div></div>`
      : `<div class="mt">${empty('flag', t('Пока нет завершенных челленджей'), t('Когда вы пройдете первый челлендж, он появится здесь вместе с сертификатом.'))}</div>`}
  </section>`;
}

function achievements(sum) {
  const s = sum.stats, list = badges(s);
  return `
  <section class="wrap section-sm"><div class="card level-card">
    <div class="level-ring">${ring(s.levelPct, 112, 'primary')}<span class="muted small">${t('до уровня {n}', { n: s.level + 1 })}</span></div>
    <div class="level-info"><p class="eyebrow">${t('Уровень {n}', { n: s.level })}</p><h2>${t(levelTitle(s.level))}</h2>
      <p class="muted">${num(s.xp)} XP. ${t('10 XP за чекин, 250 XP за завершенный челлендж и 5 XP за каждый день его программы.')}</p>
      <ol class="lvl-path">${[1, 2, 3, 4, 5, 6].map(l => `<li class="${l < s.level ? 'done' : l === s.level ? 'cur' : ''}"><span class="mono">${l}</span></li>`).join('')}</ol></div>
  </div></section>
  <section class="wrap section-sm">
    <div class="row-between"><h2 class="h-sm">${t('Бейджи')}</h2><span class="muted small">${t('Открыто {n} из {total}', { n: list.filter(b => b.earned).length, total: list.length })}</span></div>
    <div class="badges">${list.map(b => `
      <div class="badge ${b.earned ? 'on' : ''}"><span class="badge-ic">${icon(b.earned ? b.icon : 'lock')}</span><b>${t(b.title)}</b><span class="small muted">${t(b.desc)}</span>
        ${b.earned ? `<span class="tag tag-live small">${icon('check')}${t('Получен')}</span>` : `<div class="badge-prog">${bar(Math.round(b.value / b.goal * 100))}<span class="mono small muted">${b.value}/${b.goal}</span></div>`}
      </div>`).join('')}</div>
  </section>`;
}

async function myTab() {
  const list = await api.myChallenges().catch(() => []);
  return `<section class="wrap section-sm">
    <div class="row-between wrap-row"><div><h2 class="h-sm">${t('Мои челленджи')}</h2><p class="muted small">${t('Закрытые челленджи для себя, друзей и команды. Участники вступают по коду приглашения.')}</p></div>
      <div class="cta-row"><a class="btn btn-ghost btn-sm" href="${href('/join/')}">${icon('key-round')}${t('Вступить по коду')}</a><a class="btn btn-primary btn-sm" href="${href('/create/')}">${icon('plus')}${t('Создать')}</a></div></div>
    ${list.length ? `<div class="card history mt"><div class="table-scroll"><table><thead><tr><th>${t('Челлендж')}</th><th class="num">${t('Длительность')}</th><th class="num">${t('Участники')}</th><th>${t('Код')}</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td><a class="hist-name" href="${href(`/c/?id=${c.slug}`)}">${icon('lock')}${esc(c.title)}</a></td><td class="num mono">${tn(c.days, 'день')}</td><td class="num mono">${c.participants}</td>
        <td><span class="mono">${c.invite_code}</span> <button class="icon-btn icon-btn-sm" data-copy-code="${c.invite_code}" aria-label="${t('Скопировать ссылку-приглашение')}">${icon('copy')}</button></td>
        <td class="num"><a class="btn-link small" href="${href(`/create/?id=${c.slug}`)}">${t('Изменить')}</a></td></tr>`).join('')}
      </tbody></table></div></div>`
      : `<div class="mt">${empty('pencil-ruler', t('Вы еще не создавали челленджи'), t('Соберите свой челлендж за пять минут и пригласите друзей или коллег.'), `<a class="btn btn-primary" href="${href('/create/')}">${icon('plus')}${t('Создать челлендж')}</a>`)}</div>`}
  </section>`;
}

function settings(p, user) {
  const toggle = (id, label, desc, on) => `<label class="switch-row" for="${id}"><span><b>${label}</b><span class="muted small">${desc}</span></span><span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span></label>`;
  return `
  <section class="wrap section-sm settings">
    <form class="card block form" id="profile-form" novalidate>
      <h2 class="h-sm">${t('Профиль')}</h2>
      <div class="form-row">
        <label class="field" for="s-name"><span>${t('Имя для рейтинга')}</span><input id="s-name" value="${esc(p.name)}" maxlength="60" required autocomplete="name"></label>
        <label class="field" for="s-handle"><span>${t('Никнейм')} <span class="muted">(${t('для поиска друзей')})</span></span><input id="s-handle" value="${esc(p.handle || '')}" maxlength="30" placeholder="alexey_92" autocomplete="username"></label>
      </div>
      <div class="form-row">
        <label class="field" for="s-city"><span>${t('Город')}</span><input id="s-city" value="${esc(p.city || '')}" maxlength="60" autocomplete="address-level2"></label>
        <label class="field" for="s-locale"><span>${t('Язык интерфейса')}</span><select id="s-locale" class="select-input">${LANGS.map(l => `<option value="${l}" ${(p.locale || 'ru') === l ? 'selected' : ''}>${LANG_NAMES[l]}</option>`).join('')}</select></label>
      </div>
      <label class="field" for="s-email"><span>${t('Электронная почта')}</span><input id="s-email" value="${esc(user.email)}" disabled></label>
      <p class="muted small">${t('Часовой пояс: {tz} — определяется автоматически и задает, какой день считается «сегодня».', { tz: esc(p.timezone) })}</p>
      <p class="form-error" id="s-err" role="alert" hidden></p>
      <div><button class="btn btn-primary" type="submit" data-busy="${t('Сохраняем…')}">${t('Сохранить профиль')}</button></div>
    </form>
    <form class="card block form" id="notif-form">
      <h2 class="h-sm">${t('Приватность')}</h2>
      ${toggle('s-public', t('Публичный профиль'), t('Показывать мое имя, прогресс и публикации в рейтинге, ленте и поиске людей'), p.publicProfile)}
      <div><button class="btn btn-primary" type="submit" data-busy="${t('Сохраняем…')}">${t('Сохранить настройки')}</button></div>
    </form>
    <form class="card block form" id="pass-form" novalidate>
      <h2 class="h-sm">${t('Пароль')}</h2>
      <label class="field" for="s-pass"><span>${t('Новый пароль')}</span><input id="s-pass" type="password" autocomplete="new-password" placeholder="${t('8+ символов, A–z и цифра')}"></label>
      <p class="form-error" id="p-err" role="alert" hidden></p>
      <div><button class="btn btn-ghost" type="submit" data-busy="${t('Сохраняем…')}">${t('Сменить пароль')}</button></div>
    </form>
    <div class="card block danger-zone">
      <h2 class="h-sm">${t('Аккаунт')}</h2>
      <p class="muted small">${t('Удаление аккаунта сразу и безвозвратно удаляет профиль, участие, отметки, публикации и заметки.')}</p>
      <div class="cta-row"><button class="btn btn-ghost" data-action="logout">${icon('log-out')}${t('Выйти')}</button><button class="btn btn-ghost danger-text" id="del">${icon('trash-2')}${t('Удалить аккаунт')}</button></div>
      <div class="confirm" id="del-confirm" hidden>
        <label class="field" for="del-word"><span>${t('Введите {w}, чтобы подтвердить', { w: `<b>${t('УДАЛИТЬ')}</b>` })}</span><input id="del-word" autocomplete="off"></label>
        <div class="cta-row"><button class="btn btn-danger btn-sm" id="del-yes" data-busy="${t('Удаляем…')}" disabled>${t('Удалить навсегда')}</button><button class="btn btn-ghost btn-sm" id="del-no">${t('Отмена')}</button></div>
      </div>
    </div>
  </section>`;
}

/* ---------- Монтирование ---------- */
export async function init() {
  const user = api.auth.user;
  if (!user) return requireLogin(t('Войдите, чтобы открыть личный кабинет'));
  const root = $('#dash');

  async function render() {
    let enrollments, profile;
    try { [enrollments, profile] = await Promise.all([api.myEnrollments(), api.getProfile()]); }
    catch (e) {
      if (e.status === 401) return requireLogin(t('Сессия истекла. Войдите снова'));
      root.innerHTML = `<section class="wrap section">${empty('wifi-off', t('Не удалось загрузить данные'), t('Проверьте соединение и обновите страницу.'), `<button class="btn btn-primary" id="reload">${t('Обновить')}</button>`)}</section>`;
      $('#reload').addEventListener('click', () => location.reload());
      report(e, { action: 'dashboard_load' }); return;
    }
    // Своих челленджей нет в каталоге сборки — догружаем их описание
    const known = Object.fromEntries(CHALLENGES.map(c => [c.slug, c]));
    const missing = [...new Set(enrollments.map(e => e.slug))].filter(s => !known[s]);
    const extra = await Promise.all(missing.map(s => api.challengeInfo(s).catch(() => null)));
    extra.filter(Boolean).forEach(c => { known[c.slug] = { ...c, custom: true }; });
    const catalog = Object.values(known).map(localize);
    const bySlug = Object.fromEntries(catalog.map(c => [c.slug, c]));
    const sum = summarize(enrollments, catalog, ctx.today);
    sum.active.forEach(a => { a.notStarted = ctx.today < a.startDate; if (a.notStarted) { a.doneToday = false; a.streak = 0; } });
    const name = profile?.name || user.name || user.email;

    $('#dash-head').innerHTML = `
      <div class="profile">
        <div class="avatar-ring">${avatar(name, 'avatar-lg')}<span class="lvl-badge mono">${sum.stats.level}</span></div>
        <div class="profile-info"><p class="eyebrow">${t('Личный кабинет')}</p><h1>${esc(name)}</h1>
          <p class="muted small">${t('Уровень {n}', { n: sum.stats.level })} · ${t(levelTitle(sum.stats.level))} · ${num(sum.stats.xp)} XP · ${t('до уровня {n} осталось {xp} XP', { n: sum.stats.level + 1, xp: num(sum.stats.toNext) })}</p>
          ${bar(sum.stats.levelPct, 'primary', t('Прогресс уровня'))}</div>
      </div>
      <a class="btn btn-primary" href="${href('/challenges/')}">${icon('plus')}${t('Новый челлендж')}</a>`;
    const nc = $('#nav-count'); if (nc) nc.textContent = sum.active.length || '';

    root.innerHTML = TAB === 'activity' ? activity(sum, enrollments, bySlug) : TAB === 'achievements' ? achievements(sum) : TAB === 'settings' ? settings(profile, user)
      : TAB === 'feed' ? feedTab() : TAB === 'my' ? await myTab() : overview(sum);
    root.setAttribute('aria-busy', 'false');

    $$('[data-check]', root).forEach(b => b.addEventListener('click', () => {
      const a = sum.active.find(x => x.slug === b.dataset.check);
      checkInDialog(known[a.slug], a.cur, dayTasks(a.challenge)[a.cur - 1].task, render);
    }));
    $$('[data-undo]', root).forEach(b => b.addEventListener('click', () => withBusy(b, async () => {
      try { await api.undo(b.dataset.undo); toast(t('Отметка снята')); render(); } catch (e) { toast(t(e.message), 'error'); }
    })));
    $$('[data-share-streak]', root).forEach(b => b.addEventListener('click', () => {
      const a = sum.active.find(x => x.slug === b.dataset.shareStreak);
      shareStreakCard({ name, title: a.challenge.title, streak: a.streak, day: a.cur, days: a.challenge.days, done: a.done.length });
    }));
    $$('[data-copy-code]', root).forEach(b => b.addEventListener('click', async () => {
      const url = new URL(href(`/join/?code=${b.dataset.copyCode}`), location.href).href;
      toast(await copyText(url) ? t('Ссылка-приглашение скопирована') : url);
    }));
    if (TAB === 'feed') mountFeed($('#feed-list'), $('#feed-more'), before => api.friendsFeed({ before }), {
      showChallenge: true, emptyHtml: empty('users', t('В ленте пока пусто'), t('Подпишитесь на друзей — здесь появятся их отметки, которыми они поделились.'), `<a class="btn btn-primary" href="${href('/people/')}">${t('Найти друзей')}</a>`) }).reload();
    Tip.bind(root);
    if (TAB === 'settings') bindSettings();
  }

  function bindSettings() {
    $('#profile-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#s-name').value.trim(), handle = $('#s-handle').value.trim().toLowerCase(), err = $('#s-err');
      if (!name) { err.textContent = t('Введите имя: оно показывается в рейтинге потока.'); err.hidden = false; return; }
      if (handle && !/^[a-z0-9_]{3,30}$/.test(handle)) { err.textContent = t('Никнейм: 3–30 символов, латиница, цифры и _'); err.hidden = false; return; }
      const locale = $('#s-locale').value;
      withBusy($('#profile-form button[type=submit]'), async () => {
        try {
          await api.updateProfile({ name, handle, city: $('#s-city').value.trim(), locale });
          toast(t('Профиль сохранен'));
          if (locale !== ctx.lang) { location.href = (document.body.dataset.root || '') + (locale === 'ru' ? '' : locale + '/') + 'dashboard/settings/' + (ctx.explicit ? 'index.html' : ''); return; }
          render();
        } catch (x) { err.textContent = /duplicate|unique|занят/i.test(x.message) ? t('Этот никнейм уже занят') : t(x.message); err.hidden = false; }
      });
    });
    $('#notif-form').addEventListener('submit', e => {
      e.preventDefault();
      withBusy($('#notif-form button[type=submit]'), async () => {
        try { await api.updateProfile({ publicProfile: $('#s-public').checked }); toast(t('Настройки сохранены')); } catch (x) { toast(t(x.message), 'error'); }
      });
    });
    $('#pass-form').addEventListener('submit', e => {
      e.preventDefault();
      const pw = $('#s-pass').value, err = $('#p-err'), probs = passwordProblems(pw);
      if (probs.length) { err.textContent = t('Пароль должен содержать: {list}.', { list: probs.map(x => t(x)).join(', ') }); err.hidden = false; return; }
      withBusy($('#pass-form button'), async () => {
        try { await api.auth.updatePassword(pw); err.hidden = true; $('#s-pass').value = ''; toast(t('Пароль изменен')); }
        catch (x) { err.textContent = t(humanAuthError(x)); err.hidden = false; }
      });
    });
    const word = t('УДАЛИТЬ');
    $('#del').addEventListener('click', () => { $('#del-confirm').hidden = false; $('#del-word').focus(); });
    $('#del-no').addEventListener('click', () => { $('#del-confirm').hidden = true; });
    $('#del-word').addEventListener('input', e => { $('#del-yes').disabled = e.target.value.trim().toUpperCase() !== word.toUpperCase(); });
    $('#del-yes').addEventListener('click', e => withBusy(e.currentTarget, async () => {
      try { await api.deleteAccount(); toast(t('Аккаунт удален')); setTimeout(() => { location.href = href('/'); }, 800); }
      catch (x) { toast(t(x.message), 'error'); report(x, { action: 'delete_account' }); }
    }));
  }

  await render();
}
