/* Вступление в закрытый челлендж по коду приглашения. */
import { api } from '../api/index.js';
import { t } from '../i18n/index.js';
import { icon } from '../ui/markup.js';
import { $, href, withBusy, toast } from '../ui/runtime.js';
import { requireLogin } from '../ui/shell.js';
import { track } from '../analytics.js';

export async function init() {
  const app = $('#app');
  const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  app.innerHTML = `<section class="wrap"><form class="card block form join-form" id="join-form" novalidate>
    <label class="field" for="code"><span>${t('Код приглашения')}</span><input id="code" class="code-input mono" maxlength="12" autocomplete="off" autocapitalize="characters" value="${code}" placeholder="AB12CD34"></label>
    <p class="form-error" id="j-err" role="alert" hidden></p>
    <button class="btn btn-primary btn-lg btn-block" type="submit" data-busy="${t('Проверяем…')}">${icon('key-round')}${t('Вступить')}</button>
    <p class="muted small">${t('Нет кода? Создайте свой челлендж и пригласите друзей.')} <a class="btn-link" href="${href('/create/')}">${t('Создать')}</a></p>
  </form></section>`;
  app.setAttribute('aria-busy', 'false');
  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const c = $('#code').value.trim().toUpperCase(), err = $('#j-err');
    if (!api.auth.user) return requireLogin(t('Войдите, чтобы вступить в челлендж'));
    if (c.length < 6) { err.textContent = t('Код состоит из 8 символов'); err.hidden = false; return; }
    withBusy($('#join-form button'), async () => {
      try { const slug = await api.joinByCode(c); track('join_challenge', { by: 'code' }); toast(t('Вы вступили в челлендж!')); location.href = href(`/c/?id=${slug}`); }
      catch (x) { err.textContent = t(x.message); err.hidden = false; }
    });
  });
  if (code && api.auth.user) $('#join-form').requestSubmit();
}
