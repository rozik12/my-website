/* Создание заказа и адреса оплаты (Payme Checkout / Click). Вызывается из браузера с токеном пользователя. */
import { supa, json, fail, bearer, CORS } from './core.js';

export function paymeCheckoutUrl({ merchantId, orderId, amountUzs, returnUrl, test }) {
  const params = `m=${merchantId};ac.order_id=${orderId};a=${amountUzs * 100};c=${returnUrl}`;
  return `https://checkout${test ? '.test' : ''}.paycom.uz/${btoa(params)}`;
}
export function clickCheckoutUrl({ serviceId, merchantId, orderId, amountUzs, returnUrl }) {
  return 'https://my.click.uz/services/pay?' + new URLSearchParams({ service_id: serviceId, merchant_id: merchantId, amount: String(amountUzs), transaction_param: String(orderId), return_url: returnUrl });
}

export async function handlePayments(req, env, { fetchImpl = fetch } = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = bearer(req);
  if (!token) return fail('Требуется вход', 401);
  let body; try { body = await req.json(); } catch { return fail('Неверный запрос'); }
  const provider = body?.provider;
  if (!['payme', 'click'].includes(provider) || !body?.slug) return fail('Неверный запрос');
  if (provider === 'payme' && !env.PAYME_MERCHANT_ID) return fail('Оплата через Payme еще не подключена', 503);
  if (provider === 'click' && !env.CLICK_SERVICE_ID) return fail('Оплата через Click еще не подключена', 503);
  try {
    const o = await supa(env, { token, fetchImpl }).rpc('create_order', { p_slug: body.slug, p_provider: provider });
    const returnUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/pay/?order=${o.public_id}`;
    const url = provider === 'payme'
      ? paymeCheckoutUrl({ merchantId: env.PAYME_MERCHANT_ID, orderId: o.order_id, amountUzs: o.amount_uzs, returnUrl, test: env.PAYME_TEST === 'true' })
      : clickCheckoutUrl({ serviceId: env.CLICK_SERVICE_ID, merchantId: env.CLICK_MERCHANT_ID, orderId: o.order_id, amountUzs: o.amount_uzs, returnUrl });
    return json({ order: o.public_id, url });
  } catch (e) {
    return fail(e.message || 'Не удалось создать заказ', e.status && e.status < 500 ? 400 : 500);
  }
}
