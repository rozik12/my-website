/* Оболочка страниц: шапка, меню, языки, поиск Ctrl+K, демо-плашка, офлайн, установка PWA, общие диалоги. */
import { CHALLENGES, SITE } from '../content.js';
import { api, isDemo, flushQueue } from '../api/index.js';
import { humanAuthError } from '../api/supabase-client.js';
import { icon, avatar, MOODS, esc, catLabel } from './markup.js';
import { t, tn, localize } from '../i18n/index.js';
import { href, go, $, $$, Modal, toast, confetti, withBusy } from './runtime.js';
import { report } from '../monitor.js';
import { track } from '../analytics.js';

/* ---------- Шапка ---------- */
let isAdmin = false;
export function renderUserZone() {
  const zone = $('#user-zone');
  const u = api.auth.user;
  if (!u) {
    zone.innerHTML = `<a class="btn btn-ghost btn-sm" href="${href('/login/')}">${t('Войти')}</a>
      <a class="btn btn-primary btn-sm hide-sm" href="${href('/signup/')}">${t('Регистрация')}</a>`;
    return;
  }
  const name = u.name || u.email;
  zone.innerHTML = `
    <div class="dd">
      <button class="user-btn" data-dd="user" aria-label="${t('Меню профиля')}" aria-expanded="false" aria-haspopup="menu">${avatar(name, 'avatar-sm')}<span class="hide-sm">${esc(name.split(' ')[0])}</span>${icon('chevron-down', 'hide-sm')}</button>
      <div class="dd-menu" data-menu="user" role="menu" hidden>
        <div class="dd-user">${avatar(name)}<div><b>${esc(name)}</b><span class="muted small">${esc(u.email)}</span></div></div>
        <a href="${href('/dashboard/')}" class="dd-item" role="menuitem">${icon('layout-dashboard')}${t('Кабинет')}</a>
        <a href="${href('/dashboard/feed/')}" class="dd-item" role="menuitem">${icon('messages-square')}${t('Лента друзей')}</a>
        <a href="${href('/dashboard/my/')}" class="dd-item" role="menuitem">${icon('pencil-ruler')}${t('Мои челленджи')}</a>
        <a href="${href('/dashboard/settings/')}" class="dd-item" role="menuitem">${icon('settings')}${t('Настройки')}</a>
        ${isAdmin ? `<a href="${(document.body.dataset.root || '')}admin/${document.body.dataset.explicit === '1' ? 'index.html' : ''}" class="dd-item" role="menuitem">${icon('shield-check')}${t('Админ-панель')}</a>` : ''}
        <button class="dd-item" data-action="logout" role="menuitem">${icon('log-out')}${t('Выйти')}</button>
      </div>
    </div>`;
}

function closeMenus(except) {
  $$('[data-menu]').forEach(m => {
    if (m.dataset.menu === except) return;
    m.hidden = true;
    const b = $(`[data-dd="${m.dataset.menu}"]`); if (b) b.setAttribute('aria-expanded', 'false');
  });
}

/* ---------- Поиск ---------- */
export function openPalette() {
  const pages = [
    ['Главная', 'house', '/'], ['Каталог челленджей', 'layout-grid', '/challenges/'], ['Люди', 'users', '/people/'], ['Личный кабинет', 'layout-dashboard', '/dashboard/'],
    ['Лента друзей', 'messages-square', '/dashboard/feed/'], ['Создать свой челлендж', 'plus', '/create/'], ['Вступить по коду', 'key-round', '/join/'], ['Настройки', 'settings', '/dashboard/settings/']
  ].map(([label, ic, path]) => ({ label: t(label), icon: ic, href: href(path) }));
  Modal.open({
    title: t('Поиск'), size: 'md',
    body: `
      <label class="search search-lg" for="pal-q">${icon('search')}<input id="pal-q" placeholder="${t('Челлендж, категория или страница')}" autocomplete="off" role="combobox" aria-controls="pal-list" aria-expanded="true"></label>
      <div class="pal-list" id="pal-list" role="listbox"></div>
      <p class="muted small pal-hint"><kbd>↑</kbd><kbd>↓</kbd> ${t('выбор')} · <kbd>Enter</kbd> ${t('открыть')} · <kbd>Esc</kbd> ${t('закрыть')}</p>`,
    onMount(m) {
      const input = $('#pal-q', m), list = $('#pal-list', m);
      let items = [], sel = 0;
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const ch = CHALLENGES.map(localize).filter(c => !q || (c.title + ' ' + catLabel(c.category) + ' ' + c.short).toLowerCase().includes(q))
          .slice(0, 7).map(c => ({ label: c.title, sub: `${catLabel(c.category)} · ${tn(c.days, 'день')}`, icon: c.icon, href: href(`/challenges/${c.slug}/`), cat: c.category }));
        items = [...ch, ...pages.filter(p => !q || p.label.toLowerCase().includes(q))];
        sel = Math.min(sel, Math.max(0, items.length - 1));
        list.innerHTML = items.length ? items.map((it, i) => `
          <a class="pal-item ${i === sel ? 'sel' : ''}" id="pal-${i}" href="${it.href}" role="option" aria-selected="${i === sel}">
            <span class="ch-icon sm ${it.cat ? 'cat-' + it.cat : ''}">${icon(it.icon)}</span>
            <span class="pal-label">${esc(it.label)}${it.sub ? `<span class="muted small">${it.sub}</span>` : ''}</span>
            ${icon('corner-down-left', 'pal-enter')}
          </a>`).join('') : `<p class="muted small pal-empty">${t('Ничего не найдено по запросу «{q}».', { q: esc(input.value) })}</p>`;
        input.setAttribute('aria-activedescendant', items.length ? `pal-${sel}` : '');
      };
      input.addEventListener('input', () => { sel = 0; draw(); });
      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
        if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
        if (e.key === 'Enter' && items[sel]) location.href = items[sel].href;
      });
      draw();
    }
  });
}

/* ---------- Требуется вход ---------- */
export function requireLogin(reason = 'Войдите, чтобы продолжить') {
  try { sessionStorage.setItem('rb.next', location.href); sessionStorage.setItem('rb.next.reason', reason); } catch { /* */ }
  go('/login/');
}

/* ---------- Сжатие фото перед загрузкой ---------- */
export async function compressImage(file, max = 1600, quality = 0.82) {
  if (!/^image\//.test(file.type)) throw new Error(t('Нужен файл изображения: JPG, PNG или WebP'));
  if (file.size > 15 * 1024 * 1024) throw new Error(t('Файл больше 15 МБ'));
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error(t('Не удалось открыть изображение'));
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error(t('Не удалось сжать изображение')))), 'image/jpeg', quality));
}

/* ---------- Чекин: настроение, заметка, подтверждение, публикация в ленте ---------- */
export function checkInDialog(challenge, day, task, onDone) {
  const c = localize(challenge);
  const proofReq = c.proof === 'required', proofOn = c.proof !== 'none';
  let photoBlob = null;
  Modal.open({
    title: t('День {n} · чекин', { n: day }), size: 'sm',
    body: `
      <form class="form" id="ci-form">
        <div class="ci-task"><span class="ch-icon sm cat-${c.category}">${icon(c.icon)}</span><div><p class="muted small">${esc(c.title)}</p><b>${esc(task)}</b></div></div>
        <fieldset class="moods"><legend class="field-label">${t('Как прошло?')}</legend>
          ${MOODS.map(([v, ic, l]) => `<label class="mood"><input type="radio" name="mood" value="${v}" ${v === 4 ? 'checked' : ''}><span>${icon(ic)}<span class="small">${t(l)}</span></span></label>`).join('')}
        </fieldset>
        ${proofOn ? `
        <fieldset class="proof"><legend class="field-label">${t('Подтверждение')} ${proofReq ? `<span class="tag tag-hot">${t('обязательно')}</span>` : `<span class="muted">(${t('необязательно')})</span>`}</legend>
          <label class="photo-drop" for="ci-photo"><input type="file" id="ci-photo" accept="image/jpeg,image/png,image/webp" capture="environment">
            <span class="photo-drop-in">${icon('camera')}<span>${t('Добавить фото')}</span></span><img id="ci-preview" alt="" hidden></label>
          <label class="field" for="ci-link"><span>${t('или ссылка (трек пробежки, пост, документ)')}</span><input id="ci-link" type="url" inputmode="url" placeholder="https://"></label>
        </fieldset>` : ''}
        <label class="field" for="ci-note"><span>${t('Заметка')} <span class="muted">(${t('видите только вы')})</span></span>
          <textarea id="ci-note" rows="2" maxlength="280" placeholder="${t('Что получилось, что было сложно')}"></textarea></label>
        <label class="switch-row" for="ci-share"><span><b>${t('Поделиться в ленте потока')}</b><span class="muted small">${t('Участники увидят отметку, фото и текст ниже')}</span></span><span class="switch"><input type="checkbox" id="ci-share"><span></span></span></label>
        <label class="field" for="ci-post" id="ci-post-wrap" hidden><span>${t('Текст для ленты')}</span><textarea id="ci-post" rows="2" maxlength="500" placeholder="${t('Пара слов для потока')}"></textarea></label>
        <p class="form-error" id="ci-err" role="alert" hidden></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-busy="${t('Сохраняем…')}">${icon('check')}${t('Засчитать день {n}', { n: day })}</button>
      </form>`,
    onMount(m) {
      const form = $('#ci-form', m), errBox = $('#ci-err', m);
      const fail = msg => { errBox.textContent = msg; errBox.hidden = false; };
      $('#ci-share', m).addEventListener('change', e => { $('#ci-post-wrap', m).hidden = !e.target.checked; });
      const photo = $('#ci-photo', m);
      if (photo) photo.addEventListener('change', async () => {
        const f = photo.files[0]; if (!f) return;
        try {
          photoBlob = await compressImage(f);
          const img = $('#ci-preview', m); img.src = URL.createObjectURL(photoBlob); img.hidden = false;
          m.querySelector('.photo-drop').classList.add('has-photo');
        } catch (e) { photoBlob = null; fail(e.message); }
      });
      form.addEventListener('submit', e => {
        e.preventDefault(); errBox.hidden = true;
        const mood = +$('input[name=mood]:checked', m).value, note = $('#ci-note', m).value.trim();
        const proofUrl = $('#ci-link', m)?.value.trim() || '';
        if (proofUrl && !/^https:\/\/\S+\.\S+/.test(proofUrl)) return fail(t('Ссылка должна начинаться с https://'));
        if (proofReq && !proofUrl && !photoBlob) return fail(t('Для этого челленджа нужно подтверждение: фото или ссылка'));
        withBusy($('button[type=submit]', form), async () => {
          try {
            const photoPath = photoBlob ? await api.uploadPhoto(photoBlob) : null;
            const r = await api.checkIn(c.slug, { mood, note, share: $('#ci-share', m).checked, post: $('#ci-post', m).value.trim(), proofUrl: proofUrl || null, photo: photoPath });
            Modal.close();
            if (r.queued) { toast(t('Нет сети: отметка сохранена и отправится при подключении')); onDone && onDone(r); return; }
            track('check_in', { challenge: c.slug, day: r.day });
            if (r.completed) {
              confetti(); track('complete_challenge', { challenge: c.slug });
              toast(t('Челлендж «{title}» пройден! Сертификат готов.', { title: c.title }));
            } else if (r.streak > 0 && r.streak % 7 === 0) { confetti(); toast(t('Серия {n} подряд!', { n: tn(r.streak, 'день') })); }
            else toast(t('День {day} засчитан · +10 XP · серия {streak}', { day: r.day, streak: r.streak }));
            onDone && onDone(r);
          } catch (err) {
            fail(t(err.message) || t('Не удалось сохранить. Попробуйте еще раз.'));
            if (!err.status) report(err, { action: 'check_in' });
          }
        });
      });
    }
  });
}

/* ---------- Жалоба ---------- */
export function reportDialog(type, id) {
  if (!api.auth.user) return requireLogin(t('Войдите, чтобы отправить жалобу'));
  const reasons = ['Спам или реклама', 'Оскорбления', 'Неправда о выполнении', 'Личные данные', 'Другое'];
  Modal.open({
    title: t('Пожаловаться'), size: 'sm',
    body: `<form class="form" id="rep-form">
      <fieldset class="radio-list"><legend class="field-label">${t('Что не так?')}</legend>
        ${reasons.map((r, i) => `<label class="check"><input type="radio" name="reason" value="${r}" ${i === 0 ? 'checked' : ''}><span>${t(r)}</span></label>`).join('')}</fieldset>
      <p class="muted small">${t('Модераторы проверят жалобу. Автор не узнает, кто ее отправил.')}</p>
      <button class="btn btn-primary btn-block" type="submit" data-busy="${t('Отправляем…')}">${t('Отправить жалобу')}</button></form>`,
    onMount(m) {
      $('#rep-form', m).addEventListener('submit', e => {
        e.preventDefault();
        withBusy($('button[type=submit]', m), async () => {
          try { await api.report(type, id, $('input[name=reason]:checked', m).value); Modal.close(); toast(t('Спасибо! Жалоба отправлена модераторам.')); }
          catch (x) { toast(t(x.message), 'error'); }
        });
      });
    }
  });
}

/* ---------- PWA: установка ---------- */
let installEvent = null;
function initInstall() {
  const btn = $('#install-btn');
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; if (btn) btn.hidden = false; });
  if (btn) btn.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null; btn.hidden = true;
  });
}

/* ---------- Инициализация оболочки ---------- */
export function initShell() {
  renderUserZone();
  api.auth.onChange(() => renderUserZone());
  if (api.auth.user) api.isAdmin().then(v => { isAdmin = !!v; renderUserZone(); }).catch(() => {});
  if (isDemo) { const bar = $('#demo-bar'); if (bar) bar.hidden = false; }

  document.addEventListener('click', e => {
    const dd = e.target.closest('[data-dd]');
    if (dd) {
      const m = $(`[data-menu="${dd.dataset.dd}"]`);
      closeMenus(dd.dataset.dd);
      m.hidden = !m.hidden; dd.setAttribute('aria-expanded', String(!m.hidden));
      return;
    }
    if (!e.target.closest('.dd-menu') || e.target.closest('.dd-item')) closeMenus();
    const langLink = e.target.closest('[data-lang-link]');
    if (langLink) { try { localStorage.setItem('rb.lang', langLink.dataset.langLink); } catch { /* */ } if (api.auth.user) api.updateProfile({ locale: langLink.dataset.langLink }).catch(() => {}); }
    const rep = e.target.closest('[data-report]');
    if (rep) { e.preventDefault(); reportDialog(rep.dataset.report, rep.dataset.id); }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'search') openPalette();
    if (a.dataset.action === 'logout') api.auth.signOut().then(() => { toast(t('Вы вышли из аккаунта')); go('/'); });
    if (a.dataset.action === 'demo-reset' && api.reset) { api.reset(); toast(t('Демо-данные восстановлены')); setTimeout(() => location.reload(), 400); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
  });

  const burger = $('#burger');
  burger.addEventListener('click', () => burger.setAttribute('aria-expanded', String(document.body.classList.toggle('menu-open'))));
  const prog = $('#scroll-progress');
  addEventListener('scroll', () => {
    document.body.classList.toggle('scrolled', scrollY > 8);
    const max = document.documentElement.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  }, { passive: true });

  $$('.reveal').forEach(el => {
    const sib = [...el.parentElement.children].filter(x => x.classList.contains('reveal'));
    el.style.setProperty('--n', sib.indexOf(el));
  });

  // Офлайн-режим и отложенные отметки
  const offBar = $('#offline-bar');
  const net = async () => {
    if (offBar) offBar.hidden = navigator.onLine !== false;
    if (navigator.onLine !== false) {
      const r = await flushQueue().catch(() => ({ sent: 0, dropped: 0 }));
      if (r.sent) toast(t('Отправлено отложенных отметок: {n}', { n: r.sent }));
      if (r.dropped) toast(t('Отметки за прошлые дни из офлайн-очереди не засчитаны'), 'error');
    }
  };
  addEventListener('online', net); addEventListener('offline', net); net();

  initInstall();
  if (api.auth.user) syncTimezone();
}

async function syncTimezone() {
  try {
    if (sessionStorage.getItem('rb.tz.synced')) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const p = await api.getProfile();
    const patch = {};
    if (p && tz && p.timezone !== tz) patch.timezone = tz;
    if (p && p.locale !== document.documentElement.lang) patch.locale = document.documentElement.lang;
    if (Object.keys(patch).length) await api.updateProfile(patch);
    sessionStorage.setItem('rb.tz.synced', '1');
  } catch (e) { if (!e.status) report(e, { action: 'sync_tz' }); }
}

export { humanAuthError, SITE };
