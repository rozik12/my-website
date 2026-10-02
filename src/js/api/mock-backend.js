/* Демо-бэкенд: тот же интерфейс, что у Supabase, данные — в localStorage этого браузера.
   Включается, если Supabase не настроен. Используется для превью и e2e-тестов.
   Правила (доступ, оплата, потоки, модерация) повторяют SQL-функции из supabase/migrations. */
import { CHALLENGES } from '../content.js';
import { isoInTz, addDaysIso, currentDay, streak, progressPct, diffDays } from '../lib/logic.js';
import { rng, uid } from '../lib/util.js';
import { ApiError } from './supabase-client.js';

const KEY = 'rb.mock.db.v2';
const SESSION = 'rb.mock.session';
export const DEMO_ACCOUNT = { email: 'demo@rubikon.app', password: 'Demo1234' };
const DEMO_NAMES = ['Марина К.', 'Тимур А.', 'Дарья С.', 'Игорь П.', 'Сабина Р.', 'Никита Л.', 'Алия Т.', 'Роман Б.', 'Ксения Г.', 'Артём Д.',
  'Полина М.', 'Денис Ш.', 'Жасмин Х.', 'Егор Ф.', 'Лейла Н.', 'Максим О.', 'Вера Ж.', 'Олег Ц.', 'Камила Ю.', 'Фёдор Е.'];
const POSTS = ['Сегодня было тяжело, но сделал!', 'Пятый день подряд — привычка складывается.', 'Утром не хотелось, вечером закрыла задание.',
  'Отличный день, на 10 минут больше плана.', 'Кто еще в потоке? Держимся!', 'Сделал и записал выводы.', 'Почти сорвалась, но вспомнила про серию.'];

const today = () => isoInTz(new Date());
const err = (msg, status = 400, code = '') => new ApiError(msg, { status, code });

function seed() {
  const r = rng('rubikon-demo-v2');
  const t = today();
  const db = { seq: 1, users: {}, profiles: {}, custom: {}, overrides: {}, cohorts: [], enrollments: [], checkins: [], reactions: [], comments: [],
    follows: [], messages: [], reports: [], testimonials: [], orders: [], errors: [], photos: {} };
  const addUser = (email, password, name, extra = {}) => {
    const id = 'u' + (db.seq++);
    db.users[email] = { id, email, password, name, confirmed: true };
    db.profiles[id] = { name, city: '', timezone: 'UTC', publicProfile: true, locale: 'ru', handle: '', role: 'user', banned: false, createdAt: new Date(Date.now() - r() * 60 * 86400000).toISOString(), ...extra };
    return id;
  };
  const enroll = (userId, slug, startDate, doneDays, status = 'active', cohortId = null, shareRate = 0.25) => {
    const c = CHALLENGES.find(x => x.slug === slug);
    const id = db.seq++;
    db.enrollments.push({ id, publicId: uid(), userId, slug, cohortId, startDate, status, completedAt: status === 'completed' ? addDaysIso(startDate, c.days) + 'T20:00:00Z' : null, createdAt: startDate + 'T08:00:00Z' });
    doneDays.forEach(d => {
      const shared = r() < shareRate;
      db.checkins.push({ id: db.seq++, enrollmentId: id, userId, day: d, date: addDaysIso(startDate, d - 1), mood: 3 + Math.floor(r() * 3), note: '',
        shared, post: shared ? POSTS[Math.floor(r() * POSTS.length)] : '', proofUrl: null, photo: null, hidden: false,
        createdAt: addDaysIso(startDate, d - 1) + `T0${6 + Math.floor(r() * 3)}:${10 + Math.floor(r() * 49)}:00Z` });
    });
    return id;
  };
  // Потоки: идущий и предстоящие
  const running = { id: db.seq++, slug: 'cold-shower', startDate: addDaysIso(t, -9), title: 'Октябрьский поток' };
  db.cohorts.push(running);
  for (const c of CHALLENGES.filter(c => c.nextStart)) db.cohorts.push({ id: db.seq++, slug: c.slug, startDate: c.nextStart > t ? c.nextStart : addDaysIso(t, 5), title: null });

  const ids = DEMO_NAMES.map(n => addUser(n.toLowerCase().replace(/[^a-zа-яё]/gi, '') + '@demo.local', 'x', n));
  ids.forEach((u, i) => {
    if (i < 8) { const done = []; for (let d = 1; d <= 10; d++) if (r() < 0.85 || d === 10) done.push(d); enroll(u, 'cold-shower', running.startDate, done, 'active', running.id, 0.4); }
    CHALLENGES.filter(c => !c.priceUzs && r() > 0.7).slice(0, 2).forEach(c => {
      const ago = Math.floor(r() * Math.min(c.days, 20)), done = [];
      for (let d = 1; d <= ago + 1; d++) if (r() < 0.8 || d === ago + 1) done.push(d);
      if (!db.enrollments.some(e => e.userId === u && e.slug === c.slug)) enroll(u, c.slug, addDaysIso(t, -ago), done);
    });
    if (r() > 0.6) { const free = CHALLENGES.filter(c => !c.priceUzs); const c = free[Math.floor(r() * free.length)]; enroll(u, c.slug, addDaysIso(t, -(c.days + 10 + Math.floor(r() * 30))), Array.from({ length: c.days }, (_, k) => k + 1), 'completed'); }
  });

  // Демо-аккаунт — администратор, чтобы можно было посмотреть админку
  const me = addUser(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password, 'Алексей Смирнов', { city: 'Ташкент', role: 'admin', handle: 'alexey' });
  const range = (a, b, skip = []) => Array.from({ length: b - a + 1 }, (_, i) => a + i).filter(d => !skip.includes(d));
  enroll(me, 'cold-shower', running.startDate, range(1, 9, [4]), 'active', running.id, 0.5);
  enroll(me, 'deep-work', addDaysIso(t, -5), range(1, 5), 'active', null, 0);
  enroll(me, 'pushups-100', addDaysIso(t, -21), range(1, 21, [4, 13]), 'active', null, 0.1);
  enroll(me, 'detox-7', addDaysIso(t, -50), range(1, 7), 'completed', null, 0);
  enroll(me, 'read-20', addDaysIso(t, -95), range(1, 30), 'completed', null, 0);
  ids.slice(0, 3).forEach(f => db.follows.push({ follower: me, followee: f, at: new Date().toISOString() }));
  ids.slice(3, 6).forEach(f => db.follows.push({ follower: f, followee: me, at: new Date().toISOString() }));

  // Комментарии, реакции, чат потока, отзывы, жалоба
  const shared = db.checkins.filter(k => k.shared).slice(-25);
  shared.forEach(k => {
    ids.filter(() => r() > 0.7).forEach(u => db.reactions.push({ checkinId: k.id, userId: u, kind: ['fire', 'clap', 'heart'][Math.floor(r() * 3)] }));
    if (r() > 0.6) db.comments.push({ id: db.seq++, checkinId: k.id, userId: ids[Math.floor(r() * 8)], text: ['Так держать!', 'Вдохновляет', 'Завтра тоже отмечаемся', 'Красота!'][Math.floor(r() * 4)], hidden: false, at: k.createdAt });
  });
  ['Всем привет! Кто сегодня уже сделал?', 'Я! Вода +12, бодрит лучше кофе', 'Держимся, осталось 20 дней', 'Совет: начинайте с ног, так легче'].forEach((text, i) =>
    db.messages.push({ id: db.seq++, cohortId: running.id, userId: ids[i % 4], text, hidden: false, at: new Date(Date.now() - (4 - i) * 3600000).toISOString() }));
  db.testimonials.push({ id: db.seq++, userId: ids[2], slug: 'read-20', name: DEMO_NAMES[2], text: 'Прочитала три книги за месяц. Ежедневная отметка держит лучше любых обещаний себе.', approved: true },
    { id: db.seq++, userId: ids[5], slug: 'steps-10k', name: DEMO_NAMES[5], text: 'Ходил каждый день, даже в дождь. Спина болит меньше, сон стал ровнее.', approved: false });
  if (db.comments[0]) db.reports.push({ id: db.seq++, reporter: ids[1], type: 'comment', targetId: String(db.comments[0].id), reason: 'Спам', status: 'open', at: new Date().toISOString() });
  return db;
}

export function createMockBackend({ storage = localStorage, session = sessionStorage, latency = 100 } = {}) {
  let db;
  try { db = JSON.parse(storage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const save = () => { try { storage.setItem(KEY, JSON.stringify(db)); } catch { /* память */ } };
  save();
  const wait = v => new Promise((res, rej) => setTimeout(() => { try { res(typeof v === 'function' ? v() : v); } catch (e) { rej(e); } }, latency));
  const listeners = new Set();

  let currentId = null;
  try { currentId = storage.getItem(SESSION); } catch { /* */ }
  const userById = id => Object.values(db.users).find(u => u.id === id);
  const current = () => (currentId ? userById(currentId) : null);
  const setCurrent = id => { currentId = id; try { id ? storage.setItem(SESSION, id) : storage.removeItem(SESSION); } catch { /* */ } listeners.forEach(fn => fn(api.auth.user)); };
  const need = () => {
    const u = current(); if (!u) throw err('Требуется вход', 401, 'PT401');
    if (db.profiles[u.id]?.banned) throw err('Аккаунт заблокирован', 403, 'PT403');
    return u;
  };
  const needAdmin = () => { const u = need(); if (db.profiles[u.id].role !== 'admin') throw err('Нужны права администратора', 403); return u; };
  const toUser = u => u && ({ id: u.id, email: u.email, name: db.profiles[u.id]?.name || u.name, confirmed: u.confirmed });
  const pend = v => { try { session.setItem('rb.mock.pending', JSON.stringify(v)); } catch { /* */ } };
  const newProfile = (name, extra = {}) => ({ name: name || 'Участник', city: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, publicProfile: true,
    locale: (typeof document !== 'undefined' && document.documentElement.lang) || 'ru', handle: '', role: 'user', banned: false, createdAt: new Date().toISOString(), ...extra });

  // Каталог: официальный (с правками админа) + свои челленджи
  const catalog = () => [...CHALLENGES.map(c => db.overrides[c.slug] || c), ...Object.values(db.overrides).filter(o => !CHALLENGES.some(c => c.slug === o.slug)), ...Object.values(db.custom)];
  const ch = slug => catalog().find(c => c.slug === slug);
  const profile = id => db.profiles[id] || { name: 'Участник', publicProfile: false };
  const nameOf = id => (profile(id).publicProfile ? profile(id).name : 'Участник');
  const active = (userId, slug) => db.enrollments.find(e => e.userId === userId && e.slug === slug && e.status === 'active');
  const doneOf = e => db.checkins.filter(k => k.enrollmentId === e.id).map(k => k.day);
  const dayOf = e => currentDay(e.startDate, ch(e.slug).days, today());
  const hasAccess = (userId, slug) => { const c = ch(slug); return !!c && (!c.priceUzs || c.ownerId === userId || db.orders.some(o => o.userId === userId && o.slug === slug && o.status === 'paid')); };
  const canView = slug => {
    const c = ch(slug); if (!c) return false;
    const u = current();
    return (c.visibility !== 'private' && c.published !== false) || !!(u && (c.ownerId === u.id || db.profiles[u.id]?.role === 'admin' || db.enrollments.some(e => e.slug === slug && e.userId === u.id)));
  };
  const postOf = k => {
    const e = db.enrollments.find(x => x.id === k.enrollmentId), me = current()?.id, p = profile(k.userId);
    const rs = db.reactions.filter(x => x.checkinId === k.id);
    return { id: k.id, userId: k.userId, author: nameOf(k.userId), handle: p.publicProfile ? p.handle || null : null, slug: e?.slug, day: k.day, text: k.post, proofUrl: k.proofUrl, photo: k.photo, at: k.createdAt,
      fire: rs.filter(x => x.kind === 'fire').length, clap: rs.filter(x => x.kind === 'clap').length, heart: rs.filter(x => x.kind === 'heart').length,
      mine: rs.filter(x => x.userId === me).map(x => x.kind), comments: db.comments.filter(c => c.checkinId === k.id && !c.hidden).length };
  };
  const visiblePost = k => k.shared && !k.hidden && !profile(k.userId).banned;

  const api = {
    kind: 'mock',
    auth: {
      get user() { return toUser(current()); },
      onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      signUp: ({ email, password, name }) => wait(() => {
        email = email.toLowerCase();
        if (!db.users[email]) {
          const id = 'u' + (db.seq++);
          db.users[email] = { id, email, password, name, confirmed: false };
          db.profiles[id] = newProfile(name);
          save();
        }
        pend({ type: 'signup', email });
        return { needsConfirmation: true };
      }),
      signIn: ({ email, password }) => wait(() => {
        const u = db.users[email.toLowerCase()];
        if (!u || u.password !== password) throw err('Invalid login credentials', 400, 'invalid_credentials');
        if (!u.confirmed) throw err('Email not confirmed', 400, 'email_not_confirmed');
        setCurrent(u.id); return toUser(u);
      }),
      signOut: () => wait(() => setCurrent(null)),
      resendConfirmation: email => wait(() => { pend({ type: 'signup', email: email.toLowerCase() }); return {}; }),
      resetPassword: email => wait(() => { pend({ type: 'recovery', email: email.toLowerCase() }); return {}; }),
      updatePassword: password => wait(() => { const u = need(); u.password = password; save(); return toUser(u); }),
      handleCallback: () => wait(() => {
        let p = null; try { p = JSON.parse(session.getItem('rb.mock.pending')); session.removeItem('rb.mock.pending'); } catch { /* */ }
        if (!p) return null;
        if (p.type === 'oauth') {
          const email = `${p.provider}.demo@rubikon.app`;
          if (!db.users[email]) {
            const id = 'u' + (db.seq++), name = p.provider === 'google' ? 'Гость Google' : 'Гость Telegram';
            db.users[email] = { id, email, password: uid(), name, confirmed: true };
            db.profiles[id] = newProfile(name);
          }
          save(); setCurrent(db.users[email].id);
          return { type: 'signup', user: toUser(db.users[email]) };
        }
        if (!db.users[p.email]) return null;
        const u = db.users[p.email]; u.confirmed = true; save(); setCurrent(u.id);
        return { type: p.type, user: toUser(u) };
      }),
      /** В демо вход через Google и Telegram имитируется переходом на страницу подтверждения. */
      googleUrl() { pend({ type: 'oauth', provider: 'google' }); return null; },
      telegramDemo() { pend({ type: 'oauth', provider: 'telegram' }); }
    },

    getProfile: () => wait(() => ({ ...db.profiles[need().id] })),
    updateProfile: patch => wait(() => {
      const u = need();
      if (patch.handle && !/^[a-z0-9_]{3,30}$/.test(patch.handle)) throw err('Никнейм: 3–30 символов, латиница, цифры и _');
      if (patch.handle && Object.entries(db.profiles).some(([id, p]) => id !== u.id && p.handle === patch.handle)) throw err('Этот никнейм уже занят', 409);
      Object.assign(db.profiles[u.id], patch); save();
    }),
    isAdmin: () => wait(() => db.profiles[current()?.id]?.role === 'admin'),

    myEnrollments: () => wait(() => {
      const u = need();
      return db.enrollments.filter(e => e.userId === u.id).sort((a, b) => b.id - a.id).map(e => ({
        id: e.id, publicId: e.publicId, slug: e.slug, cohortId: e.cohortId, startDate: e.startDate, status: e.status, completedAt: e.completedAt,
        checkins: db.checkins.filter(k => k.enrollmentId === e.id).sort((a, b) => a.day - b.day).map(k => ({ day: k.day, date: k.date, mood: k.mood, note: k.note, shared: k.shared, post: k.post, proofUrl: k.proofUrl, photo: k.photo }))
      }));
    }),
    myPaidSlugs: () => wait(() => db.orders.filter(o => o.userId === current()?.id && o.status === 'paid').map(o => o.slug)),

    challengeInfo: slug => wait(() => {
      const c = ch(slug); if (!c || !canView(slug)) return null;
      const u = current();
      return { ...c, isOwner: !!u && c.ownerId === u.id, inviteCode: u && c.ownerId === u.id ? c.inviteCode : null, custom: !!c.ownerId };
    }),
    cohorts: slug => wait(() => db.cohorts.filter(h => h.slug === slug && h.startDate >= addDaysIso(today(), -3)).sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map(h => ({ id: h.id, startDate: h.startDate, title: h.title, participants: db.enrollments.filter(e => e.cohortId === h.id).length }))),
    cohortResults: id => wait(() => {
      const es = db.enrollments.filter(e => e.cohortId === id), c = es[0] && ch(es[0].slug);
      return { participants: es.length, finished: es.filter(e => e.status === 'completed').length,
        avg_progress: es.length ? Math.round(es.reduce((s, e) => s + progressPct(doneOf(e).length, c.days), 0) / es.length) : 0,
        top: es.map(e => ({ name: nameOf(e.userId), done: doneOf(e).length })).sort((a, b) => b.done - a.done).slice(0, 3) };
    }),
    join: (slug, cohortId = null) => wait(() => {
      const u = need(), c = ch(slug);
      if (!c || (c.visibility === 'private' && c.ownerId !== u.id && !db.enrollments.some(e => e.slug === slug && e.userId === u.id))) throw err('Челлендж не найден', 404);
      if (!hasAccess(u.id, slug)) throw err('Требуется оплата', 402, 'PT402');
      if (db.enrollments.filter(e => e.userId === u.id && e.status === 'active').length >= 10) throw err('Можно участвовать не более чем в 10 челленджах одновременно');
      let start = today();
      if (cohortId) {
        const h = db.cohorts.find(x => x.id === cohortId && x.slug === slug);
        if (!h) throw err('Поток не найден', 404);
        if (h.startDate < addDaysIso(today(), -3)) throw err('Запись в этот поток закрыта');
        start = h.startDate;
      }
      if (!active(u.id, slug)) { db.enrollments.push({ id: db.seq++, publicId: uid(), userId: u.id, slug, cohortId, startDate: start, status: 'active', completedAt: null, createdAt: new Date().toISOString() }); save(); }
      return { slug, start_date: start };
    }),
    leave: slug => wait(() => {
      const u = need(), e = active(u.id, slug); if (!e) return;
      db.enrollments = db.enrollments.filter(x => x !== e); db.checkins = db.checkins.filter(k => k.enrollmentId !== e.id); save();
    }),
    checkIn: (slug, d) => wait(() => {
      const u = need(), e = active(u.id, slug), c = ch(slug);
      if (!e) throw err('Вы не участвуете в этом челлендже');
      if (today() < e.startDate) throw err('Поток еще не начался');
      if (d.proofUrl && !/^https:\/\//.test(d.proofUrl)) throw err('Ссылка должна начинаться с https://');
      if (c.proof === 'required' && !d.proofUrl && !d.photo) throw err('Для этого челленджа нужно подтверждение: фото или ссылка');
      const day = dayOf(e);
      const row = { mood: d.mood, note: (d.note || '').slice(0, 280), shared: !!d.share, post: (d.post || '').slice(0, 500), proofUrl: d.proofUrl || null, photo: d.photo || null };
      const ex = db.checkins.find(k => k.enrollmentId === e.id && k.day === day);
      if (ex) Object.assign(ex, row, { proofUrl: row.proofUrl || ex.proofUrl, photo: row.photo || ex.photo });
      else db.checkins.push({ id: db.seq++, enrollmentId: e.id, userId: u.id, day, date: today(), hidden: false, createdAt: new Date().toISOString(), ...row });
      const done = doneOf(e);
      let completed = false;
      if (done.length >= c.days) { e.status = 'completed'; e.completedAt = new Date().toISOString(); completed = true; }
      save();
      return { day, done: done.length, streak: streak(done, day), completed, certificate: completed ? e.publicId : null };
    }),
    undo: slug => wait(() => { const u = need(), e = active(u.id, slug); if (!e) return; const day = dayOf(e); db.checkins = db.checkins.filter(k => !(k.enrollmentId === e.id && k.day === day)); save(); }),
    uploadPhoto: blob => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => { try { const path = `${need().id}/${uid()}.jpg`; db.photos[path] = fr.result; save(); res(path); } catch (e) { rej(e); } };
      fr.onerror = () => rej(err('Не удалось прочитать файл'));
      fr.readAsDataURL(blob);
    }),
    photoUrl: path => db.photos[path] || '',

    feed: (slug, { cohort = null, before = null } = {}) => wait(() => {
      if (!canView(slug)) return [];
      return db.checkins.filter(k => { const e = db.enrollments.find(x => x.id === k.enrollmentId); return e && e.slug === slug && visiblePost(k) && (!cohort || e.cohortId === cohort) && (!before || k.id < before); })
        .sort((a, b) => b.id - a.id).slice(0, 20).map(postOf);
    }),
    friendsFeed: ({ before = null } = {}) => wait(() => {
      const u = need(), fol = new Set(db.follows.filter(f => f.follower === u.id).map(f => f.followee));
      return db.checkins.filter(k => fol.has(k.userId) && visiblePost(k) && (!before || k.id < before)).sort((a, b) => b.id - a.id).slice(0, 20).map(postOf);
    }),
    react: (id, kind) => wait(() => {
      const u = need(), k = db.checkins.find(x => x.id === id);
      if (!k || !visiblePost(k)) throw err('Запись не найдена', 404);
      const i = db.reactions.findIndex(x => x.checkinId === id && x.userId === u.id && x.kind === kind);
      i >= 0 ? db.reactions.splice(i, 1) : db.reactions.push({ checkinId: id, userId: u.id, kind });
      save(); const p = postOf(k); return { fire: p.fire, clap: p.clap, heart: p.heart, mine: p.mine };
    }),
    comments: id => wait(() => db.comments.filter(c => c.checkinId === id && !c.hidden && !profile(c.userId).banned).map(c => ({ id: c.id, author: nameOf(c.userId), text: c.text, at: c.at, mine: c.userId === current()?.id }))),
    addComment: (id, text) => wait(() => {
      const u = need();
      if (!text.trim() || text.length > 500) throw err('Комментарий: от 1 до 500 символов');
      if (db.comments.filter(c => c.userId === u.id && Date.parse(c.at) > Date.now() - 60000).length >= 10) throw err('Слишком часто. Подождите минуту.', 429);
      const c = { id: db.seq++, checkinId: id, userId: u.id, text: text.trim(), hidden: false, at: new Date().toISOString() };
      db.comments.push(c); save(); return c.id;
    }),
    deleteComment: id => wait(() => { const u = need(); db.comments = db.comments.filter(c => !(c.id === id && (c.userId === u.id || db.profiles[u.id].role === 'admin'))); save(); }),
    report: (type, id, reason) => wait(() => {
      const u = need();
      if (!db.reports.some(r => r.reporter === u.id && r.type === type && r.targetId === String(id))) db.reports.push({ id: db.seq++, reporter: u.id, type, targetId: String(id), reason: reason || '', status: 'open', at: new Date().toISOString() });
      save();
    }),

    follow: (userId, on = true) => wait(() => {
      const u = need();
      db.follows = db.follows.filter(f => !(f.follower === u.id && f.followee === userId));
      if (on && userId !== u.id) db.follows.push({ follower: u.id, followee: userId, at: new Date().toISOString() });
      save();
    }),
    searchPeople: q => wait(() => {
      q = q.trim().toLowerCase(); if (q.length < 2) return [];
      const me = current()?.id;
      return Object.entries(db.profiles).filter(([id, p]) => id !== me && p.publicProfile && !p.banned && (p.name.toLowerCase().includes(q) || (p.handle || '').startsWith(q)))
        .slice(0, 20).map(([id, p]) => ({ id, name: p.name, handle: p.handle || null, following: db.follows.some(f => f.follower === me && f.followee === id) }));
    }),
    myFollows: () => wait(() => { const u = need(); return db.follows.filter(f => f.follower === u.id).map(f => ({ id: f.followee, name: profile(f.followee).name, handle: profile(f.followee).handle || null, following: true })); }),
    person: id => wait(() => {
      const p = db.profiles[id], me = current()?.id;
      if (!p || p.banned || (!p.publicProfile && id !== me)) return null;
      const es = db.enrollments.filter(e => e.userId === id && ch(e.slug)?.visibility !== 'private');
      return { id, name: p.name, handle: p.handle || null, following: db.follows.some(f => f.follower === me && f.followee === id),
        followers: db.follows.filter(f => f.followee === id).length, active: es.filter(e => e.status === 'active').length,
        finished: es.filter(e => e.status === 'completed').length, checkins: db.checkins.filter(k => k.userId === id).length,
        challenges: es.map(e => ({ slug: e.slug, status: e.status, done: doneOf(e).length })) };
    }),

    chat: (cohortId, after = 0) => wait(() => {
      const u = current(); if (!u) return [];
      const inCohort = db.enrollments.some(e => e.cohortId === cohortId && e.userId === u.id) || db.profiles[u.id]?.role === 'admin';
      if (!inCohort) return [];
      return db.messages.filter(m => m.cohortId === cohortId && m.id > after && !m.hidden).slice(-50).map(m => ({ id: m.id, author: nameOf(m.userId), text: m.text, at: m.at, mine: m.userId === u.id }));
    }),
    sendMessage: (cohortId, text) => wait(() => {
      const u = need();
      if (!db.enrollments.some(e => e.cohortId === cohortId && e.userId === u.id) && db.profiles[u.id].role !== 'admin') throw err('Чат доступен участникам потока', 403);
      if (!text.trim() || text.length > 1000) throw err('Сообщение: от 1 до 1000 символов');
      const m = { id: db.seq++, cohortId, userId: u.id, text: text.trim(), hidden: false, at: new Date().toISOString() };
      db.messages.push(m); save(); return m.id;
    }),

    saveMyChallenge: (slug, d) => wait(() => {
      const u = need();
      if (!d.title || d.title.length < 3 || d.title.length > 80) throw err('Название: от 3 до 80 символов');
      if (!(d.days >= 1 && d.days <= 100)) throw err('Длительность: от 1 до 100 дней');
      if (!d.tasks?.length || d.tasks.length > 100) throw err('Добавьте от 1 до 100 заданий');
      if (!slug) {
        if (Object.values(db.custom).filter(c => c.ownerId === u.id).length >= 20) throw err('Можно создать не более 20 челленджей');
        slug = 'u-' + uid().replace(/-/g, '').slice(0, 10);
        db.custom[slug] = { slug, ownerId: u.id, visibility: 'private', inviteCode: uid().replace(/-/g, '').slice(0, 8).toUpperCase(), priceUzs: 0, published: true, createdAt: new Date().toISOString() };
      } else if (db.custom[slug]?.ownerId !== u.id) throw err('Челлендж не найден', 404);
      const lang = db.profiles[u.id].locale || 'ru';
      Object.assign(db.custom[slug], { category: d.category || 'growth', level: d.level || 'medium', days: +d.days, icon: d.icon || 'target', proof: d.proof || 'none', nextStart: null,
        content: { [lang]: { title: d.title, short: d.short || '', goal: d.goal || '', rules: d.rules || [], phases: [{ title: 'План', tasks: d.tasks }] } } });
      save(); return slug;
    }),
    deleteMyChallenge: slug => wait(() => {
      const u = need();
      if (db.custom[slug]?.ownerId !== u.id) return;
      delete db.custom[slug];
      const ids = db.enrollments.filter(e => e.slug === slug).map(e => e.id);
      db.enrollments = db.enrollments.filter(e => e.slug !== slug); db.checkins = db.checkins.filter(k => !ids.includes(k.enrollmentId)); save();
    }),
    joinByCode: code => wait(() => {
      const u = need(), c = Object.values(db.custom).find(x => x.inviteCode === code.trim().toUpperCase());
      if (!c) throw err('Код приглашения не найден', 404);
      if (!active(u.id, c.slug)) db.enrollments.push({ id: db.seq++, publicId: uid(), userId: u.id, slug: c.slug, cohortId: null, startDate: today(), status: 'active', completedAt: null, createdAt: new Date().toISOString() });
      save(); return c.slug;
    }),
    myChallenges: () => wait(() => {
      const u = need();
      return Object.values(db.custom).filter(c => c.ownerId === u.id).map(c => ({ slug: c.slug, title: Object.values(c.content)[0].title, days: c.days, visibility: c.visibility, invite_code: c.inviteCode, participants: db.enrollments.filter(e => e.slug === c.slug).length, created_at: c.createdAt }));
    }),
    organizerReport: slug => wait(() => {
      const u = need(), c = ch(slug);
      if (!c || (c.ownerId !== u.id && db.profiles[u.id].role !== 'admin')) return [];
      return db.enrollments.filter(e => e.slug === slug).map(e => {
        const done = doneOf(e);
        return { name: profile(e.userId).name, start_date: e.startDate, status: e.status, done: done.length, pct: progressPct(done.length, c.days), streak: e.status === 'active' ? streak(done, dayOf(e)) : 0, last_checkin: db.checkins.filter(k => k.enrollmentId === e.id).map(k => k.date).sort().pop() || null };
      }).sort((a, b) => b.done - a.done);
    }),

    /** Демо-оплата: заказ сразу оплачен (в продакшене — переход на страницу Payme или Click). */
    createPayment: (slug, provider) => wait(() => {
      const u = need(), c = ch(slug);
      if (!c?.priceUzs) throw err('Этот челлендж бесплатный');
      if (hasAccess(u.id, slug)) throw err('Уже оплачено');
      const o = { id: db.seq++, publicId: uid(), userId: u.id, slug, amount: c.priceUzs, provider, status: 'paid', createdAt: new Date().toISOString(), paidAt: new Date().toISOString() };
      db.orders.push(o); save();
      return { order: o.publicId, url: null };
    }),
    orderStatus: publicId => wait(() => { const o = db.orders.find(x => x.publicId === publicId); return o ? { status: o.status, challenge_slug: o.slug, amount_uzs: o.amount, provider: o.provider } : null; }),
    certificate: id => wait(() => {
      const e = db.enrollments.find(x => x.publicId === id && x.status === 'completed'); if (!e) return null;
      const c = ch(e.slug);
      return { id: e.publicId, name: profile(e.userId).name, slug: e.slug, title: c.content, days: c.days, level: c.level, completedAt: e.completedAt, startDate: e.startDate, checkins: doneOf(e).length };
    }),

    challengeStats: () => wait(() => {
      const t = today(), out = {};
      for (const c of catalog().filter(x => x.visibility !== 'private')) {
        const es = db.enrollments.filter(e => e.slug === c.slug);
        const ended = es.filter(e => e.status === 'completed' || diffDays(e.startDate, t) >= c.days);
        out[c.slug] = { participants: es.length, avg: es.length ? Math.round(es.reduce((s, e) => s + progressPct(doneOf(e).length, c.days), 0) / es.length) : 0,
          finish: ended.length ? Math.round(es.filter(e => e.status === 'completed').length / ended.length * 100) : null,
          activeToday: new Set(db.checkins.filter(k => es.some(e => e.id === k.enrollmentId) && Date.parse(k.createdAt) > Date.now() - 86400000).map(k => k.userId)).size };
      }
      return out;
    }),
    platformStats: () => wait(() => {
      const t = today(), pub = db.enrollments.filter(e => ch(e.slug) && ch(e.slug).visibility !== 'private');
      const ended = pub.filter(e => e.status === 'completed' || diffDays(e.startDate, t) >= ch(e.slug).days), completed = pub.filter(e => e.status === 'completed').length;
      return { participants: new Set(pub.map(e => e.userId)).size, checkins24h: db.checkins.filter(k => Date.parse(k.createdAt) > Date.now() - 86400000).length, completed, finishRate: ended.length ? Math.round(completed / ended.length * 100) : null };
    }),
    recentActivity: () => wait(() => [...db.checkins].filter(k => { const e = db.enrollments.find(x => x.id === k.enrollmentId); return e && profile(k.userId).publicProfile && !profile(k.userId).banned && ch(e.slug)?.visibility !== 'private'; })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12).map(k => ({ name: profile(k.userId).name, slug: db.enrollments.find(e => e.id === k.enrollmentId).slug, day: k.day, at: k.createdAt }))),
    leaderboard: (slug, order = 'progress', cohort = null) => wait(() => {
      if (!canView(slug)) return [];
      const me = current()?.id, c = ch(slug);
      const rows = db.enrollments.filter(e => e.slug === slug && e.status === 'active' && !profile(e.userId).banned && (!cohort || e.cohortId === cohort) && (profile(e.userId).publicProfile || e.userId === me)).map(e => {
        const done = doneOf(e); return { userId: e.userId, name: profile(e.userId).name, done: done.length, streak: streak(done, dayOf(e)), pct: progressPct(done.length, c.days), me: e.userId === me };
      });
      const k1 = order === 'streak' ? 'streak' : 'done', k2 = order === 'streak' ? 'done' : 'streak';
      rows.sort((a, b) => b[k1] - a[k1] || b[k2] - a[k2]);
      return rows.map((r, i) => ({ ...r, rank: i + 1 })).filter(r => r.rank <= 10 || r.me);
    }),
    testimonials: () => wait(() => db.testimonials.filter(t => t.approved).map(t => ({ name: t.name, slug: t.slug, text: t.text }))),
    submitTestimonial: (slug, text) => wait(() => {
      const u = need();
      if (!db.enrollments.some(e => e.userId === u.id && e.slug === slug && e.status === 'completed')) throw err('Отзыв можно оставить после завершения челленджа');
      db.testimonials = db.testimonials.filter(t => !(t.userId === u.id && t.slug === slug));
      db.testimonials.push({ id: db.seq++, userId: u.id, slug, name: profile(u.id).name, text, approved: false }); save();
    }),
    deleteAccount: () => wait(() => {
      const u = need(), ids = db.enrollments.filter(e => e.userId === u.id).map(e => e.id);
      db.enrollments = db.enrollments.filter(e => e.userId !== u.id); db.checkins = db.checkins.filter(k => !ids.includes(k.enrollmentId));
      db.follows = db.follows.filter(f => f.follower !== u.id && f.followee !== u.id); db.comments = db.comments.filter(c => c.userId !== u.id);
      delete db.profiles[u.id]; delete db.users[u.email]; save(); setCurrent(null);
    }),
    logError: payload => { db.errors = [...(db.errors || []).slice(-49), { ...payload, created_at: new Date().toISOString() }]; save(); return Promise.resolve(); },

    admin: {
      stats: () => wait(() => {
        needAdmin();
        const day = d => addDaysIso(today(), -d), users = Object.values(db.profiles), paid = db.orders.filter(o => o.status === 'paid');
        return { users: users.length, users_7d: users.filter(p => (p.createdAt || '') > day(7)).length,
          active_24h: new Set(db.checkins.filter(k => Date.parse(k.createdAt) > Date.now() - 86400000).map(k => k.userId)).size,
          checkins_24h: db.checkins.filter(k => Date.parse(k.createdAt) > Date.now() - 86400000).length,
          enrollments_active: db.enrollments.filter(e => e.status === 'active').length, completed: db.enrollments.filter(e => e.status === 'completed').length,
          revenue_uzs: paid.reduce((s, o) => s + o.amount, 0), revenue_30d_uzs: paid.filter(o => o.paidAt > day(30)).reduce((s, o) => s + o.amount, 0),
          open_reports: db.reports.filter(r => r.status === 'open').length, pending_testimonials: db.testimonials.filter(t => !t.approved).length, errors_24h: (db.errors || []).length,
          signups_by_day: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), n: users.filter(p => (p.createdAt || '').slice(0, 10) === day(13 - i)).length })),
          checkins_by_day: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), n: db.checkins.filter(k => k.date === day(13 - i)).length })) };
      }),
      users: (q = '') => wait(() => {
        needAdmin(); q = q.toLowerCase();
        return Object.values(db.users).filter(u => db.profiles[u.id] && (!q || u.email.includes(q) || db.profiles[u.id].name.toLowerCase().includes(q))).map(u => ({ id: u.id, email: u.email, name: db.profiles[u.id].name, role: db.profiles[u.id].role, banned: db.profiles[u.id].banned, created_at: db.profiles[u.id].createdAt, enrollments: db.enrollments.filter(e => e.userId === u.id).length, last_checkin: db.checkins.filter(k => k.userId === u.id).map(k => k.createdAt).sort().pop() || null }));
      }),
      updateUser: (userId, patch) => wait(() => { const a = needAdmin(); if (userId === a.id && (patch.role === 'user' || patch.banned)) throw err('Нельзя снять права или заблокировать самого себя'); Object.assign(db.profiles[userId], patch); save(); }),
      challenges: () => wait(() => { needAdmin(); return catalog().map(c => ({ slug: c.slug, title: (c.content?.ru || Object.values(c.content)[0]).title, category: c.category, level: c.level, days: c.days, icon: c.icon, next_start: c.nextStart, proof: c.proof || 'none', price_uzs: c.priceUzs || 0, published: c.published !== false, visibility: c.visibility || 'public', custom: !!c.ownerId, content: c.content, participants: db.enrollments.filter(e => e.slug === c.slug).length })); }),
      saveChallenge: c => wait(() => { needAdmin(); if (!/^[a-z0-9-]{2,60}$/.test(c.slug)) throw err('Адрес: латиница, цифры и дефис'); if (db.custom[c.slug]) throw err('Это пользовательский челлендж'); db.overrides[c.slug] = { ...c, visibility: 'public' }; save(); }),
      deleteChallenge: slug => wait(() => { needAdmin(); const base = ch(slug); if (!base) return; db.overrides[slug] = { ...base, published: false }; save(); }),
      cohorts: slug => wait(() => { needAdmin(); return db.cohorts.filter(h => h.slug === slug).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(h => ({ id: h.id, start_date: h.startDate, title: h.title })); }),
      saveCohort: (slug, start, title, id = null) => wait(() => { needAdmin(); if (id) Object.assign(db.cohorts.find(h => h.id === id), { startDate: start, title }); else db.cohorts.push({ id: db.seq++, slug, startDate: start, title }); save(); }),
      deleteCohort: id => wait(() => { needAdmin(); db.cohorts = db.cohorts.filter(h => h.id !== id); save(); }),
      moderation: () => wait(() => {
        needAdmin();
        const items = db.testimonials.filter(t => !t.approved).map(t => ({ kind: 'testimonial', id: String(t.id), author: t.name, text: t.text, extra: t.slug, created_at: new Date().toISOString(), reports: 0 }));
        const groups = {};
        db.reports.filter(r => r.status === 'open').forEach(r => { (groups[r.type + ':' + r.targetId] ||= []).push(r); });
        for (const rs of Object.values(groups)) {
          const r = rs[0];
          const list = r.type === 'checkin' ? db.checkins : r.type === 'comment' ? db.comments : db.messages;
          const tgt = list.find(o => String(o.id) === r.targetId);
          items.push({ kind: r.type, id: r.targetId, author: tgt ? profile(tgt.userId).name : '—', text: tgt ? (tgt.post || tgt.text || tgt.proofUrl || '') : '', extra: rs.map(x => x.reason).filter(Boolean).join('; '), created_at: r.at, reports: rs.length });
        }
        return items;
      }),
      moderate: (kind, id, action) => wait(() => {
        needAdmin();
        if (kind === 'testimonial') { const tm = db.testimonials.find(x => String(x.id) === String(id)); if (action === 'approve') tm.approved = true; else db.testimonials = db.testimonials.filter(x => x !== tm); save(); return; }
        if (action === 'hide') { const list = kind === 'checkin' ? db.checkins : kind === 'comment' ? db.comments : db.messages; const x = list.find(o => String(o.id) === String(id)); if (x) x.hidden = true; }
        db.reports.filter(r => r.type === kind && r.targetId === String(id) && r.status === 'open').forEach(r => { r.status = action === 'hide' ? 'resolved' : 'dismissed'; });
        save();
      }),
      orders: () => wait(() => { needAdmin(); return db.orders.map(o => ({ id: o.id, email: userById(o.userId)?.email, challenge_slug: o.slug, amount_uzs: o.amount, provider: o.provider, status: o.status, created_at: o.createdAt, paid_at: o.paidAt })).reverse(); }),
      errors: () => wait(() => { needAdmin(); return [...(db.errors || [])].reverse(); }),
      rebuild: () => wait(() => { needAdmin(); return { ok: true, demo: true }; })
    },

    /* Только для демо: сброс данных */
    reset() { db = seed(); save(); setCurrent(null); }
  };
  return api;
}
