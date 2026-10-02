/* Люди: поиск, подписки и профиль участника с лентой его публикаций. */
import { api } from '../api/index.js';
import { CHALLENGES } from '../content.js';
import { t, tn, num, localize } from '../i18n/index.js';
import { esc } from '../lib/util.js';
import { icon, avatar, empty } from '../ui/markup.js';
import { $, $$, href, toast, withBusy } from '../ui/runtime.js';
import { requireLogin } from '../ui/shell.js';

const personHref = id => href(`/u/?id=${encodeURIComponent(id)}`);
const row = p => `<li class="person-row">${avatar(p.name)}<a class="person-name" href="${personHref(p.id)}"><b>${esc(p.name)}</b>${p.handle ? `<span class="muted small">@${esc(p.handle)}</span>` : ''}</a>
  <button class="btn ${p.following ? 'btn-ghost' : 'btn-primary'} btn-sm" data-follow="${p.id}" data-on="${p.following ? 0 : 1}" data-busy="…">${p.following ? t('Вы подписаны') : t('Подписаться')}</button></li>`;

async function toggleFollow(btn, after) {
  if (!api.auth.user) return requireLogin(t('Войдите, чтобы подписываться на участников'));
  await withBusy(btn, async () => {
    try { await api.follow(btn.dataset.follow, btn.dataset.on === '1'); } catch (x) { toast(t(x.message), 'error'); }
  });
  after && after();
}

async function peoplePage(app) {
  app.innerHTML = `<section class="wrap people">
    <label class="search search-lg" for="pq">${icon('search')}<span class="sr-only">${t('Поиск людей')}</span><input id="pq" type="search" placeholder="${t('Имя или @никнейм')}" autocomplete="off"></label>
    <div class="people-grid">
      <div><h2 class="h-sm">${t('Результаты поиска')}</h2><ul class="people-list" id="results"><li class="muted small">${t('Введите хотя бы 2 символа.')}</li></ul></div>
      <div><h2 class="h-sm">${t('Ваши подписки')}</h2><ul class="people-list" id="follows"></ul></div>
    </div></section>`;
  app.setAttribute('aria-busy', 'false');
  const loadFollows = async () => {
    const box = $('#follows');
    if (!api.auth.user) { box.innerHTML = `<li class="muted small"><a class="btn-link" href="${href('/login/')}">${t('Войдите')}</a>, ${t('чтобы видеть подписки и ленту друзей.')}</li>`; return; }
    const list = await api.myFollows().catch(() => []);
    box.innerHTML = list.length ? list.map(row).join('') : `<li class="muted small">${t('Вы пока ни на кого не подписаны.')}</li>`;
  };
  let timer;
  const search = async () => {
    const q = $('#pq').value.trim(), box = $('#results');
    if (q.length < 2) { box.innerHTML = `<li class="muted small">${t('Введите хотя бы 2 символа.')}</li>`; return; }
    const list = await api.searchPeople(q).catch(() => []);
    box.innerHTML = list.length ? list.map(row).join('') : `<li class="muted small">${t('Никого не нашли. Участники со скрытым профилем в поиске не показываются.')}</li>`;
  };
  $('#pq').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  app.addEventListener('click', e => { const b = e.target.closest('[data-follow]'); if (b) toggleFollow(b, () => { search(); loadFollows(); }); });
  loadFollows();
}

async function personPage(app) {
  const id = new URLSearchParams(location.search).get('id');
  const p = id ? await api.person(id).catch(() => null) : null;
  app.setAttribute('aria-busy', 'false');
  if (!p) { $('#person-name').textContent = t('Профиль скрыт'); app.innerHTML = `<section class="wrap section">${empty('eye-off', t('Профиль недоступен'), t('Участник скрыл профиль или аккаунт удален.'))}</section>`; return; }
  $('#person-name').innerHTML = `${esc(p.name)}`;
  document.title = `${p.name} · ${t('Рубикон')}`;
  const me = api.auth.user?.id === p.id;
  const titleOf = slug => localize(CHALLENGES.find(c => c.slug === slug))?.title;
  app.innerHTML = `<section class="wrap">
    <div class="person-card card">${avatar(p.name, 'avatar-lg')}
      <div class="person-info">${p.handle ? `<p class="muted">@${esc(p.handle)}</p>` : ''}
        <div class="mini-stats"><div><b class="mono">${num(p.followers)}</b><span class="muted small">${t('подписчиков')}</span></div><div><b class="mono">${num(p.active)}</b><span class="muted small">${t('активных')}</span></div><div><b class="mono">${num(p.finished)}</b><span class="muted small">${t('завершено')}</span></div><div><b class="mono">${num(p.checkins)}</b><span class="muted small">${t('отметок')}</span></div></div></div>
      ${me ? `<a class="btn btn-ghost" href="${href('/dashboard/settings/')}">${t('Редактировать профиль')}</a>` : `<button class="btn ${p.following ? 'btn-ghost' : 'btn-primary'}" data-follow="${p.id}" data-on="${p.following ? 0 : 1}" data-busy="…">${p.following ? t('Вы подписаны') : t('Подписаться')}</button>`}
    </div>
    <h2 class="h-sm mt">${t('Челленджи')}</h2>
    <ul class="person-ch">${p.challenges.filter(c => titleOf(c.slug)).map(c => `<li><a href="${href(`/challenges/${c.slug}/`)}">${esc(titleOf(c.slug))}</a> <span class="tag ${c.status === 'completed' ? 'tag-live' : ''}">${c.status === 'completed' ? t('завершен') : t('в процессе')}</span> <span class="muted small mono">${tn(c.done, 'чекин')}</span></li>`).join('') || `<li class="muted small">${t('Пока нет публичных челленджей.')}</li>`}</ul>
  </section>`;
  app.addEventListener('click', e => { const b = e.target.closest('[data-follow]'); if (b) toggleFollow(b, () => personPage(app)); });
}

export async function init() {
  const app = $('#app');
  return document.body.dataset.page === 'person' ? personPage(app) : peoplePage(app);
}
