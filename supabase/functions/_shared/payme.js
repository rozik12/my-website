/* Payme Merchant API (JSON-RPC). Payme вызывает этот адрес; бизнес-логика — в SQL-функции payme_rpc. */
import { supa } from './core.js';

const rpcError = (id, code, ru, en = ru, uz = ru) => ({ jsonrpc: '2.0', id, error: { code, message: { ru, uz, en } } });
const reply = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const METHODS = ['CheckPerformTransaction', 'CreateTransaction', 'PerformTransaction', 'CancelTransaction', 'CheckTransaction', 'GetStatement'];

export async function handlePayme(req, env, { fetchImpl = fetch } = {}) {
  if (req.method !== 'POST') return reply(rpcError(null, -32300, 'Метод запроса должен быть POST', 'Request method must be POST'));
  let body;
  try { body = await req.json(); } catch { return reply(rpcError(null, -32700, 'Ошибка разбора JSON', 'JSON parse error')); }
  const id = body?.id ?? null;
  // Авторизация: Basic base64("Paycom:" + KEY)
  const expected = 'Basic ' + btoa(`Paycom:${env.PAYME_KEY}`);
  if (!env.PAYME_KEY || req.headers.get('authorization') !== expected) return reply(rpcError(id, -32504, 'Недостаточно привилегий для выполнения метода', 'Insufficient privileges'));
  if (!body?.method || typeof body.params !== 'object') return reply(rpcError(id, -32600, 'Неверный JSON-RPC запрос', 'Invalid JSON-RPC request'));
  if (!METHODS.includes(body.method)) return reply(rpcError(id, -32601, 'Метод не найден', 'Method not found'));
  try {
    const r = await supa(env, { fetchImpl }).rpc('payme_rpc', { p_method: body.method, p_params: body.params });
    return reply({ jsonrpc: '2.0', id, ...r });
  } catch (e) {
    return reply(rpcError(id, -32400, 'Системная ошибка', 'System error'));
  }
}
