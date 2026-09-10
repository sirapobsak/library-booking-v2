import { useState } from 'react'
import { CalendarDays, CircleCheck, Clock, Loader2, Minus, Plus, Users } from 'lucide-react'
import Modal from './Modal.jsx'
import BookingQr from './BookingQr.jsx'
import { MAX_PARTY, fromMinutes, nowMinutes, toMinutes, useBookingApi } from '../bookings.js'
import { seatName } from '../layouts/index.js'

const LAST_MINUTE = 23 * 60 + 59 // จองได้ถึง 23:59 ของวันนี้

// เวลาเริ่มตั้งต้น = ครึ่งชั่วโมงถัดไป (เช่นตอนนี้ 14:07 -> 14:30) และจบหลังจากนั้น 1 ชั่วโมง
function defaultTimes() {
  const start = Math.min(Math.ceil(nowMinutes() / 30) * 30, 23 * 60 + 30)
  return { start: fromMinutes(start), end: fromMinutes(Math.min(start + 60, LAST_MINUTE)) }
}

// หน้าต่างจองที่นั่ง: ถาม "กี่โมงถึงกี่โมง" + "กี่คน"
// ถ้ามากกว่า 1 คน พอจองเสร็จจะแสดง QR/รหัส 6 หลักให้คนอื่นสแกนเข้าร่วม
export default function BookingModal({ zoneId, seatId, date, taken, onClose, onBooked }) {
  const api = useBookingApi()
  const [initial] = useState(defaultTimes)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [party, setParty] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null) // การจองที่เพิ่งสร้างสำเร็จ

  const name = seatName(zoneId, seatId)
  const todayLabel = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })

  function setDuration(hours) {
    setEnd(fromMinutes(Math.min(toMinutes(start) + hours * 60, LAST_MINUTE)))
    setError('')
  }

  // ตรวจเวลาในเครื่องก่อน จะได้บอกผู้ใช้ได้ทันทีไม่ต้องรอเซิร์ฟเวอร์
  function validate() {
    if (!start || !end) return 'กรุณาเลือกเวลาเริ่มและเวลาสิ้นสุด'
    const s = toMinutes(start)
    const e = toMinutes(end)
    if (e <= s) return 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'
    if (s < nowMinutes() - 15) return 'เวลาเริ่มผ่านไปแล้ว เลือกเวลาตั้งแต่ตอนนี้เป็นต้นไป'
    const clash = taken.find((b) => s < toMinutes(b.end) && toMinutes(b.start) < e)
    if (clash) return `ช่วงเวลานี้ทับกับการจอง ${clash.start}–${clash.end} น.`
    return ''
  }

  async function submit(event) {
    event.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    const result = await api.create({ zoneId, seatId, date, start, end, partySize: party })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setDone(result.booking)
    onBooked()
  }

  // ---------------- จองสำเร็จ ----------------
  if (done) {
    return (
      <Modal title="จองสำเร็จ" onClose={onClose}>
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-green-50 p-4 text-left">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div className="text-sm">
            <p className="font-semibold text-green-800">{name}</p>
            <p className="text-green-700">
              วันนี้ {done.start}–{done.end} น. · {done.partySize} คน
            </p>
          </div>
        </div>

        {done.partySize > 1 ? (
          <BookingQr bookingId={done.id} code={done.code} partySize={done.partySize} />
        ) : (
          <p className="text-center text-sm text-slate-500">จองคนเดียว ไม่ต้องใช้ QR — มานั่งตามเวลาได้เลย</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-green-600 px-4 py-3 font-semibold text-white transition hover:bg-green-700"
        >
          เสร็จสิ้น
        </button>
      </Modal>
    )
  }

  // ---------------- ฟอร์มจอง ----------------
  return (
    <Modal title={`จอง${name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-6">
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <CalendarDays className="h-4 w-4" />
          {todayLabel}
        </p>

        {/* จองกี่โมงถึงกี่โมง */}
        <div>
          <p className="label flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            จองกี่โมงถึงกี่โมง
          </p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input
              type="time"
              className="field"
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                setError('')
              }}
              aria-label="เวลาเริ่ม"
              required
            />
            <span className="text-sm text-slate-400">ถึง</span>
            <input
              type="time"
              className="field"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value)
                setError('')
              }}
              aria-label="เวลาสิ้นสุด"
              required
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setDuration(h)}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-green-400 hover:bg-green-50 hover:text-green-700"
              >
                {h} ชั่วโมง
              </button>
            ))}
          </div>
          {taken.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              ช่วงที่มีคนจองแล้ววันนี้: {taken.map((b) => `${b.start}–${b.end}`).join(', ')} น.
            </p>
          )}
        </div>

        {/* จองกี่คน */}
        <div>
          <p className="label flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            จองกี่คน (รวมตัวคุณ)
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setParty((p) => Math.max(1, p - 1))}
              disabled={party <= 1}
              aria-label="ลดจำนวนคน"
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-12 text-center text-2xl font-bold text-slate-800" aria-live="polite">
              {party}
            </span>
            <button
              type="button"
              onClick={() => setParty((p) => Math.min(MAX_PARTY, p + 1))}
              disabled={party >= MAX_PARTY}
              aria-label="เพิ่มจำนวนคน"
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
            <span className="text-sm text-slate-500">คน</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {party > 1
              ? `จองเสร็จแล้วจะได้ QR และรหัส 6 หลัก ให้อีก ${party - 1} คนสแกนเข้าร่วมด้วยบัญชีของตัวเอง`
              : 'จองคนเดียว ไม่ต้องใช้ QR'}
          </p>
        </div>

        {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            ยืนยันการจอง
          </button>
        </div>
      </form>
    </Modal>
  )
}
