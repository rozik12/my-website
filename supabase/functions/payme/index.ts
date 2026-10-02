// Supabase Edge Function. Логика — в ../_shared/payme.js (покрыта тестами tests/unit/edge.test.mjs).
import { handlePayme } from '../_shared/payme.js';

Deno.serve(req => handlePayme(req, Deno.env.toObject()));
