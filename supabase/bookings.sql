-- ============================================================
--  ระบบจองที่นั่ง + เข้าร่วมโต๊ะด้วย QR / รหัส 6 หลัก (library-booking-v2)
--
--  วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run
--  ต้องรัน schema.sql ก่อน (ใช้ตาราง profiles) — ไฟล์นี้รันซ้ำได้ปลอดภัย
--
--  หลักการ:
--   - คนจอง 1 คน สร้างการจอง 1 แถว พร้อมระบุจำนวนคน (party_size รวมตัวเอง)
--   - ถ้าจองหลายคน ระบบสร้าง join_code 6 หลัก -> ทำเป็น QR ให้เพื่อนสแกน
--   - เพื่อนแต่ละคนเข้าร่วมด้วยบัญชีตัวเอง -> เพิ่มแถวใน seat_booking_members
-- ============================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist; -- ใช้ทำ EXCLUDE กันจองเวลาทับกัน

-- ------------------------------------------------------------
-- 1) ตารางการจอง
-- ------------------------------------------------------------
create table if not exists public.seat_bookings (
  id           uuid primary key default gen_random_uuid(),
  zone_id      text not null,                                          -- เช่น 'quiet'
  seat_id      text not null,                                          -- เช่น 'D14', 'R2'
  user_id      uuid not null references auth.users (id) on delete cascade, -- คนจอง
  owner_name   text not null default '',
  booking_date date not null,
  start_time   time not null,
  end_time     time not null,
  party_size   int  not null default 1 check (party_size between 1 and 10), -- รวมคนจอง
  join_code    text unique check (join_code ~ '^[0-9]{6}$'),            -- มีเฉพาะการจองหลายคน
  created_at   timestamptz not null default now(),

  constraint seat_bookings_time_order check (end_time > start_time),

  -- กันจองซ้อน: ที่นั่งเดียวกัน วันเดียวกัน ช่วงเวลาห้ามทับกัน
  constraint seat_bookings_no_overlap exclude using gist (
    zone_id with =,
    seat_id with =,
    tsrange(booking_date + start_time, booking_date + end_time) with &&
  )
);

create index if not exists seat_bookings_zone_date on public.seat_bookings (zone_id, booking_date);

-- ------------------------------------------------------------
-- 2) คนที่สแกน/กรอกรหัสเข้าร่วม (ไม่รวมคนจอง)
-- ------------------------------------------------------------
create table if not exists public.seat_booking_members (
  booking_id  uuid not null references public.seat_bookings (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  member_name text not null default '',
  joined_at   timestamptz not null default now(),
  primary key (booking_id, user_id)
);

-- ------------------------------------------------------------
-- 3) สิทธิ์ (RLS) — ต้องล็อกอินเท่านั้น
--    * ดูรายละเอียด/รหัสได้เฉพาะคนจองกับคนที่เข้าร่วมแล้ว
--    * การสร้างการจอง/เข้าร่วม ทำผ่านฟังก์ชันด้านล่างเท่านั้น (insert ตรง ๆ ไม่ได้)
--    * ยกเลิกได้เฉพาะคนจอง
-- ------------------------------------------------------------
alter table public.seat_bookings enable row level security;
alter table public.seat_booking_members enable row level security;

-- ตัวช่วยเช็คสิทธิ์ (security definer = อ่านข้ามสิทธิ์ได้ กันนโยบายวนเรียกกันเอง)
create or replace function public.is_booking_member(p_booking uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from seat_booking_members where booking_id = p_booking and user_id = auth.uid()
  );
$$;

create or replace function public.is_booking_owner(p_booking uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from seat_bookings where id = p_booking and user_id = auth.uid());
$$;

drop policy if exists "owner or member reads booking" on public.seat_bookings;
create policy "owner or member reads booking" on public.seat_bookings
  for select to authenticated
  using (user_id = auth.uid() or public.is_booking_member(id));

drop policy if exists "owner cancels booking" on public.seat_bookings;
create policy "owner cancels booking" on public.seat_bookings
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "owner or self reads members" on public.seat_booking_members;
create policy "owner or self reads members" on public.seat_booking_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_booking_owner(booking_id));

-- ------------------------------------------------------------
-- 4) ฟังก์ชันที่หน้าเว็บเรียกใช้ (RPC)
-- ------------------------------------------------------------

-- 4.1 การจองทั้งหมดของโซนในวันนั้น (ใช้ระบายสีแดงบนผัง) — ไม่ส่งรหัส/ชื่อคนออกไป
create or replace function public.get_zone_bookings(p_zone text, p_date date)
returns table (
  id uuid, seat_id text, start_time time, end_time time, party_size int,
  member_count int, is_mine boolean, is_member boolean
)
language sql security definer set search_path = public stable as $$
  select b.id, b.seat_id, b.start_time, b.end_time, b.party_size,
         (select count(*)::int from seat_booking_members m where m.booking_id = b.id),
         b.user_id = auth.uid(),
         exists (select 1 from seat_booking_members m where m.booking_id = b.id and m.user_id = auth.uid())
  from seat_bookings b
  where b.zone_id = p_zone and b.booking_date = p_date and auth.uid() is not null
  order by b.start_time;
$$;

-- 4.2 จองที่นั่ง — จองหลายคนจะได้รหัส 6 หลักที่ไม่ซ้ำ
create or replace function public.create_booking(
  p_zone text, p_seat text, p_date date, p_start time, p_end time, p_party int
)
returns public.seat_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_code text;
  v_row  public.seat_bookings;
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;
  if p_party is null or p_party < 1 or p_party > 10 then raise exception 'BAD_PARTY'; end if;
  if p_end <= p_start then raise exception 'BAD_TIME'; end if;
  -- กันจองย้อนหลัง (เทียบกับเวลาไทย เพราะวัน/เวลาที่ส่งมาเป็นเวลาไทย)
  if (p_date + p_end) <= (now() at time zone 'Asia/Bangkok') then raise exception 'PAST'; end if;

  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    into v_name from profiles where id = v_uid;

  if p_party > 1 then
    loop
      v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from seat_bookings where join_code = v_code);
    end loop;
  end if;

  insert into seat_bookings
    (zone_id, seat_id, user_id, owner_name, booking_date, start_time, end_time, party_size, join_code)
  values
    (p_zone, p_seat, v_uid, coalesce(v_name, ''), p_date, p_start, p_end, p_party, v_code)
  returning * into v_row;

  return v_row;
exception
  when exclusion_violation then raise exception 'OVERLAP';
end $$;

-- 4.3 ดูการจองจากรหัส (หน้าเข้าร่วม ก่อนกดยืนยัน)
create or replace function public.get_booking_by_code(p_code text)
returns table (
  id uuid, zone_id text, seat_id text, booking_date date, start_time time, end_time time,
  party_size int, owner_name text, member_count int, is_owner boolean, is_member boolean
)
language sql security definer set search_path = public stable as $$
  select b.id, b.zone_id, b.seat_id, b.booking_date, b.start_time, b.end_time,
         b.party_size, b.owner_name,
         (select count(*)::int from seat_booking_members m where m.booking_id = b.id),
         b.user_id = auth.uid(),
         exists (select 1 from seat_booking_members m where m.booking_id = b.id and m.user_id = auth.uid())
  from seat_bookings b
  where b.join_code = p_code and auth.uid() is not null;
$$;

-- 4.4 เข้าร่วมโต๊ะด้วยบัญชีของตัวเอง
create or replace function public.join_booking(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_count int;
  b       public.seat_bookings;
begin
  if v_uid is null then raise exception 'NOT_LOGGED_IN'; end if;

  -- for update = ล็อกแถวไว้ กันสองคนกดเข้าร่วมพร้อมกันจนเกินจำนวน
  select * into b from seat_bookings where join_code = p_code for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.user_id = v_uid then raise exception 'OWNER'; end if;
  if exists (select 1 from seat_booking_members where booking_id = b.id and user_id = v_uid) then
    raise exception 'ALREADY_JOINED';
  end if;
  if (b.booking_date + b.end_time) <= (now() at time zone 'Asia/Bangkok') then
    raise exception 'EXPIRED';
  end if;

  select count(*) into v_count from seat_booking_members where booking_id = b.id;
  if v_count + 1 >= b.party_size then raise exception 'FULL'; end if; -- +1 = คนจอง

  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    into v_name from profiles where id = v_uid;

  insert into seat_booking_members (booking_id, user_id, member_name)
  values (b.id, v_uid, coalesce(v_name, ''));

  return b.id;
end $$;

-- ------------------------------------------------------------
-- 5) ให้เฉพาะผู้ที่ล็อกอินแล้วเรียกฟังก์ชันได้
-- ------------------------------------------------------------
revoke all on function public.is_booking_member(uuid) from public, anon;
revoke all on function public.is_booking_owner(uuid) from public, anon;
revoke all on function public.get_zone_bookings(text, date) from public, anon;
revoke all on function public.create_booking(text, text, date, time, time, int) from public, anon;
revoke all on function public.get_booking_by_code(text) from public, anon;
revoke all on function public.join_booking(text) from public, anon;

grant execute on function public.is_booking_member(uuid) to authenticated;
grant execute on function public.is_booking_owner(uuid) to authenticated;
grant execute on function public.get_zone_bookings(text, date) to authenticated;
grant execute on function public.create_booking(text, text, date, time, time, int) to authenticated;
grant execute on function public.get_booking_by_code(text) to authenticated;
grant execute on function public.join_booking(text) to authenticated;
