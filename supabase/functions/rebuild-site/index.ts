// Supabase Edge Function. Логика — в ../_shared/rebuild.js (покрыта тестами tests/unit/edge.test.mjs).
import { handleRebuild } from '../_shared/rebuild.js';

Deno.serve(req => handleRebuild(req, Deno.env.toObject()));
