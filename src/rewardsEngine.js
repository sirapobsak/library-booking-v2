// ============================================================
//  กติกาคะแนน 2 มิเตอร์ (ใช้ในโหมดทดลอง + ชุดทดสอบ) — ต้องทำงานเหมือน supabase/points.sql ทุกข้อ
//  ฟังก์ชันทั้งหมดรับข้อมูล (d) + รายการจอง + เวลา "ตอนนี้" (now) แล้วแก้ d ตรง ๆ ไม่แตะ localStorage
//
//  มิเตอร์ A ความประพฤติ (standing) 0–100 เริ่ม 100 — ใช้ตัดสินสิทธิ์อย่างเดียว เอาไปแลกของไม่ได้
//  มิเตอร์ B เหรียญ (coins) เริ่ม 0 ไม่มีเพดาน — เอาไว้แลกคูปอง
// ============================================================

export const DEFAULT_SETTINGS = {
  startingPoints: 100, // ความประพฤติเริ่มต้น
  noisePenalty: 5, // หักครั้งแรกของวัน
  penaltyStep: 5, // ครั้งต่อไปหักแรงขึ้นครั้งละ
  penaltyMax: 20, // เพดานต่อครั้ง
  dailyCap: 40, // หักรวมสูงสุดต่อวัน
  cooldownSeconds: 5, // พักหลังหัก (ต่ออุปกรณ์)
  sensorEnabled: true,
  refundMinutes: 10, // เงียบต่อกี่นาทีหลังโดนหัก -> คืน
  refundPercent: 50, // คืนกี่ %
  sessionBonus: 2, // จบการจองแบบเงียบ (ความประพฤติ)
  sessionCoins: 2, // จบการจองแบบเงียบ (เหรียญ)
  weeklyBonus: 5, // ไม่ทำผิดครบ 1 สัปดาห์
  coinGate: 80, // ได้เหรียญเฉพาะตอนความประพฤติ ≥ ค่านี้
  suspendDays: 7, // ความประพฤติต่ำกว่า 20 -> ระงับกี่วัน
}

// ระดับสิทธิ์ (บันไดบทลงโทษ) — เรียงจากดีไปแย่
export const LEVELS = {
  normal: {
    label: 'ปกติ',
    range: '80–100',
    tone: 'green',
    rights: ['ใช้สิทธิ์ได้ครบทุกอย่าง'],
  },
  warn: {
    label: 'เตือน',
    range: '60–79',
    tone: 'yellow',
    rights: ['โปรไฟล์ขึ้นสถานะเตือน', 'ยังใช้ได้ทุกอย่าง'],
  },
  limit1: {
    label: 'จำกัดระดับ 1',
    range: '40–59',
    tone: 'orange',
    rights: ['จองห้องประชุม/พื้นที่พิเศษไม่ได้', 'ยืมหนังสือได้จำนวนน้อยลง'],
  },
  limit2: {
    label: 'จำกัดระดับ 2',
    range: '20–39',
    tone: 'red',
    rights: ['จองห้องประชุม/พื้นที่พิเศษไม่ได้', 'ยืมหนังสือไม่ได้'],
  },
  suspended: {
    label: 'ระงับการเข้าใช้ชั่วคราว',
    range: '0–19',
    tone: 'rose',
    rights: ['จอง/เข้าร่วมโต๊ะไม่ได้จนครบกำหนด', 'ยื่นอุทธรณ์ได้'],
  },
}

// เหรียญโบนัสเมื่อเงียบติดต่อกันครบ 7 / 14 / 30 วัน (และทุก ๆ 30 วันต่อจากนั้น)
export const STREAK_MILESTONES = [7, 14, 30]
export function streakBonus(streak) {
  if (streak === 7) return 10
  if (streak === 14) return 20
  if (streak >= 30 && streak % 30 === 0) return 50
  return 0
}
export const nextMilestone = (streak) => STREAK_MILESTONES.find((m) => m > streak) ?? (Math.floor(streak / 30) + 1) * 30

export const CATALOG = [
  { id: 'small', name: 'คูปองส่วนลดเล็ก', description: 'ส่วนลดเล็ก ใช้ได้ที่เคาน์เตอร์ห้องสมุด', cost: 50 },
  { id: 'medium', name: 'คูปองส่วนลดกลาง', description: 'ส่วนลดกลาง ใช้ได้ที่เคาน์เตอร์ห้องสมุด', cost: 100 },
  { id: 'large', name: 'คูปองส่วนลดใหญ่', description: 'ส่วนลดใหญ่ ใช้ได้ที่เคาน์เตอร์ห้องสมุด', cost: 200 },
]

const WEEK_MS = 7 * 24 * 3600 * 1000
const MIN_MS = 60 * 1000

// ---------- เวลา (เครื่องผู้ใช้ = เวลาไทย) ----------
const pad = (n) => String(n).padStart(2, '0')
export const dayOf = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// เวลาเริ่ม/จบของการจองเป็นมิลลิวินาที
export const bookingStart = (b) => new Date(`${b.date}T${b.start}:00`).getTime()
export const bookingEnd = (b) => new Date(`${b.date}T${b.end}:00`).getTime()

export const levelOf = (standing, suspendedUntil, now) =>
  (suspendedUntil && Date.parse(suspendedUntil) > now) || standing < 20
    ? 'suspended'
    : standing < 40
      ? 'limit2'
      : standing < 60
        ? 'limit1'
        : standing < 80
          ? 'warn'
          : 'normal'

const fail = (key) => {
  const e = new Error(key)
  e.key = key
  throw e
}

const randomHex = (bytes) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

// ============================================================
//  ข้อมูลตั้งต้น + อ่านของแต่ละคน
// ============================================================
export function normalize(raw = {}) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...raw.settings },
    points: raw.points ?? {}, // ความประพฤติ
    coins: raw.coins ?? {},
    meta: raw.meta ?? {}, // { suspendedUntil, streak, bestStreak, streakLastDay, lastViolationAt, lastWeeklyAt, createdAt }
    logs: raw.logs ?? [],
    devices: raw.devices ?? [],
    sessions: raw.sessions ?? [],
    appeals: raw.appeals ?? [],
    coupons: raw.coupons ?? [],
  }
}

export function ensure(d, uid, now) {
  if (d.points[uid] == null) d.points[uid] = Math.min(100, d.settings.startingPoints)
  if (d.points[uid] > 100) d.points[uid] = 100
  if (d.coins[uid] == null) d.coins[uid] = 0
  if (!d.meta[uid]) {
    d.meta[uid] = {
      suspendedUntil: null,
      streak: 0,
      bestStreak: 0,
      streakLastDay: null,
      lastViolationAt: null,
      lastWeeklyAt: null,
      createdAt: new Date(now).toISOString(),
    }
  }
  return d.meta[uid]
}

// ============================================================
//  เปลี่ยนคะแนน + เก็บประวัติ (เหมือน _change_meter)
// ============================================================
export function changeMeter(d, uid, meter, delta, source, reason, now, extra = {}) {
  const m = ensure(d, uid, now)
  const store = meter === 'coins' ? d.coins : d.points
  const old = store[uid]
  const next = meter === 'coins' ? Math.max(0, old + delta) : Math.min(100, Math.max(0, old + delta))
  store[uid] = next

  if (meter === 'standing') {
    const suspended = m.suspendedUntil && Date.parse(m.suspendedUntil) > now
    // เริ่มระงับเฉพาะตอน "โดนลด" จนต่ำกว่า 20 (ได้คืนแต่ยังไม่ถึง 20 ไม่นับว่าทำผิดซ้ำ)
    if (delta < 0 && next < 20 && !suspended) {
      m.suspendedUntil = new Date(now + d.settings.suspendDays * 24 * 3600 * 1000).toISOString()
    } else if (next >= 20 && source === 'admin' && m.suspendedUntil) {
      m.suspendedUntil = null
    }
  }

  if (next !== old) {
    d.logs.unshift({
      id: `${now}-${randomHex(3)}`,
      createdAt: new Date(now).toISOString(),
      userId: uid,
      meter,
      delta: next - old,
      balanceAfter: next,
      source,
      reason,
      deviceId: extra.deviceId ?? null,
      seatId: extra.seatId ?? null,
      actorId: extra.actorId ?? null,
      bookingId: extra.bookingId ?? null,
      refunded: false,
    })
    d.logs = d.logs.slice(0, 1000)
  }
  return next
}

// ครั้งถัดไปจะหักเท่าไร (ไล่ระดับในวันเดียวกัน + ไม่เกินยอดรวมต่อวัน)
export function nextPenalty(d, uid, now) {
  const s = d.settings
  const today = dayOf(now)
  const todays = d.logs.filter(
    (l) => l.userId === uid && l.source === 'sensor' && l.meter === 'standing' && l.delta < 0 && dayOf(l.createdAt) === today,
  )
  const lost = todays.reduce((sum, l) => sum - l.delta, 0)
  const amount = Math.min(s.noisePenalty + s.penaltyStep * todays.length, s.penaltyMax)
  return Math.max(0, Math.min(amount, s.dailyCap - lost))
}

const sessionOf = (d, bookingId, uid) => d.sessions.find((x) => x.bookingId === bookingId && x.userId === uid)

function upsertSession(d, booking, uid) {
  let s = sessionOf(d, booking.id, uid)
  if (!s) {
    s = {
      bookingId: booking.id,
      userId: uid,
      date: booking.date,
      endsAt: bookingEnd(booking),
      checkedInAt: null,
      noisy: false,
      rewarded: false,
      settledAt: null,
    }
    d.sessions.push(s)
  }
  return s
}

const peopleOf = (b) => [...new Set([b.userId, ...(b.members ?? []).map((m) => m.userId)])]

// ============================================================
//  สรุปงานที่ต้องรอเวลา (เหมือน _settle_user) — เรียกซ้ำได้ ไม่ให้ซ้ำ
// ============================================================
export function settleUser(d, uid, bookings, now) {
  const s = d.settings
  const m = ensure(d, uid, now)

  // ลำดับเหมือน SQL: คืน 50% -> หมดเวลาระงับ -> จบการจอง -> ฟื้นรายสัปดาห์ (สรุปช้าก็ได้ผลเท่าเดิม)

  // 1) คืนทันที: โดนหักแล้วเงียบต่อ 10 นาที (ยังอยู่ในเวลาจอง) -> คืน 50% ของที่เพิ่งเสีย
  const pending = d.logs.filter(
    (l) => l.userId === uid && l.source === 'sensor' && l.meter === 'standing' && l.delta < 0 && !l.refunded && l.bookingId,
  )
  const byBooking = new Map()
  pending.forEach((l) => byBooking.set(l.bookingId, [...(byBooking.get(l.bookingId) ?? []), l]))
  for (const [bookingId, logs] of byBooking) {
    const lastAt = Math.max(...logs.map((l) => Date.parse(l.createdAt)))
    if (lastAt + s.refundMinutes * MIN_MS > now) continue
    logs.forEach((l) => (l.refunded = true))
    const booking = bookings.find((b) => b.id === bookingId)
    if (booking && bookingEnd(booking) >= lastAt + s.refundMinutes * MIN_MS) {
      const lost = logs.reduce((sum, l) => sum - l.delta, 0)
      changeMeter(
        d,
        uid,
        'standing',
        Math.round((lost * s.refundPercent) / 100),
        'system',
        `เงียบต่อเนื่อง ${s.refundMinutes} นาทีหลังโดนหัก — คืน ${s.refundPercent}%`,
        now,
        { bookingId },
      )
    }
  }

  // 2) หมดเวลาระงับ -> กลับมาที่ 20
  if (m.suspendedUntil && Date.parse(m.suspendedUntil) <= now) {
    m.suspendedUntil = null
    if (d.points[uid] < 20) {
      changeMeter(d, uid, 'standing', 20 - d.points[uid], 'system', 'ครบกำหนดระงับชั่วคราว — กลับมาใช้ห้องสมุดได้ (จำกัดระดับ 2)', now)
    }
  }

  // 3) จบการจอง: เช็คอินแล้ว + ไม่โดนหักทั้งวัน -> +2, สถิติ +1 วัน, เหรียญ (ถ้า ≥ 80) — วันละครั้ง
  const ended = d.sessions
    .filter((x) => x.userId === uid && !x.settledAt && x.endsAt <= now)
    .sort((a, b) => a.endsAt - b.endsAt)
  for (const sess of ended) {
    sess.settledAt = new Date(now).toISOString()
    if (!sess.checkedInAt || sess.noisy) continue
    const sameDay = d.sessions.filter((x) => x.userId === uid && x.date === sess.date)
    if (sameDay.some((x) => x.noisy) || sameDay.some((x) => x.rewarded)) continue
    sess.rewarded = true

    changeMeter(d, uid, 'standing', s.sessionBonus, 'system', 'ใช้โต๊ะจนจบการจองแบบเงียบ', now, { bookingId: sess.bookingId })
    if (m.streakLastDay !== sess.date) {
      m.streak += 1
      m.bestStreak = Math.max(m.bestStreak, m.streak)
      m.streakLastDay = sess.date
    }
    if (d.points[uid] >= s.coinGate) {
      changeMeter(d, uid, 'coins', s.sessionCoins, 'system', 'ใช้โต๊ะจนจบการจองแบบเงียบ', now, { bookingId: sess.bookingId })
      const bonus = streakBonus(m.streak)
      if (bonus > 0) changeMeter(d, uid, 'coins', bonus, 'system', `โบนัสเงียบติดต่อกันครบ ${m.streak} วัน`, now)
    }
  }

  // 4) ฟื้นเองตามเวลา: ไม่ทำผิดเลยครบทุก 7 วัน +5
  const anchor = Math.max(Date.parse(m.lastViolationAt ?? m.createdAt), Date.parse(m.lastWeeklyAt ?? m.createdAt))
  const weeks = Math.floor((now - anchor) / WEEK_MS)
  if (weeks >= 1) {
    m.lastWeeklyAt = new Date(anchor + weeks * WEEK_MS).toISOString()
    if (d.points[uid] < 100) {
      changeMeter(d, uid, 'standing', s.weeklyBonus * weeks, 'system', `ไม่มีการทำผิดครบ ${weeks} สัปดาห์ — ฟื้นคะแนนอัตโนมัติ`, now)
    }
  }
}

// ============================================================
//  เซนเซอร์ตรวจพบเสียงดัง (เหมือน _apply_noise)
// ============================================================
export function applyNoise(d, deviceId, level, bookings, now) {
  const s = d.settings
  const dev = d.devices.find((x) => x.id === deviceId) ?? fail('NOT_FOUND')
  dev.lastSeenAt = new Date(now).toISOString()
  if (level != null) dev.lastLevel = level

  if (!dev.active) return { ok: false, status: 'DEVICE_DISABLED' }
  if (!s.sensorEnabled) return { ok: false, status: 'SENSOR_OFF' }
  if (s.noisePenalty <= 0) return { ok: true, status: 'NO_PENALTY' }
  if (dev.lastPenaltyAt) {
    const waitMs = Date.parse(dev.lastPenaltyAt) + s.cooldownSeconds * 1000 - now
    if (waitMs > 0) return { ok: true, status: 'COOLDOWN', retry_in: Math.ceil(waitMs / 1000) }
  }

  const booking = bookings.find(
    (b) => b.zoneId === dev.zoneId && b.seatId === dev.seatId && bookingStart(b) <= now && now < bookingEnd(b),
  )
  if (!booking) return { ok: true, status: 'NO_BOOKING' }

  const amounts = peopleOf(booking).map((uid) => {
    settleUser(d, uid, bookings, now)
    const amount = nextPenalty(d, uid, now)
    upsertSession(d, booking, uid).noisy = true
    const m = ensure(d, uid, now)
    m.streak = 0
    m.lastViolationAt = new Date(now).toISOString()
    if (amount > 0) {
      changeMeter(d, uid, 'standing', -amount, 'sensor', 'เซนเซอร์ตรวจพบเสียงดัง', now, {
        deviceId: dev.id,
        seatId: dev.seatId,
        bookingId: booking.id,
      })
    }
    return amount
  })
  dev.lastPenaltyAt = new Date(now).toISOString()
  const max = Math.max(...amounts)
  if (max === 0) return { ok: true, status: 'DAILY_CAP', users: amounts.length }
  return { ok: true, status: 'DEDUCTED', users: amounts.length, penalty: max, penalty_min: Math.min(...amounts) }
}

// ============================================================
//  คำสั่งของผู้ใช้
// ============================================================
export function checkIn(d, uid, bookingId, bookings, now) {
  const b = bookings.find((x) => x.id === bookingId) ?? fail('NOT_FOUND')
  if (!peopleOf(b).includes(uid)) fail('NOT_MEMBER')
  if (now < bookingStart(b) - 15 * MIN_MS) fail('TOO_EARLY')
  if (now >= bookingEnd(b)) fail('EXPIRED')
  ensure(d, uid, now)
  const sess = upsertSession(d, b, uid)
  sess.checkedInAt ??= new Date(now).toISOString()
  return { ok: true }
}

export function redeem(d, uid, couponId, bookings, now) {
  settleUser(d, uid, bookings, now)
  const c = CATALOG.find((x) => x.id === couponId) ?? fail('NOT_FOUND')
  const m = ensure(d, uid, now)
  if (levelOf(d.points[uid], m.suspendedUntil, now) === 'suspended') fail('SUSPENDED')
  if (d.coins[uid] < c.cost) fail('NOT_ENOUGH_COINS')
  let code
  do {
    code = `LB-${randomHex(4).toUpperCase()}`
  } while (d.coupons.some((x) => x.code === code))
  changeMeter(d, uid, 'coins', -c.cost, 'redeem', `แลก${c.name}`, now)
  d.coupons.unshift({
    id: `${now}-${randomHex(3)}`,
    userId: uid,
    couponId: c.id,
    name: c.name,
    cost: c.cost,
    code,
    status: 'unused',
    createdAt: new Date(now).toISOString(),
    usedAt: null,
  })
  return { code, name: c.name, cost: c.cost }
}

export function submitAppeal(d, uid, message, bookings, now) {
  settleUser(d, uid, bookings, now)
  const m = ensure(d, uid, now)
  if (levelOf(d.points[uid], m.suspendedUntil, now) !== 'suspended') fail('NOT_SUSPENDED')
  const text = (message ?? '').trim()
  if (text.length < 5 || text.length > 500) fail('BAD_MESSAGE')
  if (d.appeals.some((a) => a.userId === uid && a.status === 'pending')) fail('APPEAL_PENDING')
  d.appeals.unshift({
    id: `${now}-${randomHex(3)}`,
    userId: uid,
    message: text,
    status: 'pending',
    adminNote: '',
    createdAt: new Date(now).toISOString(),
    decidedAt: null,
  })
  return { ok: true }
}

export function decideAppeal(d, adminId, appealId, approve, note, now) {
  const a = d.appeals.find((x) => x.id === appealId && x.status === 'pending') ?? fail('NOT_FOUND')
  a.status = approve ? 'approved' : 'rejected'
  a.adminNote = (note ?? '').trim()
  a.decidedAt = new Date(now).toISOString()
  if (approve) {
    const m = ensure(d, a.userId, now)
    m.suspendedUntil = null
    if (d.points[a.userId] < 20) {
      changeMeter(d, a.userId, 'standing', 20 - d.points[a.userId], 'admin', 'อนุมัติคำอุทธรณ์ — ยกเลิกการระงับ', now, {
        actorId: adminId,
      })
    }
  }
}

export function useCoupon(d, code, now) {
  const c = d.coupons.find((x) => x.code === (code ?? '').trim().toUpperCase()) ?? fail('NOT_FOUND')
  if (c.status === 'used') fail('COUPON_USED')
  c.status = 'used'
  c.usedAt = new Date(now).toISOString()
  return { code: c.code, name: c.name }
}

// เช็คก่อนจอง/เข้าร่วมโต๊ะ: คืนรหัสเหตุผลที่ห้าม หรือ null (ห้อง R1–R3 = "ห้อง/พื้นที่พิเศษ")
export function bookingRestriction(d, uid, seatId, bookings, now) {
  settleUser(d, uid, bookings, now)
  const level = levelOf(d.points[uid], d.meta[uid].suspendedUntil, now)
  if (level === 'suspended') return 'SUSPENDED'
  if ((level === 'limit1' || level === 'limit2') && /^R\d+$/.test(seatId)) return 'RESTRICTED_ROOM'
  return null
}

// ============================================================
//  ข้อมูลหน้า "คะแนนสะสม" (หน้าตาเดียวกับ get_my_rewards ใน SQL)
// ============================================================
export function myRewards(d, uid, bookings, now) {
  settleUser(d, uid, bookings, now)
  const m = d.meta[uid]
  const today = dayOf(now)
  const suspended = m.suspendedUntil && Date.parse(m.suspendedUntil) > now
  const anchor = Math.max(Date.parse(m.lastViolationAt ?? m.createdAt), Date.parse(m.lastWeeklyAt ?? m.createdAt))
  const appeal = d.appeals.find((a) => a.userId === uid)
  return {
    standing: d.points[uid],
    coins: d.coins[uid],
    level: levelOf(d.points[uid], m.suspendedUntil, now),
    suspendedUntil: suspended ? m.suspendedUntil : null,
    streak: m.streak,
    bestStreak: m.bestStreak,
    todayCounted: m.streak > 0 && m.streakLastDay === today,
    todayNoisy: d.sessions.some((x) => x.userId === uid && x.date === today && x.noisy),
    nextPenalty: nextPenalty(d, uid, now),
    nextWeeklyAt: new Date(anchor + WEEK_MS).toISOString(),
    settings: { ...d.settings },
    today: bookings
      .filter((b) => b.date === today && peopleOf(b).includes(uid))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => {
        const sess = sessionOf(d, b.id, uid)
        return {
          bookingId: b.id,
          zoneId: b.zoneId,
          seatId: b.seatId,
          start: b.start,
          end: b.end,
          isOwner: b.userId === uid,
          checkedIn: Boolean(sess?.checkedInAt),
          noisy: Boolean(sess?.noisy),
          ended: now >= bookingEnd(b),
          canCheckIn: !sess?.checkedInAt && now >= bookingStart(b) - 15 * MIN_MS && now < bookingEnd(b),
        }
      }),
    catalog: CATALOG,
    coupons: d.coupons.filter((c) => c.userId === uid).slice(0, 30),
    logs: d.logs.filter((l) => l.userId === uid).slice(0, 30),
    appeal: appeal
      ? { id: appeal.id, status: appeal.status, message: appeal.message, adminNote: appeal.adminNote, createdAt: appeal.createdAt }
      : null,
  }
}
