# AGENTS.md — คู่มือสำหรับ AI agent (Codex / Claude Code ฯลฯ) ที่จะแก้โปรเจกต์นี้

อ่านไฟล์นี้ก่อนแก้โค้ดทุกครั้ง
**ภาษา: คุยกับเจ้าของโปรเจกต์เป็นภาษาไทย** (เป็นนักศึกษาฝึกงาน อธิบายแบบเข้าใจง่าย)

---

## 1. โปรเจกต์นี้คืออะไร

ระบบจองที่นั่งในห้องสมุด — **เวอร์ชัน 2 สร้างใหม่ กำลังทำทีละส่วน**
(เวอร์ชันเก่าอยู่คนละ repo คือ `sirapobsak/library-booking` — คนละโปรเจกต์ อย่าเอามาปนกัน)

- **Stack:** React 18 + Vite 5 + Tailwind CSS 3 + React Router 6 (HashRouter) + lucide-react
- **Backend:** Supabase (Auth + Postgres) — มี **โหมดทดลอง** สำรองเมื่อไม่มี key
- **Branch หลัก:** `main`

### ทำเสร็จแล้ว
- หน้าเข้าสู่ระบบ / ลงทะเบียน (อีเมลหรือเบอร์โทร + รหัสผ่าน)
- หน้าเลือกโซน 3 โซน: `e-lecture`, `sofa`, `quiet`
- โซนเงียบ: ผังที่นั่ง SVG 56 จุด กดเลือกได้

### ยังไม่ได้ทำ (งานถัดไป)
- ผังที่นั่งของโซน E-Lecture กับโซนโซฟา
- ระบบจองจริง (เลือกวัน/เวลา + บันทึกลง Supabase + ยกเลิก)
- หน้า "การจองของฉัน"

---

## 2. ทำงานร่วมกันหลายคน/หลาย agent — อ่านก่อน

โปรเจกต์นี้มีทั้ง **Codex** และ **Claude Code** แก้สลับกัน ทำตามนี้เพื่อไม่ให้งานชนกัน

1. **ก่อนเริ่มแก้ทุกครั้ง** — `git pull --rebase origin main` ให้ได้โค้ดล่าสุดก่อนเสมอ
2. **commit ย่อย ๆ** หัวข้อสั้นบอกว่าทำอะไร แล้ว push ทันทีที่งานชิ้นนั้นเสร็จ อย่าดองไว้หลายวัน
3. **แก้เสร็จแล้วอัปเดต README.md ส่วน "สถานะตอนนี้"** ให้ตรงกับของจริง — อีกฝ่ายใช้ตรงนี้ดูว่าทำถึงไหนแล้ว
4. ถ้างานใหญ่/เสี่ยงพัง ให้แยก branch แล้วเปิด PR แทนการ push ตรงเข้า `main`
5. **อย่า force push** เข้า `main`

---

## 3. รันในเครื่อง

```bash
npm install
npm run dev      # http://localhost:5174/library-booking-v2/
npm run build    # ต้องผ่านก่อน push เสมอ
npm run preview  # ดู production build
```

> ไม่มีชุดเทสอัตโนมัติ — ตรวจงานด้วย `npm run build` (ต้องผ่าน) + เปิด `npm run dev` แล้วกดใช้จริง

---

## 4. โหมด Supabase vs โหมดทดลอง (จุดที่ต้องเข้าใจ)

`src/supabase.js` อ่าน env `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`

- **มี key** (ไฟล์ `.env` ในเครื่อง / GitHub Secrets ตอน deploy) → ใช้ Supabase จริง
- **ไม่มี key หรือต่อไม่ติด** → fallback เป็นโหมดทดลอง เก็บผู้ใช้ใน `localStorage`

`.env` **ไม่ได้อยู่ใน git** (อยู่ใน `.gitignore`) — agent ที่ไม่มี key ก็พัฒนาได้ปกติ แอปจะเข้าโหมดทดลองเอง
สมัครสมาชิกในโหมดทดลองแล้วล็อกอินด้วยบัญชีนั้นได้เลย ดูตัวอย่างค่าที่ต้องใส่ได้ที่ `.env.example`

โค้ดใน `src/auth.jsx` ทุกฟังก์ชันมี 2 สาขา (`if (cloud) {...}` แล้วค่อยตกมาโหมดทดลอง)
**แก้แล้วต้องดูแลทั้งสองสาขา**

### ⚠️ กับดักที่เคยทำพัง — ห้ามทำซ้ำ
ห้ามเรียกฟังก์ชัน async ของ Supabase (เช่น query ตาราง `profiles`) **ตรง ๆ** ใน callback ของ
`supabase.auth.onAuthStateChange` เพราะจะทำให้ internal lock ค้าง แล้ว `signOut()` จะไม่ทำงาน
(กดปุ่มออกจากระบบแล้วเงียบ) — ต้องห่อด้วย `setTimeout(..., 0)` เหมือนที่ทำไว้ใน `src/auth.jsx`

---

## 5. โครงสร้างไฟล์

```
src/
├─ main.jsx                    จุดเริ่ม + HashRouter + AuthProvider
├─ App.jsx                     routes ทั้งหมด (ยังไม่ล็อกอิน -> /login)
├─ auth.jsx                    ⭐ ระบบสมาชิก: สมัคร / ล็อกอิน / ออกจากระบบ (dual-mode)
├─ supabase.js                 สร้าง client + ping/เช็ค network
├─ data.js                     ⭐ ข้อมูล 3 โซน (id, ชื่อ, คำอธิบาย, ไอคอน, สี)
├─ layouts/
│  └─ quietZone.js             ⭐ พิกัดที่นั่งทุกจุดของโซนเงียบ (viewBox 1656x1242)
├─ components/
│  ├─ Header.jsx               แถบบน (ชื่อผู้ใช้ + ออกจากระบบ)
│  └─ QuietFloorPlan.jsx       ผังโซนเงียบ: <Structure/> = เส้นอาคาร, ที่นั่ง = rect เขียวกดได้
└─ pages/
   ├─ AuthPage.jsx             เข้าสู่ระบบ + ลงทะเบียน (ตรวจข้อมูลครบทุกช่อง)
   ├─ Zones.jsx                หน้าเลือกโซน (หน้าแรกหลังล็อกอิน)
   └─ ZonePage.jsx             /zone/:zoneId — โซนเงียบโชว์ผัง โซนอื่นเป็น placeholder
supabase/
└─ schema.sql                  SQL สร้างตาราง profiles + trigger + get_email_by_phone
```

### จุดที่ต้องรู้ก่อนแก้ผังที่นั่ง
- **ตำแหน่ง/จำนวนที่นั่ง** แก้ที่ `src/layouts/quietZone.js` ไฟล์เดียว หน้าเว็บอัปเดตตามเอง
  - `CARRELS` C01–C09 (โต๊ะมีฉากกั้น 3×3), `TABLE_SEATS` T01–T16, `DESKS` D01–D28, `ROOMS` R1–R3
- **เส้นโครงสร้างอาคาร** (ผนัง บันได ชั้นหนังสือ คาเฟ่ บันไดเลื่อน) อยู่ในฟังก์ชัน `Structure()`
  ท้ายไฟล์ `QuietFloorPlan.jsx` แบ่งเป็นบล็อกตามส่วนของอาคาร มีคอมเมนต์กำกับ
- ผังวาดตามรูปแปลนที่เจ้าของโปรเจกต์ส่งมา (ไม่มีไฟล์ต้นฉบับใน repo) — ถ้าแก้ให้เทียบกับรูปที่เขาส่ง

### เพิ่มโซนใหม่ / เพิ่มผังให้โซนอื่น
1. เพิ่ม object ใน `ZONES` ที่ `src/data.js` (ต้องมีสีใน `ACCENT` ด้วย — Tailwind ต้องเห็นชื่อคลาสเต็ม ๆ)
2. สร้างไฟล์พิกัดใน `src/layouts/` แล้วสร้าง component ผังใน `src/components/`
3. ต่อใน `ZonePage.jsx` (ตอนนี้เช็คด้วย `zone.id === 'quiet'`)

---

## 6. สไตล์โค้ดที่ใช้ในโปรเจกต์นี้

- **คอมเมนต์เป็นภาษาไทย** อธิบายว่า "ทำไม" ไม่ใช่แค่ "ทำอะไร" — เจ้าของโปรเจกต์กำลังเรียนอยู่
- ข้อความบนหน้าเว็บทั้งหมดเป็นภาษาไทย รวมถึงข้อความ error (ดูฟังก์ชัน `translateError` ใน `auth.jsx`)
- Tailwind อย่างเดียว ไม่เขียนไฟล์ CSS แยก (มี utility class รวมอยู่ใน `src/index.css` แล้ว: `.field`, `.label`, `.btn-primary`)
- เขียนให้อ่านง่ายไว้ก่อน อย่าใส่ abstraction ที่ยังไม่จำเป็น
- ไม่เพิ่ม dependency ใหม่ถ้าไม่จำเป็นจริง ๆ

---

## 7. Deploy

push ขึ้น `main` แล้ว GitHub Actions (`.github/workflows/deploy.yml`) จะ build + deploy ขึ้น
GitHub Pages ให้เอง ภายใน 1–2 นาที

ค่า Supabase อ่านจาก GitHub Secrets (`Settings > Secrets and variables > Actions`):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — ถ้าไม่ตั้ง เว็บจะขึ้นเป็นโหมดทดลองอัตโนมัติ (ไม่พัง)

**ห้าม commit ไฟล์ `.env` หรือ key ใด ๆ ลง repo**
