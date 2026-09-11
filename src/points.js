import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth.jsx'
import { supabase } from './supabase.js'
import { nowMinutes, todayStr, toMinutes } from './bookings.js'

// ============================================================
//  ระบบคะแนนสะสม — เซนเซอร์เสียง (ESP32) ตรวจพบเสียงดัง -> หักแต้ม
//
//  - ออนไลน์ (มี Supabase): ทุกอย่างผ่านฟังก์ชันใน supabase/points.sql
//      ผู้ใช้เห็นแค่คะแนนตัวเอง / ผู้ดูแล (ตาราง admins) ปรับคะแนน ตั้งค่า จัดการอุปกรณ์ได้
//  - โหมดทดลอง (ไม่มี Supabase): เก็บใน localStorage และ "ทุกบัญชีเป็นผู้ดูแล" เพื่อให้ลองได้ทุกหน้า
//      (เปิดด้วย npm run dev:mock — ไม่ใช้บนเว็บจริงที่มี Supabase)
// ============================================================

const KEY = 'lb2_points_v1'
const CHANGE_EVENT = 'lb2-points-changed' // บอกทุกคอมโพเนนต์ (เช่นป้ายคะแนนบน Header) ให้โหลดใหม่
const BOOKINGS_KEY = 'lb2_bookings_v2' // ใช้หา "ใครจองที่นั่งนี้อยู่" ตอนจำลองเซนเซอร์ในโหมดทดลอง
const MOCK_USERS_KEY = 'lb2_mock_users' // บัญชีโหมดทดลองจาก auth.jsx

export const DEFAULT_SETTINGS = { startingPoints: 100, noisePenalty: 5, cooldownSeconds: 60, sensorEnabled: true }

const notify = () => window.dispatchEvent(new Event(CHANGE_EVENT))

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

// ---------- ข้อความ error ภาษาไทย (key ตรงกับที่ SQL raise exception) ----------
const ERR = {
  NOT_LOGGED_IN: 'กรุณาเข้าสู่ระบบก่อน',
  NOT_ADMIN: 'ต้องเป็นผู้ดูแลระบบเท่านั้น',
  SELF_ADMIN: 'ถอนสิทธิ์ผู้ดูแลของตัวเองไม่ได้',
  BAD_AMOUNT: 'จำนวนแต้มไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม ไม่ติดลบ)',
  BAD_SEAT: 'กรุณาเลือกที่นั่งของอุปกรณ์',
  BAD_DEVICE: 'รหัสอุปกรณ์หรือคีย์ไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบข้อมูล (อาจถูกลบไปแล้ว)',
}

function errorMessage(error) {
  const msg = error?.message || ''
  const key = Object.keys(ERR).find((k) => msg === k || msg.includes(k))
  if (key) return ERR[key]
  if (msg.toLowerCase().includes('failed to fetch')) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง'
  return msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
}

// Supabase ตอบว่า "ไม่มีฟังก์ชัน/ตารางนี้" = ยังไม่ได้รัน points.sql
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
    case 'DEDUCTED':
      return `หักแต้มแล้ว ${r.users} คน คนละ ${r.penalty} แต้ม`
    case 'NO_BOOKING':
      return 'ตอนนี้ไม่มีใครจองที่นั่งนี้อยู่ — ไม่หักแต้ม'
    case 'COOLDOWN':
      return `เพิ่งหักแต้มไปเมื่อไม่นาน รออีก ${r.retry_in} วินาทีถึงจะหักได้อีก`
    case 'SENSOR_OFF':
      return 'ปิดการหักแต้มจากเซนเซอร์อยู่ (เปิดได้ที่แท็บตั้งค่า)'
    case 'DEVICE_DISABLED':
      return 'อุปกรณ์นี้ถูกปิดใช้งานอยู่'
    case 'NO_PENALTY':
      return 'ตั้งค่าหักแต้มเป็น 0 อยู่ — ไม่หักแต้ม'
    default:
      return r?.status ?? 'ไม่ทราบผล'
  }
}

// ============================================================
//  โหมดทดลอง (localStorage) — ทำงานเหมือนฟังก์ชันใน points.sql
// ============================================================
function readLocal() {
  const d = readJson(KEY, {})
  return {
    settings: { ...DEFAULT_SETTINGS, ...d.settings },
    points: d.points ?? {},
    logs: d.logs ?? [],
    devices: d.devices ?? [],
  }
}

function writeLocal(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* เบราว์เซอร์ไม่ให้เก็บ (เช่นโหมดส่วนตัว) */
  }
  notify()
}

const randomHex = (bytes) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

const fail = (message) => {
  throw new Error(message)
}

// เปลี่ยนคะแนน + เก็บประวัติ (คะแนนไม่ติดลบ)
function localChange(d, userId, delta, source, reason, extra = {}) {
  const old = d.points[userId] ?? d.settings.startingPoints
  const next = Math.max(0, old + delta)
  d.points[userId] = next
  d.logs.unshift({
    id: `${Date.now()}-${randomHex(3)}`,
    createdAt: new Date().toISOString(),
    userId,
    delta: next - old,
    balanceAfter: next,
    source,
    reason,
    deviceId: extra.deviceId ?? null,
    seatId: extra.seatId ?? null,
    actorId: extra.actorId ?? null,
  })
  d.logs = d.logs.slice(0, 500)
  return next
}

// เหมือน _apply_noise ใน SQL: หาคนที่จองที่นั่งของอุปกรณ์ "ตอนนี้" แล้วหักแต้มทุกคน
function localApplyNoise(d, deviceId, level) {
  const dev = d.devices.find((x) => x.id === deviceId) ?? fail(ERR.NOT_FOUND)
  const s = d.settings
  dev.lastSeenAt = new Date().toISOString()
  if (level != null) dev.lastLevel = level

  if (!dev.active) return { ok: false, status: 'DEVICE_DISABLED' }
  if (!s.sensorEnabled) return { ok: false, status: 'SENSOR_OFF' }
  if (s.noisePenalty <= 0) return { ok: true, status: 'NO_PENALTY' }
  if (dev.lastPenaltyAt) {
    const waitMs = Date.parse(dev.lastPenaltyAt) + s.cooldownSeconds * 1000 - Date.now()
    if (waitMs > 0) return { ok: true, status: 'COOLDOWN', retry_in: Math.ceil(waitMs / 1000) }
  }

  const today = todayStr()
  const now = nowMinutes()
  const booking = readJson(BOOKINGS_KEY, []).find(
    (b) =>
      b.zoneId === dev.zoneId &&
      b.seatId === dev.seatId &&
      b.date === today &&
      toMinutes(b.start) <= now &&
      now < toMinutes(b.end),
  )
  if (!booking) return { ok: true, status: 'NO_BOOKING' }

  const userIds = [...new Set([booking.userId, ...booking.members.map((m) => m.userId)])]
  userIds.forEach((uid) =>
    localChange(d, uid, -s.noisePenalty, 'sensor', 'เซนเซอร์ตรวจพบเสียงดัง', {
      deviceId: dev.id,
      seatId: dev.seatId,
    }),
  )
  dev.lastPenaltyAt = new Date().toISOString()
  return { ok: true, status: 'DEDUCTED', users: userIds.length, penalty: s.noisePenalty }
}

// ============================================================
//  คะแนนของฉัน (ใช้ทั้งหน้า "คะแนนสะสม" และป้ายคะแนนบน Header)
// ============================================================
export function useMyPoints() {
  const { user, cloud } = useAuth()
  const [state, setState] = useState({
    loading: true,
    installed: true, // false = ยังไม่ได้รัน points.sql
    points: null,
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
        installed: true,
        points: row?.points ?? 0,
        isAdmin: Boolean(row?.is_admin),
        penalty: row?.noise_penalty ?? 0,
        sensorEnabled: row?.sensor_enabled ?? true,
      })
      return
    }

    // โหมดทดลอง
    const d = readLocal()
    if (d.points[user.id] == null) {
      d.points[user.id] = d.settings.startingPoints
      writeLocal(d)
    }
    setState({
      loading: false,
      installed: true,
      points: d.points[user.id],
      isAdmin: true, // โหมดทดลอง: ทุกบัญชีเป็นผู้ดูแล
      penalty: d.settings.noisePenalty,
      sensorEnabled: d.settings.sensorEnabled,
    })
  }, [user, cloud])

  // โหลดตอนเปิด + ทุก 15 วิ (เซนเซอร์อาจหักแต้มตอนไหนก็ได้) + ตอนกลับมาที่แท็บ + ตอนผู้ดูแลแก้คะแนน
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15000)
    const onChange = () => refresh()
    window.addEventListener('focus', onChange)
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onChange)
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [refresh])

  return { ...state, mode: cloud ? 'cloud' : 'local', refresh }
}

// ============================================================
//  คำสั่งของผู้ดูแล — ทุกฟังก์ชันคืน { ok, data } หรือ { ok: false, message }
// ============================================================
export function usePointsAdmin() {
  const { user, cloud } = useAuth()
  return useMemo(() => (cloud ? cloudAdmin() : localAdmin(user)), [cloud, user])
}

function cloudAdmin() {
  async function call(fn, args, { mutate = false } = {}) {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return { ok: false, message: errorMessage(error) }
    if (mutate) notify()
    return { ok: true, data }
  }
  // แปลงผลลัพธ์เฉพาะตอนสำเร็จ
  const mapOk = (r, fn) => (r.ok ? { ok: true, data: fn(r.data) } : r)

  const mapSettings = (s) => ({
    startingPoints: s.starting_points,
    noisePenalty: s.noise_penalty,
    cooldownSeconds: s.cooldown_seconds,
    sensorEnabled: s.sensor_enabled,
  })
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
          name: r.full_name || r.email || 'ไม่มีชื่อ',
          email: r.email,
          phone: r.phone,
          points: r.points,
          isAdmin: r.is_admin,
        })),
      ),
    adjust: (userId, delta, reason) =>
      call('admin_adjust_points', { p_user: userId, p_delta: delta, p_reason: reason ?? '' }, { mutate: true }),
    setPoints: (userId, points, reason) =>
      call('admin_set_points', { p_user: userId, p_points: points, p_reason: reason ?? '' }, { mutate: true }),
    setAdmin: (userId, isAdmin) =>
      call('admin_set_admin', { p_user: userId, p_is_admin: isAdmin }, { mutate: true }),
    resetAll: (reason) => call('admin_reset_all_points', { p_reason: reason ?? '' }, { mutate: true }),
    getLogs: async (limit, source) =>
      mapOk(await call('admin_get_logs', { p_limit: limit ?? 200, p_source: source ?? null }), (rows) =>
        rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          userId: r.user_id,
          name: r.full_name || r.email || 'ไม่ทราบชื่อ',
          delta: r.delta,
          balanceAfter: r.balance_after,
          source: r.source,
          reason: r.reason,
          deviceId: r.device_id,
          seatId: r.seat_id,
          actorName: r.actor_name,
        })),
      ),
    getSettings: async () => mapOk(await call('admin_get_settings', {}), mapSettings),
    updateSettings: async (s) =>
      mapOk(
        await call(
          'admin_update_settings',
          {
            p_starting: s.startingPoints,
            p_penalty: s.noisePenalty,
            p_cooldown: s.cooldownSeconds,
            p_enabled: s.sensorEnabled,
          },
          { mutate: true },
        ),
        mapSettings,
      ),
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

function localAdmin(user) {
  // อ่าน -> แก้ -> เขียนกลับ (ถ้า mutate) แล้วห่อผลเป็น { ok, data }
  const run = async (fn, { mutate = true } = {}) => {
    try {
      const d = readLocal()
      const data = fn(d)
      if (mutate) writeLocal(d)
      return { ok: true, data }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  }
  const users = () => readJson(MOCK_USERS_KEY, [])
  const fullName = (u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
  const nameOf = (id) => {
    const u = users().find((x) => x.id === id)
    return u ? fullName(u) : 'ไม่ทราบชื่อ'
  }
  const pointsOf = (d, id) => d.points[id] ?? d.settings.startingPoints
  const checkWhole = (n) => Number.isInteger(n) || fail(ERR.BAD_AMOUNT)
  const findDevice = (d, id) => d.devices.find((x) => x.id === id) ?? fail(ERR.NOT_FOUND)

  return {
    mode: 'local',
    listUsers: (search) =>
      run(
        (d) => {
          const q = (search ?? '').toLowerCase()
          return users()
            .map((u) => ({
              id: u.id,
              name: fullName(u) || u.email,
              email: u.email,
              phone: u.phone,
              points: pointsOf(d, u.id),
              isAdmin: true,
            }))
            .filter((u) => !q || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(q))
            .sort((a, b) => a.name.localeCompare(b.name, 'th'))
        },
        { mutate: false },
      ),
    adjust: (userId, delta, reason) =>
      run((d) => {
        checkWhole(delta)
        if (delta === 0) fail(ERR.BAD_AMOUNT)
        return localChange(d, userId, delta, 'admin', reason || 'ปรับคะแนนโดยผู้ดูแล', { actorId: user.id })
      }),
    setPoints: (userId, value, reason) =>
      run((d) => {
        checkWhole(value)
        if (value < 0) fail(ERR.BAD_AMOUNT)
        const old = pointsOf(d, userId)
        if (old === value) return old
        return localChange(d, userId, value - old, 'admin', reason || 'ตั้งคะแนนใหม่โดยผู้ดูแล', { actorId: user.id })
      }),
    setAdmin: async () => ({ ok: false, message: 'โหมดทดลอง: ทุกบัญชีเป็นผู้ดูแลอยู่แล้ว' }),
    resetAll: (reason) =>
      run((d) => {
        let changed = 0
        users().forEach((u) => {
          const old = pointsOf(d, u.id)
          if (old === d.settings.startingPoints) return
          localChange(d, u.id, d.settings.startingPoints - old, 'admin', reason || 'รีเซ็ตคะแนนทุกคน', {
            actorId: user.id,
          })
          changed++
        })
        return changed
      }),
    getLogs: (limit, source) =>
      run(
        (d) =>
          d.logs
            .filter((l) => !source || l.source === source)
            .slice(0, limit ?? 200)
            .map((l) => ({ ...l, name: nameOf(l.userId), actorName: l.actorId ? nameOf(l.actorId) : null })),
        { mutate: false },
      ),
    getSettings: () => run((d) => ({ ...d.settings }), { mutate: false }),
    updateSettings: (s) =>
      run((d) => {
        for (const v of [s.startingPoints, s.noisePenalty, s.cooldownSeconds]) {
          if (!Number.isInteger(v) || v < 0) fail(ERR.BAD_AMOUNT)
        }
        d.settings = {
          startingPoints: s.startingPoints,
          noisePenalty: s.noisePenalty,
          cooldownSeconds: s.cooldownSeconds,
          sensorEnabled: Boolean(s.sensorEnabled),
        }
        return { ...d.settings }
      }),
    listDevices: () => run((d) => d.devices.map(({ key: _key, ...dev }) => dev), { mutate: false }),
    createDevice: ({ name, zoneId, seatId }) =>
      run((d) => {
        if (!seatId) fail(ERR.BAD_SEAT)
        let id
        do {
          id = `ESP-${randomHex(3).toUpperCase()}`
        } while (d.devices.some((x) => x.id === id))
        const key = randomHex(16)
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
        dev.key = randomHex(16)
        return dev.key
      }),
    deleteDevice: (id) =>
      run((d) => {
        findDevice(d, id)
        d.devices = d.devices.filter((x) => x.id !== id)
      }),
    simulateNoise: (id) => run((d) => localApplyNoise(d, id, null)),
  }
}
