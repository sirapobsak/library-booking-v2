import { useState } from 'react'
import { CANVAS, KIND_LABEL, QUIET_SEATS } from '../layouts/quietZone.js'

// ผังที่นั่งโซนเงียบ — วาดตามแปลนของห้องสมุด
// เส้นดำ = โครงสร้างอาคาร (ผนัง ชั้นหนังสือ ห้องน้ำ ทางเดิน)
// ช่องสีเขียว = ที่นั่งที่จองได้ กดเลือกได้
export default function QuietFloorPlan() {
  const [selectedId, setSelectedId] = useState(null)
  const selected = QUIET_SEATS.find((s) => s.id === selectedId)

  return (
    <div className="space-y-4">
      {/* คำอธิบายสัญลักษณ์ */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 rounded border border-black bg-[#39f51f]" />
          ที่นั่งว่าง
        </span>
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 rounded border border-black bg-emerald-700" />
          ที่นั่งที่เลือก
        </span>
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 rounded border border-slate-400 bg-white" />
          โครงสร้างอาคาร (จองไม่ได้)
        </span>
      </div>

      {/* ตัวผัง — จอเล็กเลื่อนดูซ้ายขวาได้ */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3">
        <svg
          viewBox={`${CANVAS.x} ${CANVAS.y} ${CANVAS.width} ${CANVAS.height}`}
          className="mx-auto h-auto w-full min-w-[560px] max-w-3xl"
          role="img"
          aria-label="ผังที่นั่งโซนเงียบ"
        >
          {/* วาดเส้นอาคารก่อน แล้วค่อยวางที่นั่งทับในพิกัดเดียวกับแปลน */}
          <Structure />

          {QUIET_SEATS.map((seat) => {
            const isSelected = seat.id === selectedId
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
                      ? 'fill-emerald-700 stroke-black'
                      : 'fill-[#39f51f] stroke-black hover:fill-[#6aff55]'
                  }
                  strokeWidth="2.5"
                />
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
// โครงสร้างอาคาร (ไม่ใช่ที่นั่ง) — ลอกตามแปลนเวอร์ชันล่าสุด
// พิกัดเป็นตำแหน่งพิกเซลบนรูปแปลน ใช้ระบบเดียวกับที่นั่งใน quietZone.js
// ---------------------------------------------------------------
function Structure() {
  return (
    <g fill="none" stroke="#111111" strokeWidth="4" strokeLinejoin="miter">
      {/* ================= ผนังรอบนอก ================= */}
      {/* ซ้าย -> บนซ้าย -> ช่องยื่นด้านบน -> ลงมาทางขวา */}
      <path d="M300 1110 V122 H660 V3 H965 V315" />

      {/* ผนังขวาของโซนที่นั่ง — หยักเข้าออกตามแปลน แล้วหักเฉียงลงมาปิดมุมล่าง */}
      <path d="M965 315 L1025 380 L968 432 V565 L995 592 V775 L968 802 L1025 865 L905 990 V1110 H300" />

      {/* ทางเดินที่ออกไปทางขวา 2 เส้น */}
      <path d="M1025 380 H1385" />
      <path d="M1025 865 L1090 805 H1385" />

      {/* ขอบนอกด้านล่าง + ทางเดินขวาล่าง */}
      <path d="M285 1228 H1030 V985 L1150 868 H1385" />

      {/* ================= แถบห้องด้านซ้าย ================= */}
      {/* ผนังในแนวตั้ง (x = 425) มีช่องประตูเว้นไว้เป็นช่วง ๆ */}
      <path d="M425 122 V160 H400" />
      <path d="M400 210 H425 V412" />
      <path d="M300 248 H425" />
      <path d="M306 250 V412" strokeWidth="2.5" />

      {/* ห้อง/ทางเชื่อมแนวนอนกลางแถบซ้าย */}
      <path d="M300 412 H565 V428" />
      <path d="M565 455 V495 H300" />

      {/* ผนังในช่วงห้องน้ำ (เว้นช่องประตูแต่ละห้อง) */}
      <path d="M425 495 V540 M425 566 V596 M425 626 V686 M425 714 V776 M425 802 V840 M425 868 V900 M425 930 V990" />

      {/* ผนังกั้นระหว่างห้อง */}
      <path d="M300 570 H425 M300 657 H425 M300 742 H425" />
      <path d="M300 840 H378 V815 H425" />
      <path d="M300 868 H378 V890 H425" />

      {/* ป้ายห้องน้ำ ชาย / หญิง / หญิง / ชาย */}
      <ToiletIcon type="male" cx={350} y={585} />
      <ToiletIcon type="female" cx={350} y={675} />
      <ToiletIcon type="female" cx={350} y={768} />
      <ToiletIcon type="male" cx={350} y={918} />

      {/* ================= ชั้นหนังสือ / เคาน์เตอร์ ================= */}
      {/* ชั้นรูปตัวแอล ด้านบนซ้าย */}
      <path d="M460 158 H580 V185 H487 V320 H460 Z" strokeWidth="3" />
      {/* ชั้นรูปตัวแอล ด้านบนกลาง */}
      <path d="M610 158 H703 V88 H725 V185 H610 Z" strokeWidth="3" />
      {/* ชั้นแนวตั้งด้านขวา 2 ตัว */}
      <rect x="896" y="88" width="24" height="70" strokeWidth="3" />
      <rect x="896" y="180" width="24" height="140" strokeWidth="3" />
      {/* ชั้นแนวนอนใต้โต๊ะกลุ่ม */}
      <rect x="510" y="295" width="262" height="25" strokeWidth="3" />
      <rect x="797" y="295" width="75" height="25" strokeWidth="3" />

      {/* เคาน์เตอร์ยาวฝั่งซ้าย (ปลายล่างตัดเฉียง) */}
      <path d="M465 560 H540 V835 L465 915 Z" strokeWidth="3" />

      {/* เสา/โครงสร้างรูปตัวแอลกลางห้อง */}
      <path d="M675 510 H772 V572 H737 V620 H675 Z" strokeWidth="3" />

      {/* ================= ห้องเงียบ 3 ห้องด้านล่าง ================= */}
      <path d="M300 990 H798 V1110" />
      <path d="M547 990 V1110 M668 990 V1110" strokeWidth="3" />
      {/* บานประตู (ส่วนโค้ง) + วงกบเล็ก ๆ เหนือประตู */}
      <path
        d="M517 993 A26 26 0 0 0 543 1019 M638 993 A26 26 0 0 0 664 1019 M760 993 A26 26 0 0 0 786 1019"
        strokeWidth="2.5"
      />
      <path
        d="M538 984 h18 v10 h-18 z M657 984 h18 v10 h-18 z M779 984 h18 v10 h-18 z"
        fill="#ffffff"
        strokeWidth="2.5"
      />
    </g>
  )
}

// ไอคอนห้องน้ำ (วาดเป็นรูปคนแบบป้ายห้องน้ำ) — cx = กึ่งกลางแนวนอน, y = ขอบบนของหัว
function ToiletIcon({ type, cx, y }) {
  return (
    <g fill="#111111" stroke="none">
      <title>{type === 'male' ? 'ห้องน้ำชาย' : 'ห้องน้ำหญิง'}</title>
      <circle cx={cx} cy={y + 6} r="6.5" />
      {type === 'male' ? (
        <rect x={cx - 8} y={y + 15} width="16" height="25" rx="3" />
      ) : (
        <path d={`M${cx - 5} ${y + 15} H${cx + 5} L${cx + 12} ${y + 40} H${cx - 12} Z`} />
      )}
      <rect x={cx - 7} y={y + 39} width="5" height="20" />
      <rect x={cx + 2} y={y + 39} width="5" height="20" />
    </g>
  )
}
