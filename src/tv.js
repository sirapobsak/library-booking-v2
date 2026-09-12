import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth.jsx'
import { supabase } from './supabase.js'
import * as E from './rewardsEngine.js'

// ============================================================
//  ข้อมูลจอทีวีในโซน — เปิดได้โดยไม่ต้องล็อกอิน
//  ออนไลน์: RPC get_tv_state (points.sql) / โหมดทดลอง: คำนวณจาก localStorage ด้วย rewardsEngine
// ============================================================

const POLL_MS = 3000 // ถามเซิร์ฟเวอร์ทุก 3 วินาที
export const ALERT_MS = 15000 // เสียงดังแล้ว ตาจ้อง + ขอบจอแดง นานกี่มิลลิวินาที

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

export function useTvState(zoneId) {
  const { cloud } = useAuth()
  const [state, setState] = useState({ data: null, error: '', fetchedAt: 0 })

  const refresh = useCallback(async () => {
    if (cloud) {
      const { data, error } = await supabase.rpc('get_tv_state', { p_zone: zoneId })
      if (error) {
        const missing =
          ['PGRST202', '42883'].includes(error.code) || /could not find the function/i.test(error.message || '')
        // เก็บข้อมูลเดิมไว้โชว์ต่อ แค่ขึ้นป้ายเตือน
        setState((s) => ({
          ...s,
          error: missing ? 'ยังไม่ได้รัน supabase/points.sql เวอร์ชันล่าสุด' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — กำลังลองใหม่',
        }))
        return
      }
      setState({ data, error: '', fetchedAt: Date.now() })
      return
    }
    const now = Date.now()
    const d = E.normalize(readJson('lb2_points_v1', {}))
    setState({ data: E.tvState(d, zoneId, readJson('lb2_bookings_v2', []), now), error: '', fetchedAt: now })
  }, [cloud, zoneId])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    window.addEventListener('storage', refresh) // โหมดทดลอง: กดจำลองเสียงดังจากอีกแท็บ
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', refresh)
    }
  }, [refresh])

  // เหตุการณ์นี้ผ่านมานานเท่าไร — เทียบกับนาฬิกาเซิร์ฟเวอร์ (นาฬิกาเครื่องทีวีอาจเพี้ยน)
  const ageMs = useCallback(
    (iso) =>
      state.data ? Date.parse(state.data.now) - Date.parse(iso) + (Date.now() - state.fetchedAt) : Number.POSITIVE_INFINITY,
    [state],
  )

  return { ...state, ageMs }
}

// ให้คอมโพเนนต์วาดใหม่ทุก ms (นับเวลาถอยหลัง / เวลาเงียบต่อเนื่อง)
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

// เสียงดังล่าสุดที่ยังไม่เกิน ALERT_MS -> { id, seatId, at } หรือ null
export function useNoiseAlert(data, ageMs) {
  useNow(1000)
  const latest = data?.recent?.[0]
  if (!latest || ageMs(latest.at) > ALERT_MS) return null
  return latest
}

// "เงียบมาแล้ว 12 นาที" — นับจากเสียงดังครั้งล่าสุด
export function quietFor(data, ageMs) {
  if (!data?.lastEventAt) return null
  return Math.max(0, Math.floor(ageMs(data.lastEventAt) / 60000))
}

export function formatQuiet(minutes) {
  if (minutes == null) return 'ยังไม่เคยตรวจพบเสียงดัง'
  if (minutes < 1) return 'เพิ่งมีเสียงดังเมื่อครู่'
  if (minutes < 60) return `เงียบต่อเนื่องมาแล้ว ${minutes} นาที`
  const h = Math.floor(minutes / 60)
  return h >= 24 ? `เงียบต่อเนื่องมาแล้ว ${Math.floor(h / 24)} วัน` : `เงียบต่อเนื่องมาแล้ว ${h} ชม. ${minutes % 60} นาที`
}
