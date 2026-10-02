/* Админ-панель: обзор, каталог (с переводами и потоками), модерация, пользователи, заказы, ошибки.
   Доступ проверяется на сервере (is_admin в SQL-функциях); интерфейс — только для удобства. */
import { api, isDemo } from '../api/index.js';
import { SITE } from '../content.js';
import { esc } from '../lib/util.js';
import { LANGS, LANG_NAMES } from '../i18n/index.js';
import { icon, empty, bar } from '../ui/markup.js';
import { $, $$, toast, withBusy, Modal, Tip } from '../ui/runtime.js';
import { requireLogin } from '../ui/shell.js';

const fmt = n => new Intl.NumberFormat('ru-RU').format(n ?? 0);
const dt = s => s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const SECTIONS = [['overview', 'Обзор', 'gauge'], ['challenges', 'Каталог', 'layout-grid'], ['moderation', 'Модерация', 'shield-check'], ['users', 'Пользователи', 'users'], ['orders', 'Заказы', 'wallet'], ['errors', 'Ошибки', 'bug']];

function miniBars(rows, label) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return `<div class="mini-bars" role="img" aria-label="${label}">${rows.map(r => `<span tabindex="0" data-tip="<b>${r.day.slice(5)}</b><br>${r.n}" style="--h:${Math.round(r.n / max * 100)}%"></span>`).join('')}</div>`;
}

/* Фазы в текстовом виде: строка «## Название» начинает фазу, остальные строки — задания */
const phasesToText = ph => (ph || []).map(p => `## ${p.title}\n${p.tasks.join('\n')}`).join('\n');
function textToPhases(txt) {
  const out = [];
  for (const line of txt.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (line.startsWith('## ')) out.push({ title: line.slice(3).trim(), tasks: [] });
    else { if (!out.length) out.push({ title: 'План', tasks: [] }); out[out.length - 1].tasks.push(line); }
  }
  return out.filter(p => p.tasks.length);
}

export async function init() {
  const app = $('#app');
  if (!api.auth.user) return requireLogin('Войдите под аккаунтом администратора');
  if (!(await api.isAdmin().catch(() => false))) {
    app.innerHTML = `<section class="wrap section">${empty('shield-x', 'Нет доступа', 'Эта страница доступна только администраторам. Назначить администратора можно в базе: profiles.role = admin.')}</section>`;
    app.setAttribute('aria-busy', 'false'); return;
  }
  let section = location.hash.slice(1) || 'overview';
  app.innerHTML = `<nav class="wrap tabs" aria-label="Разделы админки">${SECTIONS.map(([k, l, ic]) => `<a href="#${k}" class="tab" data-sec="${k}">${icon(ic)}${l}<span class="nav-count mono" data-count="${k}"></span></a>`).join('')}</nav><div id="adm"></div>`;
  app.setAttribute('aria-busy', 'false');
  const box = $('#adm');
  const show = async name => {
    section = name;
    $$('[data-sec]').forEach(a => { a.classList.toggle('active', a.dataset.sec === name); a.toggleAttribute('aria-current', a.dataset.sec === name); });
    box.innerHTML = `<section class="wrap section-sm"><span class="spinner"></span></section>`;
    try { await ({ overview, challenges, moderation, users, orders, errors })[name](box); }
    catch (e) { box.innerHTML = `<section class="wrap section-sm"><p class="form-error">${esc(e.message)}</p></section>`; }
    Tip.bind(box);
  };
  addEventListener('hashchange', () => show(location.hash.slice(1) || 'overview'));
  show(section);
}

async function overview(box) {
  const s = await api.admin.stats();
  const tiles = [['users', 'Пользователей', fmt(s.users), `+${fmt(s.users_7d)} за 7 дней`], ['activity', 'Активны за сутки', fmt(s.active_24h), `${fmt(s.checkins_24h)} отметок`],
    ['flag', 'Участий сейчас', fmt(s.enrollments_active), `${fmt(s.completed)} завершено`], ['wallet', 'Выручка', fmt(s.revenue_uzs) + ' сум', `${fmt(s.revenue_30d_uzs)} за 30 дней`],
    ['shield-alert', 'Жалобы', fmt(s.open_reports), `${fmt(s.pending_testimonials)} отзывов ждут`], ['bug', 'Ошибки за сутки', fmt(s.errors_24h), 'из журнала клиента']];
  $('[data-count="moderation"]').textContent = (s.open_reports + s.pending_testimonials) || '';
  box.innerHTML = `<section class="wrap section-sm">
    <div class="stats adm-stats">${tiles.map(([ic, l, v, sub]) => `<div class="stat card"><span class="stat-ic tone-primary">${icon(ic)}</span><span class="muted small">${l}</span><b class="mono">${v}</b><span class="muted small">${sub}</span></div>`).join('')}</div>
    <div class="act-grid mt">
      <article class="card block"><h2 class="h-sm">Регистрации, 14 дней</h2>${miniBars(s.signups_by_day, 'Регистрации по дням')}</article>
      <article class="card block"><h2 class="h-sm">Отметки, 14 дней</h2>${miniBars(s.checkins_by_day, 'Отметки по дням')}</article>
    </div>
    <article class="card block mt"><h2 class="h-sm">Публикация изменений каталога</h2>
      <p class="muted small">Страницы каталога пререндерены для поисковиков. После правок в разделе «Каталог» пересоберите сайт — изменения появятся через 1–2 минуты.</p>
      <div><button class="btn btn-primary" id="rebuild" data-busy="Запускаем сборку…">${icon('refresh-cw')}Пересобрать сайт</button></div></article>
  </section>`;
  $('#rebuild').addEventListener('click', e => withBusy(e.currentTarget, async () => {
    try { const r = await api.admin.rebuild(); toast(r?.demo ? 'В демо-режиме сборка не запускается' : 'Сборка запущена'); } catch (x) { toast(x.message, 'error'); }
  }));
}

async function challenges(box) {
  const list = await api.admin.challenges();
  box.innerHTML = `<section class="wrap section-sm">
    <div class="row-between wrap-row"><h2 class="h-sm">Каталог (${list.filter(c => !c.custom).length}) и пользовательские (${list.filter(c => c.custom).length})</h2>
      <button class="btn btn-primary btn-sm" id="new-ch">${icon('plus')}Новый челлендж</button></div>
    <div class="card history mt"><div class="table-scroll"><table><thead><tr><th>Челлендж</th><th>Категория</th><th class="num">Дней</th><th class="num">Цена</th><th class="num">Участники</th><th>Статус</th><th></th></tr></thead><tbody>
    ${list.map(c => `<tr><td><b>${esc(c.title)}</b><span class="muted small mono"> ${c.slug}</span></td><td class="muted">${esc(SITE.categories[c.category]?.label || c.category)}</td>
      <td class="num mono">${c.days}</td><td class="num mono">${c.price_uzs ? fmt(c.price_uzs) : '—'}</td><td class="num mono">${c.participants}</td>
      <td>${c.custom ? '<span class="tag">свой</span>' : c.published ? '<span class="tag tag-live">опубликован</span>' : '<span class="tag tag-miss">скрыт</span>'}${Object.keys(c.content || {}).filter(l => l !== 'ru').map(l => ` <span class="tag">${l}</span>`).join('')}</td>
      <td class="num">${c.custom ? '' : `<button class="btn-link small" data-edit="${c.slug}">Изменить</button> · <button class="btn-link small" data-cohorts="${c.slug}">Потоки</button>`}</td></tr>`).join('')}
    </tbody></table></div></div></section>`;
  $('#new-ch').addEventListener('click', () => editChallenge(null, () => challenges(box)));
  $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => editChallenge(list.find(c => c.slug === b.dataset.edit), () => challenges(box))));
  $$('[data-cohorts]', box).forEach(b => b.addEventListener('click', () => editCohorts(b.dataset.cohorts)));
}

function editChallenge(c, done) {
  const isNew = !c;
  c = c || { slug: '', category: 'habits', level: 'easy', days: 21, icon: 'target', next_start: null, proof: 'none', price_uzs: 0, published: true, content: { ru: { title: '', short: '', goal: '', rules: [], phases: [] } } };
  const sel = (id, obj, val) => `<select id="${id}" class="select-input">${Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(v.label || v)}</option>`).join('')}</select>`;
  Modal.open({
    title: isNew ? 'Новый челлендж' : `Редактирование: ${esc(c.content?.ru?.title || c.slug)}`, size: 'lg',
    body: `<form class="form" id="ch-form" novalidate>
      <div class="form-row form-row-4">
        <label class="field" for="a-slug"><span>Адрес (slug)</span><input id="a-slug" value="${esc(c.slug)}" ${isNew ? '' : 'disabled'} pattern="[a-z0-9-]{2,60}" placeholder="morning-run"></label>
        <label class="field" for="a-cat"><span>Категория</span>${sel('a-cat', SITE.categories, c.category)}</label>
        <label class="field" for="a-level"><span>Сложность</span>${sel('a-level', SITE.levels, c.level)}</label>
        <label class="field" for="a-days"><span>Дней</span><input id="a-days" type="number" min="1" max="365" value="${c.days}"></label>
      </div>
      <div class="form-row form-row-4">
        <label class="field" for="a-icon"><span>Иконка (Lucide)</span><input id="a-icon" value="${esc(c.icon)}"></label>
        <label class="field" for="a-start"><span>Ближайший поток</span><input id="a-start" type="date" value="${c.next_start || ''}"></label>
        <label class="field" for="a-price"><span>Цена, сум (0 — бесплатно)</span><input id="a-price" type="number" min="0" step="1000" value="${c.price_uzs}"></label>
        <label class="field" for="a-proof"><span>Подтверждение</span>${sel('a-proof', { none: 'Не нужно', optional: 'По желанию', required: 'Обязательно' }, c.proof)}</label>
      </div>
      <label class="check" for="a-pub"><input type="checkbox" id="a-pub" ${c.published ? 'checked' : ''}><span>Опубликован в каталоге</span></label>
      <div class="tabs tabs-inline" role="tablist">${LANGS.map((l, i) => `<button type="button" class="tab ${i === 0 ? 'active' : ''}" data-lang-tab="${l}">${LANG_NAMES[l]}</button>`).join('')}</div>
      ${LANGS.map((l, i) => { const x = c.content?.[l] || {}; return `<div class="lang-pane" data-pane="${l}" ${i ? 'hidden' : ''}>
        ${l !== 'ru' ? '<p class="muted small">Пустые поля берутся из русской версии. Число фаз и заданий должно совпадать с русским.</p>' : ''}
        <label class="field" for="t-${l}"><span>Название</span><input id="t-${l}" value="${esc(x.title || '')}" maxlength="80"></label>
        <label class="field" for="s-${l}"><span>Коротко</span><input id="s-${l}" value="${esc(x.short || '')}" maxlength="200"></label>
        <label class="field" for="g-${l}"><span>Цель</span><textarea id="g-${l}" rows="2">${esc(x.goal || '')}</textarea></label>
        <label class="field" for="r-${l}"><span>Правила — по одному в строке</span><textarea id="r-${l}" rows="3">${esc((x.rules || []).join('\n'))}</textarea></label>
        <label class="field" for="p-${l}"><span>Фазы и задания: строка «## Фаза», затем задания по одному в строке</span><textarea id="p-${l}" rows="9" class="mono-ta">${esc(phasesToText(x.phases))}</textarea></label>
      </div>`; }).join('')}
      <p class="form-error" id="a-err" role="alert" hidden></p>
      <div class="cta-row"><button class="btn btn-primary" type="submit" data-busy="Сохраняем…">Сохранить</button>
        ${isNew ? '' : '<button type="button" class="btn btn-ghost danger-text" id="a-del" data-busy="…">Снять с публикации / удалить</button>'}</div>
    </form>`,
    onMount(m) {
      $$('[data-lang-tab]', m).forEach(b => b.addEventListener('click', () => {
        $$('[data-lang-tab]', m).forEach(x => x.classList.toggle('active', x === b));
        $$('[data-pane]', m).forEach(p => { p.hidden = p.dataset.pane !== b.dataset.langTab; });
      }));
      const fail = msg => { const e = $('#a-err', m); e.textContent = msg; e.hidden = false; };
      $('#ch-form', m).addEventListener('submit', e => {
        e.preventDefault();
        const content = {};
        for (const l of LANGS) {
          const x = { title: $(`#t-${l}`, m).value.trim(), short: $(`#s-${l}`, m).value.trim(), goal: $(`#g-${l}`, m).value.trim(),
            rules: $(`#r-${l}`, m).value.split('\n').map(s => s.trim()).filter(Boolean), phases: textToPhases($(`#p-${l}`, m).value) };
          if (l === 'ru' || x.title || x.phases.length) content[l] = x;
        }
        const ru = content.ru;
        if (!ru.title || !ru.phases.length) return fail('Русская версия: нужно название и хотя бы одна фаза с заданиями.');
        for (const l of ['uz', 'en']) {
          const ph = content[l]?.phases;
          if (ph?.length && (ph.length !== ru.phases.length || ph.some((p, i) => p.tasks.length !== ru.phases[i].tasks.length))) return fail(`${LANG_NAMES[l]}: число фаз и заданий должно совпадать с русской версией.`);
        }
        const data = { slug: $('#a-slug', m).value.trim(), category: $('#a-cat', m).value, level: $('#a-level', m).value, days: +$('#a-days', m).value, icon: $('#a-icon', m).value.trim() || 'target',
          nextStart: $('#a-start', m).value || null, priceUzs: +$('#a-price', m).value || 0, proof: $('#a-proof', m).value, published: $('#a-pub', m).checked, content };
        if (!/^[a-z0-9-]{2,60}$/.test(data.slug)) return fail('Адрес: латиница в нижнем регистре, цифры и дефис.');
        if (!(data.days >= 1 && data.days <= 365)) return fail('Длительность: от 1 до 365 дней.');
        withBusy($('button[type=submit]', m), async () => {
          try { await api.admin.saveChallenge(data); Modal.close(); toast('Сохранено. Чтобы обновить страницы сайта, нажмите «Пересобрать сайт» в обзоре.'); done(); }
          catch (x) { fail(x.message); }
        });
      });
      const del = $('#a-del', m);
      if (del) del.addEventListener('click', () => withBusy(del, async () => { await api.admin.deleteChallenge(c.slug); Modal.close(); toast('Челлендж снят с публикации'); done(); }));
    }
  });
}

function editCohorts(slug) {
  const render = async m => {
    const list = await api.admin.cohorts(slug);
    $('#coh-list', m).innerHTML = list.length ? list.map(h => `<li class="row-between"><span><b>${h.start_date}</b> ${esc(h.title || '')}</span><button class="btn-link small danger-link" data-del-coh="${h.id}">Удалить</button></li>`).join('') : '<li class="muted small">Потоков пока нет — участники стартуют в любой день.</li>';
    $$('[data-del-coh]', m).forEach(b => b.addEventListener('click', async () => { await api.admin.deleteCohort(+b.dataset.delCoh); render(m); }));
  };
  Modal.open({
    title: `Потоки: ${slug}`, size: 'md',
    body: `<ul class="coh-list" id="coh-list"></ul>
      <form class="form-row form-row-3 mt" id="coh-form"><label class="field" for="c-date"><span>Дата старта</span><input id="c-date" type="date" required></label>
        <label class="field" for="c-title"><span>Название (необязательно)</span><input id="c-title" maxlength="80" placeholder="Ноябрьский поток"></label>
        <div class="field"><span>&nbsp;</span><button class="btn btn-primary" type="submit">Добавить</button></div></form>`,
    onMount(m) {
      render(m);
      $('#coh-form', m).addEventListener('submit', async e => {
        e.preventDefault();
        if (!$('#c-date', m).value) return;
        try { await api.admin.saveCohort(slug, $('#c-date', m).value, $('#c-title', m).value.trim()); $('#c-title', m).value = ''; render(m); toast('Поток добавлен'); } catch (x) { toast(x.message, 'error'); }
      });
    }
  });
}

async function moderation(box) {
  const items = await api.admin.moderation();
  const kinds = { testimonial: 'Отзыв', checkin: 'Публикация', comment: 'Комментарий', message: 'Сообщение в чате' };
  box.innerHTML = `<section class="wrap section-sm">${items.length ? `<ul class="mod-list">${items.map(x => `
    <li class="card mod-item" data-k="${x.kind}" data-id="${x.id}">
      <div class="row-between wrap-row"><span><span class="tag">${kinds[x.kind] || x.kind}</span> <b>${esc(x.author || '—')}</b> <span class="muted small">${dt(x.created_at)}</span></span>
        ${x.reports ? `<span class="tag tag-miss">${icon('flag')}жалоб: ${x.reports}</span>` : ''}</div>
      <p>${esc(x.text || '(без текста)')}</p>${x.extra ? `<p class="muted small">${x.kind === 'testimonial' ? 'Челлендж: ' : 'Причины: '}${esc(x.extra)}</p>` : ''}
      <div class="cta-row">${x.kind === 'testimonial'
        ? `<button class="btn btn-primary btn-sm" data-act="approve">Опубликовать</button><button class="btn btn-ghost btn-sm" data-act="reject">Отклонить</button>`
        : `<button class="btn btn-danger btn-sm" data-act="hide">Скрыть</button><button class="btn btn-ghost btn-sm" data-act="dismiss">Жалоба необоснованна</button>`}</div>
    </li>`).join('')}</ul>` : empty('shield-check', 'Очередь пуста', 'Новых жалоб и отзывов на модерацию нет.')}</section>`;
  $$('[data-act]', box).forEach(b => b.addEventListener('click', async () => {
    const li = b.closest('.mod-item');
    try { await api.admin.moderate(li.dataset.k, li.dataset.id, b.dataset.act); li.remove(); toast('Готово'); } catch (x) { toast(x.message, 'error'); }
  }));
}

async function users(box) {
  box.innerHTML = `<section class="wrap section-sm"><label class="search" for="u-q">${icon('search')}<span class="sr-only">Поиск пользователей</span><input id="u-q" type="search" placeholder="Почта или имя"></label><div id="u-list" class="mt"></div></section>`;
  const load = async () => {
    const list = await api.admin.users($('#u-q').value.trim());
    $('#u-list').innerHTML = `<div class="card history"><div class="table-scroll"><table><thead><tr><th>Пользователь</th><th>Регистрация</th><th class="num">Участий</th><th>Последняя отметка</th><th>Роль</th><th></th></tr></thead><tbody>
      ${list.map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="muted small">${esc(u.email)}</span></td><td class="muted">${dt(u.created_at)}</td><td class="num mono">${u.enrollments}</td><td class="muted">${dt(u.last_checkin)}</td>
        <td>${u.role === 'admin' ? '<span class="tag tag-joined">админ</span>' : 'пользователь'}${u.banned ? ' <span class="tag tag-miss">заблокирован</span>' : ''}</td>
        <td class="num"><button class="btn-link small" data-role="${u.id}" data-v="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}</button> · <button class="btn-link small danger-link" data-ban="${u.id}" data-v="${u.banned ? 0 : 1}">${u.banned ? 'Разблокировать' : 'Заблокировать'}</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    $$('[data-role]', box).forEach(b => b.addEventListener('click', async () => { try { await api.admin.updateUser(b.dataset.role, { role: b.dataset.v }); load(); } catch (x) { toast(x.message, 'error'); } }));
    $$('[data-ban]', box).forEach(b => b.addEventListener('click', async () => { try { await api.admin.updateUser(b.dataset.ban, { banned: b.dataset.v === '1' }); load(); } catch (x) { toast(x.message, 'error'); } }));
  };
  let tm; $('#u-q').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(load, 250); });
  load();
}

async function orders(box) {
  const list = await api.admin.orders();
  const st = { pending: 'ожидает', paid: '<span class="tag tag-live">оплачен</span>', cancelled: 'отменен', refunded: '<span class="tag tag-miss">возврат</span>' };
  box.innerHTML = `<section class="wrap section-sm">${list.length ? `<div class="card history"><div class="table-scroll"><table><thead><tr><th>№</th><th>Покупатель</th><th>Челлендж</th><th class="num">Сумма</th><th>Система</th><th>Статус</th><th>Создан</th><th>Оплачен</th></tr></thead><tbody>
    ${list.map(o => `<tr><td class="mono">${o.id}</td><td>${esc(o.email || '—')}</td><td class="mono small">${esc(o.challenge_slug)}</td><td class="num mono">${fmt(o.amount_uzs)}</td><td>${o.provider}</td><td>${st[o.status] || o.status}</td><td class="muted">${dt(o.created_at)}</td><td class="muted">${dt(o.paid_at)}</td></tr>`).join('')}
    </tbody></table></div></div>` : empty('wallet', 'Заказов пока нет', 'Здесь появятся оплаты через Payme и Click.')}</section>`;
}

async function errors(box) {
  const list = await api.admin.errors();
  box.innerHTML = `<section class="wrap section-sm">${list.length ? `<ul class="mod-list">${list.map(e => `<li class="card mod-item"><div class="row-between wrap-row"><b class="mono small">${esc(e.message)}</b><span class="muted small">${dt(e.created_at)} · ${esc(e.release || '')}</span></div>
      <p class="muted small">${esc(e.url || '')}</p>${e.stack ? `<details><summary class="small muted">Стек</summary><pre class="stack">${esc(e.stack)}</pre></details>` : ''}</li>`).join('')}</ul>`
    : empty('bug', 'Ошибок нет', isDemo ? 'В демо журнал хранится в этом браузере.' : 'Необработанные ошибки JavaScript появятся здесь автоматически.')}</section>`;
}
