import { useEffect, useState } from 'react'
import { findSeat, seatName } from '../../layouts/index.js'
import { CANVAS, QUIET_SEATS } from '../../layouts/quietZone.js'
import { formatQuiet, quietFor } from '../../tv.js'

// ============================================================
//  หน้าตา: ตากลอกมองไปรอบ ๆ ห้องเอง + กะพริบตา
//  เซนเซอร์ตรวจพบเสียงดังที่โต๊ะไหน -> ตาหันไปทางโต๊ะนั้นทันที ม่านตาเป็นสีแดง (ขอบจอแดงทำใน TvPage)
//  ทิศที่มอง = ตำแหน่งโต๊ะบนแปลนห้อง (ซ้าย/ขวา/บน/ล่าง ของแปลน) + มีแผนผังเล็กมุมจอบอกว่าโต๊ะไหน
// ============================================================

const ZONE = 'quiet'
const ALMOND = 'M-440,0 Q0,-330 440,0 Q0,330 -440,0 Z' // รูปตา (viewBox กลาง = 0,0)
const REACH_X = 250 // ม่านตาเลื่อนไปได้ไกลสุดกี่หน่วย (ไม่หลุดขอบตา)
const REACH_Y = 105

const clamp = (v) => Math.max(-1, Math.min(1, v))
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ตำแหน่งโต๊ะบนแปลน -> ทิศที่ตามอง (-1..1)
function directionTo(seatId) {
  const s = findSeat(ZONE, seatId)
  if (!s) return { x: 0, y: 0 }
  const cx = s.x + s.w / 2
  const cy = s.y + s.h / 2
  return {
    x: clamp((cx - (CANVAS.x + CANVAS.width / 2)) / (CANVAS.width / 2) / 0.6),
    y: clamp((cy - (CANVAS.y + CANVAS.height / 2)) / (CANVAS.height / 2) / 0.6),
  }
}

export default function EyeView({ data, alert, ageMs }) {
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  const [blink, setBlink] = useState(false)
  const alertId = alert?.id
  const alertSeat = alert?.seatId

  // ไม่มีเสียงดัง -> กลอกตามองไปรอบ ๆ ห้องเรื่อย ๆ (บางทีก็กลับมามองตรง)
  useEffect(() => {
    if (alertId || reduceMotion()) return
    let timer
    const wander = () => {
      const angle = Math.random() * Math.PI * 2
      const r = 0.35 + Math.random() * 0.65
      setGaze(Math.random() < 0.2 ? { x: 0, y: 0 } : { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
      timer = setTimeout(wander, 1800 + Math.random() * 2600)
    }
    timer = setTimeout(wander, 600)
    return () => clearTimeout(timer)
  }, [alertId])

  // เสียงดัง -> จ้องไปที่โต๊ะนั้น
  useEffect(() => {
    if (alertSeat) setGaze(directionTo(alertSeat))
  }, [alertId, alertSeat])

  // กะพริบตาทุก 3–7 วินาที
  useEffect(() => {
    if (reduceMotion()) return
    let wait
    let close
    const loop = () => {
      wait = setTimeout(() => {
        setBlink(true)
        close = setTimeout(() => {
          setBlink(false)
          loop()
        }, 140)
      }, 3000 + Math.random() * 4000)
    }
    loop()
    return () => {
      clearTimeout(wait)
      clearTimeout(close)
    }
  }, [])

  const dx = gaze.x * REACH_X
  const dy = gaze.y * REACH_Y
  const name = alertSeat ? seatName(ZONE, alertSeat) : ''

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#1c2a3f_0%,#0d0d0d_68%)] px-[4vw]">
      <p className="absolute left-[3vw] top-[3vh] text-[clamp(1rem,1.6vw,1.75rem)] font-semibold text-white/60">โซนเงียบ</p>

      <svg
        viewBox="-500 -300 1000 600"
        className="w-[min(78vw,125vh)]"
        role="img"
        aria-label={alert ? `ตากำลังมองไปที่${name}` : 'ตากำลังมองไปรอบ ๆ ห้อง'}
      >
        <defs>
          <clipPath id="tv-eye-shape">
            <path d={ALMOND} />
          </clipPath>
          <radialGradient id="tv-sclera" cx="50%" cy="46%" r="62%">
            <stop offset="55%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#9aa7b8" />
          </radialGradient>
          <radialGradient id="tv-iris-calm" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#99f6e4" />
            <stop offset="45%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#134e4a" />
          </radialGradient>
          <radialGradient id="tv-iris-alert" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fecaca" />
            <stop offset="45%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#7f1d1d" />
          </radialGradient>
          <linearGradient id="tv-lid-shadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f172a" stopOpacity="0.55" />
            <stop offset="32%" stopColor="#0f172a" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* ทั้งดวงหุบลง = กะพริบตา (จุดหมุนอยู่กลางตาเพราะ viewBox มี 0,0 อยู่ตรงกลาง) */}
        <g style={{ transform: `scaleY(${blink ? 0.04 : 1})`, transition: 'transform 110ms ease-in-out' }}>
          <path d={ALMOND} fill="url(#tv-sclera)" />
          <g clipPath="url(#tv-eye-shape)">
            <g
              style={{
                transform: `translate(${dx}px, ${dy}px)`,
                transition: `transform ${alert ? 320 : 1100}ms cubic-bezier(.45,0,.2,1)`,
              }}
            >
              <circle r="150" fill={`url(#${alert ? 'tv-iris-alert' : 'tv-iris-calm'})`} />
              {/* ลายม่านตา */}
              <circle r="105" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="70" strokeDasharray="3 9" />
              <circle r={alert ? 40 : 64} fill="#020617" style={{ transition: 'r 300ms ease' }} />
              <circle cx="-52" cy="-58" r="26" fill="#fff" opacity="0.9" />
              <circle cx="42" cy="46" r="10" fill="#fff" opacity="0.55" />
            </g>
            <path d={ALMOND} fill="url(#tv-lid-shadow)" />
          </g>
          <path d={ALMOND} fill="none" stroke="#0b1220" strokeWidth="16" strokeLinejoin="round" />
        </g>
      </svg>

      <div className="mt-[4vh] min-h-[8vw] text-center">
        {alert ? (
          <>
            <p className="text-[clamp(2rem,4vw,5rem)] font-bold text-red-400">ตรวจพบเสียงดังที่{name}</p>
            <p className="mt-2 text-[clamp(1.1rem,2vw,2.5rem)] text-white/80">ช่วยกันรักษาความเงียบนะครับ</p>
          </>
        ) : (
          <>
            <p className="text-[clamp(1.6rem,3vw,3.75rem)] font-semibold text-white/90">กำลังฟังความเงียบของห้อง…</p>
            <p className="mt-2 text-[clamp(1.1rem,1.8vw,2.25rem)] text-white/60">{formatQuiet(quietFor(data, ageMs))}</p>
          </>
        )}
      </div>

      {data && (
        <p className="absolute bottom-[3vh] left-[3vw] text-[clamp(0.9rem,1.3vw,1.5rem)] text-white/55">
          วันนี้ตรวจพบเสียงดัง {data.today} ครั้ง · เมื่อวานถึงเวลานี้ {data.yesterdaySoFar} ครั้ง
        </p>
      )}

      <MiniMap alertSeat={alertSeat} sensorSeats={data?.sensorSeats ?? []} />
    </div>
  )
}

// แผนผังเล็กมุมขวาล่าง: บอกว่าโต๊ะไหนเสียงดัง (แดง) และโต๊ะไหนมีเซนเซอร์ (ฟ้า)
function MiniMap({ alertSeat, sensorSeats }) {
  const sensors = new Set(sensorSeats)
  const target = alertSeat ? findSeat(ZONE, alertSeat) : null
  return (
    <figure className="absolute bottom-[3vh] right-[3vw] w-[15vw] min-w-[140px]">
      <svg
        viewBox={`${CANVAS.x} ${CANVAS.y} ${CANVAS.width} ${CANVAS.height}`}
        className="w-full rounded-2xl bg-white/[0.04] ring-1 ring-white/10"
        aria-hidden
      >
        {QUIET_SEATS.map((s) => (
          <rect
            key={s.id}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx="6"
            fill={s.id === alertSeat ? '#ef4444' : sensors.has(s.id) ? '#3987e5' : 'rgba(255,255,255,0.16)'}
          />
        ))}
        {target && (
          <circle
            className="tv-ping"
            cx={target.x + target.w / 2}
            cy={target.y + target.h / 2}
            r="70"
            fill="none"
            stroke="#ef4444"
            strokeWidth="10"
          />
        )}
      </svg>
      <figcaption className="mt-2 flex justify-center gap-4 text-[clamp(0.7rem,0.9vw,1rem)] text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#3987e5]" />
          มีเซนเซอร์
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#ef4444]" />
          เสียงดัง
        </span>
      </figcaption>
    </figure>
  )
}
