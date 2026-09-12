import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  BadgeCheck,
  CalendarCheck,
  ChevronDown,
  CircleCheck,
  Coins,
  Flame,
  Gift,
  History,
  Scale,
  ShieldAlert,
  Ticket,
} from 'lucide-react'
import Header from '../components/Header.jsx'
import LevelBadge, { LEVEL_STYLE } from '../components/LevelBadge.jsx'
import { seatName } from '../layouts/index.js'
import { LEVELS, STREAK_MILESTONES, nextMilestone, streakBonus, useMyRewards } from '../points.js'

// ============================================================
//  หน้า "คะแนนสะสม" ของผู้ใช้
//   - บนสุดตรงกลาง: สถิติเงียบติดต่อกันกี่วัน (ไฟลุกเมื่อวันนี้นับแล้ว)
//   - มิเตอร์ A ความประพฤติ (ใช้ตัดสินสิทธิ์) + มิเตอร์ B เหรียญ (เอาไว้แลกคูปอง)
//   - การจองวันนี้ + ปุ่มเช็คอิน, แลกคูปอง, อุทธรณ์ตอนโดนระงับ, กติกา, ประวัติ
// ============================================================

const formatDateTime = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
const formatDate = (iso) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })

// แถบความประพฤติ 0–100 แบ่ง 5 ช่วงตามบันไดสิทธิ์ (ซ้าย = แย่ ขวา = ดี)
const BANDS = ['bg-rose-300', 'bg-red-300', 'bg-orange-300', 'bg-yellow-300', 'bg-green-300']

export default function MyPoints() {
  const { loading, installed, data, checkIn, redeem, appeal } = useMyRewards()
  const [flash, setFlash] = useState(null) // { type: 'ok' | 'error', text }

  // ทำคำสั่งแล้วแสดงผลเป็นแถบข้อความ
  async function run(fn, okText) {
    const r = await fn()
    setFlash(r.ok ? { type: 'ok', text: okText(r.data) } : { type: 'error', text: r.message })
    return r
  }

  let body
  if (!installed) {
    body = (
      <div className="mt-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <p>ระบบคะแนนสะสมยังไม่เปิดใช้งาน (ผู้ดูแลต้องรัน supabase/points.sql เวอร์ชันล่าสุด)</p>
      </div>
    )
  } else if (loading || !data) {
    body = <p className="mt-10 text-center text-slate-500">กำลังโหลด...</p>
  } else {
    body = (
      <>
        <StreakHero data={data} />

        {flash && (
          <div
            role="status"
            className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
              flash.type === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {flash.text}
          </div>
        )}

        {data.level === 'suspended' && (
          <SuspendedCard
            data={data}
            onAppeal={(message) => run(() => appeal(message), () => 'ส่งคำอุทธรณ์แล้ว รอผู้ดูแลพิจารณา')}
          />
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <StandingCard data={data} />
          <CoinsCard data={data} />
        </div>

        <TodayCard
          data={data}
          onCheckIn={(b) =>
            run(
              () => checkIn(b.bookingId),
              () => `เช็คอิน ${seatName(b.zoneId, b.seatId)} แล้ว — ใช้โต๊ะแบบเงียบจนจบการจองเพื่อต่อสถิติ`,
            )
          }
        />

        <CouponShop
          data={data}
          onRedeem={(c) => {
            if (!window.confirm(`แลก${c.name} ใช้ ${c.cost} เหรียญ?`)) return
            run(() => redeem(c.id), (res) => `แลกสำเร็จ! รหัสคูปอง ${res.code} — ยื่นรหัสนี้ให้เจ้าหน้าที่ที่เคาน์เตอร์`)
          }}
        />

        <RulesCard settings={data.settings} />
        <HistoryCard logs={data.logs} />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-center text-sm font-semibold tracking-wide text-slate-400">คะแนนสะสม</h1>
        {body}
      </main>
    </div>
  )
}

// ============================================================
//  สถิติเงียบติดต่อกัน (บนสุดตรงกลาง) — ไฟลุกเมื่อวันนี้นับแล้ว แบบ streak ใน TikTok
// ============================================================
function StreakHero({ data }) {
  const { streak, bestStreak, todayCounted, todayNoisy, today } = data
  const lit = streak > 0 && todayCounted // วันนี้นับแล้ว -> ไฟลุก
  const waiting = streak > 0 && !todayCounted // มีสถิติอยู่ แต่วันนี้ยังไม่นับ -> ไฟหรี่
  const hasUpcoming = today.some((b) => !b.ended)
  const goal = nextMilestone(streak)
  const milestones = goal > 30 ? [...STREAK_MILESTONES, goal] : STREAK_MILESTONES

  const status = todayNoisy
    ? 'วันนี้ตรวจพบเสียงดัง — สถิติเริ่มนับใหม่'
    : todayCounted
      ? 'วันนี้นับแล้ว เก่งมาก! มาต่อสถิติกันใหม่วันที่จองครั้งหน้า'
      : hasUpcoming
        ? `เช็คอินที่โต๊ะแล้วใช้แบบเงียบจนจบการจอง เพื่อต่อเป็น ${streak + 1} วัน`
        : streak > 0
          ? 'วันที่ไม่ได้จองโต๊ะไม่นับ และไม่ตัดสถิติ'
          : 'จองโต๊ะ เช็คอิน แล้วใช้แบบเงียบจนจบการจอง เพื่อเริ่มนับวันแรก'

  return (
    <section className="mt-3 flex flex-col items-center text-center" aria-label="สถิติเงียบติดต่อกัน">
      <div
        className={`grid h-32 w-32 place-items-center rounded-full transition ${
          lit
            ? 'bg-gradient-to-b from-amber-100 to-orange-200 shadow-lg shadow-orange-200'
            : waiting
              ? 'bg-orange-50'
              : 'bg-slate-100'
        }`}
      >
        <Flame
          aria-hidden
          className={`h-20 w-20 ${
            lit
              ? 'flame-flicker fill-orange-400 text-orange-500 drop-shadow-[0_0_14px_rgba(249,115,22,0.55)]'
              : waiting
                ? 'fill-orange-100 text-orange-300'
                : 'fill-slate-200 text-slate-300'
          }`}
        />
      </div>

      <p className="mt-3 text-5xl font-bold tabular-nums text-slate-800">
        {streak}
        <span className="ml-1.5 text-xl font-semibold text-slate-500">วัน</span>
      </p>
      <p className="font-semibold text-slate-600">เงียบติดต่อกัน</p>
      <p
        className={`mt-2 max-w-md rounded-full px-4 py-1.5 text-sm ${
          todayNoisy ? 'bg-rose-50 text-rose-700' : lit ? 'bg-orange-50 text-orange-700' : 'bg-white text-slate-500 ring-1 ring-slate-200'
        }`}
      >
        {status}
      </p>

      {/* เป้าหมายโบนัสเหรียญ 7 / 14 / 30 วัน */}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {milestones.map((m) => {
          const reached = streak >= m
          return (
            <span
              key={m}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                reached
                  ? 'bg-orange-500 text-white'
                  : m === goal
                    ? 'bg-white text-orange-700 ring-2 ring-orange-300'
                    : 'bg-white text-slate-400 ring-1 ring-slate-200'
              }`}
            >
              {reached ? <CircleCheck className="h-3.5 w-3.5" /> : <Flame className="h-3.5 w-3.5" />}
              {m} วัน · +{streakBonus(m)} เหรียญ
            </span>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        อีก {goal - streak} วันถึงโบนัสถัดไป · สถิติดีที่สุด {bestStreak} วัน
      </p>
    </section>
  )
}

// ============================================================
//  มิเตอร์ A — ความประพฤติ
// ============================================================
function StandingCard({ data }) {
  const { standing, level, settings, nextPenalty, nextWeeklyAt } = data
  const info = LEVELS[level]

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <BadgeCheck className="h-4 w-4 text-sky-600" />
          ความประพฤติ
        </p>
        <LevelBadge level={level} />
      </div>
      <p className={`mt-2 text-5xl font-bold tabular-nums ${LEVEL_STYLE[level].text}`}>
        {standing}
        <span className="text-lg font-medium text-slate-400">/100</span>
      </p>

      <div className="relative mt-4" aria-hidden>
        <div className="flex h-2.5 overflow-hidden rounded-full">
          {BANDS.map((c) => (
            <div key={c} className={`flex-1 ${c}`} />
          ))}
        </div>
        <span
          className="absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded-full bg-slate-800 ring-2 ring-white"
          style={{ left: `${standing}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400" aria-hidden>
        {[0, 20, 40, 60, 80, 100].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>

      <ul className="mt-3 space-y-1 text-sm text-slate-600">
        {info.rights.map((r) => (
          <li key={r} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            {r}
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <p>ใช้ตัดสินสิทธิ์อย่างเดียว เอาไปแลกของไม่ได้</p>
        {standing < 100 && (
          <p>
            ไม่ทำผิดจนถึง {formatDate(nextWeeklyAt)} ได้คืนอัตโนมัติ +{settings.weeklyBonus}
          </p>
        )}
        {nextPenalty > 0 ? (
          <p>ถ้าวันนี้โดนเสียงดังอีก ครั้งถัดไปหัก −{nextPenalty}</p>
        ) : (
          <p>วันนี้โดนหักครบยอดสูงสุด ({settings.dailyCap}) แล้ว — ไม่หักเพิ่มจนถึงพรุ่งนี้</p>
        )}
      </div>
    </section>
  )
}

// ============================================================
//  มิเตอร์ B — เหรียญรางวัล
// ============================================================
function CoinsCard({ data }) {
  const { coins, standing, settings } = data
  const earning = standing >= settings.coinGate
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 p-5 text-white shadow-lg shadow-amber-200">
      <Coins className="absolute -right-6 -top-6 h-32 w-32 text-white/15" aria-hidden />
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-50">
        <Coins className="h-4 w-4" />
        เหรียญรางวัล
      </p>
      <p className="mt-2 text-5xl font-bold tabular-nums">{coins}</p>
      <p className="text-amber-50">เหรียญ · เอาไว้แลกคูปอง</p>
      <p className="relative mt-4 rounded-xl bg-white/20 px-3 py-2 text-sm">
        {earning
          ? `กำลังได้เหรียญ — ใช้โต๊ะแบบเงียบจนจบ +${settings.sessionCoins} และโบนัสเมื่อเงียบติดต่อกันครบ 7 / 14 / 30 วัน`
          : `หยุดได้เหรียญชั่วคราว — ความประพฤติต้องกลับมาถึง ${settings.coinGate} ก่อน`}
      </p>
    </section>
  )
}

// ============================================================
//  การจองของฉันวันนี้ + ปุ่มเช็คอิน
// ============================================================
function TodayCard({ data, onCheckIn }) {
  const [busy, setBusy] = useState(null)

  async function press(b) {
    setBusy(b.bookingId)
    await onCheckIn(b)
    setBusy(null)
  }

  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800">
        <CalendarCheck className="h-5 w-5 text-green-600" />
        การจองของฉันวันนี้
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        มาถึงโต๊ะแล้วกด “เช็คอิน” (ได้ตั้งแต่ 15 นาทีก่อนเวลาเริ่ม) — วันนั้นถึงจะนับเป็นวันที่เงียบ
      </p>

      {data.today.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
          วันนี้ยังไม่มีการจอง —{' '}
          <Link to="/" className="font-semibold text-sky-700 hover:underline">
            ไปจองโต๊ะ
          </Link>
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {data.today.map((b) => (
            <li key={b.bookingId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3.5">
              <div>
                <p className="font-semibold text-slate-800">{seatName(b.zoneId, b.seatId)}</p>
                <p className="text-sm text-slate-500">
                  {b.start}–{b.end} น. · {b.isOwner ? 'คุณเป็นคนจอง' : 'เข้าร่วมกับเพื่อน'}
                </p>
              </div>
              <CheckInStatus b={b} busy={busy === b.bookingId} onPress={() => press(b)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CheckInStatus({ b, busy, onPress }) {
  const chip = (cls, text) => <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{text}</span>
  if (b.noisy) return chip('bg-rose-100 text-rose-700', 'ตรวจพบเสียงดัง')
  if (b.checkedIn) return chip('bg-green-100 text-green-700', b.ended ? 'จบแล้ว · เงียบ' : 'เช็คอินแล้ว')
  if (b.canCheckIn) {
    return (
      <button
        type="button"
        onClick={onPress}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
      >
        <CircleCheck className="h-4 w-4" />
        เช็คอิน
      </button>
    )
  }
  if (b.ended) return chip('bg-slate-200 text-slate-600', 'ไม่ได้เช็คอิน')
  return chip('bg-slate-100 text-slate-500', 'เช็คอินได้ 15 นาทีก่อนเริ่ม')
}

// ============================================================
//  แลกคูปอง + คูปองของฉัน
// ============================================================
function CouponShop({ data, onRedeem }) {
  const suspended = data.level === 'suspended'
  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800">
        <Gift className="h-5 w-5 text-violet-600" />
        แลกคูปอง
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {data.catalog.map((c) => {
          const short = data.coins < c.cost
          return (
            <div key={c.id} className="flex flex-col rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
              <Ticket className="h-6 w-6 text-violet-500" />
              <p className="mt-2 font-semibold text-slate-800">{c.name}</p>
              <p className="flex-1 text-xs text-slate-500">{c.description}</p>
              <p className="mt-3 flex items-center gap-1 font-bold text-amber-600">
                <Coins className="h-4 w-4" />
                {c.cost} เหรียญ
              </p>
              <button
                type="button"
                onClick={() => onRedeem(c)}
                disabled={short || suspended}
                className="mt-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {suspended ? 'ถูกระงับอยู่' : short ? `ขาดอีก ${c.cost - data.coins}` : 'แลก'}
              </button>
            </div>
          )
        })}
      </div>

      {data.coupons.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-slate-700">คูปองของฉัน</h3>
          <p className="text-xs text-slate-500">ยื่นรหัสให้เจ้าหน้าที่ที่เคาน์เตอร์เพื่อใช้คูปอง</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {data.coupons.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-mono text-base font-bold tracking-wider text-slate-800">{c.code}</p>
                  <p className="text-xs text-slate-500">
                    {c.name} · แลกเมื่อ {formatDateTime(c.createdAt)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    c.status === 'used' ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-700'
                  }`}
                >
                  {c.status === 'used' ? 'ใช้แล้ว' : 'ยังไม่ได้ใช้'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// ============================================================
//  ถูกระงับการเข้าใช้ + ยื่นอุทธรณ์
// ============================================================
function SuspendedCard({ data, onAppeal }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = data.appeal?.status === 'pending'

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    const r = await onAppeal(message)
    setBusy(false)
    if (r.ok) setMessage('')
  }

  return (
    <section className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-rose-800">
        <ShieldAlert className="h-5 w-5" />
        ระงับการเข้าใช้ชั่วคราว
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-rose-700">
        {data.suspendedUntil ? `ถึง ${formatDateTime(data.suspendedUntil)}` : 'จนกว่าผู้ดูแลจะปลด'} — ระหว่างนี้จอง/เข้าร่วมโต๊ะ
        และแลกคูปองไม่ได้ ครบกำหนดแล้วความประพฤติกลับมาที่ 20 (จำกัดระดับ 2) อัตโนมัติ
      </p>

      {pending ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-600">
          <Scale className="h-4 w-4 text-slate-400" />
          ส่งคำอุทธรณ์แล้ว รอผู้ดูแลพิจารณา
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-2">
          {data.appeal?.status === 'rejected' && (
            <p className="text-sm text-rose-700">
              คำอุทธรณ์ครั้งก่อนไม่ผ่าน{data.appeal.adminNote ? `: ${data.appeal.adminNote}` : ''}
            </p>
          )}
          <label className="block">
            <span className="label">ยื่นอุทธรณ์ (อธิบายเหตุผลให้ผู้ดูแล)</span>
            <textarea
              className="field min-h-[5rem]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              placeholder="เช่น ตอนนั้นเซนเซอร์จับเสียงจากโต๊ะข้าง ๆ"
            />
          </label>
          <button
            type="submit"
            disabled={busy || message.trim().length < 5}
            className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            ส่งคำอุทธรณ์
          </button>
        </form>
      )}
    </section>
  )
}

// ============================================================
//  กติกา (พับเก็บได้)
// ============================================================
function RulesCard({ settings: s }) {
  return (
    <details className="group mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-slate-800">
        กติกาคะแนน
        <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
      </summary>

      <div className="mt-4 space-y-5 text-sm leading-relaxed text-slate-600">
        <div>
          <h3 className="font-semibold text-slate-800">โดนหักความประพฤติเมื่อไร</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>เซนเซอร์ที่โต๊ะนับเสียงคนพูดดังเกิน 65 dB ครบ 5 วินาที = 1 ครั้ง (เงียบเกิน 10 วินาทีระหว่างนับ = ไม่นับ)</li>
            <li>ครั้งที่ 1–2 แค่ไฟเตือน (เขียว → เหลือง) · ตั้งแต่ครั้งที่ 3 (ไฟแดง) หักทุกคนในการจองโต๊ะนั้น</li>
            <li>
              ครั้งแรกของวัน −{s.noisePenalty} แล้วแรงขึ้นครั้งละ {s.penaltyStep} (สูงสุด −{s.penaltyMax} ต่อครั้ง) รวมไม่เกิน −
              {s.dailyCap} ต่อวัน
            </li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-slate-800">ได้ความประพฤติคืน 4 ทาง</h3>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>
              คืนทันที: โดนหักแล้วเงียบต่อเนื่อง {s.refundMinutes} นาที (ยังนั่งอยู่) คืน {s.refundPercent}% ของที่เพิ่งเสีย
            </li>
            <li>จบการจองแบบเงียบ (เช็คอินแล้ว + ไม่โดนหัก) +{s.sessionBonus} (วันละครั้ง)</li>
            <li>ฟื้นเองตามเวลา: ทุกสัปดาห์ที่ไม่ทำผิดเลย +{s.weeklyBonus} จนกลับไปถึง 100</li>
            <li>พฤติกรรมดีอื่น ๆ เช่นคืนหนังสือตรงเวลา — ผู้ดูแลเพิ่มให้</li>
          </ol>
        </div>

        <div>
          <h3 className="font-semibold text-slate-800">ได้เหรียญอย่างไร</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>ใช้โต๊ะแบบเงียบจนจบการจอง +{s.sessionCoins} เหรียญ</li>
            <li>เงียบติดต่อกันครบ 7 วัน +10 / 14 วัน +20 / 30 วัน +50 (ทุก ๆ 30 วันต่อจากนั้น +50)</li>
            <li>ได้เหรียญเฉพาะตอนความประพฤติ ≥ {s.coinGate} — ถ้ากำลังโดนจำกัดสิทธิ์ จะหยุดได้เหรียญจนกว่าจะไต่กลับมา</li>
            <li>“วันที่เงียบ” = วันที่จองโต๊ะ + เช็คอิน + ไม่โดนหักเลยทั้งวัน · วันที่ไม่ได้จองไม่นับและไม่ตัดสถิติ</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-slate-800">บันไดสิทธิ์ตามความประพฤติ</h3>
          <ul className="mt-2 space-y-1.5">
            {Object.entries(LEVELS).map(([id, l]) => (
              <li key={id} className="flex flex-wrap items-start gap-2">
                <span className="w-14 shrink-0 font-semibold tabular-nums text-slate-700">{l.range}</span>
                <LevelBadge level={id} />
                <span className="text-slate-500">{l.rights.join(' · ')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">ต่ำกว่า 20 = ระงับ {s.suspendDays} วัน ยื่นอุทธรณ์ได้</p>
        </div>
      </div>
    </details>
  )
}

// ============================================================
//  ประวัติล่าสุด
// ============================================================
function HistoryCard({ logs }) {
  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800">
        <History className="h-5 w-5 text-slate-500" />
        ประวัติล่าสุด
      </h2>
      {logs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">ยังไม่มีการเปลี่ยนแปลง</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {logs.map((l) => (
            <li key={l.id} className="flex items-start gap-3 py-2.5">
              <span
                className={`w-12 shrink-0 text-right font-bold tabular-nums ${l.delta < 0 ? 'text-rose-600' : 'text-green-600'}`}
              >
                {l.delta > 0 ? `+${l.delta}` : l.delta}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-700">{l.reason}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${
                      l.meter === 'coins' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {l.meter === 'coins' ? 'เหรียญ' : 'ความประพฤติ'}
                  </span>
                  <span>
                    เหลือ {l.balanceAfter} · {formatDateTime(l.createdAt)}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
