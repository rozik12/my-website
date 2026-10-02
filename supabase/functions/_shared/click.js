/* Click SHOP API: Prepare (action=0) и Complete (action=1). Подпись — md5, проверяется здесь; правила заказа — в SQL. */
import { supa } from './core.js';
import { md5 } from './md5.js';

const reply = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export function clickSign(p, secret) {
  return md5(`${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}${p.action === '1' ? p.merchant_prepare_id : ''}${p.amount}${p.action}${p.sign_time}`);
}

export async function handleClick(req, env, { fetchImpl = fetch } = {}) {
  let p;
  try {
    const ct = req.headers.get('content-type') || '';
    p = ct.includes('application/json') ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()));
    for (const k of Object.keys(p)) p[k] = String(p[k]);
  } catch { return reply({ error: -8, error_note: 'Error in request from click' }); }
  const base = { click_trans_id: p.click_trans_id, merchant_trans_id: p.merchant_trans_id };
  const need = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string', 'error'];
  if (p.action === '1') need.push('merchant_prepare_id');
  if (need.some(k => p[k] === undefined || p[k] === '')) return reply({ ...base, error: -8, error_note: 'Error in request from click' });
  if (p.action !== '0' && p.action !== '1') return reply({ ...base, error: -3, error_note: 'Action not found' });
  if (String(env.CLICK_SERVICE_ID) !== p.service_id || clickSign(p, env.CLICK_SECRET_KEY) !== p.sign_string.toLowerCase()) return reply({ ...base, error: -1, error_note: 'SIGN CHECK FAILED!' });
  const amount = Number(p.amount);
  if (!(amount > 0)) return reply({ ...base, error: -2, error_note: 'Incorrect parameter amount' });
  try {
    const db = supa(env, { fetchImpl });
    if (p.action === '0') {
      const r = await db.rpc('click_prepare', { p_click_trans_id: Number(p.click_trans_id), p_order: p.merchant_trans_id, p_amount: amount });
      return reply({ ...base, merchant_prepare_id: r.merchant_prepare_id ?? null, error: r.error, error_note: r.error_note });
    }
    const r = await db.rpc('click_complete', { p_click_trans_id: Number(p.click_trans_id), p_order: p.merchant_trans_id, p_prepare_id: Number(p.merchant_prepare_id), p_amount: amount, p_click_error: Number(p.error) });
    return reply({ ...base, merchant_confirm_id: r.merchant_confirm_id ?? null, error: r.error, error_note: r.error_note });
  } catch {
    return reply({ ...base, error: -7, error_note: 'Failed to update user' });
  }
}
