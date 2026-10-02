/* Лента публикаций: отрисовка, реакции, комментарии. Используется на странице челленджа, в кабинете и профиле. */
import { api } from '../api/index.js';
import { CHALLENGES } from '../content.js';
import { t, localize } from '../i18n/index.js';
import { post, icon, avatar, ago, esc, empty } from './markup.js';
import { $, $$, href, toast, withBusy } from './runtime.js';
import { requireLogin } from './shell.js';

const titleOf = slug => localize(CHALLENGES.find(c => c.slug === slug))?.title || '';
const personHref = id => href(`/u/?id=${encodeURIComponent(id)}`);

/**
 * Подключает ленту к контейнеру.
 * load(before) → Promise<post[]>; opts.showChallenge — показывать название челленджа у поста.
 */
export function mountFeed(box, moreBtn, load, { showChallenge = false, emptyHtml } = {}) {
  let last = null, busy = false;
  const render = (items, append) => {
    const html = items.map(p => post(p, { photoUrl: api.photoUrl, titleOf, personHref, showChallenge })).join('');
    if (append) box.insertAdjacentHTML('beforeend', html);
    else box.innerHTML = html || emptyHtml || empty('messages-square', t('Пока пусто'), t('Здесь появятся отметки, которыми участники поделились с потоком.'));
    if (items.length) last = items[items.length - 1].id;
    if (moreBtn) moreBtn.hidden = items.length < 20;
  };
  const loadMore = async append => {
    if (busy) return; busy = true;
    try { render(await load(append ? last : null), append); }
    catch (e) { box.innerHTML = `<p class="muted small">${t('Не удалось загрузить ленту.')}</p>`; }
    finally { busy = false; }
  };
  if (moreBtn) moreBtn.addEventListener('click', () => loadMore(true));

  box.addEventListener('click', async e => {
    const r = e.target.closest('[data-react]');
    if (r) {
      if (!api.auth.user) return requireLogin(t('Войдите, чтобы поддержать участника'));
      try {
        const res = await api.react(+r.dataset.id, r.dataset.react);
        $$(`[data-react][data-id="${r.dataset.id}"]`, box).forEach(b => {
          const on = res.mine.includes(b.dataset.react);
          b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
          b.querySelector('.mono').textContent = res[b.dataset.react];
        });
      } catch (x) { toast(t(x.message), 'error'); }
      return;
    }
    const c = e.target.closest('[data-comments]');
    if (c) {
      const id = +c.dataset.comments, cbox = $(`[data-comments-box="${id}"]`, box);
      const open = cbox.hidden;
      cbox.hidden = !open; c.setAttribute('aria-expanded', open);
      if (open) await loadComments(id, cbox, c);
      return;
    }
    const del = e.target.closest('[data-del-comment]');
    if (del) {
      try { await api.deleteComment(+del.dataset.delComment); del.closest('.comment').remove(); toast(t('Комментарий удален')); } catch (x) { toast(t(x.message), 'error'); }
    }
  });

  async function loadComments(id, cbox, counter) {
    cbox.innerHTML = `<p class="muted small">${t('Загружаем…')}</p>`;
    const list = await api.comments(id).catch(() => []);
    cbox.innerHTML = `
      <ul class="comment-list">${list.map(m => `<li class="comment">${avatar(m.author, 'avatar-xs')}<div><b class="small">${esc(m.author)}</b> <span class="muted small">${ago(m.at)}</span><p class="small">${esc(m.text)}</p></div>
        ${m.mine ? `<button class="icon-btn icon-btn-sm" data-del-comment="${m.id}" aria-label="${t('Удалить комментарий')}">${icon('trash-2')}</button>` : `<button class="icon-btn icon-btn-sm" data-report="comment" data-id="${m.id}" aria-label="${t('Пожаловаться')}">${icon('flag')}</button>`}</li>`).join('')}</ul>
      ${api.auth.user ? `<form class="comment-form"><label class="sr-only" for="cm-${id}">${t('Комментарий')}</label><input id="cm-${id}" maxlength="500" placeholder="${t('Поддержите участника…')}" autocomplete="off"><button class="btn btn-primary btn-sm" type="submit">${t('Отправить')}</button></form>`
        : `<p class="small"><a class="btn-link" href="${href('/login/')}">${t('Войдите')}</a>, ${t('чтобы комментировать')}</p>`}`;
    const form = $('.comment-form', cbox);
    if (form) form.addEventListener('submit', ev => {
      ev.preventDefault();
      const input = $('input', form), text = input.value.trim(); if (!text) return;
      withBusy($('button', form), async () => {
        try { await api.addComment(id, text); input.value = ''; counter.querySelector('.mono').textContent = +counter.querySelector('.mono').textContent + 1; await loadComments(id, cbox, counter); }
        catch (x) { toast(t(x.message), 'error'); }
      });
    });
  }

  return { reload: () => loadMore(false) };
}
