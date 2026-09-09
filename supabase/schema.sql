-- ============================================================
--  ระบบจองห้องสมุด (v2) — ส่วนของสมาชิก/ล็อกอิน
--  วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run
--  (รันซ้ำได้ปลอดภัย)
-- ============================================================

-- ตารางเก็บข้อมูลผู้ใช้เพิ่มเติม (ผูกกับ auth.users ที่ Supabase สร้างให้ตอนสมัคร)
-- หมายเหตุ: อีเมล + รหัสผ่าน Supabase เก็บให้เองในตาราง auth.users
--          (รหัสผ่านถูกเข้ารหัสไว้ เราไม่ต้องเก็บเอง และไม่ควรเก็บเอง)
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  first_name   text not null default '',   -- ชื่อ
  last_name    text not null default '',   -- นามสกุล
  phone_number text not null default '',   -- เบอร์โทรศัพท์
  email        text,                       -- อีเมล (คัดลอกมาไว้ให้ query ง่าย)
  created_at   timestamptz not null default now()
);

-- ห้ามเบอร์โทรซ้ำกัน (ยกเว้นค่าว่าง) เพราะใช้ล็อกอินได้
create unique index if not exists profiles_phone_unique
  on public.profiles (phone_number) where phone_number <> '';

-- ------------------------------------------------------------
-- RLS: แต่ละคนเห็น/แก้ได้เฉพาะโปรไฟล์ของตัวเอง
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ------------------------------------------------------------
-- สมัครสมาชิกแล้วสร้างแถวใน profiles ให้อัตโนมัติ
-- (ดึงชื่อ/นามสกุล/เบอร์ ที่ส่งมาตอน signUp จาก raw_user_meta_data)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, phone_number, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone_number', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- ล็อกอินด้วยเบอร์โทร: แปลงเบอร์ -> อีเมล ก่อนส่งให้ Supabase Auth
-- (security definer เพื่อให้คนที่ยังไม่ล็อกอินเรียกได้ แต่คืนแค่อีเมลของเบอร์นั้น)
-- ------------------------------------------------------------
create or replace function public.get_email_by_phone(p_phone text)
returns text language sql security definer set search_path = public stable as $$
  select email from public.profiles
  where phone_number = regexp_replace(p_phone, '[^0-9]', '', 'g')
  limit 1;
$$;

grant execute on function public.get_email_by_phone(text) to anon, authenticated;
