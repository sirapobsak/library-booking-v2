import { useState } from 'react'
import { CANVAS, KIND_LABEL, QUIET_SEATS } from '../layouts/quietZone.js'

// ผังที่นั่งโซนเงียบ — วาดตามแปลนของห้องสมุด
// เส้นสีเทา = โครงสร้างอาคาร (ผนัง ชั้นหนังสือ บันได ลิฟต์ โซนคาเฟ่)
// ช่องสีเขียว = ที่นั่งที่จองได้ กดเลือกได้
export default function QuietFloorPlan() {
  const [selectedId, setSelectedId] = useState(null)
  const selected = QUIET_SEATS.find((s) => s.id === selectedId)

  return (
    <div className="space-y-4">
      {/* คำอธิบายสัญลักษณ์ */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 rounded border border-emerald-600 bg-emerald-500" />
          ที่นั่งว่าง
        </span>
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 rounded border-2 border-emerald-900 bg-emerald-800" />
          ที่นั่งที่เลือก
        </span>
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 rounded border border-slate-300 bg-white" />
          โครงสร้างอาคาร (จองไม่ได้)
        </span>
      </div>

      {/* ตัวผัง — จอเล็กเลื่อนดูซ้ายขวาได้ */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3">
        <svg
          viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
          className="h-auto w-full min-w-[760px]"
          role="img"
          aria-label="ผังที่นั่งโซนเงียบ"
        >
          <Structure />

          {QUIET_SEATS.map((seat) => {
            const isSelected = seat.id === selectedId
            const showLabel = seat.w >= 50 && seat.h >= 30

            return (
              <g
                key={seat.id}
                onClick={() => setSelectedId(isSelected ? null : seat.id)}
                className="cursor-pointer"
              >
                <title>{`${KIND_LABEL[seat.kind]} ${seat.id}`}</title>
                <rect
                  x={seat.x}
                  y={seat.y}
                  width={seat.w}
                  height={seat.h}
                  rx={seat.kind === 'room' ? 4 : 3}
                  className={
                    isSelected
                      ? 'fill-emerald-800 stroke-emerald-900'
                      : 'fill-emerald-500 stroke-emerald-600 hover:fill-emerald-400'
                  }
                  strokeWidth="3"
                />
                {showLabel && (
                  <text
                    x={seat.x + seat.w / 2}
                    y={seat.y + seat.h / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.min(seat.w, seat.h, 60) * 0.42}
                    fontWeight="600"
                    className="pointer-events-none select-none fill-white"
                  >
                    {seat.id}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* กล่องสรุปที่นั่งที่เลือก */}
      {selected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div>
            <p className="font-semibold text-emerald-900">
              {KIND_LABEL[selected.kind]} {selected.id}
            </p>
            <p className="text-sm text-emerald-700">เลือกที่นั่งนี้อยู่</p>
          </div>
          <button
            disabled
            title="ระบบจองจะมาในขั้นถัดไป"
            className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white opacity-60"
          >
            จองที่นั่งนี้ (เร็ว ๆ นี้)
          </button>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
          กดที่ช่องสีเขียวในผังเพื่อเลือกที่นั่ง
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// โครงสร้างอาคาร (ไม่ใช่ที่นั่ง) — ผนัง ชั้นหนังสือ บันได ลิฟต์ ฯลฯ
// ---------------------------------------------------------------
function Structure() {
  return (
    <g fill="none" stroke="#334155" strokeWidth="3.5" strokeLinejoin="miter">
      {/* ================= ผนังหลักของอาคาร ================= */}
      <path d="M295 128 H425 V8 H965 V150 H1035" />
      <path d="M295 128 V1115 H848" />
      <path d="M312 255 V1115" strokeWidth="3" />
      <path d="M280 1180 H1035" />

      {/* หมุดอ้างอิงบนแปลน (สามเหลี่ยมด้านบน) */}
      <path d="M566 0 H602 L584 28 Z" strokeWidth="2.5" />
      <path d="M652 30 H690 L671 58 Z" strokeWidth="2.5" />
      <path d="M671 0 V30" strokeWidth="2.5" />

      {/* ================= แถบห้องด้านซ้าย ================= */}
      <path d="M425 128 V1115" />
      <path
        d="M312 255 H425 M312 545 H425 M312 640 H425 M312 730 H425 M312 845 H425"
        strokeWidth="3"
      />
      <path d="M370 845 V908 H425" strokeWidth="3" />
      {/* สัญลักษณ์รูปโบว์ + เส้นชี้ลงมาที่บันได */}
      <path d="M372 297 L334 270 A34 34 0 0 0 334 324 Z" strokeWidth="2.5" />
      <path d="M372 297 L410 270 A34 34 0 0 1 410 324 Z" strokeWidth="2.5" />
      <path d="M372 297 V400" strokeWidth="2.5" />
      <path d="M312 258 H358" strokeWidth="2.5" strokeDasharray="12 9" />
      <path d="M358 258 H425" strokeWidth="2.5" />

      {/* โคมไฟ/ช่องแสงครึ่งวงกลม */}
      <path d="M400 198 A27 27 0 0 1 454 198 Z" strokeWidth="2.5" />

      {/* ================= บันไดฝั่งซ้าย ================= */}
      <path d="M358 402 A34 34 0 0 0 358 470" strokeWidth="2.5" />
      <rect x="358" y="398" width="66" height="92" strokeWidth="3" />
      <path d="M372 398 V490 M386 398 V490 M400 398 V490 M414 398 V490" strokeWidth="2" />
      <rect x="424" y="428" width="116" height="62" strokeWidth="3" />
      <path
        d="M438 428 V490 M452 428 V490 M466 428 V490 M480 428 V490 M494 428 V490 M508 428 V490 M522 428 V490"
        strokeWidth="2"
      />
      <path d="M540 430 A22 22 0 0 1 540 474" strokeWidth="2.5" />
      <path d="M352 415 H556" strokeWidth="3" />

      {/* ================= เคาน์เตอร์/ชั้นวางยาวฝั่งซ้าย ================= */}
      <rect x="465" y="560" width="76" height="362" strokeWidth="3" />
      <path d="M465 602 H541" strokeWidth="2" />
      <path d="M480 560 V602 M495 560 V602 M511 560 V602 M526 560 V602" strokeWidth="2" />
      <path
        d="M519 620 h18 v18 h-18 z M519 662 h18 v18 h-18 z M519 704 h18 v18 h-18 z M519 746 h18 v18 h-18 z M519 788 h18 v18 h-18 z"
        strokeWidth="2"
      />
      <path d="M486 640 h15 v15 h-15 z M486 726 h15 v15 h-15 z" strokeWidth="2" />

      {/* ================= ชั้นหนังสือด้านบน ================= */}
      <rect x="465" y="150" width="115" height="30" strokeWidth="3" />
      <rect x="600" y="150" width="100" height="30" strokeWidth="3" />
      <rect x="700" y="140" width="96" height="32" strokeWidth="3" />
      <rect x="700" y="88" width="26" height="54" strokeWidth="3" />
      <rect x="898" y="88" width="26" height="106" strokeWidth="3" />
      <rect x="898" y="206" width="26" height="78" strokeWidth="3" />
      <rect x="510" y="290" width="278" height="32" strokeWidth="3" />
      <rect x="795" y="290" width="78" height="32" strokeWidth="3" />
      <path
        d="M545 290 V322 M580 290 V322 M615 290 V322 M650 290 V322 M685 290 V322 M720 290 V322 M755 290 V322 M834 290 V322"
        strokeWidth="1.8"
      />
      <path d="M500 150 V180 M540 150 V180 M632 150 V180 M666 150 V180 M748 140 V172" strokeWidth="1.8" />
      <path d="M465 165 H580 M600 165 H700" strokeWidth="1.8" />

      {/* กรอบบล็อกโต๊ะมีฉากกั้น (3x3) */}
      <rect x="742" y="82" width="142" height="120" strokeWidth="3" />

      {/* กรอบโต๊ะกลุ่ม 4 ชุด */}
      <rect x="506" y="202" width="82" height="76" strokeWidth="2.5" />
      <rect x="594" y="202" width="94" height="76" strokeWidth="2.5" />
      <rect x="694" y="202" width="84" height="76" strokeWidth="2.5" />
      <rect x="784" y="202" width="84" height="76" strokeWidth="2.5" />

      {/* โครงสร้างรูปตัวแอลกลางห้อง */}
      <path
        d="M678 620 V518 H772 M690 620 V530 H772 M702 620 V542 H772 M714 620 V554 H772"
        strokeWidth="2.5"
      />

      {/* ================= ผนังฝั่งขวาของโซนที่นั่ง (ผนังคู่) ================= */}
      {/* บนสุดหักมุมเข้าหาโซนที่นั่ง แล้วลงตรง ๆ ก่อนหักเฉียงเข้าหามุมล่างซ้าย */}
      <path d="M1105 148 H1030 V250 L975 308 V790 L848 952 V1115" />
      <path d="M1122 165 H1048 V258 L993 316 V800 L866 966" strokeWidth="2.5" />

      {/* ปล่องลิฟต์ + บันไดเลื่อนด้านบนขวา */}
      <rect x="1040" y="0" width="65" height="148" strokeWidth="3" />
      <path
        d="M1105 148 H1420 M1120 136 H1420 M1135 124 H1420 M1150 112 H1420 M1165 100 H1420 M1180 88 H1420 M1195 76 H1420"
        strokeWidth="2.5"
      />

      {/* ================= โซนคาเฟ่ (นอกโซนเงียบ จองไม่ได้) ================= */}
      <rect x="1245" y="518" width="146" height="56" strokeWidth="2.5" />
      <text x="1258" y="556" fontSize="30" fill="#334155" stroke="none">
        Café&apos; area
      </text>
      <path d="M1130 546 V492" strokeWidth="2" />
      <circle cx="1152" cy="512" r="9" strokeWidth="2" />
      <circle cx="1185" cy="538" r="15" strokeWidth="2" />
      <circle cx="1215" cy="553" r="8" strokeWidth="2" />
      <circle cx="1188" cy="574" r="13" strokeWidth="2" />
      <rect x="1258" y="483" width="26" height="26" strokeWidth="2" />
      <path d="M1258 483 L1284 509 M1284 483 L1258 509" strokeWidth="2" />
      <rect x="1140" y="730" width="24" height="24" strokeWidth="2" />
      <circle cx="1152" cy="742" r="4" strokeWidth="2" />
      <rect x="1362" y="632" width="60" height="60" strokeWidth="2.5" />
      <path d="M1090 790 H1420" strokeWidth="3" />
      <path d="M1268 750 V792" strokeWidth="2.5" />

      {/* ================= บันไดเลื่อนด้านล่างขวา ================= */}
      {/* ทางลาดเฉียงลงมาจากมุมผนัง */}
      <path
        d="M990 806 L1060 928 M1006 796 L1076 918 M1022 786 L1092 908"
        strokeWidth="2.5"
      />
      {/* ขั้นบันไดเลื่อน — สี่เหลี่ยมซ้อนกันไล่ลงซ้าย */}
      <rect x="1075" y="852" width="140" height="46" strokeWidth="2.5" />
      <rect x="1060" y="874" width="155" height="56" strokeWidth="2.5" />
      <rect x="1045" y="896" width="170" height="66" strokeWidth="2.5" />
      <rect x="1030" y="918" width="185" height="76" strokeWidth="2.5" />
      <rect x="1015" y="940" width="200" height="86" strokeWidth="2.5" />

      {/* ลิฟต์ตรงมุมล่างของโซนที่นั่ง */}
      <rect x="848" y="962" width="56" height="96" strokeWidth="3" />
      <path d="M848 1000 H904" strokeWidth="2" />
      <path d="M860 962 A22 22 0 0 0 892 1000" strokeWidth="2" />

      {/* กล่อง/ห้องเล็กด้านล่างขวา */}
      <rect x="962" y="1008" width="54" height="54" strokeWidth="2.5" />
      <rect x="938" y="1088" width="64" height="64" strokeWidth="2.5" />

      {/* ผนังโค้งมุมล่างขวา */}
      <path d="M1198 1200 A260 260 0 0 1 1430 1082" strokeWidth="3" />

      {/* ================= ห้องเงียบ 3 ห้องด้านล่าง ================= */}
      <rect x="308" y="993" width="484" height="122" strokeWidth="3" />
      <path d="M545 993 V1115 M665 993 V1115" strokeWidth="3" />
      <path
        d="M545 993 A32 32 0 0 1 513 1025 M665 993 A32 32 0 0 1 633 1025 M792 993 A32 32 0 0 1 760 1025"
        strokeWidth="2"
      />
    </g>
  )
}
