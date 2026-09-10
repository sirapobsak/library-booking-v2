import { useState } from 'react'
import {
  CalendarClock,
  DoorClosed,
  LayoutGrid,
  MousePointerClick,
  QrCode,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react'
import BookingModal from './BookingModal.jsx'
import BookingQr from './BookingQr.jsx'
import Modal from './Modal.jsx'
import { isActive, useBookingApi, useZoneBookings } from '../bookings.js'
import { seatName } from '../layouts/index.js'
import { CANVAS, KIND_INFO, KIND_LABEL, QUIET_SEATS } from '../layouts/quietZone.js'

const ZONE_ID = 'quiet'

// ไอคอนประจำที่นั่งแต่ละแบบ (ใช้ในกล่องรายละเอียด)
const KIND_ICON = { carrel: LayoutGrid, table: Users, desk: User, room: DoorClosed }

// ---------- โทนสีของผัง (แก้สีทั้งผังได้ที่นี่ที่เดียว) ----------
const C = {
  wall: '#1e293b', // ผนัง
  floor: '#fdfcf8', // พื้นในโซน (ขาวอมครีม)
  corridor: '#eef1f5', // พื้นที่นอกโซนด้านล่าง/ขวา
  room: '#f1f5f9', // ห้องอื่น ๆ ที่ไม่ใช่ที่นั่ง
  wcMale: '#e0f2fe', // ห้องน้ำชาย (ฟ้าอ่อน)
  wcFemale: '#fce7f3', // ห้องน้ำหญิง (ชมพูอ่อน)
  wood: '#eadcc3', // เฟอร์นิเจอร์/โครงสร้างในแปลน (สีไม้)
  woodEdge: '#8b6b43',
}

// หน้าตาที่นั่งตามสถานะ: ว่าง / มีคนจอง  x  เลือกอยู่ / ไม่ได้เลือก
const SEAT_STYLE = {
  free: { fill: 'url(#qz-seat)', stroke: '#16a34a', text: '#14532d' },
  freeSelected: { fill: 'url(#qz-seat-selected)', stroke: '#14532d', text: '#ffffff', ring: '#4ade80' },
  booked: { fill: 'url(#qz-seat-booked)', stroke: '#dc2626', text: '#7f1d1d' },
  bookedSelected: { fill: 'url(#qz-seat-booked-selected)', stroke: '#7f1d1d', text: '#ffffff', ring: '#fca5a5' },
}

export default function QuietFloorPlan() {
  const api = useBookingApi()
  const { bookings, refresh, date, isLocal } = useZoneBookings(ZONE_ID)
  const [selectedId, setSelectedId] = useState(null)
  const [bookingOpen, setBookingOpen] = useState(false) // เปิดหน้าต่างจองอยู่ไหม
  const [qrFor, setQrFor] = useState(null) // การจองที่กำลังเปิดดู QR

  // เอาเฉพาะการจองที่ยังไม่จบ แล้วจัดกลุ่มตามที่นั่ง -> ที่นั่งไหนมีการจองเป็นสีแดง
  const activeBySeat = {}
  for (const b of bookings) {
    if (!isActive(b)) continue
    if (!activeBySeat[b.seatId]) activeBySeat[b.seatId] = []
    activeBySeat[b.seatId].push(b)
  }

  const selected = QUIET_SEATS.find((s) => s.id === selectedId)
  const selectedBookings = selected ? activeBySeat[selected.id] ?? [] : []
  const toggleSeat = (id) => setSelectedId((prev) => (prev === id ? null : id))

  async function cancel(b) {
    if (!window.confirm(`ยกเลิกการจอง ${b.start}–${b.end} น. ใช่ไหม?`)) return
    const result = await api.cancel(b.id)
    if (!result.ok) window.alert(result.message)
    refresh()
  }

  return (
    <div className="space-y-4">
      {/* ================= การ์ดผังที่นั่ง ================= */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-800">ผังที่นั่ง</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
            <Legend swatch="border-green-600 bg-green-200">ที่นั่งว่าง</Legend>
            <Legend swatch="border-green-900 bg-green-700">ที่เลือก</Legend>
            <Legend swatch="border-red-600 bg-red-300">ถูกจองแล้ว</Legend>
            <Legend swatch="border-sky-300 bg-sky-100">ห้องน้ำชาย</Legend>
            <Legend swatch="border-pink-300 bg-pink-100">ห้องน้ำหญิง</Legend>
          </div>
        </div>

        {/* จอเล็กเลื่อนดูซ้ายขวาได้ */}
        <div className="overflow-x-auto p-3 sm:p-5">
          <svg
            viewBox={`${CANVAS.x} ${CANVAS.y} ${CANVAS.width} ${CANVAS.height}`}
            className="mx-auto h-auto w-full min-w-[560px] max-w-[780px]"
            role="group"
            aria-label="ผังที่นั่งโซนเงียบ"
          >
            <Defs />
            <Structure />

            {/* ================= ที่นั่ง (วางทับบนแปลน) ================= */}
            {QUIET_SEATS.map((seat) => {
              const isSelected = seat.id === selectedId
              const isBooked = Boolean(activeBySeat[seat.id])
              const isRoom = seat.kind === 'room'
              const style = SEAT_STYLE[`${isBooked ? 'booked' : 'free'}${isSelected ? 'Selected' : ''}`]
              // ชื่อบนช่อง: ห้องใช้ชื่อห้อง, โต๊ะเดี่ยวใช้รหัส, ช่องเล็ก (C/T) ไม่ใส่เพราะตัวหนังสือจะเล็กเกินอ่าน
              const label = isRoom ? seat.label : seat.kind === 'desk' ? seat.id : null
              const name = `${KIND_LABEL[seat.kind]} ${seat.id}${isBooked ? ' (ถูกจองแล้ว)' : ''}`

              return (
                <g
                  key={seat.id}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  aria-pressed={isSelected}
                  onClick={() => toggleSeat(seat.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleSeat(seat.id)
                    }
                  }}
                  className="cursor-pointer outline-none hover:brightness-95 [&:focus-visible>rect.qz-seat]:stroke-sky-500 [&:focus-visible>rect.qz-seat]:[stroke-width:5px]"
                >
                  <title>{name}</title>

                  {/* วงเรืองแสงรอบที่นั่งที่เลือก */}
                  {isSelected && (
                    <rect
                      x={seat.x - 7}
                      y={seat.y - 7}
                      width={seat.w + 14}
                      height={seat.h + 14}
                      rx={isRoom ? 12 : 10}
                      fill="none"
                      stroke={style.ring}
                      strokeWidth="5"
                      opacity="0.85"
                    />
                  )}

                  <rect
                    className="qz-seat"
                    x={seat.x}
                    y={seat.y}
                    width={seat.w}
                    height={seat.h}
                    rx={isRoom ? 7 : 6}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth="2.5"
                    filter="url(#qz-shadow)"
                  />

                  {label && (
                    <text
                      x={seat.x + seat.w / 2}
                      y={seat.y + seat.h / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={isRoom ? 26 : 18}
                      fontWeight="700"
                      fill={style.text}
                      className="pointer-events-none select-none"
                    >
                      {label}
                    </text>
                  )}
                </g>
              )
            })}

            <DoorOverlay />
          </svg>
        </div>
        <p className="px-5 pb-4 text-xs text-slate-400 lg:hidden">เลื่อนผังไปทางซ้าย-ขวาเพื่อดูส่วนที่เหลือ</p>
      </section>

      {/* ยังไม่ได้รัน supabase/bookings.sql -> บอกตรง ๆ ว่าการจองยังเห็นแค่ในเครื่องนี้ */}
      {isLocal && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            ตอนนี้การจองบันทึกไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น เพื่อนที่สแกน QR จากเครื่องอื่นจะยังเข้าร่วมไม่ได้ —
            ผู้ดูแลต้องรัน <code className="rounded bg-amber-100 px-1">supabase/bookings.sql</code> บน Supabase ก่อน
          </span>
        </div>
      )}

      {/* ================= กล่องจองที่นั่ง (ใต้ผัง) ================= */}
      <BookingPanel
        seat={selected}
        seatBookings={selectedBookings}
        onBook={() => setBookingOpen(true)}
        onShowQr={setQrFor}
        onCancel={cancel}
        onClose={() => setSelectedId(null)}
      />

      {bookingOpen && selected && (
        <BookingModal
          zoneId={ZONE_ID}
          seatId={selected.id}
          date={date}
          taken={selectedBookings}
          onClose={() => setBookingOpen(false)}
          onBooked={refresh}
        />
      )}

      {qrFor && (
        <Modal title={`QR เข้าร่วม · ${seatName(ZONE_ID, qrFor.seatId)}`} onClose={() => setQrFor(null)}>
          <BookingQr bookingId={qrFor.id} code={qrFor.code} partySize={qrFor.partySize} />
        </Modal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// ชิ้นส่วนย่อยของ UI
// ---------------------------------------------------------------
function Legend({ swatch, children }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded border ${swatch}`} />
      {children}
    </span>
  )
}

function Tag({ tone, children }) {
  const tones = { red: 'bg-red-100 text-red-700', green: 'bg-green-100 text-green-700' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

function BookingPanel({ seat, seatBookings, onBook, onShowQr, onCancel, onClose }) {
  // ยังไม่ได้เลือกที่นั่ง -> แถบคำแนะนำ
  if (!seat) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-dashed border-slate-300 bg-white/60 px-5 py-4 text-sm text-slate-500">
        <MousePointerClick className="h-5 w-5 shrink-0 text-slate-400" />
        <span>
          กดที่ช่อง<span className="font-semibold text-green-700">สีเขียว</span>ในผังเพื่อเลือกที่นั่ง ·
          ช่อง<span className="font-semibold text-red-600">สีแดง</span>คือที่นั่งที่มีคนจองแล้ว
        </span>
      </div>
    )
  }

  const Icon = KIND_ICON[seat.kind]
  const booked = seatBookings.length > 0

  return (
    <div className={`rounded-3xl border p-5 ${booked ? 'border-red-200 bg-red-50/60' : 'border-green-200 bg-green-50/60'}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
              booked ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
            }`}
          >
            <Icon className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-bold text-slate-800">
              {seat.label ?? seat.id}{' '}
              <span className="text-sm font-medium text-slate-500">
                {KIND_LABEL[seat.kind]} · รหัส {seat.id}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-slate-600">{KIND_INFO[seat.kind]}</p>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onBook}
            className="rounded-xl bg-green-600 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-[.98]"
          >
            {booked ? 'จองช่วงเวลาอื่น' : 'จองที่นั่งนี้'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            ปิด
          </button>
        </div>
      </div>

      {/* รายการจองของที่นั่งนี้วันนี้ */}
      {booked && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">การจองวันนี้</p>
          {seatBookings.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <CalendarClock className="h-4 w-4 text-red-500" />
                <span className="font-semibold text-slate-800">
                  {b.start}–{b.end} น.
                </span>
                <span className="text-slate-500">
                  {b.memberCount + 1}/{b.partySize} คน
                </span>
                {b.isMine && <Tag tone="red">การจองของคุณ</Tag>}
                {b.isMember && <Tag tone="green">คุณเข้าร่วมแล้ว</Tag>}
              </div>

              {b.isMine && (
                <div className="flex gap-2">
                  {b.partySize > 1 && (
                    <button
                      type="button"
                      onClick={() => onShowQr(b)}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <QrCode className="h-4 w-4" />
                      QR / รหัส
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onCancel(b)}
                    className="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    ยกเลิกการจอง
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// ของตกแต่งผัง: สีไล่ระดับ เงา ลายพื้น (ใช้ id ขึ้นต้น qz- กันชนกับ SVG อื่น)
// ---------------------------------------------------------------
function Defs() {
  return (
    <defs>
      {/* ลายจุดจาง ๆ นอกอาคาร ให้ดูเหมือนกระดาษแปลน */}
      <pattern id="qz-dots" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.6" fill="#e2e8f0" />
      </pattern>
      {/* ลายเส้นเฉียงสำหรับเสา/โครงสร้างทึบ */}
      <pattern id="qz-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="12" height="12" fill="#e2e8f0" />
        <line x1="0" y1="0" x2="0" y2="12" stroke="#94a3b8" strokeWidth="3" />
      </pattern>
      {/* ที่นั่งว่าง (เขียว) */}
      <linearGradient id="qz-seat" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#bbf7d0" />
        <stop offset="1" stopColor="#86efac" />
      </linearGradient>
      <linearGradient id="qz-seat-selected" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#22c55e" />
        <stop offset="1" stopColor="#15803d" />
      </linearGradient>
      {/* ที่นั่งที่ถูกจองแล้ว (แดง) */}
      <linearGradient id="qz-seat-booked" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fecaca" />
        <stop offset="1" stopColor="#f87171" />
      </linearGradient>
      <linearGradient id="qz-seat-booked-selected" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ef4444" />
        <stop offset="1" stopColor="#b91c1c" />
      </linearGradient>
      <filter id="qz-shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#1e293b" floodOpacity="0.22" />
      </filter>
    </defs>
  )
}

// ---------------------------------------------------------------
// โครงสร้างอาคาร (ไม่ใช่ที่นั่ง) — ลอกตามแปลนเวอร์ชันล่าสุด
// พิกัดเป็นตำแหน่งพิกเซลบนรูปแปลน ใช้ระบบเดียวกับที่นั่งใน quietZone.js
// ⚠️ เส้น/พิกัดทุกเส้นตรงกับแปลน — ปรับหน้าตาได้ที่สี (ตัวแปร C) อย่าขยับพิกัด
// ---------------------------------------------------------------
function Structure() {
  return (
    <>
      {/* ---------- พื้นหลัง ---------- */}
      <rect x={CANVAS.x} y={CANVAS.y} width={CANVAS.width} height={CANVAS.height} fill="url(#qz-dots)" />

      {/* พื้นในโซน = รูปเดียวกับผนังรอบนอกพอดี */}
      <path
        d="M300 1110 V122 H660 V3 H965 V315 L1025 380 L968 432 V565 L995 592 V775 L968 802 L1025 865 L905 990 V1110 Z"
        fill={C.floor}
      />
      {/* พื้นที่นอกโซนรูปตัวแอล (ขอบล่าง + เฉียงออกไปทางขวา) */}
      <path
        d="M285 1110 H905 V990 L1025 865 L1090 805 H1385 V868 H1150 L1030 985 V1228 H285 Z"
        fill={C.corridor}
      />

      {/* ---------- สีพื้นห้องในแถบซ้าย ---------- */}
      <g stroke="none">
        <path d="M300 122 H425 V248 H300 Z M300 248 H425 V412 H300 Z" fill={C.room} />
        <path d="M300 412 H565 V495 H300 Z M300 495 H425 V570 H300 Z" fill={C.room} />
        <path d="M300 570 H425 V657 H300 Z" fill={C.wcMale} />
        <path d="M300 657 H425 V742 H300 Z" fill={C.wcFemale} />
        <path d="M300 742 H425 V815 H378 V840 H300 Z" fill={C.wcFemale} />
        <path d="M300 840 H378 V815 H425 V890 H378 V868 H300 Z" fill={C.room} />
        <path d="M300 868 H378 V890 H425 V990 H300 Z" fill={C.wcMale} />
      </g>

      {/* ---------- เฟอร์นิเจอร์/โครงสร้างในแปลน (สีไม้) ---------- */}
      <g fill={C.wood} stroke={C.woodEdge} strokeWidth="3" strokeLinejoin="round">
        {/* รูปตัวแอล ด้านบนซ้าย */}
        <path d="M460 158 H580 V185 H487 V320 H460 Z" />
        {/* รูปตัวแอล ด้านบนกลาง */}
        <path d="M610 158 H703 V88 H725 V185 H610 Z" />
        {/* แนวตั้งด้านขวา 2 ชิ้น */}
        <rect x="896" y="88" width="24" height="70" rx="2" />
        <rect x="896" y="180" width="24" height="140" rx="2" />
        {/* แนวนอนใต้โต๊ะกลุ่ม */}
        <rect x="510" y="295" width="262" height="25" rx="2" />
        <rect x="797" y="295" width="75" height="25" rx="2" />
        {/* ชิ้นยาวฝั่งซ้าย (ปลายล่างตัดเฉียง) */}
        <path d="M465 560 H540 V835 L465 915 Z" />
      </g>

      {/* เสา/โครงสร้างรูปตัวแอลกลางห้อง (ลายเส้นเฉียง = ส่วนทึบ) */}
      <path
        d="M675 510 H772 V572 H737 V620 H675 Z"
        fill="url(#qz-hatch)"
        stroke="#475569"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* ---------- ผนัง ---------- */}
      <g fill="none" stroke={C.wall} strokeLinecap="round" strokeLinejoin="round">
        {/* ผนังรอบนอก (หนากว่าผนังใน) */}
        <g strokeWidth="6">
          <path d="M300 1110 V122 H660 V3 H965 V315" />
          <path d="M965 315 L1025 380 L968 432 V565 L995 592 V775 L968 802 L1025 865 L905 990 V1110 H300" />
          <path d="M1025 380 H1385" />
          <path d="M1025 865 L1090 805 H1385" />
          <path d="M285 1228 H1030 V985 L1150 868 H1385" />
        </g>

        {/* ผนังในของแถบห้องซ้าย */}
        <g strokeWidth="4">
          <path d="M425 122 V160 H400" />
          <path d="M400 210 H425 V412" />
          <path d="M300 248 H425" />
          <path d="M300 412 H565 V428" />
          <path d="M565 455 V495 H300" />
          {/* เว้นช่องประตูแต่ละห้อง */}
          <path d="M425 495 V540 M425 566 V596 M425 626 V686 M425 714 V776 M425 802 V840 M425 868 V900 M425 930 V990" />
          <path d="M300 570 H425 M300 657 H425 M300 742 H425" />
          <path d="M300 840 H378 V815 H425" />
          <path d="M300 868 H378 V890 H425" />
          {/* ผนังด้านบนของห้องเงียบ 3 ห้อง */}
          <path d="M300 990 H798 V1110" />
        </g>
        <path d="M306 250 V412" strokeWidth="2.5" />
        <path d="M547 990 V1110 M668 990 V1110" strokeWidth="3" />
      </g>

      {/* ---------- ป้ายห้องน้ำ ชาย / หญิง / หญิง / ชาย ---------- */}
      <ToiletIcon type="male" cx={350} y={585} />
      <ToiletIcon type="female" cx={350} y={675} />
      <ToiletIcon type="female" cx={350} y={768} />
      <ToiletIcon type="male" cx={350} y={918} />
    </>
  )
}

// บานประตูห้องเงียบ — วาดทับหลังที่นั่ง จะได้มองเห็นบนพื้นสีเขียว/แดง
function DoorOverlay() {
  return (
    <g className="pointer-events-none">
      <path
        d="M517 993 A26 26 0 0 0 543 1019 M638 993 A26 26 0 0 0 664 1019 M760 993 A26 26 0 0 0 786 1019"
        fill="none"
        stroke="#1e293b"
        strokeWidth="2.5"
        strokeDasharray="5 4"
        opacity="0.45"
      />
      <path
        d="M538 984 h18 v10 h-18 z M657 984 h18 v10 h-18 z M779 984 h18 v10 h-18 z"
        fill="#ffffff"
        stroke={C.wall}
        strokeWidth="2.5"
      />
    </g>
  )
}

// ไอคอนห้องน้ำ (รูปคนแบบป้ายห้องน้ำ) — cx = กึ่งกลางแนวนอน, y = ขอบบนของหัว
function ToiletIcon({ type, cx, y }) {
  const color = type === 'male' ? '#0369a1' : '#be185d'
  return (
    <g fill={color} stroke="none">
      <title>{type === 'male' ? 'ห้องน้ำชาย' : 'ห้องน้ำหญิง'}</title>
      <circle cx={cx} cy={y + 6} r="6.5" />
      {type === 'male' ? (
        <rect x={cx - 8} y={y + 15} width="16" height="25" rx="3" />
      ) : (
        <path d={`M${cx - 5} ${y + 15} H${cx + 5} L${cx + 12} ${y + 40} H${cx - 12} Z`} />
      )}
      <rect x={cx - 7} y={y + 39} width="5" height="20" rx="2" />
      <rect x={cx + 2} y={y + 39} width="5" height="20" rx="2" />
    </g>
  )
}
