// Supabase Edge Function. Логика — в ../_shared/click.js (покрыта тестами tests/unit/edge.test.mjs).
import { handleClick } from '../_shared/click.js';

Deno.serve(req => handleClick(req, Deno.env.toObject()));
