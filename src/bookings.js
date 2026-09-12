import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth.jsx'
import { supabase } from './supabase.js'
import { localBookingRestriction } from './points.js'

// ============================================================
//  ระบบจองที่นั่ง + เข้าร่วมโต๊ะด้วย QR / รหัส 6 หลัก
//
//  เก็บข้อมูลได้ 2 แบบ (เลือกให้อัตโนมัติ):
//   1) Supabase     — ทุกคน/ทุกเครื่องเห็นตรงกัน (ต้องรัน supabase/bookings.sql ก่อน 1 ครั้ง)
//   2) localStorage — ใช้เมื่อยังไม่ได้รัน SQL หรือไม่มี Supabase: เห็นเฉพาะในเบราว์เซอร์นี้
//
//  ต้องล็อกอินก่อนเท่านั้นถึงจะจอง/เข้าร่วมได้ (ใช้บัญชีจากระบบล็อกอินใน auth.jsx)
// ============================================================

export const MAX_PARTY = 10 // จำนวนคนสูงสุดต่อการจอง 1 ครั้ง (รวมคนจอง) — ต้องตรงกับใน bookings.sql

const KEY = 'lb2_bookings_v2' // key ใน localStorage
const CHANGE_EVENT = 'lb2-bookings-changed' // แจ้งทุกคอมโพเนนต์ในแท็บเดียวกันว่าข้อมูลเปลี่ยน

// ---------- ตัวช่วยเรื่องวัน/เวลา (ใช้เวลาของเครื่องผู้ใช้ = เวลาไทย) ----------
const pad = (n) => String(n).padStart(2, '0')

export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export const fromMinutes = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

export const nowMinutes = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

// การจองยังไม่จบ -> ที่นั่งเป็นสีแดง
export const isActive = (b) =>
  b.date > todayStr() || (b.date === todayStr() && toMinutes(b.end) > nowMinutes())

// ลิงก์ที่ฝังใน QR — สแกนแล้วเปิดหน้าเข้าร่วมโต๊ะพร้อมรหัส
export const joinUrl = (code) => `${window.location.origin}${import.meta.env.BASE_URL}#/join/${code}`

const fullName = (u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
const cut = (t) => t.slice(0, 5) // '14:00:00' -> '14:00'

// ---------- ข้อความ error ภาษาไทย (key ตรงกับที่ SQL raise exception) ----------
const ERR = {
  NOT_LOGGED_IN: 'กรุณาเข้าสู่ระบบก่อน',
  OVERLAP: 'ช่วงเวลานี้มีคนจองที่นั่งนี้ไว้แล้ว ลองเลือกช่วงเวลาอื่น',
  BAD_PARTY: `จำนวนคนต้องอยู่ระหว่าง 1–${MAX_PARTY} คน`,
  BAD_TIME: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม',
  PAST: 'ช่วงเวลานี้ผ่านไปแล้ว เลือกเวลาตั้งแต่ตอนนี้เป็นต้นไป',
  NOT_OWNER: 'ยกเลิกได้เฉพาะการจองของตัวเอง',
  NOT_FOUND: 'ไม่พบรหัสนี้ ลองตรวจสอบตัวเลขอีกครั้ง',
  OWNER: 'นี่คือการจองของคุณเอง ไม่ต้องเข้าร่วมซ้ำ',
  ALREADY_JOINED: 'คุณเข้าร่วมโต๊ะนี้ไปแล้ว',
  EXPIRED: 'การจองนี้หมดเวลาแล้ว',
  FULL: 'โต๊ะนี้มีคนเข้าร่วมครบจำนวนแล้ว',
  // จากระบบคะแนนความประพฤติ (points.sql)
  SUSPENDED: 'บัญชีถูกระงับการเข้าใช้ชั่วคราว (ความประพฤติต่ำกว่า 20) — จอง/เข้าร่วมโต๊ะไม่ได้จนครบกำหนด ดูรายละเอียดที่หน้าคะแนนสะสม',
  RESTRICTED_ROOM: 'ความประพฤติต่ำกว่า 60 (ถูกจำกัดสิทธิ์) — จองห้อง/พื้นที่พิเศษไม่ได้ชั่วคราว เลือกโต๊ะอื่นได้',
}

function errorMessage(error) {
  const msg = error?.message || ''
  const key = Object.keys(ERR).find((k) => msg.includes(k)) // NOT_OWNER อยู่ก่อน OWNER จึงไม่จับผิดตัว
  if (key) return ERR[key]
  if (msg.toLowerCase().includes('failed to fetch')) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง'
  return msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
}

// Supabase ตอบว่า "ไม่มีฟังก์ชัน/ตารางนี้" = ยังไม่ได้รัน bookings.sql
function isMissingBackend(error) {
  if (!error) return false
  return (
    ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code) ||
    /could not find the (function|table)/i.test(error.message || '')
  )
}

// เป็น true เมื่อพบว่ายังไม่ได้รัน bookings.sql -> ใช้ localStorage แทนจนกว่าจะรีเฟรชหน้า
let backendMissing = false

// ============================================================
//  โหมด localStorage
// ============================================================
function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? []
  } catch {
    return []
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* เบราว์เซอร์ไม่ให้เก็บ (เช่นโหมดส่วนตัว) */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

// แปลงให้หน้าตาเหมือนข้อมูลจาก Supabase
function localView(b, user) {
  const isMine = b.userId === user.id
  const isMember = b.members.some((m) => m.userId === user.id)
  return {
    id: b.id,
    zoneId: b.zoneId,
    seatId: b.seatId,
    date: b.date,
    start: b.start,
    end: b.end,
    partySize: b.partySize,
    ownerName: b.ownerName,
    memberCount: b.members.length,
    isMine,
    isMember,
    // รหัสและรายชื่อ ให้เห็นเฉพาะคนจองกับคนที่เข้าร่วมแล้ว (เหมือนสิทธิ์ใน Supabase)
    code: isMine || isMember ? b.code : null,
    members: isMine || isMember ? b.members.map((m) => ({ name: m.name, joinedAt: m.joinedAt })) : [],
  }
}

// ============================================================
//  คำสั่งหลัก — ทุกฟังก์ชันลอง Supabase ก่อน ถ้ายังไม่มีตารางค่อยตกมาใช้ localStorage
// ============================================================

// การจองทั้งหมดของโซนในวันที่กำหนด
async function listZone({ cloud, user }, zoneId, date) {
  if (cloud && !backendMissing) {
    const { data, error } = await supabase.rpc('get_zone_bookings', { p_zone: zoneId, p_date: date })
    if (!error) {
      return data.map((r) => ({
        id: r.id,
        zoneId,
        seatId: r.seat_id,
        date,
        start: cut(r.start_time),
        end: cut(r.end_time),
        partySize: r.party_size,
        memberCount: r.member_count,
        isMine: r.is_mine,
        isMember: r.is_member,
      }))
    }
    if (!isMissingBackend(error)) throw error
    backendMissing = true
  }
  return readLocal()
    .filter((b) => b.zoneId === zoneId && b.date === date)
    .map((b) => localView(b, user))
}

// จองที่นั่ง — ถ้าจองหลายคน ระบบสร้างรหัส 6 หลักให้
async function createBooking({ cloud, user }, { zoneId, seatId, date, start, end, partySize }) {
  if (!user) return { ok: false, message: ERR.NOT_LOGGED_IN }

  if (cloud && !backendMissing) {
    const { data, error } = await supabase.rpc('create_booking', {
      p_zone: zoneId,
      p_seat: seatId,
      p_date: date,
      p_start: start,
      p_end: end,
      p_party: partySize,
    })
    if (!error) {
      return {
        ok: true,
        booking: { id: data.id, zoneId, seatId, date, start, end, partySize: data.party_size, code: data.join_code },
      }
    }
    if (!isMissingBackend(error)) return { ok: false, message: errorMessage(error) }
    backendMissing = true
  }

  const block = localBookingRestriction(user.id, seatId)
  if (block) return { ok: false, message: ERR[block] }

  const list = readLocal()
  const clash = list.some(
    (b) =>
      b.zoneId === zoneId &&
      b.seatId === seatId &&
      b.date === date &&
      toMinutes(start) < toMinutes(b.end) &&
      toMinutes(b.start) < toMinutes(end),
  )
  if (clash) return { ok: false, message: ERR.OVERLAP }

  let code = null
  if (partySize > 1) {
    do {
      code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
    } while (list.some((b) => b.code === code))
  }

  const booking = {
    id: crypto.randomUUID(),
    zoneId,
    seatId,
    date,
    start,
    end,
    partySize,
    code,
    userId: user.id,
    ownerName: fullName(user),
    createdAt: new Date().toISOString(),
    members: [],
  }
  writeLocal([...list, booking])
  return { ok: true, booking: localView(booking, user) }
}

// ยกเลิกการจอง (เฉพาะของตัวเอง)
async function cancelBooking({ cloud, user }, id) {
  if (cloud && !backendMissing) {
    const { data, error } = await supabase.from('seat_bookings').delete().eq('id', id).select('id')
    if (!error) return data.length ? { ok: true } : { ok: false, message: ERR.NOT_OWNER }
    if (!isMissingBackend(error)) return { ok: false, message: errorMessage(error) }
    backendMissing = true
  }
  const list = readLocal()
  const target = list.find((b) => b.id === id)
  if (!target || target.userId !== user.id) return { ok: false, message: ERR.NOT_OWNER }
  writeLocal(list.filter((b) => b.id !== id))
  return { ok: true }
}

// รายละเอียดการจอง + รหัส + รายชื่อคนที่เข้าร่วม (เห็นได้เฉพาะคนจอง/คนที่เข้าร่วมแล้ว)
async function getDetail({ cloud, user }, id) {
  if (cloud && !backendMissing) {
    const { data, error } = await supabase
      .from('seat_bookings')
      .select(
        'id, zone_id, seat_id, booking_date, start_time, end_time, party_size, join_code, owner_name, seat_booking_members(member_name, joined_at)',
      )
      .eq('id', id)
      .maybeSingle()
    if (!error) {
      if (!data) return null
      return {
        id: data.id,
        zoneId: data.zone_id,
        seatId: data.seat_id,
        date: data.booking_date,
        start: cut(data.start_time),
        end: cut(data.end_time),
        partySize: data.party_size,
        code: data.join_code,
        ownerName: data.owner_name,
        members: data.seat_booking_members
          .map((m) => ({ name: m.member_name, joinedAt: m.joined_at }))
          .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
      }
    }
    if (!isMissingBackend(error)) throw error
    backendMissing = true
  }
  const b = readLocal().find((x) => x.id === id)
  return b ? localView(b, user) : null
}

// หาการจองจากรหัส 6 หลัก (ใช้ในหน้าเข้าร่วม ก่อนกดยืนยัน)
async function findByCode({ cloud, user }, code) {
  if (cloud && !backendMissing) {
    const { data, error } = await supabase.rpc('get_booking_by_code', { p_code: code })
    if (!error) {
      const r = data?.[0]
      if (!r) return { ok: false, message: ERR.NOT_FOUND }
      return {
        ok: true,
        booking: {
          id: r.id,
          zoneId: r.zone_id,
          seatId: r.seat_id,
          date: r.booking_date,
          start: cut(r.start_time),
          end: cut(r.end_time),
          partySize: r.party_size,
          ownerName: r.owner_name,
          memberCount: r.member_count,
          isMine: r.is_owner,
          isMember: r.is_member,
        },
      }
    }
    if (!isMissingBackend(error)) return { ok: false, message: errorMessage(error) }
    backendMissing = true
  }
  const b = readLocal().find((x) => x.code === code)
  return b ? { ok: true, booking: localView(b, user) } : { ok: false, message: ERR.NOT_FOUND }
}

// เข้าร่วมโต๊ะด้วยบัญชีของตัวเอง
async function joinBooking({ cloud, user }, code) {
  if (!user) return { ok: false, message: ERR.NOT_LOGGED_IN }

  if (cloud && !backendMissing) {
    const { error } = await supabase.rpc('join_booking', { p_code: code })
    if (!error) return { ok: true }
    if (!isMissingBackend(error)) return { ok: false, message: errorMessage(error) }
    backendMissing = true
  }

  const list = readLocal()
  const b = list.find((x) => x.code === code)
  if (!b) return { ok: false, message: ERR.NOT_FOUND }
  if (b.userId === user.id) return { ok: false, message: ERR.OWNER }
  if (b.members.some((m) => m.userId === user.id)) return { ok: false, message: ERR.ALREADY_JOINED }
  if (!isActive(b)) return { ok: false, message: ERR.EXPIRED }
  if (b.members.length + 1 >= b.partySize) return { ok: false, message: ERR.FULL }
  const block = localBookingRestriction(user.id, b.seatId)
  if (block) return { ok: false, message: ERR[block] }

  b.members.push({ userId: user.id, name: fullName(user), joinedAt: new Date().toISOString() })
  writeLocal(list)
  return { ok: true }
}

// ============================================================
//  Hooks สำหรับใช้ในคอมโพเนนต์
// ============================================================

// const api = useBookingApi()  ->  api.create(...), api.join(...) ฯลฯ ผูกกับผู้ใช้ที่ล็อกอินอยู่ให้เอง
export function useBookingApi() {
  const { user, cloud } = useAuth()
  return useMemo(() => {
    const ctx = { user, cloud }
    return {
      listZone: (zoneId, date) => listZone(ctx, zoneId, date),
      create: (input) => createBooking(ctx, input),
      cancel: (id) => cancelBooking(ctx, id),
      detail: (id) => getDetail(ctx, id),
      findByCode: (code) => findByCode(ctx, code),
      join: (code) => joinBooking(ctx, code),
      isLocal: () => !cloud || backendMissing,
    }
  }, [user, cloud])
}

// การจองของวันนี้ในโซน — โหลดใหม่ทุก 20 วินาที / เมื่อกลับมาที่แท็บ / เมื่อมีการเปลี่ยนแปลง
export function useZoneBookings(zoneId) {
  const api = useBookingApi()
  const [date] = useState(todayStr)
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setBookings(await api.listZone(zoneId, date))
    } catch {
      /* เน็ตหลุดชั่วคราว — ใช้ข้อมูลเดิมไปก่อน */
    } finally {
      setLoading(false)
    }
  }, [api, zoneId, date])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 20000)
    const onStorage = (e) => {
      if (e.key === KEY) refresh()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  return { bookings, loading, refresh, date, isLocal: api.isLocal() }
}
