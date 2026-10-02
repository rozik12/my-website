// Supabase Edge Function. Логика — в ../_shared/payments.js (покрыта тестами tests/unit/edge.test.mjs).
import { handlePayments } from '../_shared/payments.js';

Deno.serve(req => handlePayments(req, Deno.env.toObject()));
