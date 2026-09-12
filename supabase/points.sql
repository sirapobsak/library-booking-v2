-- ============================================================
--  ระบบคะแนน 2 มิเตอร์ + เซนเซอร์ตรวจจับเสียง (ESP32) + คูปอง
--  วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run  (รันซ้ำได้ปลอดภัย)
--  ต้องรันหลัง schema.sql และ bookings.sql
--
--  ⚠️ ฐานข้อมูลนี้ใช้ร่วมกับเว็บเวอร์ชันแรก (v1) — v1 มี point_logs, reward_logs, profiles.points,
--     adjust_points ฯลฯ อยู่แล้ว ของ v2 จึงใช้ชื่อ user_points / user_point_logs / user_sessions /
--     standing_appeals / coupon_catalog / user_coupons และห้ามแตะของ v1
--
--  มิเตอร์ A — คะแนนความประพฤติ (Standing) · เริ่ม 100 เพดาน 100 · เอาไปแลกของไม่ได้
--    = "ใบอนุญาตใช้ห้องสมุด" ใช้ตัดสินสิทธิ์อย่างเดียว (เก็บในคอลัมน์ user_points.points)
--      80–100 ปกติ | 60–79 เตือน | 40–59 จำกัดระดับ 1 (จองห้อง/พื้นที่พิเศษไม่ได้ + ยืมหนังสือได้น้อยลง)
--      20–39 จำกัดระดับ 2 (+ ยืมหนังสือไม่ได้) | 0–19 ระงับการเข้าใช้ชั่วคราว (มีกำหนดเวลา + อุทธรณ์ได้)
--    หัก: บอร์ดส่งมาเมื่อเสียงดังตั้งแต่ครั้งที่ 3 -> ครั้งแรกของวัน −5 แล้วแรงขึ้นทีละ 5
--         เพดาน −20 ต่อครั้ง และรวมไม่เกิน −40 ต่อวัน (พลาดวันเดียวไม่ถึงขั้นโดนตัดสิทธิ์)
--    คืน: (1) เงียบต่อ 10 นาทีหลังโดนหัก (ยังนั่งอยู่ในเวลาจอง) -> คืน 50% ของที่เพิ่งเสีย
--         (2) จบการจองแบบเงียบ (เช็คอินแล้ว + ไม่โดนหัก) +2 (วันละครั้ง)
--         (3) ไม่ทำผิดเลยครบทุก 1 สัปดาห์ +5 อัตโนมัติ
--         (4) พฤติกรรมดีอื่น ๆ -> ผู้ดูแลกดเพิ่มให้ (เช่นคืนหนังสือตรงเวลา +3)
--
--  มิเตอร์ B — เหรียญรางวัล (Coins) · เริ่ม 0 ไม่มีเพดาน · เอาไว้แลกคูปอง
--    +2 ต่อการจองที่เงียบ, เงียบติดต่อกัน 7 วัน +10 / 14 วัน +20 / 30 วัน +50 (ทุก ๆ 30 วันต่อจากนั้น +50)
--    ได้เหรียญเฉพาะตอนความประพฤติ ≥ 80 (กำลังโดนจำกัดสิทธิ์ = หยุดได้เหรียญ)
--
--  "วันที่เงียบ" (สถิติเงียบติดต่อกัน) = วันที่จองโต๊ะ + เช็คอินที่โต๊ะ + ไม่โดนเซนเซอร์หักเลยทั้งวัน
--    วันที่ไม่ได้จอง/ไม่ได้มา ไม่นับ และไม่ตัดสถิติ — โดนหักเมื่อไร สถิติกลับเป็น 0 ทันที
--
--  งานที่ต้องรอเวลา (คืน 50%, จบการจอง, ฟื้นรายสัปดาห์, หมดเวลาระงับ) ระบบคำนวณให้เองตอนผู้ใช้เปิดเว็บ
--  หรือตอนบอร์ดส่ง heartbeat ทุก 30 วิ (ฟังก์ชัน _settle_user) — ไม่ต้องตั้ง cron
--
--  ผู้ใช้ทั่วไปเห็นแค่ของตัวเอง แก้เองไม่ได้ / ผู้ดูแล (ตาราง admins) ปรับคะแนน ตั้งค่า ตัดสินอุทธรณ์
--  จัดการคูปองและอุปกรณ์ได้ / ESP32 ต้องส่ง "คีย์อุปกรณ์" มาด้วยทุกครั้ง
-- ============================================================

create extension if not exists pgcrypto;  -- crypt() / gen_salt() / gen_random_bytes()

-- ------------------------------------------------------------
-- 1) ตาราง (รันซ้ำได้ — ตารางที่มีอยู่แล้วจะถูกเติมคอลัมน์ใหม่ให้)
-- ------------------------------------------------------------

-- ผู้ดูแลระบบ (เพิ่มคนแรกด้วย SQL ท้ายไฟล์ คนต่อไปตั้งจากหน้าผู้ดูแลได้)
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ตั้งค่าระบบคะแนน (มีแถวเดียว id = 1)
create table if not exists public.point_settings (
  id               int primary key default 1 check (id = 1),
  starting_points  int not null default 100 check (starting_points >= 0),  -- ความประพฤติเริ่มต้น
  noise_penalty    int not null default 5   check (noise_penalty >= 0),    -- หักครั้งแรกของวัน
  cooldown_seconds int not null default 5   check (cooldown_seconds >= 0), -- พักหลังหัก (ต่ออุปกรณ์) ไม่ควรเกิน 5
  sensor_enabled   boolean not null default true,                          -- เปิด/ปิดการหักจากเซนเซอร์
  updated_at       timestamptz not null default now()
);
alter table public.point_settings
  add column if not exists penalty_step   int not null default 5  check (penalty_step >= 0),    -- หักแรงขึ้นครั้งละ
  add column if not exists penalty_max    int not null default 20 check (penalty_max >= 0),     -- เพดานต่อครั้ง
  add column if not exists daily_cap      int not null default 40 check (daily_cap >= 0),       -- หักรวมสูงสุดต่อวัน
  add column if not exists refund_minutes int not null default 10 check (refund_minutes >= 1),  -- เงียบต่อกี่นาทีถึงคืน
  add column if not exists refund_percent int not null default 50 check (refund_percent between 0 and 100),
  add column if not exists session_bonus  int not null default 2  check (session_bonus >= 0),   -- จบการจองแบบเงียบ (ความประพฤติ)
  add column if not exists session_coins  int not null default 2  check (session_coins >= 0),   -- จบการจองแบบเงียบ (เหรียญ)
  add column if not exists weekly_bonus   int not null default 5  check (weekly_bonus >= 0),    -- ไม่ทำผิดครบสัปดาห์
  add column if not exists coin_gate      int not null default 80 check (coin_gate between 0 and 100), -- ได้เหรียญเมื่อ ≥
  add column if not exists suspend_days   int not null default 7  check (suspend_days >= 1);    -- ระงับกี่วัน
insert into public.point_settings (id) values (1) on conflict (id) do nothing;
-- ติดตั้งครั้งแรกเคยตั้งช่วงพักไว้ 60 วิ (ยาวกว่ารอบนับ 5 วิของบอร์ด) -> ปรับเป็น 5 ให้เอง
update public.point_settings set cooldown_seconds = 5 where id = 1 and cooldown_seconds = 60;
update public.point_settings set starting_points = 100 where id = 1 and starting_points > 100;

-- คะแนนของแต่ละคน (แยกจาก profiles เพื่อให้ผู้ใช้แก้เองไม่ได้)
create table if not exists public.user_points (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  points     int not null default 0 check (points >= 0),   -- = คะแนนความประพฤติ (0–100)
  updated_at timestamptz not null default now()
);
alter table public.user_points
  add column if not exists coins             int not null default 0 check (coins >= 0), -- เหรียญรางวัล
  add column if not exists suspended_until   timestamptz,          -- ระงับการเข้าใช้ถึงเมื่อไร
  add column if not exists streak            int not null default 0, -- เงียบติดต่อกันกี่วัน
  add column if not exists best_streak       int not null default 0,
  add column if not exists streak_last_day   date,                 -- วันล่าสุดที่นับเข้าสถิติ
  add column if not exists last_violation_at timestamptz,          -- โดนเซนเซอร์หักล่าสุด
  add column if not exists last_weekly_at    timestamptz,          -- ฟื้นรายสัปดาห์ล่าสุด
  add column if not exists created_at        timestamptz not null default now();
-- ความประพฤติมีเพดาน 100 (เวอร์ชันก่อนผู้ดูแลเพิ่มเกิน 100 ได้)
update public.user_points set points = 100 where points > 100;

-- ประวัติการเปลี่ยนคะแนนทุกครั้ง (ทั้งความประพฤติและเหรียญ)
create table if not exists public.user_point_logs (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  delta         int  not null,                 -- เปลี่ยนไปเท่าไร (ติดลบ = หัก)
  balance_after int  not null,                 -- ค่าหลังเปลี่ยน
  source        text not null,
  reason        text not null default '',
  device_id     text,                          -- อุปกรณ์ที่ตรวจพบ (ถ้ามาจากเซนเซอร์)
  seat_id       text,
  actor_id      uuid references auth.users (id) on delete set null,  -- ผู้ดูแลที่กด (ถ้ามี)
  created_at    timestamptz not null default now()
);
alter table public.user_point_logs
  add column if not exists meter      text not null default 'standing' check (meter in ('standing', 'coins')),
  add column if not exists booking_id uuid,                               -- การจองที่เกี่ยวข้อง
  add column if not exists refunded   boolean not null default false;     -- การหักนี้คืน 50% ไปแล้วหรือยัง
alter table public.user_point_logs drop constraint if exists user_point_logs_source_check;
alter table public.user_point_logs add constraint user_point_logs_source_check
  check (source in ('sensor', 'admin', 'system', 'redeem'));
create index if not exists user_point_logs_user_idx    on public.user_point_logs (user_id, created_at desc);
create index if not exists user_point_logs_created_idx on public.user_point_logs (created_at desc);

-- การใช้โต๊ะของแต่ละคนในแต่ละการจอง (เช็คอิน / โดนเสียงดัง / ได้รางวัลแล้วหรือยัง)
create table if not exists public.user_sessions (
  booking_id    uuid not null references public.seat_bookings (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_date  date not null,                 -- วันที่จอง (เวลาไทย)
  ends_at       timestamp not null,            -- เวลาจบการจอง (เวลาไทย)
  checked_in_at timestamptz,                   -- กดเช็คอินที่โต๊ะเมื่อไร (null = ยังไม่มา)
  noisy         boolean not null default false, -- โดนเซนเซอร์หักระหว่างการจองนี้
  rewarded      boolean not null default false, -- ได้รางวัล "จบการจองแบบเงียบ" แล้ว
  settled_at    timestamptz,                   -- สรุปผลหลังจบการจองแล้ว
  primary key (booking_id, user_id)
);
create index if not exists user_sessions_user_idx on public.user_sessions (user_id, session_date);

-- คำอุทธรณ์ตอนโดนระงับ
create table if not exists public.standing_appeals (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  message    text not null check (char_length(message) between 5 and 500),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);

-- รายการคูปองที่แลกได้ (แก้ชื่อ/ราคาได้ที่ตารางนี้)
create table if not exists public.coupon_catalog (
  id          text primary key,
  name        text not null,
  description text not null default '',
  cost        int  not null check (cost > 0),   -- ราคาเป็นเหรียญ
  active      boolean not null default true
);
insert into public.coupon_catalog (id, name, description, cost) values
  ('small',  'คูปองส่วนลดเล็ก', 'ส่วนลดเล็ก ใช้ได้ที่เคาน์เตอร์ห้องสมุด', 50),
  ('medium', 'คูปองส่วนลดกลาง', 'ส่วนลดกลาง ใช้ได้ที่เคาน์เตอร์ห้องสมุด', 100),
  ('large',  'คูปองส่วนลดใหญ่', 'ส่วนลดใหญ่ ใช้ได้ที่เคาน์เตอร์ห้องสมุด', 200)
on conflict (id) do nothing;

-- คูปองที่ผู้ใช้แลกแล้ว
create table if not exists public.user_coupons (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  coupon_id  text not null references public.coupon_catalog (id),
  name       text not null,
  cost       int  not null,
  code       text not null unique,             -- รหัสที่ยื่นให้เจ้าหน้าที่
  status     text not null default 'unused' check (status in ('unused', 'used')),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

-- เสียงดังที่เซนเซอร์ตรวจพบแต่ละครั้ง (ใช้ในจอทีวี: ตามองไปที่โต๊ะ + สถิติวันนี้/เมื่อวาน) — ไม่มีข้อมูลว่าใครนั่ง
create table if not exists public.noise_events (
  id         bigint generated always as identity primary key,
  zone_id    text not null,
  seat_id    text not null,
  device_id  text,
  level      int,
  created_at timestamptz not null default now()
);
create index if not exists noise_events_zone_idx on public.noise_events (zone_id, created_at desc);

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
alter table public.admins           enable row level security;
alter table public.point_settings   enable row level security;
alter table public.user_points      enable row level security;
alter table public.user_point_logs  enable row level security;
alter table public.user_sessions    enable row level security;
alter table public.standing_appeals enable row level security;
alter table public.coupon_catalog   enable row level security;
alter table public.user_coupons     enable row level security;
alter table public.noise_devices    enable row level security;
alter table public.noise_events     enable row level security;

drop policy if exists "read own points" on public.user_points;
create policy "read own points" on public.user_points
  for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3) ลบฟังก์ชันเวอร์ชันก่อนที่เปลี่ยนหน้าตา (พารามิเตอร์/ผลลัพธ์) — จะสร้างใหม่ด้านล่าง
-- ------------------------------------------------------------
drop function if exists public.get_my_points();
drop function if exists public.admin_list_users(text);
drop function if exists public.admin_adjust_points(uuid, int, text);
drop function if exists public.admin_set_points(uuid, int, text);
drop function if exists public.admin_get_logs(int, text);
drop function if exists public.admin_get_settings();
drop function if exists public.admin_update_settings(int, int, int, boolean);
drop function if exists public._change_points(uuid, int, text, text, text, text, uuid);

-- ------------------------------------------------------------
-- 4) ตัวช่วยภายใน (ห้ามเรียกจากหน้าเว็บ/อุปกรณ์ตรง ๆ — ดูการ revoke ด้านล่าง)
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
  select least(100, coalesce((select starting_points from public.point_settings where id = 1), 100));
$$;

-- วันนี้ / ตอนนี้ แบบเวลาไทย (เวลาจองในตาราง seat_bookings เก็บเป็นเวลาไทย)
create or replace function public._bkk_now()
returns timestamp language sql stable as $$ select now() at time zone 'Asia/Bangkok' $$;

-- ระดับสิทธิ์จากคะแนนความประพฤติ
create or replace function public._level(p_points int, p_until timestamptz)
returns text language sql stable as $$
  select case
    when (p_until is not null and p_until > now()) or p_points < 20 then 'suspended'
    when p_points < 40 then 'limit2'
    when p_points < 60 then 'limit1'
    when p_points < 80 then 'warn'
    else 'normal'
  end;
$$;

-- เหรียญโบนัสเมื่อเงียบติดต่อกันครบ 7 / 14 / 30 วัน (และทุก ๆ 30 วันต่อจากนั้น)
create or replace function public._streak_bonus(p_streak int)
returns int language sql immutable as $$
  select case
    when p_streak = 7 then 10
    when p_streak = 14 then 20
    when p_streak >= 30 and p_streak % 30 = 0 then 50
    else 0
  end;
$$;

-- สร้างแถวคะแนนให้ถ้ายังไม่มี แล้วคืนคะแนนความประพฤติปัจจุบัน
create or replace function public._ensure_points(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_points int;
begin
  insert into public.user_points (user_id, points) values (p_user, public._starting_points())
  on conflict (user_id) do nothing;
  select up.points into v_points from public.user_points up where up.user_id = p_user;
  return v_points;
end $$;

-- เปลี่ยนคะแนน + บันทึกประวัติ (ทุกการเปลี่ยนต้องผ่านฟังก์ชันนี้)
--   p_meter = 'standing' (ความประพฤติ 0–100) หรือ 'coins' (เหรียญ ≥ 0)
--   ความประพฤติตกต่ำกว่า 20 -> ระงับการเข้าใช้ชั่วคราว suspend_days วัน
--   ผู้ดูแลปรับกลับขึ้นมา ≥ 20 -> ยกเลิกการระงับ
create or replace function public._change_meter(
  p_user uuid, p_meter text, p_delta int, p_source text, p_reason text,
  p_device text default null, p_seat text default null, p_actor uuid default null, p_booking uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  u     public.user_points;
  v_old int;
  v_new int;
  v_days int;
begin
  perform public._ensure_points(p_user);
  select * into u from public.user_points up where up.user_id = p_user for update;

  if p_meter = 'coins' then
    v_old := u.coins;
    v_new := greatest(0, v_old + p_delta);
    update public.user_points set coins = v_new, updated_at = now() where user_id = p_user;
  else
    v_old := u.points;
    v_new := least(100, greatest(0, v_old + p_delta));
    update public.user_points set points = v_new, updated_at = now() where user_id = p_user;
    -- เริ่มระงับเฉพาะตอน "โดนลด" จนต่ำกว่า 20 (ได้คืนแต่ยังไม่ถึง 20 ไม่นับว่าทำผิดซ้ำ)
    if p_delta < 0 and v_new < 20 and (u.suspended_until is null or u.suspended_until <= now()) then
      select suspend_days into v_days from public.point_settings where id = 1;
      update public.user_points set suspended_until = now() + make_interval(days => coalesce(v_days, 7))
       where user_id = p_user;
    elsif v_new >= 20 and p_source = 'admin' and u.suspended_until is not null then
      update public.user_points set suspended_until = null where user_id = p_user;
    end if;
  end if;

  if v_new <> v_old then  -- ชนเพดาน/พื้นแล้วไม่เปลี่ยน = ไม่ต้องเก็บประวัติ
    insert into public.user_point_logs
      (user_id, meter, delta, balance_after, source, reason, device_id, seat_id, actor_id, booking_id)
    values (p_user, p_meter, v_new - v_old, v_new, p_source, coalesce(p_reason, ''),
            p_device, p_seat, p_actor, p_booking);
  end if;
  return v_new;
end $$;

-- โดนเซนเซอร์หักครั้งถัดไปจะหักเท่าไร (ไล่ระดับในวันเดียวกัน + ไม่เกินยอดรวมต่อวัน)
create or replace function public._next_penalty(p_user uuid)
returns int language plpgsql security definer set search_path = public stable as $$
declare
  s     public.point_settings;
  v_n   int;
  v_sum int;
  v_amt int;
begin
  select * into s from public.point_settings where id = 1;
  select count(*), coalesce(sum(-l.delta), 0) into v_n, v_sum
    from public.user_point_logs l
   where l.user_id = p_user and l.source = 'sensor' and l.meter = 'standing' and l.delta < 0
     and (l.created_at at time zone 'Asia/Bangkok')::date = public._bkk_now()::date;
  v_amt := least(s.noise_penalty + s.penalty_step * v_n, s.penalty_max);
  return greatest(0, least(v_amt, s.daily_cap - v_sum));
end $$;

-- สรุปงานที่ต้องรอเวลาของผู้ใช้ 1 คน (เรียกบ่อยได้ ไม่ให้ซ้ำ)
create or replace function public._settle_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        public.point_settings;
  u        public.user_points;
  r        record;
  v_now    timestamp := public._bkk_now();
  v_streak int;
  v_bonus  int;
  v_anchor timestamptz;
  v_weeks  int;
begin
  perform public._ensure_points(p_user);
  select * into s from public.point_settings where id = 1;
  select * into u from public.user_points where user_id = p_user for update;  -- ล็อก กันสรุปซ้อนกัน

  -- ลำดับสำคัญ: ทำตามลำดับเวลาที่เกิดจริง (คืน 50% เกิดก่อนหมดเวลาระงับเสมอ)
  -- ผลจึงเท่ากันไม่ว่าจะสรุปทันทีหรือสรุปทีหลังหลายวัน

  -- 1) คืนทันที: โดนหักแล้วเงียบต่อ refund_minutes นาที (ยังอยู่ในเวลาจอง) -> คืน refund_percent%
  for r in
    select l.booking_id, max(l.created_at) as last_at, sum(-l.delta)::int as lost
      from public.user_point_logs l
     where l.user_id = p_user and l.source = 'sensor' and l.meter = 'standing' and l.delta < 0
       and not l.refunded and l.booking_id is not null
     group by l.booking_id
  loop
    continue when r.last_at + make_interval(mins => s.refund_minutes) > now();  -- ยังไม่ครบเวลา
    update public.user_point_logs set refunded = true
     where user_id = p_user and booking_id = r.booking_id and source = 'sensor' and delta < 0 and not refunded;
    -- ต้องยังนั่งอยู่จนครบเวลา (การจองยังไม่จบตอนครบ 10 นาที) ถึงจะถือว่า "เงียบต่อ"
    if exists (select 1 from public.seat_bookings b
                where b.id = r.booking_id
                  and b.booking_date + b.end_time >=
                      (r.last_at at time zone 'Asia/Bangkok') + make_interval(mins => s.refund_minutes)) then
      perform public._change_meter(p_user, 'standing', round(r.lost * s.refund_percent / 100.0)::int, 'system',
        format('เงียบต่อเนื่อง %s นาทีหลังโดนหัก — คืน %s%%', s.refund_minutes, s.refund_percent),
        null, null, null, r.booking_id);
    end if;
  end loop;

  -- 2) หมดเวลาระงับ -> กลับมาใช้ได้ที่ 20 (จำกัดระดับ 2)
  select * into u from public.user_points where user_id = p_user;
  if u.suspended_until is not null and u.suspended_until <= now() then
    update public.user_points set suspended_until = null where user_id = p_user;
    if u.points < 20 then
      perform public._change_meter(p_user, 'standing', 20 - u.points, 'system',
        'ครบกำหนดระงับชั่วคราว — กลับมาใช้ห้องสมุดได้ (จำกัดระดับ 2)');
    end if;
  end if;

  -- 3) จบการจอง: เช็คอินแล้ว + ไม่โดนหักทั้งวัน -> ความประพฤติ +2, สถิติ +1 วัน, เหรียญ (ถ้า ≥ 80)
  for r in
    select us.* from public.user_sessions us
     where us.user_id = p_user and us.settled_at is null and us.ends_at <= v_now
     order by us.ends_at
  loop
    update public.user_sessions set settled_at = now() where booking_id = r.booking_id and user_id = p_user;
    continue when r.checked_in_at is null or r.noisy;
    continue when exists (select 1 from public.user_sessions x                -- วันนั้นโดนหักที่การจองอื่น
                           where x.user_id = p_user and x.session_date = r.session_date and x.noisy);
    continue when exists (select 1 from public.user_sessions x                -- ได้รางวัลวันนี้ไปแล้ว (วันละครั้ง)
                           where x.user_id = p_user and x.session_date = r.session_date and x.rewarded);
    update public.user_sessions set rewarded = true where booking_id = r.booking_id and user_id = p_user;

    perform public._change_meter(p_user, 'standing', s.session_bonus, 'system', 'ใช้โต๊ะจนจบการจองแบบเงียบ',
      null, null, null, r.booking_id);

    select * into u from public.user_points where user_id = p_user;
    v_streak := u.streak;
    if u.streak_last_day is distinct from r.session_date then
      v_streak := u.streak + 1;
      update public.user_points
         set streak = v_streak, best_streak = greatest(best_streak, v_streak), streak_last_day = r.session_date
       where user_id = p_user;
    end if;

    if u.points >= s.coin_gate then  -- เหรียญได้เฉพาะตอนความประพฤติ ≥ 80
      perform public._change_meter(p_user, 'coins', s.session_coins, 'system', 'ใช้โต๊ะจนจบการจองแบบเงียบ',
        null, null, null, r.booking_id);
      v_bonus := public._streak_bonus(v_streak);
      if v_bonus > 0 then
        perform public._change_meter(p_user, 'coins', v_bonus, 'system',
          format('โบนัสเงียบติดต่อกันครบ %s วัน', v_streak));
      end if;
    end if;
  end loop;

  -- 4) ฟื้นเองตามเวลา: ไม่ทำผิดเลยครบทุก 7 วัน +weekly_bonus
  select * into u from public.user_points where user_id = p_user;
  v_anchor := greatest(coalesce(u.last_violation_at, u.created_at), coalesce(u.last_weekly_at, u.created_at));
  v_weeks := floor(extract(epoch from (now() - v_anchor)) / 604800);
  if v_weeks >= 1 then
    update public.user_points set last_weekly_at = v_anchor + make_interval(days => 7 * v_weeks)
     where user_id = p_user;
    if u.points < 100 then
      perform public._change_meter(p_user, 'standing', s.weekly_bonus * v_weeks, 'system',
        format('ไม่มีการทำผิดครบ %s สัปดาห์ — ฟื้นคะแนนอัตโนมัติ', v_weeks));
    end if;
  end if;
end $$;

-- เช็คก่อนจอง/เข้าร่วมโต๊ะ: คืนรหัสเหตุผลที่ห้าม หรือ null = จองได้
--   (bookings.sql เรียกฟังก์ชันนี้ถ้ามีอยู่ — ห้อง R1–R3 = "ห้อง/พื้นที่พิเศษ")
create or replace function public._booking_restriction(p_user uuid, p_seat text)
returns text language plpgsql security definer set search_path = public as $$
declare u public.user_points; v_level text;
begin
  perform public._settle_user(p_user);
  select * into u from public.user_points where user_id = p_user;
  v_level := public._level(u.points, u.suspended_until);
  if v_level = 'suspended' then return 'SUSPENDED'; end if;
  if v_level in ('limit1', 'limit2') and p_seat ~ '^R[0-9]+$' then return 'RESTRICTED_ROOM'; end if;
  return null;
end $$;

create or replace function public._settings_json(s public.point_settings)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'startingPoints', s.starting_points, 'noisePenalty', s.noise_penalty, 'penaltyStep', s.penalty_step,
    'penaltyMax', s.penalty_max, 'dailyCap', s.daily_cap, 'cooldownSeconds', s.cooldown_seconds,
    'sensorEnabled', s.sensor_enabled, 'refundMinutes', s.refund_minutes, 'refundPercent', s.refund_percent,
    'sessionBonus', s.session_bonus, 'sessionCoins', s.session_coins, 'weeklyBonus', s.weekly_bonus,
    'coinGate', s.coin_gate, 'suspendDays', s.suspend_days);
$$;

-- อ่านเลขจำนวนเต็มจาก JSON (ไม่ส่งมา = ใช้ค่าเดิม, ผิดช่วง = BAD_AMOUNT)
create or replace function public._json_int(p jsonb, p_key text, p_current int, p_lo int, p_hi int)
returns int language plpgsql immutable as $$
declare v int;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then return p_current; end if;
  if jsonb_typeof(p -> p_key) <> 'number' then raise exception 'BAD_AMOUNT'; end if;
  v := (p ->> p_key)::numeric;
  if v::numeric <> (p ->> p_key)::numeric or v < p_lo or v > p_hi then raise exception 'BAD_AMOUNT'; end if;
  return v;
end $$;

-- ------------------------------------------------------------
-- 5) สมัครสมาชิกใหม่ -> ได้ความประพฤติเริ่มต้นอัตโนมัติ (+ เติมให้บัญชีที่มีอยู่แล้ว)
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
-- 6) ฟังก์ชันของผู้ใช้ทั่วไป
-- ------------------------------------------------------------

-- ป้ายบน Header (เบา ๆ เรียกทุก 15 วิ)
create or replace function public.get_my_points()
returns table (points int, coins int, level text, streak int, is_admin boolean,
               noise_penalty int, sensor_enabled boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;
  perform public._settle_user(v_uid);
  return query
    select up.points, up.coins, public._level(up.points, up.suspended_until), up.streak, public.is_admin(),
           s.noise_penalty, s.sensor_enabled
      from public.user_points up, public.point_settings s
     where up.user_id = v_uid and s.id = 1;
end $$;

-- ทุกอย่างของหน้า "คะแนนสะสม" ในครั้งเดียว (ชื่อฟิลด์แบบ camelCase ใช้ในเว็บได้เลย)
create or replace function public.get_my_rewards()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamp;
  v_today date;
  u       public.user_points;
  s       public.point_settings;
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;
  perform public._settle_user(v_uid);
  v_now := public._bkk_now();
  v_today := v_now::date;
  select * into u from public.user_points where user_id = v_uid;
  select * into s from public.point_settings where id = 1;

  return jsonb_build_object(
    'standing', u.points,
    'coins', u.coins,
    'level', public._level(u.points, u.suspended_until),
    'suspendedUntil', case when u.suspended_until > now() then u.suspended_until end,
    'streak', u.streak,
    'bestStreak', u.best_streak,
    'todayCounted', u.streak > 0 and u.streak_last_day = v_today,
    'todayNoisy', exists (select 1 from public.user_sessions x
                           where x.user_id = v_uid and x.session_date = v_today and x.noisy),
    'nextPenalty', public._next_penalty(v_uid),
    'nextWeeklyAt', greatest(coalesce(u.last_violation_at, u.created_at),
                             coalesce(u.last_weekly_at, u.created_at)) + interval '7 days',
    'isAdmin', public.is_admin(),
    'settings', public._settings_json(s),
    -- การจองของฉันวันนี้ (ของตัวเอง + ที่เข้าร่วมด้วย QR) พร้อมสถานะเช็คอิน
    'today', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bookingId', b.id, 'zoneId', b.zone_id, 'seatId', b.seat_id,
               'start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'),
               'isOwner', b.user_id = v_uid,
               'checkedIn', us.checked_in_at is not null,
               'noisy', coalesce(us.noisy, false),
               'ended', v_now >= b.booking_date + b.end_time,
               'canCheckIn', us.checked_in_at is null
                             and v_now >= b.booking_date + b.start_time - interval '15 minutes'
                             and v_now < b.booking_date + b.end_time
             ) order by b.start_time), '[]'::jsonb)
        from public.seat_bookings b
        left join public.user_sessions us on us.booking_id = b.id and us.user_id = v_uid
       where b.booking_date = v_today
         and (b.user_id = v_uid or exists (select 1 from public.seat_booking_members m
                                            where m.booking_id = b.id and m.user_id = v_uid))),
    'catalog', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description,
                                                   'cost', c.cost) order by c.cost), '[]'::jsonb)
        from public.coupon_catalog c where c.active),
    'coupons', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'cost', x.cost, 'code', x.code,
                                                   'status', x.status, 'createdAt', x.created_at,
                                                   'usedAt', x.used_at) order by x.created_at desc), '[]'::jsonb)
        from (select * from public.user_coupons where user_id = v_uid order by created_at desc limit 30) x),
    'logs', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'createdAt', x.created_at, 'meter', x.meter,
                                                   'delta', x.delta, 'balanceAfter', x.balance_after,
                                                   'source', x.source, 'reason', x.reason, 'seatId', x.seat_id)
                                order by x.created_at desc, x.id desc), '[]'::jsonb)
        from (select * from public.user_point_logs where user_id = v_uid
               order by created_at desc, id desc limit 30) x),
    'appeal', (
      select jsonb_build_object('id', a.id, 'status', a.status, 'message', a.message,
                                'adminNote', a.admin_note, 'createdAt', a.created_at)
        from public.standing_appeals a where a.user_id = v_uid
       order by a.created_at desc limit 1)
  );
end $$;

-- เช็คอินที่โต๊ะ (ตั้งแต่ 15 นาทีก่อนเวลาเริ่ม จนจบการจอง) — ต้องเป็นคนจองหรือคนที่เข้าร่วมแล้ว
create or replace function public.check_in(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamp := public._bkk_now();
  b     public.seat_bookings;
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into b from public.seat_bookings where id = p_booking;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.user_id <> v_uid and not exists (select 1 from public.seat_booking_members m
                                         where m.booking_id = b.id and m.user_id = v_uid) then
    raise exception 'NOT_MEMBER';
  end if;
  if v_now < b.booking_date + b.start_time - interval '15 minutes' then raise exception 'TOO_EARLY'; end if;
  if v_now >= b.booking_date + b.end_time then raise exception 'EXPIRED'; end if;

  insert into public.user_sessions (booking_id, user_id, session_date, ends_at, checked_in_at)
  values (b.id, v_uid, b.booking_date, b.booking_date + b.end_time, now())
  on conflict (booking_id, user_id)
    do update set checked_in_at = coalesce(public.user_sessions.checked_in_at, now());
  return jsonb_build_object('ok', true);
end $$;

-- แลกคูปองด้วยเหรียญ
create or replace function public.redeem_coupon(p_coupon text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid  uuid := auth.uid();
  c      public.coupon_catalog;
  u      public.user_points;
  v_code text;
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;
  perform public._settle_user(v_uid);
  select * into c from public.coupon_catalog where id = p_coupon and active;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into u from public.user_points where user_id = v_uid for update;
  if public._level(u.points, u.suspended_until) = 'suspended' then raise exception 'SUSPENDED'; end if;
  if u.coins < c.cost then raise exception 'NOT_ENOUGH_COINS'; end if;

  loop
    v_code := 'LB-' || upper(encode(gen_random_bytes(4), 'hex'));
    exit when not exists (select 1 from public.user_coupons where code = v_code);
  end loop;
  perform public._change_meter(v_uid, 'coins', -c.cost, 'redeem', 'แลก' || c.name);
  insert into public.user_coupons (user_id, coupon_id, name, cost, code) values (v_uid, c.id, c.name, c.cost, v_code);
  return jsonb_build_object('code', v_code, 'name', c.name, 'cost', c.cost);
end $$;

-- ยื่นอุทธรณ์ตอนโดนระงับ (มีเรื่องรอพิจารณาได้ทีละเรื่อง)
create or replace function public.submit_appeal(p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); u public.user_points;
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;
  perform public._settle_user(v_uid);
  select * into u from public.user_points where user_id = v_uid;
  if public._level(u.points, u.suspended_until) <> 'suspended' then raise exception 'NOT_SUSPENDED'; end if;
  if char_length(trim(coalesce(p_message, ''))) not between 5 and 500 then raise exception 'BAD_MESSAGE'; end if;
  if exists (select 1 from public.standing_appeals where user_id = v_uid and status = 'pending') then
    raise exception 'APPEAL_PENDING';
  end if;
  insert into public.standing_appeals (user_id, message) values (v_uid, trim(p_message));
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------
-- 7) ฟังก์ชันของผู้ดูแล (ทุกตัวเช็คสิทธิ์ผู้ดูแลก่อน)
-- ------------------------------------------------------------
create or replace function public.admin_list_users(p_search text default '')
returns table (user_id uuid, full_name text, email text, phone text, points int, coins int, level text,
               suspended_until timestamptz, streak int, is_admin boolean, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r record;
begin
  perform public._require_admin();
  for r in select u.id from auth.users u loop
    perform public._settle_user(r.id);  -- ให้ตัวเลขเป็นปัจจุบัน (คืน 50% / ฟื้นรายสัปดาห์ ฯลฯ)
  end loop;
  return query
    select u.id,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           u.email::text,
           coalesce(p.phone_number, ''),
           up.points, up.coins, public._level(up.points, up.suspended_until),
           case when up.suspended_until > now() then up.suspended_until end,
           up.streak,
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

-- เพิ่ม/ลด (p_delta ติดลบ = ลด) — p_meter = 'standing' ความประพฤติ / 'coins' เหรียญ
create or replace function public.admin_adjust_points(p_user uuid, p_delta int, p_reason text default '',
                                                      p_meter text default 'standing')
returns int language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_meter not in ('standing', 'coins') then raise exception 'BAD_AMOUNT'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'BAD_AMOUNT'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  return public._change_meter(p_user, p_meter, p_delta, 'admin',
    coalesce(nullif(trim(p_reason), ''), 'ปรับโดยผู้ดูแล'), null, null, auth.uid());
end $$;

-- ตั้งเป็นค่าที่ต้องการเลย
create or replace function public.admin_set_points(p_user uuid, p_points int, p_reason text default '',
                                                   p_meter text default 'standing')
returns int language plpgsql security definer set search_path = public as $$
declare u public.user_points; v_old int;
begin
  perform public._require_admin();
  if p_meter not in ('standing', 'coins') or p_points is null or p_points < 0
     or (p_meter = 'standing' and p_points > 100) or p_points > 1000000 then
    raise exception 'BAD_AMOUNT';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  perform public._ensure_points(p_user);
  select * into u from public.user_points where user_id = p_user;
  v_old := case when p_meter = 'coins' then u.coins else u.points end;
  if v_old = p_points then return v_old; end if;
  return public._change_meter(p_user, p_meter, p_points - v_old, 'admin',
    coalesce(nullif(trim(p_reason), ''), 'ตั้งค่าใหม่โดยผู้ดูแล'), null, null, auth.uid());
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

-- รีเซ็ตความประพฤติทุกคนกลับเป็นค่าเริ่มต้น + ยกเลิกการระงับ (เหรียญไม่แตะ) — คืนจำนวนคนที่ถูกเปลี่ยน
create or replace function public.admin_reset_all_points(p_reason text default '')
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_start int := public._starting_points(); v_count int := 0;
begin
  perform public._require_admin();
  insert into public.user_points (user_id, points)
    select u.id, v_start from auth.users u
    on conflict (user_id) do nothing;
  for r in select up.user_id, up.points, up.suspended_until from public.user_points up
            where up.points <> v_start or up.suspended_until is not null loop
    update public.user_points set suspended_until = null where user_id = r.user_id;
    if r.points <> v_start then
      perform public._change_meter(r.user_id, 'standing', v_start - r.points, 'admin',
        coalesce(nullif(trim(p_reason), ''), 'รีเซ็ตความประพฤติทุกคน'), null, null, auth.uid());
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.admin_get_logs(p_limit int default 200, p_source text default null)
returns table (id bigint, created_at timestamptz, user_id uuid, full_name text, email text, meter text,
               delta int, balance_after int, source text, reason text, device_id text, seat_id text,
               actor_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
    select l.id, l.created_at, l.user_id,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           u.email::text, l.meter, l.delta, l.balance_after, l.source, l.reason, l.device_id, l.seat_id,
           nullif(trim(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, '')), '')
    from public.user_point_logs l
    left join auth.users u      on u.id = l.user_id
    left join public.profiles p  on p.id = l.user_id
    left join public.profiles ap on ap.id = l.actor_id
    where p_source is null or l.source = p_source
    order by l.created_at desc, l.id desc
    limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

create or replace function public.admin_get_settings()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.point_settings;
begin
  perform public._require_admin();
  select * into s from public.point_settings where id = 1;
  return public._settings_json(s);
end $$;

-- บันทึกการตั้งค่า (ส่งเฉพาะช่องที่จะเปลี่ยนก็ได้ ชื่อช่องแบบเดียวกับ admin_get_settings)
create or replace function public.admin_update_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.point_settings;
begin
  perform public._require_admin();
  select * into s from public.point_settings where id = 1;
  if p ? 'sensorEnabled' and jsonb_typeof(p -> 'sensorEnabled') <> 'boolean' then raise exception 'BAD_AMOUNT'; end if;
  update public.point_settings set
    starting_points  = public._json_int(p, 'startingPoints', s.starting_points, 0, 100),
    noise_penalty    = public._json_int(p, 'noisePenalty', s.noise_penalty, 0, 100),
    penalty_step     = public._json_int(p, 'penaltyStep', s.penalty_step, 0, 100),
    penalty_max      = public._json_int(p, 'penaltyMax', s.penalty_max, 0, 100),
    daily_cap        = public._json_int(p, 'dailyCap', s.daily_cap, 0, 100),
    cooldown_seconds = public._json_int(p, 'cooldownSeconds', s.cooldown_seconds, 0, 86400),
    refund_minutes   = public._json_int(p, 'refundMinutes', s.refund_minutes, 1, 1440),
    refund_percent   = public._json_int(p, 'refundPercent', s.refund_percent, 0, 100),
    session_bonus    = public._json_int(p, 'sessionBonus', s.session_bonus, 0, 100),
    session_coins    = public._json_int(p, 'sessionCoins', s.session_coins, 0, 100000),
    weekly_bonus     = public._json_int(p, 'weeklyBonus', s.weekly_bonus, 0, 100),
    coin_gate        = public._json_int(p, 'coinGate', s.coin_gate, 0, 100),
    suspend_days     = public._json_int(p, 'suspendDays', s.suspend_days, 1, 365),
    sensor_enabled   = coalesce((p ->> 'sensorEnabled')::boolean, s.sensor_enabled),
    updated_at       = now()
  where id = 1
  returning * into s;
  return public._settings_json(s);
end $$;

-- ---------- คำอุทธรณ์ ----------
create or replace function public.admin_list_appeals(p_status text default 'pending')
returns table (id bigint, user_id uuid, full_name text, email text, message text, status text,
               admin_note text, created_at timestamptz, decided_at timestamptz, points int,
               suspended_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
    select a.id, a.user_id,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           u.email::text, a.message, a.status, a.admin_note, a.created_at, a.decided_at,
           up.points, case when up.suspended_until > now() then up.suspended_until end
      from public.standing_appeals a
      left join auth.users u on u.id = a.user_id
      left join public.profiles p on p.id = a.user_id
      left join public.user_points up on up.user_id = a.user_id
     where p_status is null or a.status = p_status
     order by a.created_at desc
     limit 200;
end $$;

-- อนุมัติ = ยกเลิกการระงับทันที + ความประพฤติกลับมาอย่างน้อย 20 / ไม่อนุมัติ = ระงับต่อจนครบกำหนด
create or replace function public.admin_decide_appeal(p_id bigint, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare a public.standing_appeals; v_points int;
begin
  perform public._require_admin();
  select * into a from public.standing_appeals where id = p_id for update;
  if not found or a.status <> 'pending' then raise exception 'NOT_FOUND'; end if;
  update public.standing_appeals
     set status = case when p_approve then 'approved' else 'rejected' end,
         admin_note = coalesce(trim(p_note), ''), decided_at = now(), decided_by = auth.uid()
   where id = p_id;
  if p_approve then
    v_points := public._ensure_points(a.user_id);
    update public.user_points set suspended_until = null where user_id = a.user_id;
    if v_points < 20 then
      perform public._change_meter(a.user_id, 'standing', 20 - v_points, 'admin',
        'อนุมัติคำอุทธรณ์ — ยกเลิกการระงับ', null, null, auth.uid());
    end if;
  end if;
end $$;

-- ---------- คูปอง ----------
create or replace function public.admin_list_coupons(p_limit int default 200)
returns table (id bigint, code text, name text, cost int, status text, created_at timestamptz,
               used_at timestamptz, user_id uuid, full_name text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
    select c.id, c.code, c.name, c.cost, c.status, c.created_at, c.used_at, c.user_id,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), u.email::text
      from public.user_coupons c
      left join auth.users u on u.id = c.user_id
      left join public.profiles p on p.id = c.user_id
     order by c.created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

-- เจ้าหน้าที่กรอกรหัสคูปองที่ผู้ใช้ยื่นมา -> ใช้แล้ว (ใช้ซ้ำไม่ได้)
create or replace function public.admin_use_coupon(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.user_coupons;
begin
  perform public._require_admin();
  select * into c from public.user_coupons where code = upper(trim(p_code)) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.status = 'used' then raise exception 'COUPON_USED'; end if;
  update public.user_coupons set status = 'used', used_at = now() where id = c.id;
  return jsonb_build_object('code', c.code, 'name', c.name);
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
-- 8) หัวใจของเซนเซอร์: บอร์ดส่งมา (เสียงดังตั้งแต่ครั้งที่ 3) -> หักความประพฤติทุกคนในการจองที่นั่งนั้น
--    คืนสถานะเป็น JSON: DEDUCTED / DAILY_CAP / NO_BOOKING / COOLDOWN / SENSOR_OFF / DEVICE_DISABLED / NO_PENALTY
-- ------------------------------------------------------------
create or replace function public._apply_noise(p_device_id text, p_level int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s       public.point_settings;
  d       public.noise_devices;
  b       public.seat_bookings;
  v_now   timestamp := public._bkk_now();
  v_uid   uuid;
  v_amt   int;
  v_count int := 0;
  v_min   int;
  v_max   int := 0;
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

  -- ช่วงพัก: บอร์ดส่งซ้ำรัว ๆ ไม่ให้ถูกหักซ้ำ
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

  -- ทุกคนในการจองนั้น: คนจอง + เพื่อนที่เข้าร่วมด้วย QR/รหัส
  for v_uid in
    select b.user_id
    union
    select m.user_id from public.seat_booking_members m where m.booking_id = b.id
  loop
    perform public._settle_user(v_uid);
    v_amt := public._next_penalty(v_uid);
    -- การจองนี้ = ไม่เงียบ (ไม่ได้รางวัลจบการจอง) + สถิติเงียบติดต่อกันกลับเป็น 0
    insert into public.user_sessions (booking_id, user_id, session_date, ends_at, noisy)
    values (b.id, v_uid, b.booking_date, b.booking_date + b.end_time, true)
    on conflict (booking_id, user_id) do update set noisy = true;
    update public.user_points set streak = 0, last_violation_at = now() where user_id = v_uid;
    if v_amt > 0 then
      perform public._change_meter(v_uid, 'standing', -v_amt, 'sensor', 'เซนเซอร์ตรวจพบเสียงดัง',
                                   d.id, d.seat_id, null, b.id);
    end if;
    v_count := v_count + 1;
    v_min := least(coalesce(v_min, v_amt), v_amt);
    v_max := greatest(v_max, v_amt);
  end loop;

  update public.noise_devices set last_penalty_at = now() where id = d.id;
  -- เก็บไว้ให้จอทีวี (ตามองไปที่โต๊ะนี้ + นับสถิติ)
  insert into public.noise_events (zone_id, seat_id, device_id, level) values (d.zone_id, d.seat_id, d.id, p_level);
  if v_max = 0 then  -- ทุกคนโดนหักครบยอดสูงสุดของวันแล้ว
    return jsonb_build_object('ok', true, 'status', 'DAILY_CAP', 'users', v_count);
  end if;
  return jsonb_build_object('ok', true, 'status', 'DEDUCTED', 'users', v_count,
                            'penalty', v_max, 'penalty_min', v_min);
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

-- ESP32 เรียกทุก 30 วินาที: บอกว่ายังออนไลน์ + ถามว่าตอนนี้ที่นั่งนี้มีการจองอยู่ไหม
--   (+ สรุปคะแนนของคนที่นั่งอยู่ เช่นคืน 50% เมื่อเงียบครบ 10 นาที)
create or replace function public.device_heartbeat(p_device text, p_key text, p_level int default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  d     public.noise_devices;
  s     public.point_settings;
  b     public.seat_bookings;
  v_now timestamp := public._bkk_now();
  v_uid uuid;
  v_pen int;
begin
  select * into d from public.noise_devices where id = p_device;
  if not found or p_key is null or crypt(p_key, d.key_hash) <> d.key_hash then
    raise exception 'BAD_DEVICE';
  end if;
  update public.noise_devices
     set last_seen_at = now(), last_level = coalesce(p_level, last_level)
   where id = p_device;
  select * into s from public.point_settings where id = 1;

  select * into b from public.seat_bookings sb
   where sb.zone_id = d.zone_id and sb.seat_id = d.seat_id
     and sb.booking_date + sb.start_time <= v_now
     and v_now < sb.booking_date + sb.end_time
   order by sb.start_time
   limit 1;

  if b.id is not null then
    for v_uid in
      select b.user_id union select m.user_id from public.seat_booking_members m where m.booking_id = b.id
    loop
      perform public._settle_user(v_uid);
    end loop;
    v_pen := public._next_penalty(b.user_id);  -- ครั้งถัดไปจะหักเท่าไร (จอบอร์ดขึ้น -xPT)
  end if;

  return jsonb_build_object(
    'ok', true,
    'active', d.active,
    'sensor_enabled', s.sensor_enabled,
    'penalty', coalesce(v_pen, s.noise_penalty),
    'seat', d.seat_id,
    'booking', case when b.id is null then null else jsonb_build_object(
      'id', b.id,
      'start', to_char(b.start_time, 'HH24:MI'),
      'end', to_char(b.end_time, 'HH24:MI'),
      'ends_in', floor(extract(epoch from ((b.booking_date + b.end_time) - v_now)))::int,
      'people', 1 + (select count(*) from public.seat_booking_members m where m.booking_id = b.id)
    ) end
  );
end $$;

-- จอทีวีในโซน (เปิดได้โดยไม่ต้องล็อกอิน) — คืนแค่ "โต๊ะไหน/เมื่อไร/กี่ครั้ง" ไม่มีชื่อหรือข้อมูลของผู้ใช้
--   recent = เสียงดังใน 2 นาทีล่าสุด (ตามองไปที่โต๊ะนั้น), today / yesterday / yesterdaySoFar = สถิติแข่งกับเมื่อวาน
create or replace function public.get_tv_state(p_zone text default 'quiet')
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_now   timestamp := public._bkk_now();
  v_today date := public._bkk_now()::date;
begin
  return jsonb_build_object(
    'now', now(),
    'today', (select count(*) from public.noise_events e
               where e.zone_id = p_zone and (e.created_at at time zone 'Asia/Bangkok')::date = v_today),
    'yesterday', (select count(*) from public.noise_events e
                   where e.zone_id = p_zone and (e.created_at at time zone 'Asia/Bangkok')::date = v_today - 1),
    -- เมื่อวาน "ถึงเวลาเดียวกับตอนนี้" (เทียบกันแฟร์ ๆ ระหว่างวัน)
    'yesterdaySoFar', (select count(*) from public.noise_events e
                        where e.zone_id = p_zone and (e.created_at at time zone 'Asia/Bangkok')::date = v_today - 1
                          and (e.created_at at time zone 'Asia/Bangkok')::time <= v_now::time),
    'hoursToday', (select jsonb_agg(coalesce(x.n, 0) order by h.h)
                     from generate_series(0, 23) h(h)
                     left join (select extract(hour from e.created_at at time zone 'Asia/Bangkok')::int hr, count(*)::int n
                                  from public.noise_events e
                                 where e.zone_id = p_zone and (e.created_at at time zone 'Asia/Bangkok')::date = v_today
                                 group by 1) x on x.hr = h.h),
    'hoursYesterday', (select jsonb_agg(coalesce(x.n, 0) order by h.h)
                         from generate_series(0, 23) h(h)
                         left join (select extract(hour from e.created_at at time zone 'Asia/Bangkok')::int hr, count(*)::int n
                                      from public.noise_events e
                                     where e.zone_id = p_zone and (e.created_at at time zone 'Asia/Bangkok')::date = v_today - 1
                                     group by 1) x on x.hr = h.h),
    'days', (select jsonb_agg(jsonb_build_object('date', to_char(g.d, 'YYYY-MM-DD'), 'count',
                                (select count(*) from public.noise_events e
                                  where e.zone_id = p_zone and (e.created_at at time zone 'Asia/Bangkok')::date = g.d::date))
                              order by g.d)
               from generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day') g(d)),
    'lastEventAt', (select max(e.created_at) from public.noise_events e where e.zone_id = p_zone),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'seatId', e.seat_id, 'at', e.created_at,
                                                            'level', e.level) order by e.created_at desc, e.id desc), '[]'::jsonb)
                 from public.noise_events e
                where e.zone_id = p_zone and e.created_at > now() - interval '2 minutes'),
    'sensorSeats', (select coalesce(jsonb_agg(distinct d.seat_id), '[]'::jsonb)
                      from public.noise_devices d where d.zone_id = p_zone and d.active),
    'bookedNow', (select count(*) from public.seat_bookings b
                   where b.zone_id = p_zone and b.booking_date + b.start_time <= v_now
                     and v_now < b.booking_date + b.end_time)
  );
end $$;

-- ผู้ดูแลกด "จำลองเสียงดัง" จากหน้าเว็บ — ใช้ทดสอบระบบก่อนมีบอร์ดจริง
create or replace function public.admin_simulate_noise(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  return public._apply_noise(p_id, null);
end $$;

-- ------------------------------------------------------------
-- 9) สิทธิ์การเรียกฟังก์ชัน
-- ------------------------------------------------------------
-- ตัวช่วยภายใน: ห้ามใครเรียกจากภายนอก
do $$
declare f text;
begin
  foreach f in array array[
    '_require_admin()', '_starting_points()', '_bkk_now()', '_level(integer, timestamptz)',
    '_streak_bonus(integer)', '_ensure_points(uuid)',
    '_change_meter(uuid, text, integer, text, text, text, text, uuid, uuid)',
    '_next_penalty(uuid)', '_settle_user(uuid)', '_booking_restriction(uuid, text)',
    '_settings_json(point_settings)', '_json_int(jsonb, text, integer, integer, integer)',
    '_apply_noise(text, integer)', 'handle_new_user_points()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ผู้ใช้ที่ล็อกอิน + ผู้ดูแล (ฟังก์ชันผู้ดูแลเช็คสิทธิ์ข้างในอีกชั้น)
do $$
declare f text;
begin
  foreach f in array array[
    'is_admin()', 'get_my_points()', 'get_my_rewards()', 'check_in(uuid)', 'redeem_coupon(text)',
    'submit_appeal(text)',
    'admin_list_users(text)', 'admin_adjust_points(uuid, integer, text, text)',
    'admin_set_points(uuid, integer, text, text)', 'admin_set_admin(uuid, boolean)',
    'admin_reset_all_points(text)', 'admin_get_logs(integer, text)',
    'admin_get_settings()', 'admin_update_settings(jsonb)',
    'admin_list_appeals(text)', 'admin_decide_appeal(bigint, boolean, text)',
    'admin_list_coupons(integer)', 'admin_use_coupon(text)',
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

-- จอทีวี (ไม่ต้องล็อกอิน — ข้อมูลเป็นแค่จำนวนครั้ง/ตำแหน่งโต๊ะ)
revoke all on function public.get_tv_state(text) from public;
grant execute on function public.get_tv_state(text) to anon, authenticated;

-- ============================================================
--  ตั้ง "ผู้ดูแลคนแรก" — เปลี่ยนอีเมลเป็นบัญชีที่ใช้ล็อกอินเว็บ แล้วลบ -- หน้าบรรทัดล่างออกก่อนรัน
--  (ผู้ดูแลคนต่อ ๆ ไป กดตั้งให้ได้จากหน้าผู้ดูแล > ผู้ใช้ & คะแนน > ปรับ… > ตั้งเป็นผู้ดูแล)
-- ============================================================
-- insert into public.admins (user_id) select id from auth.users where email = 'อีเมลของคุณ@example.com' on conflict do nothing;
