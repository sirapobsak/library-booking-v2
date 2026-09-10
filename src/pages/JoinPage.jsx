import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, CircleCheck, Loader2, QrCode, TriangleAlert, User, Users } from 'lucide-react'
import Header from '../components/Header.jsx'
import { isActive, useBookingApi } from '../bookings.js'
import { getZone } from '../data.js'
import { seatName } from '../layouts/index.js'

const thaiDate = (d) =>
  new Date(`${d}T00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })

// หน้าเข้าร่วมโต๊ะ — เปิดจาก QR (/join/123456) หรือกรอกรหัสเอง (/join)
// ต้องล็อกอินก่อนเสมอ (App.jsx พาไปหน้าล็อกอินแล้วพากลับมาที่นี่ให้เอง)
export default function JoinPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const api = useBookingApi()

  const [input, setInput] = useState(code ?? '')
  const [inputError, setInputError] = useState('')
  const [lookup, setLookup] = useState({ loading: Boolean(code), booking: null, error: '' })
  const [joinState, setJoinState] = useState({ busy: false, error: '', done: false })

  // มีรหัสใน URL -> ไปค้นหาการจองนั้น
  useEffect(() => {
    setInput(code ?? '')
    setJoinState({ busy: false, error: '', done: false })
    if (!code) {
      setLookup({ loading: false, booking: null, error: '' })
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setLookup({ loading: false, booking: null, error: 'รหัสต้องเป็นตัวเลข 6 หลัก' })
      return
    }
    let alive = true
    setLookup({ loading: true, booking: null, error: '' })
    api.findByCode(code).then((r) => {
      if (alive) setLookup({ loading: false, booking: r.ok ? r.booking : null, error: r.ok ? '' : r.message })
    })
    return () => {
      alive = false
    }
  }, [code, api])

  function submitCode(e) {
    e.preventDefault()
    const digits = input.replace(/\D/g, '')
    if (digits.length !== 6) {
      setInputError('กรอกรหัสตัวเลขให้ครบ 6 หลัก')
      return
    }
    setInputError('')
    navigate(`/join/${digits}`)
  }

  async function joinNow() {
    setJoinState({ busy: true, error: '', done: false })
    const r = await api.join(code)
    if (!r.ok) {
      setJoinState({ busy: false, error: r.message, done: false })
      return
    }
    const again = await api.findByCode(code) // โหลดใหม่ให้จำนวนคนอัปเดต
    if (again.ok) setLookup((l) => ({ ...l, booking: again.booking }))
    setJoinState({ busy: false, error: '', done: true })
  }

  const b = lookup.booking

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="mx-auto max-w-lg px-5 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปเลือกโซน
        </Link>

        <div className="mt-5 flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-green-100 text-green-700">
            <QrCode className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">เข้าร่วมโต๊ะ</h1>
            <p className="mt-1 text-slate-500">สแกน QR จากเพื่อน หรือกรอกรหัส 6 หลักที่เพื่อนส่งให้</p>
          </div>
        </div>

        {/* ช่องกรอกรหัส */}
        <form onSubmit={submitCode} className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="label" htmlFor="join-code">
            รหัส 6 หลัก
          </label>
          <div className="flex gap-2">
            <input
              id="join-code"
              className={`field text-center font-mono text-xl tracking-[0.3em] ${inputError ? 'field-error' : ''}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={input}
              onChange={(e) => {
                setInput(e.target.value.replace(/\D/g, '').slice(0, 6))
                setInputError('')
              }}
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-green-600 px-5 font-semibold text-white transition hover:bg-green-700"
            >
              ค้นหา
            </button>
          </div>
          {inputError && <p className="mt-1.5 text-sm text-rose-600">{inputError}</p>}
        </form>

        {/* ผลการค้นหา */}
        {lookup.loading && (
          <div className="mt-6 grid place-items-center py-10 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {!lookup.loading && lookup.error && (
          <p className="mt-6 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {lookup.error}
          </p>
        )}

        {!lookup.loading && b && (
          <BookingCard booking={b} joinState={joinState} onJoin={joinNow} />
        )}
      </main>
    </div>
  )
}

function BookingCard({ booking: b, joinState, onJoin }) {
  const zone = getZone(b.zoneId)
  const occupied = b.memberCount + 1 // +1 = คนจอง
  const full = occupied >= b.partySize
  const expired = !isActive(b)

  return (
    <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-green-500 to-green-700 p-5 text-white">
        <p className="text-sm text-green-100">{zone?.name ?? b.zoneId}</p>
        <p className="mt-0.5 text-xl font-bold">{seatName(b.zoneId, b.seatId)}</p>
      </div>

      <div className="space-y-4 p-5">
        <dl className="space-y-2 text-sm">
          <Row icon={CalendarDays} label="เวลา">
            {thaiDate(b.date)} · {b.start}–{b.end} น.
          </Row>
          <Row icon={User} label="คนจอง">
            {b.ownerName || 'ผู้ใช้'}
          </Row>
          <Row icon={Users} label="จำนวนคน">
            {occupied}/{b.partySize} คน
          </Row>
        </dl>

        {b.isMine ? (
          <Status tone="slate">นี่คือการจองของคุณ — ส่ง QR/รหัสนี้ให้เพื่อนสแกนเข้าร่วม</Status>
        ) : b.isMember ? (
          <Status tone="green">
            {joinState.done ? 'เข้าร่วมสำเร็จ! ' : ''}คุณเข้าร่วมโต๊ะนี้แล้ว
          </Status>
        ) : expired ? (
          <Status tone="slate">การจองนี้หมดเวลาแล้ว</Status>
        ) : full ? (
          <Status tone="amber">โต๊ะนี้มีคนเข้าร่วมครบจำนวนแล้ว</Status>
        ) : (
          <>
            {joinState.error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{joinState.error}</p>}
            <button
              type="button"
              onClick={onJoin}
              disabled={joinState.busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
            >
              {joinState.busy && <Loader2 className="h-4 w-4 animate-spin" />}
              เข้าร่วมโต๊ะนี้ด้วยบัญชีของฉัน
            </button>
          </>
        )}

        <Link
          to={`/zone/${b.zoneId}`}
          className="block text-center text-sm font-medium text-green-700 hover:underline"
        >
          ดูผังที่นั่งของ{zone?.name ?? 'โซนนี้'}
        </Link>
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <dt className="w-20 shrink-0 text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{children}</dd>
    </div>
  )
}

function Status({ tone, children }) {
  const tones = {
    green: 'border-green-200 bg-green-50 text-green-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }
  return (
    <p className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium ${tones[tone]}`}>
      {tone === 'green' && <CircleCheck className="h-4 w-4 shrink-0" />}
      {children}
    </p>
  )
}
