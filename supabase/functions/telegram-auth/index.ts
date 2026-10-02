// Supabase Edge Function. Логика — в ../_shared/telegram.js (покрыта тестами tests/unit/edge.test.mjs).
import { handleTelegram } from '../_shared/telegram.js';

Deno.serve(req => handleTelegram(req, Deno.env.toObject()));
