import { createClient } from '@supabase/supabase-js'

// ค่าพวกนี้อ่านมาจากไฟล์ .env ที่อยู่ root ของโปรเจกต์
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// ยังไม่ได้ใส่ key -> แอปจะทำงานโหมดทดลอง (เก็บข้อมูลในเครื่อง)
// ใส่ key แล้ว     -> แอปจะเชื่อมฐานข้อมูลจริง
export const isSupabaseEnabled = Boolean(url && anonKey)

export const supabase = isSupabaseEnabled
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

// โปรเจกต์ Supabase แพลนฟรีจะถูก "พัก" เองถ้าไม่มีคนใช้นาน ๆ
// พอถูกพัก โดเมนจะหายไป -> ล็อกอิน/สมัครจะค้างแล้วพัง เลยต้องเช็คก่อน
export async function pingSupabase(timeoutMs = 4000) {
  if (!isSupabaseEnabled) return false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    await fetch(`${url}/auth/v1/health`, { signal: ctrl.signal, headers: { apikey: anonKey } })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// แยกให้ออกว่า "ต่อเน็ตไม่ได้" ต่างจาก "รหัสผ่านผิด"
export function isNetworkError(error) {
  if (!error) return false
  const msg = (error.message || String(error)).toLowerCase()
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('fetch failed')
  )
}
