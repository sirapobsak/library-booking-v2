import { useState } from 'react'
import { DoorClosed, LayoutGrid, MousePointerClick, User, Users } from 'lucide-react'
import { CANVAS, KIND_INFO, KIND_LABEL, KIND_ORDER, QUIET_SEATS } from '../layouts/quietZone.js'

// ไอคอนประจำที่นั่งแต่ละแบบ (ใช้ในแผงด้านข้าง)
const KIND_ICON = { carrel: LayoutGrid, table: Users, desk: User, room: DoorClosed }

// ---------- โทนสีของผัง (แก้สีทั้งผังได้ที่นี่ที่เดียว) ----------
const C = {
  wall: '#1e293b', // ผนัง
  floor: '#fdfcf8', // พื้นในโซน (ขาวอมครีม)
  corridor: '#eef1f5', // ทางเดิน
  room: '#f1f5f9', // ห้องอื่น ๆ ที่ไม่ใช่ที่นั่ง
  wcMale: '#e0f2fe', // ห้องน้ำชาย (ฟ้าอ่อน)
  wcFemale: '#fce7f3', // ห้องน้ำหญิง (ชมพูอ่อน)
  wood: '#eadcc3', // ชั้นหนังสือ/เคาน์เตอร์ (สีไม้)
  woodEdge: '#8b6b43',
  seatEdge: '#16a34a',
  seatText: '#14532d',
}

export default function QuietFloorPlan() {
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState(null) // null = แสดงทุกประเภท
  const selected = QUIET_SEATS.find((s) => s.id === selectedId)

  const toggleSeat = (id) => setSelectedId((prev) => (prev === id ? null : id))
  const countOf = (kind) => QUIET_SEATS.filter((s) => s.kind === kind).length

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* ================= การ์ดผังที่นั่ง ================= */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-800">ผังที่นั่ง</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
            <Legend swatch="border-green-600 bg-green-200">ที่นั่งว่าง</Legend>
            <Legend swatch="border-green-900 bg-green-700">ที่เลือก</Legend>
            <Legend swatch="border-[#8b6b43] bg-[#eadcc3]">ชั้นหนังสือ</Legend>
            <Legend swatch="border-sky-300 bg-sky-100">ห้องน้ำชาย</Legend>
            <Legend swatch="border-pink-300 bg-pink-100">ห้องน้ำหญิง</Legend>
          </div>
        </div>

        {/* จอเล็กเลื่อนดูซ้ายขวาได้ */}
        <div className="overflow-x-auto p-3 sm:p-5">
          <svg
            viewBox={`${CANVAS.x} ${CANVAS.y} ${CANVAS.width} ${CANVAS.height}`}
            className="mx-auto h-auto w-full min-w-[560px] max-w-[760px]"
            role="group"
            aria-label="ผังที่นั่งโซนเงียบ"
          >
            <Defs />
            <Structure />

            {/* ================= ที่นั่ง (วางทับบนแปลน) ================= */}
            {QUIET_SEATS.map((seat) => {
              const isSelected = seat.id === selectedId
              const dimmed = filter !== null && seat.kind !== filter
              const isRoom = seat.kind === 'room'
              // ชื่อบนช่อง: ห้องใช้ชื่อห้อง, โต๊ะเดี่ยวใช้รหัส, ช่องเล็ก (C/T) ไม่ใส่เพราะตัวหนังสือจะเล็กเกินอ่าน
              const label = isRoom ? seat.label : seat.kind === 'desk' ? seat.id : null

              return (
                <g
                  key={seat.id}
                  role="button"
                  tabIndex={dimmed ? -1 : 0}
                  aria-label={`${KIND_LABEL[seat.kind]} ${seat.id}`}
                  aria-pressed={isSelected}
                  onClick={() => toggleSeat(seat.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleSeat(seat.id)
                    }
                  }}
                  opacity={dimmed ? 0.18 : 1}
                  className="cursor-pointer outline-none transition-opacity duration-200 hover:brightness-95 [&:focus-visible>rect.qz-seat]:stroke-sky-500 [&:focus-visible>rect.qz-seat]:[stroke-width:5px]"
                >
                  <title>{`${KIND_LABEL[seat.kind]} ${seat.id}`}</title>

                  {/* วงเรืองแสงรอบที่นั่งที่เลือก */}
                  {isSelected && (
                    <rect
                      x={seat.x - 7}
                      y={seat.y - 7}
                      width={seat.w + 14}
                      height={seat.h + 14}
                      rx={isRoom ? 12 : 10}
                      fill="none"
                      stroke="#4ade80"
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
                    fill={isSelected ? 'url(#qz-seat-selected)' : 'url(#qz-seat)'}
                    stroke={isSelected ? '#14532d' : C.seatEdge}
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
                      fill={isSelected ? '#ffffff' : C.seatText}
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

      {/* ================= แผงด้านข้าง ================= */}
      <aside className="space-y-4">
        {/* จำนวนที่นั่ง + ตัวกรองตามประเภท */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">ที่นั่งทั้งหมดในโซน</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">
            {QUIET_SEATS.length} <span className="text-base font-medium text-slate-400">จุด</span>
          </p>

          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-400">ไฮไลต์ตามประเภท</p>
          <div className="mt-2 space-y-1.5">
            <FilterButton active={filter === null} onClick={() => setFilter(null)} count={QUIET_SEATS.length}>
              ทั้งหมด
            </FilterButton>
            {KIND_ORDER.map((kind) => {
              const Icon = KIND_ICON[kind]
              return (
                <FilterButton
                  key={kind}
                  active={filter === kind}
                  onClick={() => setFilter((prev) => (prev === kind ? null : kind))}
                  count={countOf(kind)}
                  icon={<Icon className="h-4 w-4" />}
                >
                  {KIND_LABEL[kind]}
                </FilterButton>
              )
            })}
          </div>
        </div>

        {/* รายละเอียดที่นั่งที่เลือก */}
        {selected ? (
          <SelectedCard seat={selected} onClear={() => setSelectedId(null)} />
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 p-6 text-center">
            <MousePointerClick className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 font-medium text-slate-600">ยังไม่ได้เลือกที่นั่ง</p>
            <p className="mt-1 text-sm text-slate-400">กดที่ช่องสีเขียวในผังเพื่อดูรายละเอียด</p>
          </div>
        )}
      </aside>
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

function FilterButton({ active, onClick, count, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
        active
          ? 'bg-green-50 font-semibold text-green-800 ring-1 ring-green-600'
          : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      <span className="flex items-center gap-2">
        {icon ?? <span className="h-4 w-4" />}
        {children}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
          active ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function SelectedCard({ seat, onClear }) {
  const Icon = KIND_ICON[seat.kind]
  return (
    <div className="overflow-hidden rounded-3xl border border-green-200 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-green-500 to-green-700 p-5 text-white">
        <p className="text-sm text-green-100">ที่นั่งที่เลือก</p>
        <p className="mt-1 flex items-center gap-2 text-2xl font-bold">
          <Icon className="h-6 w-6" />
          {seat.label ?? seat.id}
        </p>
        <p className="mt-0.5 text-sm text-green-50">
          {KIND_LABEL[seat.kind]} · รหัส {seat.id}
        </p>
      </div>
      <div className="space-y-3 p-5">
        <p className="text-sm leading-relaxed text-slate-600">{KIND_INFO[seat.kind]}</p>
        <button
          disabled
          title="ระบบจองจะมาในขั้นถัดไป"
          className="w-full rounded-xl bg-green-600 px-4 py-2.5 font-semibold text-white opacity-60"
        >
          จองที่นั่งนี้ (เร็ว ๆ นี้)
        </button>
        <button
          type="button"
          onClick={onClear}
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          ยกเลิกการเลือก
        </button>
      </div>
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
      <linearGradient id="qz-seat" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#bbf7d0" />
        <stop offset="1" stopColor="#86efac" />
      </linearGradient>
      <linearGradient id="qz-seat-selected" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#22c55e" />
        <stop offset="1" stopColor="#15803d" />
      </linearGradient>
      <filter id="qz-shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#14532d" floodOpacity="0.25" />
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
      {/* ทางเดินรูปตัวแอล (ขอบล่าง + เฉียงออกไปทางขวา) */}
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

      {/* ---------- ชั้นหนังสือ / เคาน์เตอร์ (สีไม้) ---------- */}
      <g fill={C.wood} stroke={C.woodEdge} strokeWidth="3" strokeLinejoin="round">
        {/* ชั้นรูปตัวแอล ด้านบนซ้าย */}
        <path d="M460 158 H580 V185 H487 V320 H460 Z" />
        {/* ชั้นรูปตัวแอล ด้านบนกลาง */}
        <path d="M610 158 H703 V88 H725 V185 H610 Z" />
        {/* ชั้นแนวตั้งด้านขวา 2 ตัว */}
        <rect x="896" y="88" width="24" height="70" rx="2" />
        <rect x="896" y="180" width="24" height="140" rx="2" />
        {/* ชั้นแนวนอนใต้โต๊ะกลุ่ม */}
        <rect x="510" y="295" width="262" height="25" rx="2" />
        <rect x="797" y="295" width="75" height="25" rx="2" />
        {/* เคาน์เตอร์ยาวฝั่งซ้าย (ปลายล่างตัดเฉียง) */}
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

      {/* ---------- ป้ายชื่อพื้นที่ ---------- */}
      <g fill="#94a3b8" fontWeight="600" className="select-none" letterSpacing="2">
        <text x="600" y="1178" fontSize="28" textAnchor="middle">ทางเดิน</text>
        <text x="1268" y="846" fontSize="24" textAnchor="middle">ทางเดิน</text>
      </g>
    </>
  )
}

// บานประตูห้องเงียบ — วาดทับหลังที่นั่ง จะได้มองเห็นบนพื้นสีเขียว
function DoorOverlay() {
  return (
    <g className="pointer-events-none">
      <path
        d="M517 993 A26 26 0 0 0 543 1019 M638 993 A26 26 0 0 0 664 1019 M760 993 A26 26 0 0 0 786 1019"
        fill="none"
        stroke="#14532d"
        strokeWidth="2.5"
        strokeDasharray="5 4"
        opacity="0.55"
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
