/* Боевой бэкенд: Supabase (Auth, Postgres через PostgREST/RPC, Storage, Edge Functions). */
import { createSupabaseClient } from './supabase-client.js';
import { uid } from '../lib/util.js';

const toPost = r => ({
  id: r.id, userId: r.user_id, author: r.author, handle: r.handle ?? null, slug: r.challenge_slug, day: r.day_number,
  text: r.post_text || '', proofUrl: r.proof_url, photo: r.photo_path, at: r.created_at,
  fire: r.fire, clap: r.clap, heart: r.heart, mine: r.mine || [], comments: r.comments
});
const fromProfile = p => p && ({ name: p.display_name, city: p.city || '', timezone: p.timezone, publicProfile: p.public_profile, locale: p.locale, handle: p.handle || '', role: p.role, banned: p.banned });

export function createSupabaseBackend(config) {
  const sb = createSupabaseClient({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey });
  const { auth, db, storage, invoke } = sb;
  const me = () => auth.user?.id;
  const toUser = u => u ? { id: u.id, email: u.email, name: u.user_metadata?.name || u.user_metadata?.full_name || '', confirmed: !!(u.email_confirmed_at || u.confirmed_at) } : null;

  return {
    kind: 'supabase',
    auth: {
      get user() { return toUser(auth.user); },
      onChange: fn => auth.onChange(s => fn(toUser(s?.user))),
      signUp: ({ email, password, name }) => auth.signUp({ email, password, name, redirectTo: config.authRedirect }),
      signIn: ({ email, password }) => auth.signIn({ email, password }).then(toUser),
      signOut: () => auth.signOut(),
      resendConfirmation: email => auth.resendConfirmation({ email, redirectTo: config.authRedirect }),
      resetPassword: email => auth.resetPassword({ email, redirectTo: config.authRedirect }),
      updatePassword: password => auth.updateUser({ password }).then(toUser),
      handleCallback: hash => auth.fromUrlFragment(hash).then(r => r && { type: r.type, user: toUser(r.user) }),
      googleUrl: () => auth.oauthUrl('google', config.authRedirect),
      /** Вход через Telegram: код авторизации меняется на одноразовую ссылку входа в Edge Function. */
      telegramExchange: ({ code, codeVerifier, redirectUri }) => invoke('telegram-auth', { code, code_verifier: codeVerifier, redirect_uri: redirectUri, redirect_to: config.authRedirect })
    },

    async getProfile() { return fromProfile((await db.select('profiles', { select: '*', id: `eq.${me()}` }))[0]); },
    async updateProfile(patch) {
      const map = { name: 'display_name', city: 'city', timezone: 'timezone', publicProfile: 'public_profile', locale: 'locale', handle: 'handle' };
      const row = {};
      for (const [k, v] of Object.entries(patch)) if (map[k]) row[map[k]] = v === '' && k === 'handle' ? null : v;
      await db.update('profiles', { id: `eq.${me()}` }, row);
    },
    isAdmin: () => db.rpc('is_admin'),

    async myEnrollments() {
      const rows = await db.select('enrollments', {
        select: 'id,public_id,challenge_slug,cohort_id,start_date,status,completed_at,checkins(day_number,checkin_date,mood,note,shared,post_text,proof_url,photo_path)',
        user_id: `eq.${me()}`, order: 'created_at.desc'
      });
      return rows.map(r => ({
        id: r.id, publicId: r.public_id, slug: r.challenge_slug, cohortId: r.cohort_id, startDate: r.start_date, status: r.status, completedAt: r.completed_at,
        checkins: (r.checkins || []).map(k => ({ day: k.day_number, date: k.checkin_date, mood: k.mood, note: k.note || '', shared: k.shared, post: k.post_text || '', proofUrl: k.proof_url, photo: k.photo_path })).sort((a, b) => a.day - b.day)
      }));
    },
    async myPaidSlugs() {
      return (await db.select('orders', { select: 'challenge_slug', user_id: `eq.${me()}`, status: 'eq.paid' })).map(r => r.challenge_slug);
    },

    challengeInfo: slug => db.rpc('challenge_info', { p_slug: slug }),
    async cohorts(slug) { return (await db.rpc('cohorts_for', { p_slug: slug })).map(r => ({ id: r.id, startDate: r.start_date, title: r.title, participants: r.participants })); },
    cohortResults: id => db.rpc('cohort_results', { p_cohort: id }),
    join: (slug, cohortId = null) => db.rpc('join_challenge', { p_slug: slug, p_cohort: cohortId }),
    leave: slug => db.rpc('leave_challenge', { p_slug: slug }),
    checkIn: (slug, d) => db.rpc('check_in', { p_slug: slug, p_mood: d.mood, p_note: d.note, p_share: !!d.share, p_post: d.post || null, p_proof_url: d.proofUrl || null, p_photo_path: d.photo || null }),
    undo: slug => db.rpc('undo_check_in', { p_slug: slug }),
    async uploadPhoto(blob) { return storage.upload('proofs', `${me()}/${uid()}.jpg`, blob, blob.type || 'image/jpeg'); },
    photoUrl: path => storage.publicUrl('proofs', path),

    async feed(slug, { cohort = null, before = null } = {}) { return (await db.rpc('feed', { p_slug: slug, p_cohort: cohort, p_before: before, p_limit: 20 })).map(toPost); },
    async friendsFeed({ before = null } = {}) { return (await db.rpc('friends_feed', { p_before: before, p_limit: 20 })).map(toPost); },
    react: (id, kind) => db.rpc('toggle_reaction', { p_checkin: id, p_kind: kind }),
    async comments(id) { return (await db.rpc('comments_for', { p_checkin: id })).map(c => ({ id: c.id, author: c.author, text: c.text, at: c.created_at, mine: c.mine })); },
    addComment: (id, text) => db.rpc('add_comment', { p_checkin: id, p_text: text }),
    deleteComment: id => db.rpc('delete_comment', { p_id: id }),
    report: (type, id, reason) => db.rpc('report_content', { p_type: type, p_id: String(id), p_reason: reason || null }),

    follow: (userId, on = true) => db.rpc('follow', { p_user: userId, p_on: on }),
    searchPeople: q => db.rpc('search_people', { p_q: q }),
    myFollows: () => db.rpc('my_follows'),
    person: userId => db.rpc('person', { p_user: userId }),

    async chat(cohortId, after = 0) { return (await db.rpc('cohort_messages', { p_cohort: cohortId, p_after: after, p_limit: 50 })).map(m => ({ id: m.id, author: m.author, text: m.text, at: m.created_at, mine: m.mine })); },
    sendMessage: (cohortId, text) => db.rpc('send_message', { p_cohort: cohortId, p_text: text }),

    saveMyChallenge: (slug, data) => db.rpc('save_my_challenge', { p_slug: slug, p_data: data }),
    deleteMyChallenge: slug => db.rpc('delete_my_challenge', { p_slug: slug }),
    joinByCode: code => db.rpc('join_by_code', { p_code: code }),
    myChallenges: () => db.rpc('my_challenges'),
    organizerReport: slug => db.rpc('organizer_report', { p_slug: slug }),

    /** Создает заказ и возвращает адрес страницы оплаты Payme или Click. */
    createPayment: (slug, provider) => invoke('payments', { slug, provider, return_url: config.siteUrl }),
    async orderStatus(publicId) { return (await db.select('orders', { select: 'status,challenge_slug,amount_uzs,provider', public_id: `eq.${publicId}` }))[0] || null; },
    certificate: id => db.rpc('certificate', { p_id: id }),

    async challengeStats() {
      const rows = await db.rpc('challenge_stats');
      return Object.fromEntries(rows.map(r => [r.slug, { participants: r.participants, avg: r.avg_progress, finish: r.finish_rate, activeToday: r.active_today }]));
    },
    async platformStats() { const s = await db.rpc('platform_stats'); return { participants: s.participants, checkins24h: s.checkins_24h, completed: s.completed, finishRate: s.finish_rate }; },
    async recentActivity() { return (await db.rpc('recent_activity', { p_limit: 12 })).map(r => ({ name: r.display_name, slug: r.challenge_slug, day: r.day_number, at: r.created_at })); },
    async leaderboard(slug, order = 'progress', cohort = null) {
      return (await db.rpc('leaderboard', { p_slug: slug, p_order: order, p_limit: 10, p_cohort: cohort })).map(r => ({ rank: r.rank, userId: r.user_id, name: r.display_name, done: r.done, streak: r.streak, pct: r.pct, me: r.is_me }));
    },
    async testimonials() {
      return (await db.select('testimonials', { select: 'author_name,challenge_slug,text', approved: 'eq.true', order: 'created_at.desc', limit: '6' })).map(r => ({ name: r.author_name, slug: r.challenge_slug, text: r.text }));
    },
    submitTestimonial: (slug, text) => db.rpc('submit_testimonial', { p_slug: slug, p_text: text }),
    deleteAccount: async () => { await db.rpc('delete_my_account'); await auth.signOut(); },
    logError: payload => db.insert('error_logs', payload),

    admin: {
      stats: () => db.rpc('admin_stats'),
      users: (q = '') => db.rpc('admin_users', { p_q: q, p_limit: 100, p_offset: 0 }),
      updateUser: (userId, patch) => db.rpc('admin_update_user', { p_user: userId, p_role: patch.role ?? null, p_banned: patch.banned ?? null }),
      challenges: () => db.rpc('admin_challenges'),
      saveChallenge: c => db.rpc('admin_save_challenge', { p: c }),
      deleteChallenge: slug => db.rpc('admin_delete_challenge', { p_slug: slug }),
      cohorts: slug => db.select('cohorts', { select: 'id,start_date,title', challenge_slug: `eq.${slug}`, order: 'start_date.desc' }),
      saveCohort: (slug, start, title, id = null) => db.rpc('admin_save_cohort', { p_slug: slug, p_start: start, p_title: title || null, p_id: id }),
      deleteCohort: id => db.rpc('admin_delete_cohort', { p_id: id }),
      moderation: () => db.rpc('admin_moderation'),
      moderate: (kind, id, action) => db.rpc('admin_moderate', { p_kind: kind, p_id: String(id), p_action: action }),
      orders: () => db.rpc('admin_orders', { p_limit: 200 }),
      errors: () => db.select('error_logs', { select: '*', order: 'created_at.desc', limit: '100' }),
      rebuild: () => invoke('rebuild-site', {})
    }
  };
}
