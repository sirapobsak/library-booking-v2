import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Loader2, Users } from 'lucide-react'
import { joinUrl, useBookingApi } from '../bookings.js'

// QR + รหัส 6 หลักของการจองหลายคน พร้อมรายชื่อคนที่เข้าร่วมแล้ว (อัปเดตเองทุก 5 วินาที)
// ใช้ได้ทั้งตอนจองเสร็จ (มี code มาแล้ว) และตอนกดดู QR ย้อนหลัง (โหลด code จากรายละเอียดการจอง)
export default function BookingQr({ bookingId, code: initialCode, partySize: initialSize }) {
  const api = useBookingApi()
  const [detail, setDetail] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const d = await api.detail(bookingId)
        if (alive && d) setDetail(d)
      } catch {
        /* โหลดไม่ได้ชั่วคราว — ลองใหม่รอบถัดไป */
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [api, bookingId])

  const code = detail?.code ?? initialCode
  const partySize = detail?.partySize ?? initialSize
  const members = detail?.members ?? []

  if (!code) {
    return (
      <div className="grid place-items-center py-10 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const url = joinUrl(code)
  const joined = members.length + 1 // +1 = คนจอง
  const percent = Math.min(100, Math.round((joined / partySize) * 100))

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* บางเบราว์เซอร์ไม่อนุญาตให้คัดลอก */
    }
  }

  return (
    <div className="space-y-5 text-center">
      <p className="text-sm text-slate-600">
        ให้เพื่อนที่มานั่งด้วย <b>สแกน QR นี้ด้วยกล้องมือถือ</b> แล้วเข้าสู่ระบบด้วยบัญชีของตัวเอง
      </p>

      <div className="mx-auto w-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <QRCodeSVG value={url} size={196} level="M" />
      </div>

      <div>
        <p className="text-sm text-slate-500">หรือกรอกรหัสนี้ที่เมนู “เข้าร่วมด้วยรหัส”</p>
        <p className="mt-1 font-mono text-4xl font-bold tracking-[0.3em] text-slate-800">{code}</p>
      </div>

      <button
        type="button"
        onClick={copyLink}
        className="mx-auto flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        {copied ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์เข้าร่วม'}
      </button>

      {/* คนที่เข้าร่วมแล้ว */}
      <div className="rounded-2xl bg-slate-50 p-4 text-left">
        <p className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            เข้าร่วมแล้ว
          </span>
          <span>
            {joined}/{partySize} คน
          </span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          <li>• คนจอง</li>
          {members.map((m, i) => (
            <li key={i}>• {m.name || 'ผู้ใช้'}</li>
          ))}
          {joined < partySize && <li className="text-slate-400">รออีก {partySize - joined} คน…</li>}
        </ul>
      </div>
    </div>
  )
}
