import { AlertTriangle, Scale, Trophy } from 'lucide-react'
import { formatQuiet, quietFor } from '../../tv.js'

// ============================================================
//  หน้าสถิติ: วันนี้ vs เมื่อวาน — ชวนคนทั้งห้องแข่งกับคนที่ใช้ห้องเมื่อวาน
//  จอทีวีเป็นธีมมืดอย่างเดียว (สีตาม palette มาตรฐาน dataviz โหมดมืด ตรวจ CVD แล้ว)
//  ทีวีไม่มีคนกด จึงไม่มี tooltip — ตัวเลขสำคัญเขียนไว้บนจอ + มีตารางซ่อนสำหรับ screen reader
// ============================================================

const C = {
  surface: '#1a1a19',
  ink: '#ffffff',
  ink2: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  base: '#383835',
  today: '#3987e5', // ชุดสี 1 (ฟ้า)
  yesterday: '#d95926', // ชุดสี 2 (ส้ม)
  good: '#0ca30c',
  serious: '#ec835a',
}

const thaiDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })
const weekday = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short' })

export default function StatsView({ data, ageMs }) {
  if (!data) {
    return <div className="grid h-full place-items-center text-2xl text-white/60">กำลังโหลดสถิติ…</div>
  }
  const { today, yesterday, yesterdaySoFar, hoursToday, hoursYesterday, days } = data
  const todayIso = days[days.length - 1].date

  // ช่วงชั่วโมงที่แสดง: 08–20 น. เป็นอย่างน้อย ขยายถ้ามีเสียงดังนอกช่วง
  const active = hoursToday.map((n, h) => (n || hoursYesterday[h] ? h : null)).filter((h) => h != null)
  const from = Math.min(8, ...active)
  const to = Math.max(20, ...active)
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)

  return (
    <div className="flex h-full flex-col gap-[2.2vh] px-[3vw] py-[4vh]" style={{ color: C.ink }}>
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(1.6rem,2.8vw,3.5rem)] font-bold">ห้องเงียบ วันนี้ vs เมื่อวาน</h1>
          <p className="text-[clamp(1rem,1.4vw,1.75rem)]" style={{ color: C.ink2 }}>
            {thaiDate(todayIso)} · ยิ่งน้อยยิ่งดี — ช่วยกันทำให้วันนี้เงียบกว่าเมื่อวาน
          </p>
        </div>
        <p className="text-right text-[clamp(0.9rem,1.2vw,1.5rem)]" style={{ color: C.muted }}>
          {formatQuiet(quietFor(data, ageMs))}
        </p>
      </header>

      {/* ---------- ตัวเลขใหญ่ ---------- */}
      <section className="grid grid-cols-3 gap-[1.5vw]">
        <Tile keyColor={C.today} label="วันนี้ ตรวจพบเสียงดัง">
          <span className="text-[clamp(3.5rem,8vw,10rem)] font-bold leading-none">{today}</span>
          <span className="ml-3 text-[clamp(1.2rem,2vw,2.5rem)]" style={{ color: C.ink2 }}>
            ครั้ง
          </span>
        </Tile>
        <Tile keyColor={C.yesterday} label="เมื่อวาน ถึงเวลานี้">
          <span className="text-[clamp(2.5rem,5.5vw,7rem)] font-semibold leading-none">{yesterdaySoFar}</span>
          <span className="ml-3 text-[clamp(1.2rem,2vw,2.5rem)]" style={{ color: C.ink2 }}>
            ครั้ง
          </span>
          <p className="mt-2 text-[clamp(0.9rem,1.3vw,1.6rem)]" style={{ color: C.ink2 }}>
            เมื่อวานทั้งวัน {yesterday} ครั้ง
          </p>
        </Tile>
        <Verdict today={today} soFar={yesterdaySoFar} yesterday={yesterday} />
      </section>

      {/* ---------- กราฟ ---------- */}
      <section className="grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-[1.5vw]">
        <Card title="เสียงดังรายชั่วโมง">
          <Legend
            items={[
              ['วันนี้', C.today],
              ['เมื่อวาน', C.yesterday],
            ]}
          />
          <ColumnChart
            labels={hours.map((h) => String(h).padStart(2, '0'))}
            series={[
              { name: 'วันนี้', color: C.today, values: hours.map((h) => hoursToday[h]) },
              { name: 'เมื่อวาน', color: C.yesterday, values: hours.map((h) => hoursYesterday[h]) },
            ]}
            ariaLabel="กราฟแท่งจำนวนครั้งที่ตรวจพบเสียงดังรายชั่วโมง วันนี้เทียบกับเมื่อวาน"
          />
          <SrTable
            caption="เสียงดังรายชั่วโมง"
            head={['ชั่วโมง', 'วันนี้', 'เมื่อวาน']}
            rows={hours.map((h) => [`${String(h).padStart(2, '0')}:00`, hoursToday[h], hoursYesterday[h]])}
          />
        </Card>
        <Card title="7 วันล่าสุด">
          <ColumnChart
            labels={days.map((d) => (d.date === todayIso ? 'วันนี้' : weekday(d.date)))}
            series={[{ name: 'เสียงดัง', color: C.today, values: days.map((d) => d.count) }]}
            valueLabels
            emphasizeLast
            width={520}
            ariaLabel="กราฟแท่งจำนวนครั้งที่ตรวจพบเสียงดังใน 7 วันล่าสุด"
          />
          <SrTable caption="7 วันล่าสุด" head={['วัน', 'ครั้ง']} rows={days.map((d) => [d.date, d.count])} />
        </Card>
      </section>
    </div>
  )
}

function Tile({ keyColor, label, children }) {
  return (
    <div className="rounded-3xl p-[1.6vw]" style={{ background: C.surface, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}>
      <p className="mb-3 flex items-center gap-2 text-[clamp(1rem,1.5vw,1.9rem)]" style={{ color: C.ink2 }}>
        <span className="h-3.5 w-3.5 rounded-full" style={{ background: keyColor }} />
        {label}
      </p>
      <div>{children}</div>
    </div>
  )
}

// ผลการแข่งกับเมื่อวาน (สีสถานะ + ไอคอน + ข้อความเสมอ ไม่ใช้สีอย่างเดียว)
function Verdict({ today, soFar, yesterday }) {
  const diff = today - soFar
  let Icon = Scale
  let color = C.ink2
  let title = 'สูสีกับเมื่อวาน'
  let detail = 'เงียบอีกนิดก็ชนะแล้ว'
  if (diff < 0) {
    Icon = Trophy
    color = C.good
    title = 'วันนี้เงียบกว่าเมื่อวาน!'
    detail = `น้อยกว่าเมื่อวานช่วงเดียวกัน ${-diff} ครั้ง — ช่วยกันรักษาไว้`
  } else if (diff > 0) {
    Icon = AlertTriangle
    color = C.serious
    title = 'วันนี้เสียงดังกว่าเมื่อวาน'
    detail = `มากกว่าเมื่อวานช่วงเดียวกัน ${diff} ครั้ง — ช่วยกันเงียบอีกนิด`
  }
  const goal =
    yesterday > 0
      ? today < yesterday
        ? `ทั้งวันไม่เกิน ${yesterday - 1} ครั้ง = ชนะเมื่อวาน (ดังได้อีกไม่เกิน ${yesterday - 1 - today} ครั้ง)`
        : `วันนี้เกินยอดทั้งวันของเมื่อวาน (${yesterday} ครั้ง) แล้ว — พรุ่งนี้เอาใหม่!`
      : 'เมื่อวานไม่มีเสียงดังเลย — วันนี้ทำให้ได้ 0 ครั้งเหมือนกัน'

  return (
    <div className="flex flex-col justify-center rounded-3xl p-[1.6vw]" style={{ background: C.surface, boxShadow: `inset 0 0 0 2px ${color}` }}>
      <p className="flex items-center gap-3 text-[clamp(1.1rem,1.9vw,2.4rem)] font-bold leading-tight">
        <Icon className="h-[1.2em] w-[1.2em] shrink-0" style={{ color }} aria-hidden />
        {title}
      </p>
      <p className="mt-2 text-[clamp(1rem,1.4vw,1.75rem)]" style={{ color: C.ink2 }}>
        {detail}
      </p>
      <p className="mt-3 text-[clamp(0.9rem,1.2vw,1.5rem)]" style={{ color: C.muted }}>
        เป้าหมาย: {goal}
      </p>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div
      className="flex min-h-0 flex-col rounded-3xl p-[1.4vw]"
      style={{ background: C.surface, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}
    >
      <h2 className="text-[clamp(1rem,1.5vw,1.9rem)] font-semibold">{title}</h2>
      {children}
    </div>
  )
}

function Legend({ items }) {
  return (
    <div className="mt-1 flex gap-5 text-[clamp(0.85rem,1.1vw,1.35rem)]" style={{ color: C.ink2 }}>
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}

// กราฟแท่งแนวตั้ง (หลายชุดวางคู่กัน) — แท่งกว้างไม่เกิน 24 หน่วย ปลายมน 4 หน่วย เว้นช่อง 2 หน่วยระหว่างแท่ง
// width = ความกว้างพื้นที่วาด (การ์ดแคบให้ค่าน้อยลง ตัวหนังสือจะได้ไม่เล็กเกิน)
function ColumnChart({ labels, series, ariaLabel, valueLabels = false, emphasizeLast = false, width = 1000 }) {
  const W = width
  const H = 380
  const pad = { l: 46, r: 8, t: valueLabels ? 34 : 16, b: 40 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const step = Math.max(1, Math.ceil(max / 4))
  const top = step * 4
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step)
  const band = plotW / labels.length
  const gap = 2
  const barW = Math.max(4, Math.min(24, (band * 0.62 - gap * (series.length - 1)) / series.length))
  const groupW = barW * series.length + gap * (series.length - 1)
  const y = (v) => pad.t + plotH - (v / top) * plotH

  // ปลายบนมน ฐานเหลี่ยม
  const bar = (x, v) => {
    const h = (v / top) * plotH
    if (h <= 0) return null
    const r = Math.min(4, h, barW / 2)
    const yt = pad.t + plotH - h
    const yb = pad.t + plotH
    return `M${x},${yb} L${x},${yt + r} Q${x},${yt} ${x + r},${yt} L${x + barW - r},${yt} Q${x + barW},${yt} ${x + barW},${yt + r} L${x + barW},${yb} Z`
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto min-h-0 w-full flex-1" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.base : C.grid} strokeWidth="1" />
          <text x={pad.l - 10} y={y(t) + 6} textAnchor="end" fontSize="18" fill={C.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t}
          </text>
        </g>
      ))}
      {labels.map((label, i) => {
        const x0 = pad.l + i * band + (band - groupW) / 2
        const last = emphasizeLast && i === labels.length - 1
        return (
          <g key={label + i}>
            {series.map((s, j) => {
              const d = bar(x0 + j * (barW + gap), s.values[i])
              return d && <path key={s.name} d={d} fill={s.color} />
            })}
            {valueLabels && (
              <text
                x={x0 + groupW / 2}
                y={y(series[0].values[i]) - 8}
                textAnchor="middle"
                fontSize="20"
                fontWeight={last ? 700 : 500}
                fill={last ? C.ink : C.ink2}
              >
                {series[0].values[i]}
              </text>
            )}
            <text
              x={pad.l + i * band + band / 2}
              y={H - 12}
              textAnchor="middle"
              fontSize="18"
              fontWeight={last ? 700 : 400}
              fill={last ? C.ink : C.muted}
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ตารางซ่อน (ให้ screen reader อ่านตัวเลขทุกค่าได้)
function SrTable({ caption, head, rows }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            {r.map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
