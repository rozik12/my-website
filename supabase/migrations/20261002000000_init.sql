-- =====================================================================
-- Рубикон: схема базы данных (Supabase / PostgreSQL 15+)
-- Все изменения данных идут через RPC-функции с проверками на сервере.
-- Прямой доступ к таблицам ограничен политиками RLS.
-- =====================================================================

-- ---------- Профили ----------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null default 'Участник' check (char_length(display_name) between 1 and 60),
  city            text check (char_length(city) <= 60),
  timezone        text not null default 'UTC',
  public_profile  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- Каталог (синхронизируется из content/challenges.json, см. supabase/seed.sql) ----------
create table public.challenges (
  slug        text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  title       text not null,
  category    text not null check (category in ('sport', 'business', 'habits', 'growth')),
  level       text not null check (level in ('easy', 'medium', 'hard')),
  days        int  not null check (days between 1 and 365),
  next_start  date,
  updated_at  timestamptz not null default now()
);

-- ---------- Участие ----------
create table public.enrollments (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  challenge_slug  text not null references public.challenges (slug) on delete cascade,
  start_date      date not null,
  status          text not null default 'active' check (status in ('active', 'completed')),
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);
-- Один активный поток на челлендж; завершенные можно проходить повторно
create unique index enrollments_one_active on public.enrollments (user_id, challenge_slug) where status = 'active';
create index enrollments_slug on public.enrollments (challenge_slug);

-- ---------- Чекины ----------
create table public.checkins (
  id             bigint generated always as identity primary key,
  enrollment_id  bigint not null references public.enrollments (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  day_number     int  not null check (day_number >= 1),
  checkin_date   date not null,
  mood           smallint check (mood between 1 and 5),
  note           text check (char_length(note) <= 280),
  created_at     timestamptz not null default now(),
  unique (enrollment_id, day_number)
);
create index checkins_user on public.checkins (user_id, checkin_date);
create index checkins_created on public.checkins (created_at desc);

-- ---------- Отзывы (публикуются после модерации: approved = true) ----------
create table public.testimonials (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  challenge_slug  text not null references public.challenges (slug) on delete cascade,
  author_name     text not null,
  text            text not null check (char_length(text) between 20 and 600),
  approved        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (user_id, challenge_slug)
);

-- ---------- Ошибки клиента (мониторинг) ----------
create table public.error_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid default auth.uid(),
  message     text not null check (char_length(message) <= 2000),
  stack       text check (char_length(stack) <= 8000),
  url         text check (char_length(url) <= 1000),
  user_agent  text check (char_length(user_agent) <= 500),
  release     text check (char_length(release) <= 60)
);
create index error_logs_created on public.error_logs (created_at desc);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.profiles     enable row level security;
alter table public.challenges   enable row level security;
alter table public.enrollments  enable row level security;
alter table public.checkins     enable row level security;
alter table public.testimonials enable row level security;
alter table public.error_logs   enable row level security;

create policy "profiles: read own"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "challenges: public read" on public.challenges for select to anon, authenticated using (true);

create policy "enrollments: read own" on public.enrollments for select to authenticated using (user_id = (select auth.uid()));
create policy "checkins: read own"    on public.checkins    for select to authenticated using (user_id = (select auth.uid()));

create policy "testimonials: read approved" on public.testimonials for select to anon, authenticated using (approved or user_id = (select auth.uid()));

create policy "error_logs: insert" on public.error_logs for insert to anon, authenticated with check (user_id is null or user_id = (select auth.uid()));

-- Профиль: пользователю нельзя менять id и даты
revoke update on public.profiles from authenticated;
grant update (display_name, city, timezone, public_profile) on public.profiles to authenticated;

-- =====================================================================
-- Служебные функции
-- =====================================================================

-- Профиль создается автоматически при регистрации
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Участник'));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Сегодняшняя дата в часовом поясе пользователя
create or replace function public.user_today(p_user uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select p.timezone from public.profiles p where p.id = p_user), 'UTC'))::date
$$;

-- Текущий день программы для участия
create or replace function public.enrollment_day(p_enrollment bigint) returns int
language sql stable security definer set search_path = '' as $$
  select least(c.days, greatest(1, public.user_today(e.user_id) - e.start_date + 1))
  from public.enrollments e join public.challenges c on c.slug = e.challenge_slug
  where e.id = p_enrollment
$$;

-- Серия: подряд выполненные дни, заканчивая текущим или предыдущим днем
create or replace function public.enrollment_streak(p_enrollment bigint) returns int
language sql stable security definer set search_path = '' as $$
  with cur as (select public.enrollment_day(p_enrollment) as d),
  anchor as (
    select case when exists (select 1 from public.checkins k where k.enrollment_id = p_enrollment and k.day_number = (select d from cur))
                then (select d from cur) else (select d from cur) - 1 end as a
  ),
  s as (
    select (select a from anchor) - k.day_number as off,
           row_number() over (order by k.day_number desc) - 1 as rn
    from public.checkins k
    where k.enrollment_id = p_enrollment and k.day_number <= (select a from anchor)
  )
  select count(*)::int from s where off = rn
$$;

revoke execute on function public.user_today(uuid), public.enrollment_day(bigint), public.enrollment_streak(bigint) from public, anon, authenticated;

-- =====================================================================
-- Публичная статистика (только агрегаты и публичные профили)
-- =====================================================================
create or replace function public.challenge_stats()
returns table (slug text, participants int, avg_progress int, finish_rate int, active_today int)
language sql stable security definer set search_path = '' as $$
  with e as (
    select e.id, e.challenge_slug, e.status, e.start_date, c.days,
           (select count(*) from public.checkins k where k.enrollment_id = e.id) as done
    from public.enrollments e join public.challenges c on c.slug = e.challenge_slug
  )
  select c.slug,
         count(e.id)::int,
         coalesce(round(avg(least(100, e.done * 100.0 / e.days))), 0)::int,
         round(100.0 * count(e.id) filter (where e.status = 'completed')
               / nullif(count(e.id) filter (where e.status = 'completed' or e.start_date + e.days <= current_date), 0))::int,
         (select count(distinct k.user_id) from public.checkins k join public.enrollments x on x.id = k.enrollment_id
           where x.challenge_slug = c.slug and k.created_at > now() - interval '24 hours')::int
  from public.challenges c left join e on e.challenge_slug = c.slug
  group by c.slug
$$;

create or replace function public.platform_stats() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'participants', (select count(distinct user_id) from public.enrollments),
    'checkins_24h', (select count(*) from public.checkins where created_at > now() - interval '24 hours'),
    'completed',    (select count(*) from public.enrollments where status = 'completed'),
    'finish_rate',  (select round(100.0 * count(*) filter (where e.status = 'completed')
                              / nullif(count(*) filter (where e.status = 'completed' or e.start_date + c.days <= current_date), 0))
                       from public.enrollments e join public.challenges c on c.slug = e.challenge_slug)
  )
$$;

create or replace function public.recent_activity(p_limit int default 12)
returns table (display_name text, challenge_slug text, day_number int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.display_name, e.challenge_slug, k.day_number, k.created_at
  from public.checkins k
  join public.enrollments e on e.id = k.enrollment_id
  join public.profiles p on p.id = k.user_id
  where p.public_profile and k.created_at > now() - interval '7 days'
  order by k.created_at desc
  limit least(greatest(p_limit, 1), 30)
$$;

create or replace function public.leaderboard(p_slug text, p_order text default 'progress', p_limit int default 10)
returns table (rank int, display_name text, done int, streak int, pct int, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with r0 as (
    select e.user_id, p.display_name, p.public_profile,
           (select count(*) from public.checkins k where k.enrollment_id = e.id)::int as done,
           case when e.status = 'active' then public.enrollment_streak(e.id) else 0 end as streak,
           c.days
    from public.enrollments e
    join public.challenges c on c.slug = e.challenge_slug
    join public.profiles p on p.id = e.user_id
    where e.challenge_slug = p_slug and e.status = 'active'
  ),
  ranked as (
    select row_number() over (order by
             case when p_order = 'streak' then streak else done end desc,
             case when p_order = 'streak' then done else streak end desc)::int as rank,
           *
    from r0 where public_profile or user_id = (select auth.uid())
  )
  select rank, display_name, done, streak, least(100, round(done * 100.0 / days))::int, user_id = (select auth.uid())
  from ranked
  where rank <= least(greatest(p_limit, 1), 50) or user_id = (select auth.uid())
  order by rank
$$;

grant execute on function public.challenge_stats(), public.platform_stats(), public.recent_activity(int), public.leaderboard(text, text, int) to anon, authenticated;

-- =====================================================================
-- Действия пользователя
-- =====================================================================
create or replace function public.join_challenge(p_slug text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id bigint;
begin
  if v_uid is null then raise exception 'Требуется вход' using errcode = '28000'; end if;
  if not exists (select 1 from public.challenges where slug = p_slug) then raise exception 'Челлендж не найден' using errcode = 'P0002'; end if;
  if (select count(*) from public.enrollments where user_id = v_uid and status = 'active') >= 10 then
    raise exception 'Можно участвовать не более чем в 10 челленджах одновременно' using errcode = 'P0001';
  end if;
  insert into public.enrollments (user_id, challenge_slug, start_date)
  values (v_uid, p_slug, public.user_today(v_uid))
  on conflict (user_id, challenge_slug) where status = 'active' do nothing
  returning id into v_id;
  return json_build_object('id', v_id, 'slug', p_slug);
end $$;

create or replace function public.leave_challenge(p_slug text) returns void
language sql security definer set search_path = '' as $$
  delete from public.enrollments where user_id = auth.uid() and challenge_slug = p_slug and status = 'active'
$$;

create or replace function public.check_in(p_slug text, p_mood int default null, p_note text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); e public.enrollments; v_day int; v_done int; v_days int; v_completed boolean := false;
begin
  if v_uid is null then raise exception 'Требуется вход' using errcode = '28000'; end if;
  select * into e from public.enrollments where user_id = v_uid and challenge_slug = p_slug and status = 'active' for update;
  if not found then raise exception 'Вы не участвуете в этом челлендже' using errcode = 'P0002'; end if;
  if p_mood is not null and (p_mood < 1 or p_mood > 5) then raise exception 'Оценка должна быть от 1 до 5' using errcode = '22023'; end if;

  v_day := public.enrollment_day(e.id);
  insert into public.checkins (enrollment_id, user_id, day_number, checkin_date, mood, note)
  values (e.id, v_uid, v_day, public.user_today(v_uid), p_mood, nullif(left(trim(coalesce(p_note, '')), 280), ''))
  on conflict (enrollment_id, day_number) do update set mood = excluded.mood, note = excluded.note;

  select count(*) into v_done from public.checkins where enrollment_id = e.id;
  select days into v_days from public.challenges where slug = p_slug;
  if v_done >= v_days then
    update public.enrollments set status = 'completed', completed_at = now() where id = e.id;
    v_completed := true;
  end if;
  return json_build_object('day', v_day, 'done', v_done, 'streak', public.enrollment_streak(e.id), 'completed', v_completed);
end $$;

-- Отменить можно только сегодняшнюю отметку
create or replace function public.undo_check_in(p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.enrollments;
begin
  select * into e from public.enrollments where user_id = auth.uid() and challenge_slug = p_slug and status = 'active';
  if not found then return; end if;
  delete from public.checkins where enrollment_id = e.id and day_number = public.enrollment_day(e.id);
end $$;

create or replace function public.submit_testimonial(p_slug text, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.enrollments where user_id = v_uid and challenge_slug = p_slug and status = 'completed') then
    raise exception 'Отзыв можно оставить после завершения челленджа' using errcode = 'P0001';
  end if;
  insert into public.testimonials (user_id, challenge_slug, author_name, text)
  values (v_uid, p_slug, (select display_name from public.profiles where id = v_uid), trim(p_text))
  on conflict (user_id, challenge_slug) do update set text = excluded.text, approved = false, created_at = now();
end $$;

-- Полное удаление аккаунта и всех данных пользователя
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Требуется вход' using errcode = '28000'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.join_challenge(text), public.leave_challenge(text), public.check_in(text, int, text),
  public.undo_check_in(text), public.submit_testimonial(text, text), public.delete_my_account() from public, anon;
grant execute on function public.join_challenge(text), public.leave_challenge(text), public.check_in(text, int, text),
  public.undo_check_in(text), public.submit_testimonial(text, text), public.delete_my_account() to authenticated;
