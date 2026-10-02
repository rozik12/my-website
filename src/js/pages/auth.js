/* Вход, регистрация с подтверждением почты, восстановление пароля, вход через Google и Telegram, обработка ссылок из писем. */
import { api, isDemo, config } from '../api/index.js';
import { humanAuthError } from '../api/supabase-client.js';
import { EMAIL_RE, passwordProblems } from '../lib/logic.js';
import { esc } from '../lib/util.js';
import { t } from '../i18n/index.js';
import { icon } from '../ui/markup.js';
import { $, $$, href, withBusy, toast } from '../ui/runtime.js';
import { report } from '../monitor.js';
import { track } from '../analytics.js';

const MODE = document.body.dataset.mode;
const H = msg => t(humanAuthError({ message: msg?.message, code: msg?.code }));

function nextUrl() {
  try { const n = sessionStorage.getItem('rb.next'); sessionStorage.removeItem('rb.next'); sessionStorage.removeItem('rb.next.reason'); if (n) return n; } catch { /* */ }
  return href('/dashboard/');
}
const showError = msg => { const e = $('#auth-err'); e.textContent = msg; e.hidden = false; e.focus?.(); };
const hideError = () => { const e = $('#auth-err'); if (e) e.hidden = true; };
const done = (title, text, extra = '') => { $('#auth-card').innerHTML = `<div class="auth-done">${icon('mail-check', 'auth-done-ic')}<h1 class="h-auth">${title}</h1><p class="muted">${text}</p>${extra}</div>`; };
const demoMail = label => isDemo ? `<div class="demo-mail"><p class="small">${t('Демо-режим: письма не отправляются. Нажмите, чтобы открыть ссылку из «письма».')}</p><a class="btn btn-ghost btn-block" href="${href('/auth/callback/')}">${icon('mail-open')}${label}</a></div>` : '';

/* ---------- PKCE для Telegram ---------- */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomStr = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function startTelegram() {
  if (isDemo) { api.auth.telegramDemo(); location.href = href('/auth/callback/'); return; }
  if (!config.telegramClientId) { toast(t('Вход через Telegram еще не настроен.'), 'error'); return; }
  const verifier = randomStr(48), state = randomStr(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const redirectUri = (config.siteUrl || location.origin) + '/auth/telegram/';
  sessionStorage.setItem('rb.tg', JSON.stringify({ verifier, state, redirectUri }));
  location.href = 'https://oauth.telegram.org/auth?' + new URLSearchParams({ client_id: config.telegramClientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile', state, code_challenge: challenge, code_challenge_method: 'S256' });
}
function startGoogle() {
  const url = api.auth.googleUrl();
  location.href = url || href('/auth/callback/');
}

export async function init() {
  try { const r = sessionStorage.getItem('rb.next.reason'); if (r && $('#auth-reason')) { $('#auth-reason').textContent = t(r); $('#auth-reason').hidden = false; } } catch { /* */ }
  $$('[data-social]').forEach(b => b.addEventListener('click', () => (b.dataset.social === 'google' ? startGoogle() : startTelegram())));
  const eye = $('#toggle-pass'); if (eye) eye.addEventListener('click', togglePass);

  if (MODE === 'login') {
    if (api.auth.user) { location.replace(href('/dashboard/')); return; }
    if (isDemo && $('#demo-hint')) $('#demo-hint').hidden = false;
    $('#auth-form').addEventListener('submit', e => {
      e.preventDefault(); hideError();
      const email = $('#email').value.trim(), password = $('#password').value;
      if (!EMAIL_RE.test(email)) return showError(t('Проверьте адрес почты: в нем должны быть «@» и домен.'));
      if (!password) return showError(t('Введите пароль.'));
      withBusy($('#auth-form button[type=submit]'), async () => {
        try { await api.auth.signIn({ email, password }); track('login', { method: 'email' }); location.href = nextUrl(); }
        catch (x) {
          showError(H(x));
          if (x.code === 'email_not_confirmed') $('#resend').hidden = false;
          if (!x.status) report(x, { action: 'sign_in' });
        }
      });
    });
    $('#resend').addEventListener('click', e => withBusy(e.currentTarget, async () => {
      try { await api.auth.resendConfirmation($('#email').value.trim()); toast(t('Письмо отправлено повторно')); } catch (x) { showError(H(x)); }
    }));
  }

  if (MODE === 'signup') {
    if (api.auth.user) { location.replace(href('/dashboard/')); return; }
    const pw = $('#password'), meter = $('#pw-meter');
    pw.addEventListener('input', () => {
      const probs = passwordProblems(pw.value);
      meter.dataset.level = pw.value ? String(3 - Math.min(3, probs.length)) : '';
      $('#pw-hint').textContent = pw.value ? (probs.length ? t('Добавьте: {list}', { list: probs.map(x => t(x)).join(', ') }) : t('Надежный пароль')) : t('Не меньше 8 символов, строчные и заглавные латинские буквы, цифра');
    });
    $('#auth-form').addEventListener('submit', e => {
      e.preventDefault(); hideError();
      const name = $('#name').value.trim(), email = $('#email').value.trim(), password = pw.value;
      if (!name) return showError(t('Введите имя: оно будет видно в рейтинге потока.'));
      if (!EMAIL_RE.test(email)) return showError(t('Проверьте адрес почты: в нем должны быть «@» и домен.'));
      const probs = passwordProblems(password);
      if (probs.length) return showError(t('Пароль должен содержать: {list}.', { list: probs.map(x => t(x)).join(', ') }));
      if (!$('#terms').checked) return showError(t('Чтобы создать аккаунт, примите условия и политику конфиденциальности.'));
      withBusy($('#auth-form button[type=submit]'), async () => {
        try {
          const r = await api.auth.signUp({ email, password, name });
          track('sign_up', { method: 'email' });
          if (!r.needsConfirmation) { location.href = nextUrl(); return; }
          done(t('Подтвердите почту'), t('Мы отправили письмо на {email}. Перейдите по ссылке в письме, чтобы активировать аккаунт. Если письма нет, проверьте папку «Спам».', { email: `<b>${esc(email)}</b>` }),
            `${demoMail(t('Открыть письмо и подтвердить'))}<button class="btn btn-ghost btn-block" id="resend2" data-busy="${t('Отправляем…')}">${t('Отправить письмо еще раз')}</button>`);
          const rs = $('#resend2');
          rs.addEventListener('click', () => withBusy(rs, async () => {
            try { await api.auth.resendConfirmation(email); toast(t('Письмо отправлено повторно')); } catch (x) { toast(H(x), 'error'); }
          }));
        } catch (x) { showError(H(x)); if (!x.status) report(x, { action: 'sign_up' }); }
      });
    });
  }

  if (MODE === 'forgot') {
    $('#auth-form').addEventListener('submit', e => {
      e.preventDefault(); hideError();
      const email = $('#email').value.trim();
      if (!EMAIL_RE.test(email)) return showError(t('Проверьте адрес почты: в нем должны быть «@» и домен.'));
      withBusy($('#auth-form button[type=submit]'), async () => {
        try {
          await api.auth.resetPassword(email);
          done(t('Проверьте почту'), t('Если аккаунт с адресом {email} существует, мы отправили на него ссылку для смены пароля. Ссылка действует 1 час.', { email: `<b>${esc(email)}</b>` }), demoMail(t('Открыть письмо со ссылкой')));
        } catch (x) { showError(H(x)); }
      });
    });
  }

  if (MODE === 'reset') {
    if (!api.auth.user) { done(t('Ссылка недействительна'), t('Чтобы сменить пароль, откройте страницу по ссылке из письма или запросите новую.'), `<a class="btn btn-primary btn-block" href="${href('/forgot-password/')}">${t('Запросить новую ссылку')}</a>`); return; }
    $('#auth-form').addEventListener('submit', e => {
      e.preventDefault(); hideError();
      const pw = $('#password').value, probs = passwordProblems(pw);
      if (probs.length) return showError(t('Пароль должен содержать: {list}.', { list: probs.map(x => t(x)).join(', ') }));
      if (pw !== $('#password2').value) return showError(t('Пароли не совпадают.'));
      withBusy($('#auth-form button[type=submit]'), async () => {
        try { await api.auth.updatePassword(pw); toast(t('Пароль изменен')); setTimeout(() => { location.href = href('/dashboard/'); }, 700); }
        catch (x) { showError(H(x)); }
      });
    });
  }

  if (MODE === 'callback') {
    try {
      const r = await api.auth.handleCallback(location.hash);
      history.replaceState(null, '', location.pathname);
      if (!r) done(t('Ссылка не распознана'), t('Откройте ссылку из последнего письма целиком или запросите новое письмо.'), `<a class="btn btn-primary btn-block" href="${href('/login/')}">${t('Ко входу')}</a>`);
      else if (r.type === 'recovery') location.replace(href('/reset-password/'));
      else {
        track('login', { method: 'link' });
        let next = null; try { next = sessionStorage.getItem('rb.next'); } catch { /* */ }
        if (next) { location.replace(nextUrl()); return; }
        done(t('Готово, вы вошли'), t('Аккаунт активирован. Выберите первый челлендж — план по дням появится в кабинете.'),
          `<a class="btn btn-primary btn-block" href="${href('/challenges/')}">${t('Выбрать челлендж')}</a><a class="btn btn-ghost btn-block" href="${href('/dashboard/')}">${t('Открыть кабинет')}</a>`);
      }
    } catch (x) {
      history.replaceState(null, '', location.pathname);
      done(t('Не удалось войти'), esc(H(x)), `<a class="btn btn-primary btn-block" href="${href('/login/')}">${t('Ко входу')}</a>`);
    }
  }

  if (MODE === 'telegram') {
    const p = new URLSearchParams(location.search);
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem('rb.tg')); sessionStorage.removeItem('rb.tg'); } catch { /* */ }
    history.replaceState(null, '', location.pathname);
    if (p.get('error') || !p.get('code') || !saved || saved.state !== p.get('state')) {
      done(t('Не удалось войти через Telegram'), t('Попробуйте еще раз или войдите по почте.'), `<a class="btn btn-primary btn-block" href="${href('/login/')}">${t('Ко входу')}</a>`);
      return;
    }
    try {
      const r = await api.auth.telegramExchange({ code: p.get('code'), codeVerifier: saved.verifier, redirectUri: saved.redirectUri });
      track('login', { method: 'telegram' });
      location.replace(r.action_link);
    } catch (x) {
      report(x, { action: 'telegram_exchange' });
      done(t('Не удалось войти через Telegram'), esc(t(x.message)), `<a class="btn btn-primary btn-block" href="${href('/login/')}">${t('Ко входу')}</a>`);
    }
  }
}

function togglePass(e) {
  const btn = e.currentTarget, inputs = document.querySelectorAll('input[data-pass]'), show = inputs[0].type === 'password';
  inputs.forEach(i => { i.type = show ? 'text' : 'password'; });
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? t('Скрыть пароль') : t('Показать пароль'));
  btn.innerHTML = icon(show ? 'eye-off' : 'eye');
}
