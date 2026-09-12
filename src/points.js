import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth.jsx'
import { supabase } from './supabase.js'
import * as E from './rewardsEngine.js'

// ============================================================
//  ระบบคะแนน 2 มิเตอร์ — ความประพฤติ (Standing) + เหรียญรางวัล (Coins)
//  เซนเซอร์เสียง (ESP32) ตรวจพบเสียงดัง -> หักความประพฤติ / ใช้โต๊ะแบบเงียบ -> ได้คืน + ได้เหรียญ
//
//  - ออนไลน์ (มี Supabase): ทุกอย่างผ่านฟังก์ชันใน supabase/points.sql
//  - โหมดทดลอง (ไม่มี Supabase): เก็บใน localStorage ใช้กติกาจาก rewardsEngine.js (เหมือน SQL ทุกข้อ)
//      และ "ทุกบัญชีเป็นผู้ดูแล" เพื่อให้ลองได้ทุกหน้า (เปิดด้วย npm run dev:mock)
// ============================================================

export { DEFAULT_SETTINGS, LEVELS, STREAK_MILESTONES, levelOf, nextMilestone, streakBonus } from './rewardsEngine.js'

const KEY = 'lb2_points_v1'
const CHANGE_EVENT = 'lb2-points-changed' // บอกทุกคอมโพเนนต์ (เช่นป้ายบน Header) ให้โหลดใหม่
const BOOKINGS_KEY = 'lb2_bookings_v2' // การจองในโหมดทดลอง (จาก bookings.js)
const BOOKINGS_EVENT = 'lb2-bookings-changed'
const MOCK_USERS_KEY = 'lb2_mock_users' // บัญชีโหมดทดลองจาก auth.jsx

const notify = () => window.dispatchEvent(new Event(CHANGE_EVENT))

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

// ---------- ข้อความ error ภาษาไทย (key ตรงกับที่ SQL raise exception) ----------
// NOT_SUSPENDED ต้องอยู่ก่อน SUSPENDED (หาแบบ "มีคำนี้อยู่ในข้อความ")
const ERR = {
  NOT_LOGGED_IN: 'กรุณาเข้าสู่ระบบก่อน',
  NOT_ADMIN: 'ต้องเป็นผู้ดูแลระบบเท่านั้น',
  SELF_ADMIN: 'ถอนสิทธิ์ผู้ดูแลของตัวเองไม่ได้',
  BAD_AMOUNT: 'จำนวนไม่ถูกต้อง (ต้องเป็นจำนวนเต็มในช่วงที่กำหนด)',
  BAD_SEAT: 'กรุณาเลือกที่นั่งของอุปกรณ์',
  BAD_DEVICE: 'รหัสอุปกรณ์หรือคีย์ไม่ถูกต้อง',
  NOT_MEMBER: 'คุณไม่ได้อยู่ในการจองนี้',
  TOO_EARLY: 'ยังไม่ถึงเวลา — เช็คอินได้ตั้งแต่ 15 นาทีก่อนเวลาเริ่ม',
  EXPIRED: 'การจองนี้จบไปแล้ว',
  NOT_SUSPENDED: 'ยื่นอุทธรณ์ได้เฉพาะตอนถูกระงับการเข้าใช้',
  SUSPENDED: 'บัญชีถูกระงับการเข้าใช้ชั่วคราว',
  NOT_ENOUGH_COINS: 'เหรียญไม่พอแลกคูปองนี้',
  BAD_MESSAGE: 'เขียนเหตุผลอย่างน้อย 5 ตัวอักษร (ไม่เกิน 500)',
  APPEAL_PENDING: 'มีคำอุทธรณ์รอผู้ดูแลพิจารณาอยู่แล้ว',
  COUPON_USED: 'คูปองนี้ถูกใช้ไปแล้ว',
  NOT_FOUND: 'ไม่พบข้อมูล (อาจถูกลบไปแล้ว)',
}

function errorMessage(error) {
  const msg = error?.message || ''
  const key = Object.keys(ERR).find((k) => msg === k || msg.includes(k))
  if (key) return ERR[key]
  if (msg.toLowerCase().includes('failed to fetch')) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง'
  return msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
}

// Supabase ตอบว่า "ไม่มีฟังก์ชัน/ตารางนี้" = ยังไม่ได้รัน points.sql (เวอร์ชันล่าสุด)
function isMissingBackend(error) {
  if (!error) return false
  return (
    ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code) ||
    /could not find the (function|table)/i.test(error.message || '')
  )
}

// ผลการตรวจพบเสียง (จาก ESP32 หรือปุ่มจำลอง) -> ข้อความภาษาไทย
export function noiseStatusText(r) {
  switch (r?.status) {
    case 'DEDUCTED': {
      const each = r.penalty_min != null && r.penalty_min !== r.penalty ? `${r.penalty_min}–${r.penalty}` : r.penalty
      return `หักคะแนนความประพฤติแล้ว ${r.users} คน คนละ ${each} คะแนน`
    }
    case 'DAILY_CAP':
      return 'ทุกคนในโต๊ะนี้โดนหักครบยอดสูงสุดของวันนี้แล้ว — ไม่หักเพิ่ม (สถิติเงียบกลับเป็น 0)'
    case 'NO_BOOKING':
      return 'ตอนนี้ไม่มีใครจองที่นั่งนี้อยู่ — ไม่หักคะแนน'
    case 'COOLDOWN':
      return `เพิ่งหักไปเมื่อไม่นาน รออีก ${r.retry_in} วินาทีถึงจะหักได้อีก`
    case 'SENSOR_OFF':
      return 'ปิดการหักคะแนนจากเซนเซอร์อยู่ (เปิดได้ที่แท็บตั้งค่า)'
    case 'DEVICE_DISABLED':
      return 'อุปกรณ์นี้ถูกตัดการเชื่อมต่ออยู่'
    case 'NO_PENALTY':
      return 'ตั้งค่าหักครั้งแรกเป็น 0 อยู่ — ไม่หักคะแนน'
    default:
      return r?.status ?? 'ไม่ทราบผล'
  }
}

// ============================================================
//  โหมดทดลอง (localStorage)
// ============================================================
const readLocal = () => E.normalize(readJson(KEY, {}))
const localBookings = () => readJson(BOOKINGS_KEY, [])

// เขียนกลับเฉพาะตอนข้อมูลเปลี่ยนจริง (กันโหลดใหม่วนไม่จบ: เขียน -> แจ้ง -> โหลด -> เขียน ...)
function saveIfChanged(d) {
  const next = JSON.stringify(d)
  if (localStorage.getItem(KEY) === next) return
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* เบราว์เซอร์ไม่ให้เก็บ (เช่นโหมดส่วนตัว) */
  }
  notify()
}

// อ่าน -> ทำงาน -> เขียนกลับ แล้วห่อผลเป็น { ok, data } / { ok: false, message }
function runLocal(fn) {
  try {
    const d = readLocal()
    const data = fn(d, localBookings(), Date.now())
    saveIfChanged(d)
    return { ok: true, data }
  } catch (e) {
    return { ok: false, message: errorMessage(e) }
  }
}

// bookings.js เรียกก่อนจอง/เข้าร่วมโต๊ะในโหมดทดลอง -> คืน 'SUSPENDED' / 'RESTRICTED_ROOM' / null
export function localBookingRestriction(userId, seatId) {
  const r = runLocal((d, bookings, now) => E.bookingRestriction(d, userId, seatId, bookings, now))
  return r.ok ? r.data : null
}

// โหลดใหม่เมื่อ: เปิดหน้า, ทุก 15 วิ (เซนเซอร์หักได้ตลอด), กลับมาที่แท็บ, ข้อมูลคะแนน/การจองเปลี่ยน
function useAutoRefresh(refresh) {
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15000)
    const onChange = () => refresh()
    const events = ['focus', CHANGE_EVENT, BOOKINGS_EVENT, 'storage']
    events.forEach((e) => window.addEventListener(e, onChange))
    return () => {
      clearInterval(timer)
      events.forEach((e) => window.removeEventListener(e, onChange))
    }
  }, [refresh])
}

// ============================================================
//  ป้ายบน Header + เช็คสิทธิ์ผู้ดูแล (เบา ๆ)
// ============================================================
export function useMyPoints() {
  const { user, cloud } = useAuth()
  const [state, setState] = useState({
    loading: true,
    installed: true, // false = ยังไม่ได้รัน points.sql เวอร์ชันล่าสุด
    standing: null,
    coins: null,
    level: 'normal',
    streak: 0,
    isAdmin: false,
    penalty: 0,
    sensorEnabled: true,
  })

  const refresh = useCallback(async () => {
    if (!user) return
    if (cloud) {
      const { data, error } = await supabase.rpc('get_my_points')
      if (error) {
        // ต่อเน็ตไม่ได้ชั่วคราว -> เก็บค่าเดิมไว้ก่อน
        setState((s) => ({ ...s, loading: false, installed: isMissingBackend(error) ? false : s.installed }))
        return
      }
      const row = data?.[0]
      setState({
        loading: false,
        installed: row?.coins !== undefined, // ฐานข้อมูลยังเป็นเวอร์ชันเก่า (ไม่มีเหรียญ) = ต้องรัน SQL ใหม่
        standing: row?.points ?? 0,
        coins: row?.coins ?? 0,
        level: row?.level ?? 'normal',
        streak: row?.streak ?? 0,
        isAdmin: Boolean(row?.is_admin),
        penalty: row?.noise_penalty ?? 0,
        sensorEnabled: row?.sensor_enabled ?? true,
      })
      return
    }

    const r = runLocal((d, bookings, now) => {
      E.settleUser(d, user.id, bookings, now)
      return {
        standing: d.points[user.id],
        coins: d.coins[user.id],
        level: E.levelOf(d.points[user.id], d.meta[user.id].suspendedUntil, now),
        streak: d.meta[user.id].streak,
        penalty: d.settings.noisePenalty,
        sensorEnabled: d.settings.sensorEnabled,
      }
    })
    if (r.ok) setState({ loading: false, installed: true, isAdmin: true, ...r.data }) // โหมดทดลอง: ทุกบัญชีเป็นผู้ดูแล
  }, [user, cloud])

  useAutoRefresh(refresh)
  return { ...state, points: state.standing, mode: cloud ? 'cloud' : 'local', refresh }
}

// ============================================================
//  หน้า "คะแนนสะสม": ข้อมูลทั้งหมด + คำสั่ง เช็คอิน / แลกคูปอง / อุทธรณ์
// ============================================================
export function useMyRewards() {
  const { user, cloud } = useAuth()
  const [state, setState] = useState({ loading: true, installed: true, data: null })

  const refresh = useCallback(async () => {
    if (!user) return
    if (cloud) {
      const { data, error } = await supabase.rpc('get_my_rewards')
      if (error) {
        setState((s) => ({ ...s, loading: false, installed: isMissingBackend(error) ? false : s.installed }))
        return
      }
      setState({ loading: false, installed: true, data })
      return
    }
    const r = runLocal((d, bookings, now) => E.myRewards(d, user.id, bookings, now))
    if (r.ok) setState({ loading: false, installed: true, data: r.data })
  }, [user, cloud])

  useAutoRefresh(refresh)

  const actions = useMemo(() => {
    async function act(fn, args, local) {
      if (cloud) {
        const { data, error } = await supabase.rpc(fn, args)
        if (error) return { ok: false, message: errorMessage(error) }
        notify()
        return { ok: true, data }
      }
      const r = runLocal(local)
      if (r.ok) notify()
      return r
    }
    return {
      checkIn: (bookingId) =>
        act('check_in', { p_booking: bookingId }, (d, b, now) => E.checkIn(d, user.id, bookingId, b, now)),
      redeem: (couponId) =>
        act('redeem_coupon', { p_coupon: couponId }, (d, b, now) => E.redeem(d, user.id, couponId, b, now)),
      appeal: (message) =>
        act('submit_appeal', { p_message: message }, (d, b, now) => E.submitAppeal(d, user.id, message, b, now)),
    }
  }, [cloud, user])

  return { ...state, refresh, ...actions }
}

// ============================================================
//  คำสั่งของผู้ดูแล — ทุกฟังก์ชันคืน { ok, data } หรือ { ok: false, message }
// ============================================================
export function usePointsAdmin() {
  const { user, cloud } = useAuth()
  return useMemo(() => (cloud ? cloudAdmin() : localAdmin(user)), [cloud, user])
}

const displayName = (fullName, email, fallback) => fullName || email || fallback

function cloudAdmin() {
  async function call(fn, args, { mutate = false } = {}) {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return { ok: false, message: errorMessage(error) }
    if (mutate) notify()
    return { ok: true, data }
  }
  // แปลงผลลัพธ์เฉพาะตอนสำเร็จ
  const mapOk = (r, fn) => (r.ok ? { ok: true, data: fn(r.data) } : r)

  const mapDevice = (d) => ({
    id: d.id,
    name: d.name,
    zoneId: d.zone_id,
    seatId: d.seat_id,
    active: d.active,
    lastSeenAt: d.last_seen_at,
    lastLevel: d.last_level,
    lastPenaltyAt: d.last_penalty_at,
    createdAt: d.created_at,
  })

  return {
    mode: 'cloud',
    listUsers: async (search) =>
      mapOk(await call('admin_list_users', { p_search: search ?? '' }), (rows) =>
        rows.map((r) => ({
          id: r.user_id,
          name: displayName(r.full_name, r.email, 'ไม่มีชื่อ'),
          email: r.email,
          phone: r.phone,
          points: r.points,
          coins: r.coins,
          level: r.level,
          suspendedUntil: r.suspended_until,
          streak: r.streak,
          isAdmin: r.is_admin,
        })),
      ),
    adjust: (userId, delta, reason, meter = 'standing') =>
      call(
        'admin_adjust_points',
        { p_user: userId, p_delta: delta, p_reason: reason ?? '', p_meter: meter },
        { mutate: true },
      ),
    setPoints: (userId, value, reason, meter = 'standing') =>
      call('admin_set_points', { p_user: userId, p_points: value, p_reason: reason ?? '', p_meter: meter }, { mutate: true }),
    setAdmin: (userId, isAdmin) => call('admin_set_admin', { p_user: userId, p_is_admin: isAdmin }, { mutate: true }),
    resetAll: (reason) => call('admin_reset_all_points', { p_reason: reason ?? '' }, { mutate: true }),
    getLogs: async (limit, source) =>
      mapOk(await call('admin_get_logs', { p_limit: limit ?? 200, p_source: source ?? null }), (rows) =>
        rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          userId: r.user_id,
          name: displayName(r.full_name, r.email, 'ไม่ทราบชื่อ'),
          meter: r.meter,
          delta: r.delta,
          balanceAfter: r.balance_after,
          source: r.source,
          reason: r.reason,
          deviceId: r.device_id,
          seatId: r.seat_id,
          actorName: r.actor_name,
        })),
      ),
    getSettings: () => call('admin_get_settings', {}),
    updateSettings: (s) => call('admin_update_settings', { p: s }, { mutate: true }),
    listAppeals: async (status) =>
      mapOk(await call('admin_list_appeals', { p_status: status ?? null }), (rows) =>
        rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          name: displayName(r.full_name, r.email, 'ไม่ทราบชื่อ'),
          message: r.message,
          status: r.status,
          adminNote: r.admin_note,
          createdAt: r.created_at,
          decidedAt: r.decided_at,
          points: r.points,
          suspendedUntil: r.suspended_until,
        })),
      ),
    decideAppeal: (id, approve, note) =>
      call('admin_decide_appeal', { p_id: id, p_approve: approve, p_note: note ?? '' }, { mutate: true }),
    listCoupons: async () =>
      mapOk(await call('admin_list_coupons', { p_limit: 200 }), (rows) =>
        rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          cost: r.cost,
          status: r.status,
          createdAt: r.created_at,
          usedAt: r.used_at,
          userName: displayName(r.full_name, r.email, 'ไม่ทราบชื่อ'),
        })),
      ),
    markCouponUsed: (code) => call('admin_use_coupon', { p_code: code }),
    listDevices: async () => mapOk(await call('admin_list_devices', {}), (rows) => rows.map(mapDevice)),
    createDevice: async ({ name, zoneId, seatId }) =>
      mapOk(await call('admin_create_device', { p_name: name ?? '', p_zone: zoneId, p_seat: seatId }), (rows) => ({
        id: rows[0].id,
        key: rows[0].device_key,
      })),
    updateDevice: (id, { name = null, seatId = null, active = null }) =>
      call('admin_update_device', { p_id: id, p_name: name, p_seat: seatId, p_active: active }),
    resetDeviceKey: (id) => call('admin_reset_device_key', { p_id: id }),
    deleteDevice: (id) => call('admin_delete_device', { p_id: id }),
    simulateNoise: (id) => call('admin_simulate_noise', { p_id: id }, { mutate: true }),
  }
}

// ช่วงค่าที่ตั้งได้ (เหมือน admin_update_settings ใน SQL)
const SETTING_RANGE = {
  startingPoints: [0, 100],
  noisePenalty: [0, 100],
  penaltyStep: [0, 100],
  penaltyMax: [0, 100],
  dailyCap: [0, 100],
  cooldownSeconds: [0, 86400],
  refundMinutes: [1, 1440],
  refundPercent: [0, 100],
  sessionBonus: [0, 100],
  sessionCoins: [0, 100000],
  weeklyBonus: [0, 100],
  coinGate: [0, 100],
  suspendDays: [1, 365],
}

function localAdmin(user) {
  const run = async (fn) => runLocal(fn)
  const users = () => readJson(MOCK_USERS_KEY, [])
  const fullName = (u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
  const nameOf = (id) => {
    const u = users().find((x) => x.id === id)
    return u ? fullName(u) || u.email : 'ไม่ทราบชื่อ'
  }
  const fail = (key) => {
    throw new Error(key)
  }
  const findDevice = (d, id) => d.devices.find((x) => x.id === id) ?? fail('NOT_FOUND')
  const checkMeter = (meter) => ['standing', 'coins'].includes(meter) || fail('BAD_AMOUNT')

  return {
    mode: 'local',
    listUsers: (search) =>
      run((d, bookings, now) => {
        const q = (search ?? '').toLowerCase()
        return users()
          .map((u) => {
            E.settleUser(d, u.id, bookings, now)
            const m = d.meta[u.id]
            const suspended = m.suspendedUntil && Date.parse(m.suspendedUntil) > now
            return {
              id: u.id,
              name: fullName(u) || u.email,
              email: u.email,
              phone: u.phone,
              points: d.points[u.id],
              coins: d.coins[u.id],
              level: E.levelOf(d.points[u.id], m.suspendedUntil, now),
              suspendedUntil: suspended ? m.suspendedUntil : null,
              streak: m.streak,
              isAdmin: true,
            }
          })
          .filter((u) => !q || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name, 'th'))
      }),
    adjust: (userId, delta, reason, meter = 'standing') =>
      run((d, _b, now) => {
        checkMeter(meter)
        if (!Number.isInteger(delta) || delta === 0) fail('BAD_AMOUNT')
        return E.changeMeter(d, userId, meter, delta, 'admin', reason || 'ปรับโดยผู้ดูแล', now, { actorId: user.id })
      }),
    setPoints: (userId, value, reason, meter = 'standing') =>
      run((d, _b, now) => {
        checkMeter(meter)
        if (!Number.isInteger(value) || value < 0 || (meter === 'standing' && value > 100)) fail('BAD_AMOUNT')
        E.ensure(d, userId, now)
        const old = meter === 'coins' ? d.coins[userId] : d.points[userId]
        if (old === value) return old
        return E.changeMeter(d, userId, meter, value - old, 'admin', reason || 'ตั้งค่าใหม่โดยผู้ดูแล', now, {
          actorId: user.id,
        })
      }),
    setAdmin: async () => ({ ok: false, message: 'โหมดทดลอง: ทุกบัญชีเป็นผู้ดูแลอยู่แล้ว' }),
    resetAll: (reason) =>
      run((d, _b, now) => {
        const start = Math.min(100, d.settings.startingPoints)
        let changed = 0
        users().forEach((u) => {
          const m = E.ensure(d, u.id, now)
          if (d.points[u.id] === start && !m.suspendedUntil) return
          m.suspendedUntil = null
          if (d.points[u.id] !== start) {
            E.changeMeter(d, u.id, 'standing', start - d.points[u.id], 'admin', reason || 'รีเซ็ตความประพฤติทุกคน', now, {
              actorId: user.id,
            })
          }
          changed++
        })
        return changed
      }),
    getLogs: (limit, source) =>
      run((d) =>
        d.logs
          .filter((l) => !source || l.source === source)
          .slice(0, limit ?? 200)
          .map((l) => ({ ...l, name: nameOf(l.userId), actorName: l.actorId ? nameOf(l.actorId) : null })),
      ),
    getSettings: () => run((d) => ({ ...d.settings })),
    updateSettings: (s) =>
      run((d) => {
        for (const [k, [lo, hi]] of Object.entries(SETTING_RANGE)) {
          if (s[k] == null) continue
          if (!Number.isInteger(s[k]) || s[k] < lo || s[k] > hi) fail('BAD_AMOUNT')
        }
        d.settings = { ...d.settings, ...s, sensorEnabled: s.sensorEnabled ?? d.settings.sensorEnabled }
        return { ...d.settings }
      }),
    listAppeals: (status) =>
      run((d, _b, now) =>
        d.appeals
          .filter((a) => !status || a.status === status)
          .map((a) => {
            const m = d.meta[a.userId]
            return {
              ...a,
              name: nameOf(a.userId),
              points: d.points[a.userId],
              suspendedUntil: m?.suspendedUntil && Date.parse(m.suspendedUntil) > now ? m.suspendedUntil : null,
            }
          }),
      ),
    decideAppeal: (id, approve, note) => run((d, _b, now) => E.decideAppeal(d, user.id, id, approve, note, now)),
    listCoupons: () => run((d) => d.coupons.map((c) => ({ ...c, userName: nameOf(c.userId) }))),
    markCouponUsed: (code) => run((d, _b, now) => E.useCoupon(d, code, now)),
    listDevices: () => run((d) => d.devices.map(({ key: _key, ...dev }) => dev)),
    createDevice: ({ name, zoneId, seatId }) =>
      run((d) => {
        if (!seatId) fail('BAD_SEAT')
        const hex = (n) =>
          Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('')
        let id
        do {
          id = `ESP-${hex(3).toUpperCase()}`
        } while (d.devices.some((x) => x.id === id))
        const key = hex(16)
        d.devices.push({
          id,
          name: (name ?? '').trim(),
          zoneId,
          seatId,
          active: true,
          lastSeenAt: null,
          lastLevel: null,
          lastPenaltyAt: null,
          createdAt: new Date().toISOString(),
          key,
        })
        return { id, key }
      }),
    updateDevice: (id, patch) =>
      run((d) => {
        const dev = findDevice(d, id)
        if (patch.name != null) dev.name = patch.name.trim()
        if (patch.seatId) dev.seatId = patch.seatId
        if (patch.active != null) dev.active = patch.active
      }),
    resetDeviceKey: (id) =>
      run((d) => {
        const dev = findDevice(d, id)
        dev.key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
        return dev.key
      }),
    deleteDevice: (id) =>
      run((d) => {
        findDevice(d, id)
        d.devices = d.devices.filter((x) => x.id !== id)
      }),
    simulateNoise: (id) => run((d, bookings, now) => E.applyNoise(d, id, null, bookings, now)),
  }
}
