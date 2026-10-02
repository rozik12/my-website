-- =====================================================================
-- Рубикон v2: администрирование, мультиязычный каталог, потоки, сообщество,
-- подтверждение выполнения, свои челленджи, оплата, сертификаты.
-- =====================================================================

-- ---------- Профили: роль, блокировка, язык, никнейм ----------
alter table public.profiles
  add column role    text not null default 'user' check (role in ('user', 'admin')),
  add column banned  boolean not null default false,
  add column locale  text not null default 'ru' check (locale in ('ru', 'uz', 'en')),
  add column handle  text unique check (handle ~ '^[a-z0-9_]{3,30}$');
grant update (locale, handle) on public.profiles to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' and not banned from public.profiles where id = auth.uid()), false)
$$;

-- Проверка перед любым действием пользователя
create or replace function public.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Требуется вход' using errcode = 'PT401'; end if;
  if (select banned from public.profiles where id = v) then raise exception 'Аккаунт заблокирован' using errcode = 'PT403'; end if;
  return v;
end $$;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Нужны права администратора' using errcode = 'PT403'; end if;
end $$;

-- ---------- Каталог: тексты на трех языках, цена, подтверждение, приватность ----------
alter table public.challenges
  add column icon         text not null default 'target',
  add column content      jsonb not null default '{}'::jsonb,
  add column proof        text not null default 'none' check (proof in ('none', 'optional', 'required')),
  add column price_uzs    int  not null default 0 check (price_uzs >= 0),
  add column published    boolean not null default true,
  add column visibility   text not null default 'public' check (visibility in ('public', 'private')),
  add column owner_id     uuid references auth.users (id) on delete cascade,
  add column invite_code  text unique,
  add column created_at   timestamptz not null default now();
alter table public.challenges drop constraint challenges_slug_check;
alter table public.challenges add constraint challenges_slug_check check (slug ~ '^[a-z0-9-]{2,60}$');
create index challenges_owner on public.challenges (owner_id);

-- Заголовок для служебных выборок
create or replace function public.challenge_title(c public.challenges, p_lang text default 'ru') returns text
language sql immutable as $$
  select coalesce(c.content -> p_lang ->> 'title', c.content -> 'ru' ->> 'title', c.title)
$$;

drop policy "challenges: public read" on public.challenges;
create policy "challenges: read" on public.challenges for select to anon, authenticated using (
  (visibility = 'public' and published)
  or owner_id = (select auth.uid())
  or exists (select 1 from public.enrollments e where e.challenge_slug = slug and e.user_id = (select auth.uid()))
  or (select public.is_admin())
);

-- ---------- Потоки с общей датой старта ----------
create table public.cohorts (
  id              bigint generated always as identity primary key,
  challenge_slug  text not null references public.challenges (slug) on delete cascade,
  start_date      date not null,
  title           text check (char_length(title) <= 80),
  created_at      timestamptz not null default now(),
  unique (challenge_slug, start_date)
);
alter table public.cohorts enable row level security;
create policy "cohorts: read" on public.cohorts for select to anon, authenticated using (true);

alter table public.enrollments
  add column cohort_id  bigint references public.cohorts (id) on delete set null,
  add column public_id  uuid not null default gen_random_uuid() unique;

-- ---------- Чекины: подтверждение и публикация в ленте ----------
alter table public.checkins
  add column shared      boolean not null default false,
  add column post_text   text check (char_length(post_text) <= 500),
  add column proof_url   text check (proof_url ~ '^https://' and char_length(proof_url) <= 500),
  add column photo_path  text check (char_length(photo_path) <= 300),
  add column hidden      boolean not null default false;
create index checkins_feed on public.checkins (enrollment_id) where shared and not hidden;

-- ---------- Сообщество ----------
create table public.reactions (
  checkin_id  bigint not null references public.checkins (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('fire', 'clap', 'heart')),
  created_at  timestamptz not null default now(),
  primary key (checkin_id, user_id, kind)
);
create table public.comments (
  id          bigint generated always as identity primary key,
  checkin_id  bigint not null references public.checkins (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 500),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index comments_checkin on public.comments (checkin_id, id);
create table public.follows (
  follower    uuid not null references auth.users (id) on delete cascade,
  followee    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create table public.messages (
  id          bigint generated always as identity primary key,
  cohort_id   bigint not null references public.cohorts (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 1000),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index messages_cohort on public.messages (cohort_id, id);
create table public.reports (
  id           bigint generated always as identity primary key,
  reporter     uuid not null references auth.users (id) on delete cascade,
  target_type  text not null check (target_type in ('checkin', 'comment', 'message', 'challenge')),
  target_id    text not null,
  reason       text check (char_length(reason) <= 300),
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (reporter, target_type, target_id)
);

alter table public.reactions enable row level security;
alter table public.comments  enable row level security;
alter table public.follows   enable row level security;
alter table public.messages  enable row level security;
alter table public.reports   enable row level security;
create policy "follows: own" on public.follows for select to authenticated using (follower = (select auth.uid()) or followee = (select auth.uid()));
create policy "reports: admin" on public.reports for select to authenticated using ((select public.is_admin()));
-- Ленты, комментарии и чат читаются через функции ниже (с учетом приватности и модерации)

-- ---------- Оплата ----------
create table public.orders (
  id              bigint generated always as identity primary key,
  public_id       uuid not null default gen_random_uuid() unique,
  user_id         uuid not null references auth.users (id) on delete cascade,
  challenge_slug  text not null references public.challenges (slug),
  amount_uzs      int  not null check (amount_uzs > 0),
  provider        text not null check (provider in ('payme', 'click')),
  status          text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  cancelled_at    timestamptz
);
create index orders_user on public.orders (user_id, challenge_slug);
create table public.payme_transactions (
  id            text primary key,             -- идентификатор транзакции Payme
  order_id      bigint not null references public.orders (id),
  amount        bigint not null,              -- в тийинах
  payme_time    bigint not null,
  create_time   bigint not null,
  perform_time  bigint not null default 0,
  cancel_time   bigint not null default 0,
  state         smallint not null default 1 check (state in (1, 2, -1, -2)),
  reason        int
);
create unique index payme_one_active on public.payme_transactions (order_id) where state in (1, 2);
create table public.click_transactions (
  prepare_id      bigint generated always as identity primary key,
  click_trans_id  bigint not null unique,
  order_id        bigint not null references public.orders (id),
  amount          numeric(14, 2) not null,
  status          text not null default 'prepared' check (status in ('prepared', 'completed', 'cancelled')),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
alter table public.orders enable row level security;
alter table public.payme_transactions enable row level security;
alter table public.click_transactions enable row level security;
create policy "orders: own or admin" on public.orders for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

create or replace function public.has_access(p_user uuid, p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select price_uzs = 0 or owner_id = p_user from public.challenges where slug = p_slug), false)
      or exists (select 1 from public.orders o where o.user_id = p_user and o.challenge_slug = p_slug and o.status = 'paid')
$$;

-- ---------- Админ-доступ на чтение ----------
create policy "testimonials: admin" on public.testimonials for select to authenticated using ((select public.is_admin()));
create policy "error_logs: admin"  on public.error_logs  for select to authenticated using ((select public.is_admin()));
create policy "profiles: admin"    on public.profiles    for select to authenticated using ((select public.is_admin()));
create policy "enrollments: admin" on public.enrollments for select to authenticated using ((select public.is_admin()));

-- ---------- Хранилище фото-подтверждений (только в Supabase, где есть схема storage) ----------
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('proofs', 'proofs', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "proofs: upload own" on storage.objects for insert to authenticated
      with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$create policy "proofs: delete own" on storage.objects for delete to authenticated
      using (bucket_id = 'proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;

-- =====================================================================
-- Участие, потоки, чекины (заменяют версии из первой миграции)
-- =====================================================================
drop function public.join_challenge(text);
create or replace function public.join_challenge(p_slug text, p_cohort bigint default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); c public.challenges; v_start date; v_id bigint;
begin
  select * into c from public.challenges where slug = p_slug;
  if not found or (c.visibility = 'private' and c.owner_id is distinct from v_uid and not exists (
      select 1 from public.enrollments where challenge_slug = p_slug and user_id = v_uid)) then
    raise exception 'Челлендж не найден' using errcode = 'PT404';
  end if;
  if not c.published and c.owner_id is distinct from v_uid then raise exception 'Челлендж недоступен' using errcode = 'PT404'; end if;
  if not public.has_access(v_uid, p_slug) then raise exception 'Требуется оплата' using errcode = 'PT402'; end if;
  if (select count(*) from public.enrollments where user_id = v_uid and status = 'active') >= 10 then
    raise exception 'Можно участвовать не более чем в 10 челленджах одновременно' using errcode = 'P0001';
  end if;
  v_start := public.user_today(v_uid);
  if p_cohort is not null then
    select start_date into v_start from public.cohorts where id = p_cohort and challenge_slug = p_slug;
    if not found then raise exception 'Поток не найден' using errcode = 'PT404'; end if;
    if v_start < public.user_today(v_uid) - 3 then raise exception 'Запись в этот поток закрыта' using errcode = 'P0001'; end if;
  end if;
  insert into public.enrollments (user_id, challenge_slug, start_date, cohort_id)
  values (v_uid, p_slug, v_start, p_cohort)
  on conflict (user_id, challenge_slug) where status = 'active' do nothing
  returning id into v_id;
  return json_build_object('id', v_id, 'slug', p_slug, 'start_date', v_start);
end $$;

drop function public.check_in(text, int, text);
create or replace function public.check_in(
  p_slug text, p_mood int default null, p_note text default null,
  p_share boolean default false, p_post text default null, p_proof_url text default null, p_photo_path text default null
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); e public.enrollments; c public.challenges; v_day int; v_done int; v_completed boolean := false;
begin
  select * into e from public.enrollments where user_id = v_uid and challenge_slug = p_slug and status = 'active' for update;
  if not found then raise exception 'Вы не участвуете в этом челлендже' using errcode = 'P0002'; end if;
  select * into c from public.challenges where slug = p_slug;
  if public.user_today(v_uid) < e.start_date then raise exception 'Поток еще не начался' using errcode = 'P0001'; end if;
  if p_mood is not null and (p_mood < 1 or p_mood > 5) then raise exception 'Оценка должна быть от 1 до 5' using errcode = '22023'; end if;
  p_proof_url := nullif(trim(coalesce(p_proof_url, '')), '');
  p_photo_path := nullif(trim(coalesce(p_photo_path, '')), '');
  if p_proof_url is not null and p_proof_url !~ '^https://' then raise exception 'Ссылка должна начинаться с https://' using errcode = '22023'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> v_uid::text then raise exception 'Недопустимый путь к фото' using errcode = '22023'; end if;
  if c.proof = 'required' and p_proof_url is null and p_photo_path is null then
    raise exception 'Для этого челленджа нужно подтверждение: фото или ссылка' using errcode = 'P0001';
  end if;

  v_day := public.enrollment_day(e.id);
  insert into public.checkins (enrollment_id, user_id, day_number, checkin_date, mood, note, shared, post_text, proof_url, photo_path)
  values (e.id, v_uid, v_day, public.user_today(v_uid), p_mood, nullif(left(trim(coalesce(p_note, '')), 280), ''),
          coalesce(p_share, false), nullif(left(trim(coalesce(p_post, '')), 500), ''), p_proof_url, p_photo_path)
  on conflict (enrollment_id, day_number) do update set
    mood = excluded.mood, note = excluded.note, shared = excluded.shared, post_text = excluded.post_text,
    proof_url = coalesce(excluded.proof_url, public.checkins.proof_url), photo_path = coalesce(excluded.photo_path, public.checkins.photo_path);

  select count(*) into v_done from public.checkins where enrollment_id = e.id;
  if v_done >= c.days then
    update public.enrollments set status = 'completed', completed_at = now() where id = e.id;
    v_completed := true;
  end if;
  return json_build_object('day', v_day, 'done', v_done, 'streak', public.enrollment_streak(e.id), 'completed', v_completed, 'certificate', case when v_completed then e.public_id end);
end $$;

create or replace function public.cohorts_for(p_slug text)
returns table (id bigint, start_date date, title text, participants int)
language sql stable security definer set search_path = '' as $$
  select h.id, h.start_date, h.title, (select count(*) from public.enrollments e where e.cohort_id = h.id)::int
  from public.cohorts h join public.challenges c on c.slug = h.challenge_slug
  where h.challenge_slug = p_slug and h.start_date >= current_date - 3 and (c.visibility = 'public' or public.is_admin())
  order by h.start_date
  limit 6
$$;

create or replace function public.cohort_results(p_cohort bigint) returns json
language sql stable security definer set search_path = '' as $$
  with e as (
    select e.*, p.display_name, p.public_profile, c.days,
           (select count(*) from public.checkins k where k.enrollment_id = e.id) as done
    from public.enrollments e join public.profiles p on p.id = e.user_id join public.challenges c on c.slug = e.challenge_slug
    where e.cohort_id = p_cohort
  )
  select json_build_object(
    'participants', (select count(*) from e),
    'finished', (select count(*) from e where status = 'completed'),
    'avg_progress', (select coalesce(round(avg(least(100, done * 100.0 / days))), 0) from e),
    'top', (select coalesce(json_agg(t), '[]') from (select case when public_profile then display_name else 'Участник' end as name, done
             from e order by done desc, created_at limit 3) t)
  )
$$;

-- =====================================================================
-- Лента, реакции, комментарии, жалобы, подписки
-- =====================================================================
create or replace function public.can_view_challenge(p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.challenges c where c.slug = p_slug and (
    (c.visibility = 'public' and c.published) or c.owner_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.enrollments e where e.challenge_slug = c.slug and e.user_id = auth.uid())))
$$;

create or replace function public.feed_rows(p_ids bigint[])
returns table (id bigint, user_id uuid, author text, handle text, challenge_slug text, day_number int, post_text text,
               proof_url text, photo_path text, created_at timestamptz, fire int, clap int, heart int, mine text[], comments int)
language sql stable security definer set search_path = '' as $$
  select k.id, k.user_id,
         case when p.public_profile then p.display_name else 'Участник' end,
         case when p.public_profile then p.handle end,
         e.challenge_slug, k.day_number, k.post_text, k.proof_url, k.photo_path, k.created_at,
         (select count(*) from public.reactions r where r.checkin_id = k.id and r.kind = 'fire')::int,
         (select count(*) from public.reactions r where r.checkin_id = k.id and r.kind = 'clap')::int,
         (select count(*) from public.reactions r where r.checkin_id = k.id and r.kind = 'heart')::int,
         coalesce((select array_agg(r.kind) from public.reactions r where r.checkin_id = k.id and r.user_id = auth.uid()), '{}'),
         (select count(*) from public.comments m where m.checkin_id = k.id and not m.hidden)::int
  from public.checkins k
  join public.enrollments e on e.id = k.enrollment_id
  join public.profiles p on p.id = k.user_id
  where k.id = any (p_ids)
  order by k.id desc
$$;
revoke execute on function public.feed_rows(bigint[]) from public, anon, authenticated;

create or replace function public.feed(p_slug text, p_cohort bigint default null, p_before bigint default null, p_limit int default 20)
returns table (id bigint, user_id uuid, author text, handle text, challenge_slug text, day_number int, post_text text,
               proof_url text, photo_path text, created_at timestamptz, fire int, clap int, heart int, mine text[], comments int)
language sql stable security definer set search_path = '' as $$
  select * from public.feed_rows(array(
    select k.id from public.checkins k
    join public.enrollments e on e.id = k.enrollment_id
    join public.profiles p on p.id = k.user_id
    where public.can_view_challenge(p_slug) and e.challenge_slug = p_slug and k.shared and not k.hidden and not p.banned
      and (p_cohort is null or e.cohort_id = p_cohort)
      and (p_before is null or k.id < p_before)
    order by k.id desc limit least(greatest(p_limit, 1), 50)))
$$;

create or replace function public.friends_feed(p_before bigint default null, p_limit int default 20)
returns table (id bigint, user_id uuid, author text, handle text, challenge_slug text, day_number int, post_text text,
               proof_url text, photo_path text, created_at timestamptz, fire int, clap int, heart int, mine text[], comments int)
language sql stable security definer set search_path = '' as $$
  select * from public.feed_rows(array(
    select k.id from public.checkins k
    join public.enrollments e on e.id = k.enrollment_id
    join public.challenges c on c.slug = e.challenge_slug
    join public.follows f on f.followee = k.user_id and f.follower = auth.uid()
    join public.profiles p on p.id = k.user_id
    where k.shared and not k.hidden and not p.banned and c.visibility = 'public'
      and (p_before is null or k.id < p_before)
    order by k.id desc limit least(greatest(p_limit, 1), 50)))
$$;

create or replace function public.toggle_reaction(p_checkin bigint, p_kind text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_slug text;
begin
  select e.challenge_slug into v_slug from public.checkins k join public.enrollments e on e.id = k.enrollment_id where k.id = p_checkin and k.shared and not k.hidden;
  if v_slug is null or not public.can_view_challenge(v_slug) then raise exception 'Запись не найдена' using errcode = 'PT404'; end if;
  if exists (select 1 from public.reactions where checkin_id = p_checkin and user_id = v_uid and kind = p_kind) then
    delete from public.reactions where checkin_id = p_checkin and user_id = v_uid and kind = p_kind;
  else
    insert into public.reactions (checkin_id, user_id, kind) values (p_checkin, v_uid, p_kind);
  end if;
  return (select json_build_object('fire', fire, 'clap', clap, 'heart', heart, 'mine', mine) from public.feed_rows(array[p_checkin]));
end $$;

create or replace function public.comments_for(p_checkin bigint)
returns table (id bigint, author text, text text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, case when p.public_profile then p.display_name else 'Участник' end, m.text, m.created_at, m.user_id = auth.uid()
  from public.comments m
  join public.profiles p on p.id = m.user_id
  join public.checkins k on k.id = m.checkin_id
  join public.enrollments e on e.id = k.enrollment_id
  where m.checkin_id = p_checkin and not m.hidden and not p.banned and public.can_view_challenge(e.challenge_slug)
  order by m.id
  limit 200
$$;

create or replace function public.add_comment(p_checkin bigint, p_text text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_slug text; v_id bigint;
begin
  if (select count(*) from public.comments where user_id = v_uid and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Слишком часто. Подождите минуту.' using errcode = 'PT429';
  end if;
  select e.challenge_slug into v_slug from public.checkins k join public.enrollments e on e.id = k.enrollment_id where k.id = p_checkin and k.shared and not k.hidden;
  if v_slug is null or not public.can_view_challenge(v_slug) then raise exception 'Запись не найдена' using errcode = 'PT404'; end if;
  insert into public.comments (checkin_id, user_id, text) values (p_checkin, v_uid, trim(p_text)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_comment(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  delete from public.comments where id = p_id and (user_id = auth.uid() or public.is_admin())
$$;

create or replace function public.report_content(p_type text, p_id text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  insert into public.reports (reporter, target_type, target_id, reason) values (v_uid, p_type, p_id, left(p_reason, 300))
  on conflict (reporter, target_type, target_id) do nothing;
end $$;

create or replace function public.follow(p_user uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if p_on then insert into public.follows (follower, followee) values (v_uid, p_user) on conflict do nothing;
  else delete from public.follows where follower = v_uid and followee = p_user; end if;
end $$;

create or replace function public.search_people(p_q text)
returns table (id uuid, name text, handle text, following boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.handle, exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p.id)
  from public.profiles p
  where p.public_profile and not p.banned and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
    and char_length(trim(p_q)) >= 2
    and (p.display_name ilike '%' || trim(p_q) || '%' or p.handle ilike trim(p_q) || '%')
  order by p.display_name limit 20
$$;

create or replace function public.my_follows()
returns table (id uuid, name text, handle text, following boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.handle, true from public.follows f join public.profiles p on p.id = f.followee
  where f.follower = auth.uid() and not p.banned order by f.created_at desc
$$;

create or replace function public.person(p_user uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', p.id, 'name', p.display_name, 'handle', p.handle,
    'following', exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p.id),
    'followers', (select count(*) from public.follows f where f.followee = p.id),
    'active', (select count(*) from public.enrollments e join public.challenges c on c.slug = e.challenge_slug where e.user_id = p.id and e.status = 'active' and c.visibility = 'public'),
    'finished', (select count(*) from public.enrollments e where e.user_id = p.id and e.status = 'completed'),
    'checkins', (select count(*) from public.checkins k where k.user_id = p.id),
    'challenges', (select coalesce(json_agg(json_build_object('slug', e.challenge_slug, 'status', e.status, 'done', (select count(*) from public.checkins k where k.enrollment_id = e.id))), '[]')
                   from public.enrollments e join public.challenges c on c.slug = e.challenge_slug where e.user_id = p.id and c.visibility = 'public')
  )
  from public.profiles p where p.id = p_user and (p.public_profile or p.id = auth.uid()) and not p.banned
$$;

-- ---------- Чат потока ----------
create or replace function public.in_cohort(p_cohort bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (select 1 from public.enrollments e where e.cohort_id = p_cohort and e.user_id = auth.uid())
$$;

create or replace function public.cohort_messages(p_cohort bigint, p_after bigint default 0, p_limit int default 50)
returns table (id bigint, author text, text text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select * from (
    select m.id, case when p.public_profile then p.display_name else 'Участник' end, m.text, m.created_at, m.user_id = auth.uid()
    from public.messages m join public.profiles p on p.id = m.user_id
    where public.in_cohort(p_cohort) and m.cohort_id = p_cohort and m.id > coalesce(p_after, 0) and not m.hidden and not p.banned
    order by m.id desc limit least(greatest(p_limit, 1), 100)
  ) t order by id
$$;

create or replace function public.send_message(p_cohort bigint, p_text text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_id bigint;
begin
  if not public.in_cohort(p_cohort) then raise exception 'Чат доступен участникам потока' using errcode = 'PT403'; end if;
  if (select count(*) from public.messages where user_id = v_uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Слишком часто. Подождите минуту.' using errcode = 'PT429';
  end if;
  insert into public.messages (cohort_id, user_id, text) values (p_cohort, v_uid, trim(p_text)) returning id into v_id;
  return v_id;
end $$;

-- =====================================================================
-- Свои и командные челленджи
-- =====================================================================
create or replace function public.save_my_challenge(p_slug text, p_data jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_slug text := p_slug; v_lang text; v_days int; v_tasks jsonb;
begin
  v_lang := coalesce((select locale from public.profiles where id = v_uid), 'ru');
  v_days := (p_data ->> 'days')::int;
  v_tasks := coalesce(p_data -> 'tasks', '[]');
  if char_length(coalesce(p_data ->> 'title', '')) not between 3 and 80 then raise exception 'Название: от 3 до 80 символов' using errcode = '22023'; end if;
  if v_days is null or v_days not between 1 and 100 then raise exception 'Длительность: от 1 до 100 дней' using errcode = '22023'; end if;
  if jsonb_array_length(v_tasks) not between 1 and 100 then raise exception 'Добавьте от 1 до 100 заданий' using errcode = '22023'; end if;
  if v_slug is null then
    if (select count(*) from public.challenges where owner_id = v_uid) >= 20 then raise exception 'Можно создать не более 20 челленджей' using errcode = 'P0001'; end if;
    v_slug := 'u-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into public.challenges (slug, title, category, level, days, owner_id, visibility, invite_code, price_uzs, published)
    values (v_slug, p_data ->> 'title', coalesce(p_data ->> 'category', 'growth'), coalesce(p_data ->> 'level', 'medium'), v_days,
            v_uid, coalesce(p_data ->> 'visibility', 'private'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 0, true);
  elsif not exists (select 1 from public.challenges where slug = v_slug and owner_id = v_uid) then
    raise exception 'Челлендж не найден' using errcode = 'PT404';
  end if;
  update public.challenges set
    title = p_data ->> 'title', days = v_days,
    category = coalesce(p_data ->> 'category', category), level = coalesce(p_data ->> 'level', level),
    proof = coalesce(p_data ->> 'proof', proof), icon = coalesce(p_data ->> 'icon', 'target'),
    updated_at = now(),
    content = jsonb_build_object(v_lang, jsonb_build_object(
      'title', p_data ->> 'title', 'short', coalesce(p_data ->> 'short', ''), 'goal', coalesce(p_data ->> 'goal', ''),
      'rules', coalesce(p_data -> 'rules', '[]'), 'phases', jsonb_build_array(jsonb_build_object('title', 'План', 'tasks', v_tasks))))
  where slug = v_slug;
  return v_slug;
end $$;

create or replace function public.delete_my_challenge(p_slug text) returns void
language sql security definer set search_path = '' as $$
  delete from public.challenges where slug = p_slug and owner_id = auth.uid()
$$;

create or replace function public.join_by_code(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_slug text;
begin
  select slug into v_slug from public.challenges where invite_code = upper(trim(p_code));
  if v_slug is null then raise exception 'Код приглашения не найден' using errcode = 'PT404'; end if;
  insert into public.enrollments (user_id, challenge_slug, start_date) values (v_uid, v_slug, public.user_today(v_uid))
  on conflict (user_id, challenge_slug) where status = 'active' do nothing;
  return v_slug;
end $$;

create or replace function public.my_challenges()
returns table (slug text, title text, days int, visibility text, invite_code text, participants int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.slug, c.title, c.days, c.visibility, c.invite_code, (select count(*) from public.enrollments e where e.challenge_slug = c.slug)::int, c.created_at
  from public.challenges c where c.owner_id = auth.uid() order by c.created_at desc
$$;

create or replace function public.organizer_report(p_slug text)
returns table (name text, start_date date, status text, done int, pct int, streak int, last_checkin date)
language sql stable security definer set search_path = '' as $$
  select p.display_name, e.start_date, e.status,
         (select count(*) from public.checkins k where k.enrollment_id = e.id)::int,
         least(100, round((select count(*) from public.checkins k where k.enrollment_id = e.id) * 100.0 / c.days))::int,
         case when e.status = 'active' then public.enrollment_streak(e.id) else 0 end,
         (select max(k.checkin_date) from public.checkins k where k.enrollment_id = e.id)
  from public.enrollments e join public.challenges c on c.slug = e.challenge_slug join public.profiles p on p.id = e.user_id
  where e.challenge_slug = p_slug and (c.owner_id = auth.uid() or public.is_admin())
  order by 4 desc
$$;

-- Каталог своих/закрытых челленджей для клиента (официальные пререндерены)
create or replace function public.challenge_info(p_slug text) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('slug', c.slug, 'category', c.category, 'level', c.level, 'days', c.days, 'icon', c.icon,
    'nextStart', c.next_start, 'proof', c.proof, 'priceUzs', c.price_uzs, 'content', c.content, 'visibility', c.visibility,
    'isOwner', c.owner_id = auth.uid(), 'inviteCode', case when c.owner_id = auth.uid() then c.invite_code end, 'custom', c.owner_id is not null)
  from public.challenges c where c.slug = p_slug and public.can_view_challenge(p_slug)
$$;

-- =====================================================================
-- Сертификаты (публичная проверка по ссылке)
-- =====================================================================
create or replace function public.certificate(p_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('id', e.public_id, 'name', p.display_name, 'slug', e.challenge_slug, 'title', c.content, 'titleFallback', c.title,
    'days', c.days, 'level', c.level, 'completedAt', e.completed_at, 'startDate', e.start_date,
    'checkins', (select count(*) from public.checkins k where k.enrollment_id = e.id))
  from public.enrollments e join public.profiles p on p.id = e.user_id join public.challenges c on c.slug = e.challenge_slug
  where e.public_id = p_id and e.status = 'completed'
$$;

-- =====================================================================
-- Публичная статистика: только публичные челленджи, без заблокированных
-- =====================================================================
create or replace function public.challenge_stats()
returns table (slug text, participants int, avg_progress int, finish_rate int, active_today int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select e.id, e.challenge_slug, e.status, e.start_date, c.days,
           (select count(*) from public.checkins k where k.enrollment_id = e.id) as done
    from public.enrollments e join public.challenges c on c.slug = e.challenge_slug
  )
  select c.slug, count(e.id)::int,
         coalesce(round(avg(least(100, e.done * 100.0 / e.days))), 0)::int,
         round(100.0 * count(e.id) filter (where e.status = 'completed')
               / nullif(count(e.id) filter (where e.status = 'completed' or e.start_date + e.days <= current_date), 0))::int,
         (select count(distinct k.user_id) from public.checkins k join public.enrollments x on x.id = k.enrollment_id
           where x.challenge_slug = c.slug and k.created_at > now() - interval '24 hours')::int
  from public.challenges c left join e on e.challenge_slug = c.slug
  where c.visibility = 'public' and c.published
  group by c.slug
$$;

create or replace function public.recent_activity(p_limit int default 12)
returns table (display_name text, challenge_slug text, day_number int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.display_name, e.challenge_slug, k.day_number, k.created_at
  from public.checkins k
  join public.enrollments e on e.id = k.enrollment_id
  join public.challenges c on c.slug = e.challenge_slug
  join public.profiles p on p.id = k.user_id
  where p.public_profile and not p.banned and c.visibility = 'public' and k.created_at > now() - interval '7 days'
  order by k.created_at desc
  limit least(greatest(p_limit, 1), 30)
$$;

create or replace function public.leaderboard(p_slug text, p_order text default 'progress', p_limit int default 10, p_cohort bigint default null)
returns table (rank int, user_id uuid, display_name text, done int, streak int, pct int, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with r0 as (
    select e.user_id, p.display_name, p.public_profile,
           (select count(*) from public.checkins k where k.enrollment_id = e.id)::int as done,
           public.enrollment_streak(e.id) as streak, c.days
    from public.enrollments e
    join public.challenges c on c.slug = e.challenge_slug
    join public.profiles p on p.id = e.user_id
    where e.challenge_slug = p_slug and e.status = 'active' and not p.banned and public.can_view_challenge(p_slug)
      and (p_cohort is null or e.cohort_id = p_cohort)
  ),
  ranked as (
    select row_number() over (order by
             case when p_order = 'streak' then streak else done end desc,
             case when p_order = 'streak' then done else streak end desc)::int as rank, *
    from r0 where public_profile or user_id = (select auth.uid())
  )
  select rank, user_id, display_name, done, streak, least(100, round(done * 100.0 / days))::int, user_id = (select auth.uid())
  from ranked
  where rank <= least(greatest(p_limit, 1), 50) or user_id = (select auth.uid())
  order by rank
$$;
drop function if exists public.leaderboard(text, text, int);

-- =====================================================================
-- Оплата: логика протоколов Payme и Click (вызываются Edge Functions с ключом service_role)
-- =====================================================================
create or replace function public.create_order(p_slug text, p_provider text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); c public.challenges; o public.orders;
begin
  select * into c from public.challenges where slug = p_slug and visibility = 'public' and published;
  if not found or c.price_uzs = 0 then raise exception 'Этот челлендж бесплатный' using errcode = 'P0001'; end if;
  if public.has_access(v_uid, p_slug) then raise exception 'Уже оплачено' using errcode = 'P0001'; end if;
  insert into public.orders (user_id, challenge_slug, amount_uzs, provider) values (v_uid, p_slug, c.price_uzs, p_provider) returning * into o;
  return json_build_object('order_id', o.id, 'public_id', o.public_id, 'amount_uzs', o.amount_uzs, 'provider', o.provider);
end $$;

create or replace function public.mark_order_paid(p_order bigint) returns void
language sql security definer set search_path = '' as $$
  update public.orders set status = 'paid', paid_at = now() where id = p_order and status = 'pending'
$$;

-- Payme Merchant API. Время — миллисекунды Unix. Возвращает {result} или {error}.
create or replace function public.payme_rpc(p_method text, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  o public.orders; t public.payme_transactions; v_order bigint; v_amount bigint;
begin
  if p_method in ('CheckPerformTransaction', 'CreateTransaction') then
    v_amount := (p_params ->> 'amount')::bigint;
    begin v_order := (p_params -> 'account' ->> 'order_id')::bigint; exception when others then v_order := null; end;
    select * into o from public.orders where id = v_order and provider = 'payme';
    if not found then return jsonb_build_object('error', jsonb_build_object('code', -31050, 'data', 'order_id',
      'message', jsonb_build_object('ru', 'Заказ не найден', 'uz', 'Buyurtma topilmadi', 'en', 'Order not found'))); end if;
    if o.amount_uzs::bigint * 100 <> v_amount then return jsonb_build_object('error', jsonb_build_object('code', -31001,
      'message', jsonb_build_object('ru', 'Неверная сумма', 'uz', 'Noto''g''ri summa', 'en', 'Incorrect amount'))); end if;
  end if;

  if p_method = 'CheckPerformTransaction' then
    if o.status <> 'pending' then return jsonb_build_object('error', jsonb_build_object('code', -31051, 'data', 'order_id',
      'message', jsonb_build_object('ru', 'Заказ уже оплачен или отменен', 'uz', 'Buyurtma allaqachon to''langan yoki bekor qilingan', 'en', 'Order is already paid or cancelled'))); end if;
    return jsonb_build_object('result', jsonb_build_object('allow', true));

  elsif p_method = 'CreateTransaction' then
    select * into t from public.payme_transactions where id = p_params ->> 'id';
    if found then
      if t.state <> 1 then return jsonb_build_object('error', jsonb_build_object('code', -31008, 'message', jsonb_build_object('ru', 'Невозможно выполнить операцию', 'uz', 'Amalni bajarib bo''lmaydi', 'en', 'Unable to perform operation'))); end if;
      if now_ms - t.create_time > 43200000 then
        update public.payme_transactions set state = -1, reason = 4, cancel_time = now_ms where id = t.id;
        return jsonb_build_object('error', jsonb_build_object('code', -31008, 'message', jsonb_build_object('ru', 'Транзакция истекла', 'uz', 'Tranzaksiya muddati o''tdi', 'en', 'Transaction expired')));
      end if;
      return jsonb_build_object('result', jsonb_build_object('create_time', t.create_time, 'transaction', t.order_id::text, 'state', t.state));
    end if;
    if o.status <> 'pending' or exists (select 1 from public.payme_transactions where order_id = o.id and state in (1, 2)) then
      return jsonb_build_object('error', jsonb_build_object('code', -31099, 'data', 'order_id',
        'message', jsonb_build_object('ru', 'Заказ ожидает другую оплату', 'uz', 'Buyurtma boshqa to''lovni kutmoqda', 'en', 'Order is awaiting another payment')));
    end if;
    insert into public.payme_transactions (id, order_id, amount, payme_time, create_time)
    values (p_params ->> 'id', o.id, v_amount, (p_params ->> 'time')::bigint, now_ms) returning * into t;
    return jsonb_build_object('result', jsonb_build_object('create_time', t.create_time, 'transaction', t.order_id::text, 'state', 1));

  elsif p_method = 'PerformTransaction' then
    select * into t from public.payme_transactions where id = p_params ->> 'id' for update;
    if not found then return jsonb_build_object('error', jsonb_build_object('code', -31003, 'message', jsonb_build_object('ru', 'Транзакция не найдена', 'uz', 'Tranzaksiya topilmadi', 'en', 'Transaction not found'))); end if;
    if t.state = 1 then
      if now_ms - t.create_time > 43200000 then
        update public.payme_transactions set state = -1, reason = 4, cancel_time = now_ms where id = t.id;
        return jsonb_build_object('error', jsonb_build_object('code', -31008, 'message', jsonb_build_object('ru', 'Транзакция истекла', 'uz', 'Tranzaksiya muddati o''tdi', 'en', 'Transaction expired')));
      end if;
      update public.payme_transactions set state = 2, perform_time = now_ms where id = t.id returning * into t;
      perform public.mark_order_paid(t.order_id);
    elsif t.state <> 2 then
      return jsonb_build_object('error', jsonb_build_object('code', -31008, 'message', jsonb_build_object('ru', 'Невозможно выполнить операцию', 'uz', 'Amalni bajarib bo''lmaydi', 'en', 'Unable to perform operation')));
    end if;
    return jsonb_build_object('result', jsonb_build_object('transaction', t.order_id::text, 'perform_time', t.perform_time, 'state', t.state));

  elsif p_method = 'CancelTransaction' then
    select * into t from public.payme_transactions where id = p_params ->> 'id' for update;
    if not found then return jsonb_build_object('error', jsonb_build_object('code', -31003, 'message', jsonb_build_object('ru', 'Транзакция не найдена', 'uz', 'Tranzaksiya topilmadi', 'en', 'Transaction not found'))); end if;
    if t.state = 1 then
      update public.payme_transactions set state = -1, reason = (p_params ->> 'reason')::int, cancel_time = now_ms where id = t.id returning * into t;
      update public.orders set status = 'cancelled', cancelled_at = now() where id = t.order_id and status = 'pending';
    elsif t.state = 2 then
      -- Возврат: доступ к челленджу отзывается
      update public.payme_transactions set state = -2, reason = (p_params ->> 'reason')::int, cancel_time = now_ms where id = t.id returning * into t;
      update public.orders set status = 'refunded', cancelled_at = now() where id = t.order_id;
    end if;
    return jsonb_build_object('result', jsonb_build_object('transaction', t.order_id::text, 'cancel_time', t.cancel_time, 'state', t.state));

  elsif p_method = 'CheckTransaction' then
    select * into t from public.payme_transactions where id = p_params ->> 'id';
    if not found then return jsonb_build_object('error', jsonb_build_object('code', -31003, 'message', jsonb_build_object('ru', 'Транзакция не найдена', 'uz', 'Tranzaksiya topilmadi', 'en', 'Transaction not found'))); end if;
    return jsonb_build_object('result', jsonb_build_object('create_time', t.create_time, 'perform_time', t.perform_time, 'cancel_time', t.cancel_time,
      'transaction', t.order_id::text, 'state', t.state, 'reason', t.reason));

  elsif p_method = 'GetStatement' then
    return jsonb_build_object('result', jsonb_build_object('transactions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'time', x.payme_time, 'amount', x.amount, 'account', jsonb_build_object('order_id', x.order_id::text),
        'create_time', x.create_time, 'perform_time', x.perform_time, 'cancel_time', x.cancel_time, 'transaction', x.order_id::text,
        'state', x.state, 'reason', x.reason) order by x.payme_time)
      from public.payme_transactions x where x.payme_time between (p_params ->> 'from')::bigint and (p_params ->> 'to')::bigint), '[]'::jsonb)));
  end if;
  return jsonb_build_object('error', jsonb_build_object('code', -32601, 'message', jsonb_build_object('ru', 'Метод не найден', 'uz', 'Metod topilmadi', 'en', 'Method not found')));
end $$;

-- Click SHOP API. Подпись проверяет Edge Function; здесь — бизнес-правила.
create or replace function public.click_prepare(p_click_trans_id bigint, p_order text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_order bigint; v_prepare bigint;
begin
  begin v_order := p_order::bigint; exception when others then v_order := null; end;
  select * into o from public.orders where id = v_order and provider = 'click';
  if not found then return jsonb_build_object('error', -5, 'error_note', 'Order not found'); end if;
  if o.status = 'paid' then return jsonb_build_object('error', -4, 'error_note', 'Already paid'); end if;
  if o.status <> 'pending' then return jsonb_build_object('error', -9, 'error_note', 'Transaction cancelled'); end if;
  if abs(o.amount_uzs - p_amount) > 0.01 then return jsonb_build_object('error', -2, 'error_note', 'Incorrect parameter amount'); end if;
  insert into public.click_transactions (click_trans_id, order_id, amount) values (p_click_trans_id, o.id, p_amount)
  on conflict (click_trans_id) do update set amount = excluded.amount returning prepare_id into v_prepare;
  return jsonb_build_object('error', 0, 'error_note', 'Success', 'merchant_prepare_id', v_prepare);
end $$;

create or replace function public.click_complete(p_click_trans_id bigint, p_order text, p_prepare_id bigint, p_amount numeric, p_click_error int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.click_transactions; o public.orders;
begin
  select * into t from public.click_transactions where prepare_id = p_prepare_id and click_trans_id = p_click_trans_id for update;
  if not found or t.order_id::text <> p_order then return jsonb_build_object('error', -6, 'error_note', 'Transaction does not exist'); end if;
  select * into o from public.orders where id = t.order_id;
  if t.status = 'completed' or o.status = 'paid' then return jsonb_build_object('error', -4, 'error_note', 'Already paid', 'merchant_confirm_id', t.prepare_id); end if;
  if t.status = 'cancelled' or o.status <> 'pending' then return jsonb_build_object('error', -9, 'error_note', 'Transaction cancelled'); end if;
  if abs(t.amount - p_amount) > 0.01 then return jsonb_build_object('error', -2, 'error_note', 'Incorrect parameter amount'); end if;
  if p_click_error < 0 then
    update public.click_transactions set status = 'cancelled' where prepare_id = t.prepare_id;
    update public.orders set status = 'cancelled', cancelled_at = now() where id = o.id;
    return jsonb_build_object('error', -9, 'error_note', 'Transaction cancelled');
  end if;
  update public.click_transactions set status = 'completed', completed_at = now() where prepare_id = t.prepare_id;
  perform public.mark_order_paid(o.id);
  return jsonb_build_object('error', 0, 'error_note', 'Success', 'merchant_confirm_id', t.prepare_id);
end $$;

revoke execute on function public.payme_rpc(text, jsonb), public.click_prepare(bigint, text, numeric),
  public.click_complete(bigint, text, bigint, numeric, int), public.mark_order_paid(bigint) from public, anon, authenticated;

-- =====================================================================
-- Администрирование
-- =====================================================================
create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return json_build_object(
    'users', (select count(*) from auth.users),
    'users_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_24h', (select count(distinct user_id) from public.checkins where created_at > now() - interval '24 hours'),
    'checkins_24h', (select count(*) from public.checkins where created_at > now() - interval '24 hours'),
    'enrollments_active', (select count(*) from public.enrollments where status = 'active'),
    'completed', (select count(*) from public.enrollments where status = 'completed'),
    'revenue_uzs', (select coalesce(sum(amount_uzs), 0) from public.orders where status = 'paid'),
    'revenue_30d_uzs', (select coalesce(sum(amount_uzs), 0) from public.orders where status = 'paid' and paid_at > now() - interval '30 days'),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'pending_testimonials', (select count(*) from public.testimonials where not approved),
    'errors_24h', (select count(*) from public.error_logs where created_at > now() - interval '24 hours'),
    'signups_by_day', (select coalesce(json_agg(json_build_object('day', d::date, 'n', (select count(*) from auth.users u where u.created_at::date = d::date)) order by d), '[]')
                       from generate_series(current_date - 13, current_date, interval '1 day') d),
    'checkins_by_day', (select coalesce(json_agg(json_build_object('day', d::date, 'n', (select count(*) from public.checkins k where k.checkin_date = d::date)) order by d), '[]')
                        from generate_series(current_date - 13, current_date, interval '1 day') d)
  );
end $$;

create or replace function public.admin_users(p_q text default '', p_limit int default 50, p_offset int default 0)
returns table (id uuid, email text, name text, role text, banned boolean, created_at timestamptz, enrollments int, last_checkin timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query
    select u.id, u.email::text, p.display_name, p.role, p.banned, u.created_at,
           (select count(*) from public.enrollments e where e.user_id = u.id)::int,
           (select max(k.created_at) from public.checkins k where k.user_id = u.id)
    from auth.users u join public.profiles p on p.id = u.id
    where coalesce(p_q, '') = '' or u.email ilike '%' || p_q || '%' or p.display_name ilike '%' || p_q || '%'
    order by u.created_at desc limit least(p_limit, 200) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_update_user(p_user uuid, p_role text default null, p_banned boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_user = auth.uid() and (p_role = 'user' or p_banned) then raise exception 'Нельзя снять права или заблокировать самого себя' using errcode = 'P0001'; end if;
  update public.profiles set role = coalesce(p_role, role), banned = coalesce(p_banned, banned) where id = p_user;
end $$;

create or replace function public.admin_save_challenge(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  insert into public.challenges (slug, title, category, level, days, icon, next_start, proof, price_uzs, published, content)
  values (p ->> 'slug', p -> 'content' -> 'ru' ->> 'title', p ->> 'category', p ->> 'level', (p ->> 'days')::int, coalesce(p ->> 'icon', 'target'),
          nullif(p ->> 'nextStart', '')::date, coalesce(p ->> 'proof', 'none'), coalesce((p ->> 'priceUzs')::int, 0), coalesce((p ->> 'published')::boolean, true), p -> 'content')
  on conflict (slug) do update set title = excluded.title, category = excluded.category, level = excluded.level, days = excluded.days,
    icon = excluded.icon, next_start = excluded.next_start, proof = excluded.proof, price_uzs = excluded.price_uzs,
    published = excluded.published, content = excluded.content, updated_at = now()
  where public.challenges.owner_id is null;
end $$;

create or replace function public.admin_delete_challenge(p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if exists (select 1 from public.enrollments where challenge_slug = p_slug) then
    update public.challenges set published = false where slug = p_slug;  -- с участниками — только снять с публикации
  else
    delete from public.challenges where slug = p_slug;
  end if;
end $$;

create or replace function public.admin_challenges()
returns table (slug text, title text, category text, level text, days int, icon text, next_start date, proof text, price_uzs int,
               published boolean, visibility text, custom boolean, content jsonb, participants int, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query select c.slug, c.title, c.category, c.level, c.days, c.icon, c.next_start, c.proof, c.price_uzs, c.published, c.visibility,
    c.owner_id is not null, c.content, (select count(*) from public.enrollments e where e.challenge_slug = c.slug)::int, c.updated_at
  from public.challenges c order by c.owner_id is not null, c.created_at;
end $$;

create or replace function public.admin_save_cohort(p_slug text, p_start date, p_title text default null, p_id bigint default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform public.require_admin();
  if p_id is null then insert into public.cohorts (challenge_slug, start_date, title) values (p_slug, p_start, p_title) returning id into v_id;
  else update public.cohorts set start_date = p_start, title = p_title where id = p_id returning id into v_id; end if;
  update public.challenges set next_start = (select min(start_date) from public.cohorts where challenge_slug = p_slug and start_date >= current_date) where slug = p_slug;
  return v_id;
end $$;

create or replace function public.admin_delete_cohort(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin perform public.require_admin(); delete from public.cohorts where id = p_id; end $$;

create or replace function public.admin_moderation()
returns table (kind text, id text, author text, text text, extra text, created_at timestamptz, reports int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query
    select 'testimonial', t.id::text, t.author_name, t.text, t.challenge_slug, t.created_at, 0 from public.testimonials t where not t.approved
    union all
    select r.target_type, r.target_id, coalesce(pk.display_name, pc.display_name, pm.display_name),
           coalesce(k.post_text, cm.text, m.text, k.proof_url, k.photo_path), string_agg(distinct coalesce(r.reason, ''), '; '), min(r.created_at), count(*)::int
    from public.reports r
    left join public.checkins k on r.target_type = 'checkin' and k.id::text = r.target_id
    left join public.profiles pk on pk.id = k.user_id
    left join public.comments cm on r.target_type = 'comment' and cm.id::text = r.target_id
    left join public.profiles pc on pc.id = cm.user_id
    left join public.messages m on r.target_type = 'message' and m.id::text = r.target_id
    left join public.profiles pm on pm.id = m.user_id
    where r.status = 'open'
    group by r.target_type, r.target_id, pk.display_name, pc.display_name, pm.display_name, k.post_text, cm.text, m.text, k.proof_url, k.photo_path
    order by 6 desc;
end $$;

create or replace function public.admin_moderate(p_kind text, p_id text, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_kind = 'testimonial' then
    if p_action = 'approve' then update public.testimonials set approved = true where id = p_id::bigint;
    else delete from public.testimonials where id = p_id::bigint; end if;
    return;
  end if;
  if p_action = 'hide' then
    if p_kind = 'checkin' then update public.checkins set hidden = true where id = p_id::bigint; end if;
    if p_kind = 'comment' then update public.comments set hidden = true where id = p_id::bigint; end if;
    if p_kind = 'message' then update public.messages set hidden = true where id = p_id::bigint; end if;
  end if;
  update public.reports set status = case when p_action = 'hide' then 'resolved' else 'dismissed' end, resolved_at = now()
  where target_type = p_kind and target_id = p_id and status = 'open';
end $$;

create or replace function public.admin_orders(p_limit int default 100)
returns table (id bigint, email text, challenge_slug text, amount_uzs int, provider text, status text, created_at timestamptz, paid_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query select o.id, u.email::text, o.challenge_slug, o.amount_uzs, o.provider, o.status, o.created_at, o.paid_at
  from public.orders o join auth.users u on u.id = o.user_id order by o.id desc limit least(p_limit, 500);
end $$;

-- =====================================================================
-- Права на вызов
-- =====================================================================
grant execute on function public.cohorts_for(text), public.cohort_results(bigint), public.feed(text, bigint, bigint, int),
  public.comments_for(bigint), public.person(uuid), public.certificate(uuid), public.challenge_info(text), public.search_people(text),
  public.leaderboard(text, text, int, bigint), public.is_admin() to anon, authenticated;
revoke execute on function public.join_challenge(text, bigint), public.check_in(text, int, text, boolean, text, text, text),
  public.toggle_reaction(bigint, text), public.add_comment(bigint, text), public.delete_comment(bigint), public.report_content(text, text, text),
  public.follow(uuid, boolean), public.my_follows(), public.friends_feed(bigint, int), public.cohort_messages(bigint, bigint, int), public.send_message(bigint, text),
  public.save_my_challenge(text, jsonb), public.delete_my_challenge(text), public.join_by_code(text), public.my_challenges(), public.organizer_report(text),
  public.create_order(text, text), public.admin_stats(), public.admin_users(text, int, int), public.admin_update_user(uuid, text, boolean),
  public.admin_save_challenge(jsonb), public.admin_delete_challenge(text), public.admin_challenges(), public.admin_save_cohort(text, date, text, bigint),
  public.admin_delete_cohort(bigint), public.admin_moderation(), public.admin_moderate(text, text, text), public.admin_orders(int) from public, anon;
grant execute on function public.join_challenge(text, bigint), public.check_in(text, int, text, boolean, text, text, text),
  public.toggle_reaction(bigint, text), public.add_comment(bigint, text), public.delete_comment(bigint), public.report_content(text, text, text),
  public.follow(uuid, boolean), public.my_follows(), public.friends_feed(bigint, int), public.cohort_messages(bigint, bigint, int), public.send_message(bigint, text),
  public.save_my_challenge(text, jsonb), public.delete_my_challenge(text), public.join_by_code(text), public.my_challenges(), public.organizer_report(text),
  public.create_order(text, text), public.admin_stats(), public.admin_users(text, int, int), public.admin_update_user(uuid, text, boolean),
  public.admin_save_challenge(jsonb), public.admin_delete_challenge(text), public.admin_challenges(), public.admin_save_cohort(text, date, text, bigint),
  public.admin_delete_cohort(bigint), public.admin_moderation(), public.admin_moderate(text, text, text), public.admin_orders(int) to authenticated;
revoke execute on function public.require_user(), public.require_admin(), public.has_access(uuid, text), public.can_view_challenge(text), public.in_cohort(bigint) from public, anon;
grant execute on function public.require_user(), public.can_view_challenge(text), public.in_cohort(bigint) to authenticated;
