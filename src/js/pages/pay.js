/* Результат оплаты: после возврата с Payme/Click ждем подтверждения платежа от сервера. */
import { api } from '../api/index.js';
import { CHALLENGES } from '../content.js';
import { t, money, localize } from '../i18n/index.js';
import { esc } from '../lib/util.js';
import { icon, empty } from '../ui/markup.js';
import { $, href, confetti } from '../ui/runtime.js';
import { track } from '../analytics.js';

export async function init() {
  const app = $('#app');
  const order = new URLSearchParams(location.search).get('order');
  app.setAttribute('aria-busy', 'false');
  if (!order) { app.innerHTML = `<section class="wrap section">${empty('wallet', t('Заказ не найден'), t('Проверьте ссылку или вернитесь к челленджу.'))}</section>`; return; }
  let tries = 0;
  const check = async () => {
    const o = await api.orderStatus(order).catch(() => null);
    const c = o && localize(CHALLENGES.find(x => x.slug === o.challenge_slug));
    if (o?.status === 'paid') {
      confetti(); track('purchase', { value: o.amount_uzs, currency: 'UZS', challenge: o.challenge_slug });
      app.innerHTML = `<section class="wrap section"><div class="empty">${icon('circle-check')}<h2 class="h-sm">${t('Оплата прошла')}</h2>
        <p class="muted">${t('Доступ к челленджу «{title}» открыт. Сумма: {sum}.', { title: esc(c?.title || o.challenge_slug), sum: money(o.amount_uzs) })}</p>
        <a class="btn btn-primary" href="${href(`/challenges/${o.challenge_slug}/`)}">${t('Перейти к челленджу и вступить')}</a></div></section>`;
      return;
    }
    if (o && ['cancelled', 'refunded'].includes(o.status)) {
      app.innerHTML = `<section class="wrap section">${empty('circle-x', t('Оплата отменена'), t('Деньги не списаны или будут возвращены платежной системой.'), c ? `<a class="btn btn-primary" href="${href(`/challenges/${o.challenge_slug}/`)}">${t('Вернуться к челленджу')}</a>` : '')}</section>`;
      return;
    }
    app.innerHTML = `<section class="wrap section"><div class="empty"><span class="spinner spinner-lg" aria-hidden="true"></span><h2 class="h-sm">${t('Ждем подтверждение оплаты')}</h2><p class="muted">${t('Обычно это занимает несколько секунд. Не закрывайте страницу.')}</p></div></section>`;
    if (++tries < 40) setTimeout(check, 3000);
    else app.innerHTML = `<section class="wrap section">${empty('clock', t('Оплата еще обрабатывается'), t('Если деньги списаны, доступ откроется автоматически. Напишите в поддержку, если этого не произошло в течение часа.'))}</section>`;
  };
  check();
}
