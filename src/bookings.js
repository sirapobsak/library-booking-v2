import { useEffect, useState } from 'react'

// ============================================================
//  การจองที่นั่ง (เวอร์ชันเก็บในเบราว์เซอร์)
//  ตอนนี้บันทึกไว้ใน localStorage ของเครื่องนี้ — คนอื่น/เครื่องอื่นจะยังไม่เห็น
//  ถ้าจะให้ทุกคนเห็นตรงกัน ต้องย้ายไปเก็บในตาราง bookings บน Supabase (งานขั้นถัดไป)
// ============================================================

const KEY = 'lb2_seat_bookings'
// รูปแบบข้อมูล: { [zoneId]: { [seatId]: { userId, name, bookedAt } } }

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {}
  } catch {
    return {}
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* เบราว์เซอร์ไม่ให้เก็บ (เช่นโหมดส่วนตัว) — ใช้ในหน่วยความจำไปก่อน */
  }
}

export function useSeatBookings(zoneId) {
  const [all, setAll] = useState(readAll)

  // เปิดหลายแท็บ: จองในแท็บหนึ่ง อีกแท็บเปลี่ยนสีตามทันที
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === KEY) setAll(readAll())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // อ่านค่าล่าสุดจาก storage ทุกครั้งก่อนแก้ จะได้ไม่ทับการจองที่อีกแท็บเพิ่งทำ
  function update(change) {
    const next = change(readAll())
    writeAll(next)
    setAll(next)
  }

  function book(seatId, user) {
    update((prev) => {
      const zone = prev[zoneId] ?? {}
      if (zone[seatId]) return prev // มีคนจองไปก่อนแล้ว ไม่ทับ
      const booking = {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        bookedAt: new Date().toISOString(),
      }
      return { ...prev, [zoneId]: { ...zone, [seatId]: booking } }
    })
  }

  function cancel(seatId) {
    update((prev) => {
      const { [seatId]: _removed, ...rest } = prev[zoneId] ?? {}
      return { ...prev, [zoneId]: rest }
    })
  }

  return { bookings: all[zoneId] ?? {}, book, cancel }
}
