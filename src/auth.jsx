import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseEnabled, pingSupabase, isNetworkError } from './supabase.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// ---------- โหมดทดลอง (ใช้เมื่อยังไม่ได้ตั้งค่า Supabase หรือฐานข้อมูลถูกพัก) ----------
// เก็บผู้ใช้ไว้ใน localStorage ของเบราว์เซอร์ เพื่อให้ยังทดลองสมัคร/ล็อกอินได้
const USERS_KEY = 'lb2_mock_users'
const SESSION_KEY = 'lb2_mock_session'
const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
const mockUsers = () => readJson(USERS_KEY, [])
const saveMockUsers = (list) => localStorage.setItem(USERS_KEY, JSON.stringify(list))

// ตัดช่องว่าง/ขีดออกจากเบอร์โทร ให้เหลือแต่ตัวเลข (0812345678)
export const normalizePhone = (v) => (v || '').replace(/[^0-9]/g, '')
// ผู้ใช้พิมพ์อะไรมา? ถ้ามี @ ถือว่าเป็นอีเมล ถ้าไม่มีถือว่าเป็นเบอร์โทร
export const looksLikeEmail = (v) => (v || '').includes('@')

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)     // ข้อมูลผู้ใช้ที่ล็อกอินอยู่ (null = ยังไม่ล็อกอิน)
  const [loading, setLoading] = useState(true) // กำลังเช็ค session ตอนเปิดแอปครั้งแรก
  const [offline, setOffline] = useState(false) // ต่อฐานข้อมูลจริงไม่ได้ -> ใช้โหมดทดลอง

  const cloud = isSupabaseEnabled && !offline

  // ตอนเปิดแอป: เช็คว่าฐานข้อมูลออนไลน์ไหม + เคยล็อกอินค้างไว้หรือเปล่า
  useEffect(() => {
    let alive = true
    let subscription = null
    ;(async () => {
      if (isSupabaseEnabled) {
        const backendUp = await pingSupabase()
        if (!alive) return
        if (backendUp) {
          const { data } = await supabase.auth.getSession()
          if (data?.session) await loadProfile(data.session.user)
          if (!alive) return
          setLoading(false)
          // ถ้ามีการล็อกอิน/ออกจากระบบจากที่อื่น (หรืออีกแท็บ) ให้อัปเดตตาม
          const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            // ห้ามเรียกฟังก์ชัน async ของ supabase "ตรง ๆ" ในนี้ — จะทำให้ล็อกค้าง
            // (เช่นกดออกจากระบบแล้วไม่มีอะไรเกิดขึ้น) เลยเลื่อนไปทำนอกรอบด้วย setTimeout
            setTimeout(() => {
              if (!alive) return
              if (session?.user) loadProfile(session.user)
              else setUser(null)
            }, 0)
          })
          subscription = sub.subscription
          return
        }
        setOffline(true)
      }
      // โหมดทดลอง: อ่าน session ที่เก็บไว้ในเครื่อง
      const saved = readJson(SESSION_KEY, null)
      if (saved) setUser(saved)
      setLoading(false)
    })()
    return () => {
      alive = false
      subscription?.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ดึงข้อมูลโปรไฟล์ (ชื่อ-นามสกุล-เบอร์) จากตาราง profiles มาแสดง
  async function loadProfile(authUser) {
    let profile = null
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle()
      profile = data
    } catch { /* ถ้าดึงไม่ได้ ก็ใช้ข้อมูลจาก auth ไปก่อน */ }
    const meta = authUser.user_metadata || {}
    setUser({
      id: authUser.id,
      email: authUser.email,
      firstName: profile?.first_name || meta.first_name || '',
      lastName: profile?.last_name || meta.last_name || '',
      phone: profile?.phone_number || meta.phone_number || '',
    })
  }

  // ---------------- สมัครสมาชิก ----------------
  async function register({ firstName, lastName, phone, email, password }) {
    const cleanPhone = normalizePhone(phone)

    if (cloud) {
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { first_name: firstName, last_name: lastName, phone_number: cleanPhone } },
        })
        if (error) throw error
        // เผื่อ trigger ฝั่งฐานข้อมูลยังไม่ได้ติดตั้ง — เขียนโปรไฟล์ซ้ำให้แน่ใจ
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            first_name: firstName,
            last_name: lastName,
            phone_number: cleanPhone,
            email,
          })
        }
        if (!data.session) {
          return { ok: true, message: 'สมัครสำเร็จ! กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ' }
        }
        await loadProfile(data.user)
        return { ok: true }
      } catch (error) {
        if (!isNetworkError(error)) return { ok: false, message: translateError(error) }
        setOffline(true) // ต่อไม่ติด -> ตกลงมาใช้โหมดทดลองข้างล่าง
      }
    }

    // --- โหมดทดลอง ---
    const users = mockUsers()
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
      return { ok: false, message: 'อีเมลนี้ถูกใช้สมัครไปแล้ว' }
    if (users.some((u) => u.phone === cleanPhone))
      return { ok: false, message: 'เบอร์โทรนี้ถูกใช้สมัครไปแล้ว' }
    const created = { id: crypto.randomUUID(), firstName, lastName, phone: cleanPhone, email, password }
    saveMockUsers([...users, created])
    signInMock(created)
    return { ok: true }
  }

  // ---------------- เข้าสู่ระบบ ----------------
  // identifier = อีเมล หรือ เบอร์โทร ก็ได้
  async function login({ identifier, password }) {
    const id = (identifier || '').trim()

    if (cloud) {
      try {
        let email = id
        if (!looksLikeEmail(id)) {
          // ผู้ใช้กรอกเบอร์โทรมา -> ถามฐานข้อมูลว่าเบอร์นี้คืออีเมลอะไร
          const { data, error } = await supabase.rpc('get_email_by_phone', { p_phone: normalizePhone(id) })
          if (error) throw error
          if (!data) return { ok: false, message: 'ไม่พบผู้ใช้ที่ใช้เบอร์โทรนี้' }
          email = data
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        await loadProfile(data.user)
        return { ok: true }
      } catch (error) {
        if (!isNetworkError(error)) return { ok: false, message: translateError(error) }
        setOffline(true)
      }
    }

    // --- โหมดทดลอง ---
    const found = mockUsers().find((u) =>
      looksLikeEmail(id) ? u.email.toLowerCase() === id.toLowerCase() : u.phone === normalizePhone(id),
    )
    if (!found || found.password !== password)
      return { ok: false, message: 'อีเมล/เบอร์โทร หรือรหัสผ่านไม่ถูกต้อง' }
    signInMock(found)
    return { ok: true }
  }

  function signInMock(u) {
    const session = { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setUser(session)
  }

  async function logout() {
    // เคลียร์ฝั่งหน้าจอก่อน เพื่อให้ปุ่มตอบสนองทันทีแม้เน็ตช้า
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
    if (cloud) {
      try { await supabase.auth.signOut() } catch { /* ออกจากระบบฝั่งเราไปแล้ว */ }
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, offline, cloud, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// แปลข้อความ error ของ Supabase เป็นภาษาไทยที่อ่านรู้เรื่อง
function translateError(error) {
  const msg = (error?.message || '').toLowerCase()
  if (msg.includes('invalid login credentials')) return 'อีเมล/เบอร์โทร หรือรหัสผ่านไม่ถูกต้อง'
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'อีเมลนี้ถูกใช้สมัครไปแล้ว'
  if (msg.includes('password should be')) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'
  if (msg.includes('email not confirmed')) return 'ยังไม่ได้ยืนยันอีเมล กรุณาเช็คกล่องจดหมาย'
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return 'รูปแบบอีเมลไม่ถูกต้อง'
  return error?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
}
