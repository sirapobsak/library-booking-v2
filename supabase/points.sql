-- ============================================================
--  ระบบคะแนนสะสม + เซนเซอร์ตรวจจับเสียง (ESP32)
--  วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run  (รันซ้ำได้ปลอดภัย)
--  ต้องรันหลัง schema.sql และ bookings.sql
--
--  หลักการ
--   - ทุกคนเริ่มที่ starting_points (ผู้ดูแลตั้งค่าได้)
--   - ESP32 1 ตัวผูกกับที่นั่ง 1 ที่ — ตรวจพบเสียงดัง -> หักแต้ม "ทุกคนในการจองที่นั่งนั้นตอนนี้"
--     (คนจอง + เพื่อนที่เข้าร่วมด้วย QR) ครั้งละ noise_penalty แต้ม, คะแนนไม่ติดลบ (ต่ำสุด 0)
--   - ผู้ใช้ทั่วไปเห็นได้แค่คะแนนตัวเอง แก้เองไม่ได้ — เปลี่ยนคะแนนได้ผ่านฟังก์ชันด้านล่างเท่านั้น
--   - ผู้ดูแล (ตาราง admins) เพิ่ม/ลด/ตั้งคะแนน ดูประวัติ ตั้งค่า และจัดการอุปกรณ์ได้
--   - ESP32 ต้องส่ง "คีย์อุปกรณ์" มาด้วยทุกครั้ง (anon key ของเว็บเป็นของสาธารณะ ใช้ยืนยันตัวไม่ได้)
-- ============================================================

create extension if not exists pgcrypto;  -- crypt() / gen_salt() / gen_random_bytes() สำหรับคีย์อุปกรณ์

-- ------------------------------------------------------------
-- 1) ตาราง
-- ------------------------------------------------------------

-- ผู้ดูแลระบบ (เพิ่มคนแรกด้วย SQL ท้ายไฟล์ คนต่อไปตั้งจากหน้าผู้ดูแลได้)
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ตั้งค่าระบบคะแนน (มีแถวเดียว id = 1)
create table if not exists public.point_settings (
  id               int primary key default 1 check (id = 1),
  starting_points  int not null default 100 check (starting_points >= 0),  -- คะแนนเริ่มต้น
  noise_penalty    int not null default 5   check (noise_penalty >= 0),    -- หักต่อการตรวจพบ 1 ครั้ง
  cooldown_seconds int not null default 60  check (cooldown_seconds >= 0), -- พักหลังหัก (ต่ออุปกรณ์)
  sensor_enabled   boolean not null default true,                          -- เปิด/ปิดการหักจากเซนเซอร์
  updated_at       timestamptz not null default now()
);
insert into public.point_settings (id) values (1) on conflict (id) do nothing;

-- คะแนนปัจจุบันของแต่ละคน (แยกจาก profiles เพื่อให้ผู้ใช้แก้คะแนนตัวเองไม่ได้)
create table if not exists public.user_points (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  points     int not null default 0 check (points >= 0),
  updated_at timestamptz not null default now()
);

-- ประวัติการเปลี่ยนคะแนนทุกครั้ง
create table if not exists public.point_logs (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  delta         int  not null,                 -- เปลี่ยนไปเท่าไร (ติดลบ = หัก)
  balance_after int  not null,                 -- คะแนนหลังเปลี่ยน
  source        text not null check (source in ('sensor', 'admin', 'system')),
  reason        text not null default '',
  device_id     text,                          -- อุปกรณ์ที่ตรวจพบ (ถ้ามาจากเซนเซอร์)
  seat_id       text,
  actor_id      uuid references auth.users (id) on delete set null,  -- ผู้ดูแลที่กด (ถ้ามี)
  created_at    timestamptz not null default now()
);
create index if not exists point_logs_user_idx    on public.point_logs (user_id, created_at desc);
create index if not exists point_logs_created_idx on public.point_logs (created_at desc);

-- อุปกรณ์ ESP32 (1 ตัว = 1 ที่นั่ง)
create table if not exists public.noise_devices (
  id              text primary key check (id ~ '^[A-Za-z0-9_-]{3,40}$'),
  name            text not null default '',
  zone_id         text not null,
  seat_id         text not null,
  key_hash        text not null,               -- เก็บแบบ hash (bcrypt) ไม่เก็บคีย์จริง
  active          boolean not null default true,
  last_seen_at    timestamptz,                 -- ติดต่อมาล่าสุด (heartbeat / รายงานเสียง)
  last_level      int,                         -- ระดับเสียงล่าสุดที่ส่งมา
  last_penalty_at timestamptz,                 -- หักแต้มครั้งล่าสุด (ใช้คุมช่วงพัก)
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) RLS — ผู้ใช้อ่านได้แค่คะแนนตัวเอง ตารางอื่นเข้าถึงตรง ๆ ไม่ได้เลย (ต้องผ่านฟังก์ชัน)
-- ------------------------------------------------------------
alter table public.admins         enable row level security;
alter table public.point_settings enable row level security;
alter table public.user_points    enable row level security;
alter table public.point_logs     enable row level security;
alter table public.noise_devices  enable row level security;

drop policy if exists "read own points" on public.user_points;
create policy "read own points" on public.user_points
  for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3) ตัวช่วยภายใน (ห้ามเรียกจากหน้าเว็บ/อุปกรณ์ตรง ๆ — ดูการ revoke ด้านล่าง)
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._require_admin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
end $$;

create or replace function public._starting_points()
returns int language sql security definer set search_path = public stable as $$
  select coalesce((select starting_points from public.point_settings where id = 1), 100);
$$;

-- สร้างแถวคะแนนให้ถ้ายังไม่มี แล้วคืนคะแนนปัจจุบัน
create or replace function public._ensure_points(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_points int;
begin
  insert into public.user_points (user_id, points) values (p_user, public._starting_points())
  on conflict (user_id) do nothing;
  select up.points into v_points from public.user_points up where up.user_id = p_user;
  return v_points;
end $$;

-- เปลี่ยนคะแนน + บันทึกประวัติ (ทุกการเปลี่ยนคะแนนต้องผ่านฟังก์ชันนี้)
create or replace function public._change_points(
  p_user uuid, p_delta int, p_source text, p_reason text,
  p_device text default null, p_seat text default null, p_actor uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_old int; v_new int;
begin
  perform public._ensure_points(p_user);
  select up.points into v_old from public.user_points up where up.user_id = p_user for update;
  v_new := greatest(0, v_old + p_delta);  -- คะแนนไม่ติดลบ
  update public.user_points set points = v_new, updated_at = now() where user_id = p_user;
  insert into public.point_logs (user_id, delta, balance_after, source, reason, device_id, seat_id, actor_id)
  values (p_user, v_new - v_old, v_new, p_source, coalesce(p_reason, ''), p_device, p_seat, p_actor);
  return v_new;
end $$;

-- ------------------------------------------------------------
-- 4) สมัครสมาชิกใหม่ -> ได้คะแนนเริ่มต้นอัตโนมัติ (+ เติมให้บัญชีที่มีอยู่แล้ว)
-- ------------------------------------------------------------
create or replace function public.handle_new_user_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_points (user_id, points) values (new.id, public._starting_points())
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_points on auth.users;
create trigger on_auth_user_created_points
  after insert on auth.users
  for each row execute function public.handle_new_user_points();

insert into public.user_points (user_id, points)
select u.id, public._starting_points() from auth.users u
on conflict (user_id) do nothing;

-- ------------------------------------------------------------
-- 5) ฟังก์ชันของผู้ใช้ทั่วไป
-- ------------------------------------------------------------
create or replace function public.get_my_points()
returns table (points int, is_admin boolean, noise_penalty int, sensor_enabled boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;
  return query
    select public._ensure_points(v_uid), public.is_admin(), s.noise_penalty, s.sensor_enabled
    from public.point_settings s where s.id = 1;
end $$;

-- ------------------------------------------------------------
-- 6) ฟังก์ชันของผู้ดูแล (ทุกตัวเช็คสิทธิ์ผู้ดูแลก่อน)
-- ------------------------------------------------------------
create or replace function public.admin_list_users(p_search text default '')
returns table (user_id uuid, full_name text, email text, phone text, points int, is_admin boolean, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  insert into public.user_points (user_id, points)
    select u.id, public._starting_points() from auth.users u
    on conflict (user_id) do nothing;
  return query
    select u.id,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           u.email::text,
           coalesce(p.phone_number, ''),
           up.points,
           exists (select 1 from public.admins a where a.user_id = u.id),
           up.updated_at
    from auth.users u
    join public.user_points up on up.user_id = u.id
    left join public.profiles p on p.id = u.id
    where coalesce(p_search, '') = ''
       or (coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '') || ' ' ||
           coalesce(u.email, '') || ' ' || coalesce(p.phone_number, '')) ilike '%' || p_search || '%'
    order by 2 nulls last, 3;
end $$;

-- เพิ่ม/ลดคะแนน (p_delta ติดลบ = ลด)
create or replace function public.admin_adjust_points(p_user uuid, p_delta int, p_reason text default '')
returns int language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'BAD_AMOUNT'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  return public._change_points(p_user, p_delta, 'admin',
    coalesce(nullif(trim(p_reason), ''), 'ปรับคะแนนโดยผู้ดูแล'), null, null, auth.uid());
end $$;

-- ตั้งคะแนนเป็นค่าที่ต้องการเลย
create or replace function public.admin_set_points(p_user uuid, p_points int, p_reason text default '')
returns int language plpgsql security definer set search_path = public as $$
declare v_old int;
begin
  perform public._require_admin();
  if p_points is null or p_points < 0 or p_points > 1000000 then raise exception 'BAD_AMOUNT'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  v_old := public._ensure_points(p_user);
  if v_old = p_points then return v_old; end if;
  return public._change_points(p_user, p_points - v_old, 'admin',
    coalesce(nullif(trim(p_reason), ''), 'ตั้งคะแนนใหม่โดยผู้ดูแล'), null, null, auth.uid());
end $$;

-- ตั้ง/ถอนสิทธิ์ผู้ดูแล (ถอนสิทธิ์ตัวเองไม่ได้ กันระบบไม่เหลือผู้ดูแล)
create or replace function public.admin_set_admin(p_user uuid, p_is_admin boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_user = auth.uid() and not p_is_admin then raise exception 'SELF_ADMIN'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  if p_is_admin then
    insert into public.admins (user_id) values (p_user) on conflict (user_id) do nothing;
  else
    delete from public.admins where user_id = p_user;
  end if;
  return p_is_admin;
end $$;

-- รีเซ็ตคะแนนทุกคนกลับเป็นคะแนนเริ่มต้น (คืนจำนวนคนที่ถูกเปลี่ยน)
create or replace function public.admin_reset_all_points(p_reason text default '')
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_start int := public._starting_points(); v_count int := 0;
begin
  perform public._require_admin();
  insert into public.user_points (user_id, points)
    select u.id, v_start from auth.users u
    on conflict (user_id) do nothing;
  for r in select up.user_id, up.points from public.user_points up where up.points <> v_start loop
    perform public._change_points(r.user_id, v_start - r.points, 'admin',
      coalesce(nullif(trim(p_reason), ''), 'รีเซ็ตคะแนนทุกคน'), null, null, auth.uid());
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.admin_get_logs(p_limit int default 200, p_source text default null)
returns table (id bigint, created_at timestamptz, user_id uuid, full_name text, email text, delta int,
               balance_after int, source text, reason text, device_id text, seat_id text, actor_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
    select l.id, l.created_at, l.user_id,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           u.email::text, l.delta, l.balance_after, l.source, l.reason, l.device_id, l.seat_id,
           nullif(trim(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, '')), '')
    from public.point_logs l
    left join auth.users u      on u.id = l.user_id
    left join public.profiles p  on p.id = l.user_id
    left join public.profiles ap on ap.id = l.actor_id
    where p_source is null or l.source = p_source
    order by l.created_at desc, l.id desc
    limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

create or replace function public.admin_get_settings()
returns public.point_settings language plpgsql security definer set search_path = public as $$
declare s public.point_settings;
begin
  perform public._require_admin();
  select * into s from public.point_settings where id = 1;
  return s;
end $$;

create or replace function public.admin_update_settings(p_starting int, p_penalty int, p_cooldown int, p_enabled boolean)
returns public.point_settings language plpgsql security definer set search_path = public as $$
declare s public.point_settings;
begin
  perform public._require_admin();
  if p_starting is null or p_penalty is null or p_cooldown is null or p_enabled is null
     or p_starting < 0 or p_penalty < 0 or p_cooldown < 0
     or p_starting > 1000000 or p_penalty > 100000 or p_cooldown > 86400 then
    raise exception 'BAD_AMOUNT';
  end if;
  update public.point_settings
     set starting_points = p_starting, noise_penalty = p_penalty,
         cooldown_seconds = p_cooldown, sensor_enabled = p_enabled, updated_at = now()
   where id = 1
  returning * into s;
  return s;
end $$;

-- ---------- อุปกรณ์เซนเซอร์ ----------
create or replace function public.admin_list_devices()
returns table (id text, name text, zone_id text, seat_id text, active boolean,
               last_seen_at timestamptz, last_level int, last_penalty_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
    select d.id, d.name, d.zone_id, d.seat_id, d.active, d.last_seen_at, d.last_level, d.last_penalty_at, d.created_at
    from public.noise_devices d order by d.created_at;
end $$;

-- สร้างอุปกรณ์ใหม่ — คืน id + คีย์ (คีย์จริงแสดงครั้งเดียว ในตารางเก็บแค่ hash)
create or replace function public.admin_create_device(p_name text, p_zone text, p_seat text)
returns table (id text, device_key text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare v_id text; v_key text;
begin
  perform public._require_admin();
  if coalesce(trim(p_zone), '') = '' or coalesce(trim(p_seat), '') = '' then raise exception 'BAD_SEAT'; end if;
  loop
    v_id := 'ESP-' || upper(encode(gen_random_bytes(3), 'hex'));
    exit when not exists (select 1 from public.noise_devices d where d.id = v_id);
  end loop;
  v_key := encode(gen_random_bytes(16), 'hex');
  insert into public.noise_devices (id, name, zone_id, seat_id, key_hash)
  values (v_id, coalesce(trim(p_name), ''), trim(p_zone), trim(p_seat), crypt(v_key, gen_salt('bf')));
  return query select v_id, v_key;
end $$;

-- ทำคีย์หาย -> สร้างคีย์ใหม่ (คีย์เก่าใช้ไม่ได้ทันที)
create or replace function public.admin_reset_device_key(p_id text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_key text;
begin
  perform public._require_admin();
  v_key := encode(gen_random_bytes(16), 'hex');
  update public.noise_devices set key_hash = crypt(v_key, gen_salt('bf')) where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return v_key;
end $$;

-- แก้ชื่อ / ย้ายที่นั่ง / เปิด-ปิดอุปกรณ์ (ส่ง null = ไม่เปลี่ยนค่านั้น)
create or replace function public.admin_update_device(p_id text, p_name text, p_seat text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update public.noise_devices
     set name    = coalesce(trim(p_name), name),
         seat_id = coalesce(nullif(trim(p_seat), ''), seat_id),
         active  = coalesce(p_active, active)
   where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.admin_delete_device(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  delete from public.noise_devices where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- ------------------------------------------------------------
-- 7) หัวใจของเซนเซอร์: ตรวจพบเสียงดัง -> หักแต้มคนที่จองที่นั่งนั้นอยู่ตอนนี้
--    คืนสถานะเป็น JSON: DEDUCTED / NO_BOOKING / COOLDOWN / SENSOR_OFF / DEVICE_DISABLED / NO_PENALTY
-- ------------------------------------------------------------
create or replace function public._apply_noise(p_device_id text, p_level int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s     public.point_settings;
  d     public.noise_devices;
  b     public.seat_bookings;
  v_now timestamp := now() at time zone 'Asia/Bangkok';  -- เวลาจองเก็บเป็นเวลาไทย
  v_uid uuid;
  v_count int := 0;
begin
  select * into s from public.point_settings where id = 1;

  update public.noise_devices
     set last_seen_at = now(), last_level = coalesce(p_level, last_level)
   where id = p_device_id
  returning * into d;
  if not found then raise exception 'NOT_FOUND'; end if;

  if not d.active then return jsonb_build_object('ok', false, 'status', 'DEVICE_DISABLED'); end if;
  if not s.sensor_enabled then return jsonb_build_object('ok', false, 'status', 'SENSOR_OFF'); end if;
  if s.noise_penalty <= 0 then return jsonb_build_object('ok', true, 'status', 'NO_PENALTY'); end if;

  -- ช่วงพัก: เสียงดังต่อเนื่องครั้งเดียว ไม่ให้ถูกหักซ้ำหลายรอบ
  if d.last_penalty_at is not null
     and d.last_penalty_at > now() - make_interval(secs => s.cooldown_seconds) then
    return jsonb_build_object('ok', true, 'status', 'COOLDOWN', 'retry_in',
      ceil(extract(epoch from (d.last_penalty_at + make_interval(secs => s.cooldown_seconds) - now())))::int);
  end if;

  -- การจองของที่นั่งนี้ที่ "กำลังนั่งอยู่ตอนนี้"
  select * into b from public.seat_bookings sb
   where sb.zone_id = d.zone_id and sb.seat_id = d.seat_id
     and sb.booking_date + sb.start_time <= v_now
     and v_now < sb.booking_date + sb.end_time
   order by sb.start_time
   limit 1;
  if not found then return jsonb_build_object('ok', true, 'status', 'NO_BOOKING'); end if;

  -- หักทุกคนในการจองนั้น: คนจอง + เพื่อนที่เข้าร่วมด้วย QR/รหัส
  for v_uid in
    select b.user_id
    union
    select m.user_id from public.seat_booking_members m where m.booking_id = b.id
  loop
    perform public._change_points(v_uid, -s.noise_penalty, 'sensor', 'เซนเซอร์ตรวจพบเสียงดัง',
                                  d.id, d.seat_id, null);
    v_count := v_count + 1;
  end loop;

  update public.noise_devices set last_penalty_at = now() where id = d.id;
  return jsonb_build_object('ok', true, 'status', 'DEDUCTED', 'users', v_count, 'penalty', s.noise_penalty);
end $$;

-- ESP32 เรียกเมื่อตรวจพบเสียงดัง (ต้องมีคีย์อุปกรณ์)
create or replace function public.report_noise(p_device text, p_key text, p_level int default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select key_hash into v_hash from public.noise_devices where id = p_device;
  if v_hash is null or p_key is null or crypt(p_key, v_hash) <> v_hash then
    raise exception 'BAD_DEVICE';
  end if;
  return public._apply_noise(p_device, p_level);
end $$;

-- ESP32 เรียกทุก 1 นาทีเพื่อบอกว่ายังออนไลน์ (+ รู้ว่าผู้ดูแลปิดอุปกรณ์/เซนเซอร์ไว้ไหม)
create or replace function public.device_heartbeat(p_device text, p_key text, p_level int default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d public.noise_devices; s public.point_settings;
begin
  select * into d from public.noise_devices where id = p_device;
  if not found or p_key is null or crypt(p_key, d.key_hash) <> d.key_hash then
    raise exception 'BAD_DEVICE';
  end if;
  update public.noise_devices
     set last_seen_at = now(), last_level = coalesce(p_level, last_level)
   where id = p_device;
  select * into s from public.point_settings where id = 1;
  return jsonb_build_object('ok', true, 'active', d.active, 'sensor_enabled', s.sensor_enabled);
end $$;

-- ผู้ดูแลกด "จำลองเสียงดัง" จากหน้าเว็บ — ใช้ทดสอบระบบก่อนมีบอร์ดจริง
create or replace function public.admin_simulate_noise(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  return public._apply_noise(p_id, null);
end $$;

-- ------------------------------------------------------------
-- 8) สิทธิ์การเรียกฟังก์ชัน
-- ------------------------------------------------------------
-- ตัวช่วยภายใน: ห้ามใครเรียกจากภายนอก
revoke all on function public._require_admin()                                         from public, anon, authenticated;
revoke all on function public._starting_points()                                       from public, anon, authenticated;
revoke all on function public._ensure_points(uuid)                                     from public, anon, authenticated;
revoke all on function public._change_points(uuid, int, text, text, text, text, uuid)  from public, anon, authenticated;
revoke all on function public._apply_noise(text, int)                                  from public, anon, authenticated;
revoke all on function public.handle_new_user_points()                                 from public, anon, authenticated;

-- ผู้ใช้ที่ล็อกอิน + ผู้ดูแล (ฟังก์ชันผู้ดูแลเช็คสิทธิ์ข้างในอีกชั้น)
do $$
declare f text;
begin
  foreach f in array array[
    'is_admin()', 'get_my_points()',
    'admin_list_users(text)', 'admin_adjust_points(uuid, integer, text)',
    'admin_set_points(uuid, integer, text)', 'admin_set_admin(uuid, boolean)',
    'admin_reset_all_points(text)', 'admin_get_logs(integer, text)',
    'admin_get_settings()', 'admin_update_settings(integer, integer, integer, boolean)',
    'admin_list_devices()', 'admin_create_device(text, text, text)',
    'admin_reset_device_key(text)', 'admin_update_device(text, text, text, boolean)',
    'admin_delete_device(text)', 'admin_simulate_noise(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- อุปกรณ์ ESP32 (เรียกด้วย anon key + คีย์อุปกรณ์)
revoke all on function public.report_noise(text, text, integer)     from public;
revoke all on function public.device_heartbeat(text, text, integer) from public;
grant execute on function public.report_noise(text, text, integer)     to anon, authenticated;
grant execute on function public.device_heartbeat(text, text, integer) to anon, authenticated;

-- ============================================================
--  ตั้ง "ผู้ดูแลคนแรก" — เปลี่ยนอีเมลเป็นบัญชีที่ใช้ล็อกอินเว็บ แล้วลบ -- หน้าบรรทัดล่างออกก่อนรัน
--  (ผู้ดูแลคนต่อ ๆ ไป กดตั้งให้ได้จากหน้าผู้ดูแล > ผู้ใช้ & คะแนน > ปรับ… > ตั้งเป็นผู้ดูแล)
-- ============================================================
-- insert into public.admins (user_id) select id from auth.users where email = 'อีเมลของคุณ@example.com' on conflict do nothing;
