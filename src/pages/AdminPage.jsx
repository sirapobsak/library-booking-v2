import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  Coins,
  Copy,
  Cpu,
  Flame,
  History,
  KeyRound,
  MonitorPlay,
  Plug,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  ShieldOff,
  Ticket,
  Trash2,
  Unplug,
  Users,
  Volume2,
} from 'lucide-react'
import Header from '../components/Header.jsx'
import LevelBadge from '../components/LevelBadge.jsx'
import Modal from '../components/Modal.jsx'
import { useAuth } from '../auth.jsx'
import { getZone } from '../data.js'
import { seatName } from '../layouts/index.js'
import { KIND_LABEL, QUIET_SEATS } from '../layouts/quietZone.js'
import { noiseStatusText, useMyPoints, usePointsAdmin } from '../points.js'

// ============================================================
//  หน้าผู้ดูแลระบบ — คะแนนความประพฤติ + เหรียญ + คำอุทธรณ์ + คูปอง + เซนเซอร์ตรวจจับเสียง (ESP32)
//  เข้าได้เฉพาะผู้ดูแล (ฝั่งฐานข้อมูลเช็คสิทธิ์ซ้ำอีกชั้นในทุกฟังก์ชัน)
// ============================================================

const TABS = [
  { id: 'users', label: 'ผู้ใช้ & คะแนน', icon: Users },
  { id: 'logs', label: 'ประวัติ', icon: History },
  { id: 'appeals', label: 'คำอุทธรณ์', icon: Scale },
  { id: 'coupons', label: 'คูปอง', icon: Ticket },
  { id: 'devices', label: 'อุปกรณ์เซนเซอร์', icon: Cpu },
  { id: 'settings', label: 'ตั้งค่า', icon: Settings },
]

// ที่มาของการเปลี่ยนคะแนน (ตรงกับคอลัมน์ source ใน user_point_logs)
const SOURCE = {
  sensor: { label: 'เซนเซอร์', cls: 'bg-amber-100 text-amber-800' },
  admin: { label: 'ผู้ดูแล', cls: 'bg-sky-100 text-sky-800' },
  system: { label: 'ระบบ (อัตโนมัติ)', cls: 'bg-slate-100 text-slate-600' },
  redeem: { label: 'แลกคูปอง', cls: 'bg-violet-100 text-violet-800' },
}

const METER = {
  standing: { label: 'ความประพฤติ', unit: 'คะแนน', cls: 'bg-sky-50 text-sky-700' },
  coins: { label: 'เหรียญ', unit: 'เหรียญ', cls: 'bg-amber-50 text-amber-700' },
}

const DEVICE_ZONE = 'quiet' // ตอนนี้มีผังที่นั่งแค่โซนเงียบ
const ONLINE_MS = 150 * 1000 // ESP32 ส่ง heartbeat ทุก 30 วิ -> เงียบไปเกิน 2.5 นาที = ออฟไลน์

const formatTime = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return `${s} วินาทีที่แล้ว`
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`
  return formatTime(iso)
}

export default function AdminPage() {
  const { user } = useAuth()
  const { isAdmin, loading, installed, mode } = useMyPoints()
  const api = usePointsAdmin()
  const [tab, setTab] = useState('users')

  let body
  if (loading) {
    body = <p className="text-slate-500">กำลังโหลด...</p>
  } else if (!installed) {
    body = (
      <Notice icon={AlertCircle} title="ระบบคะแนนบนฐานข้อมูลยังไม่ใช่เวอร์ชันล่าสุด">
        รัน supabase/bookings.sql แล้วตามด้วย supabase/points.sql ใน Supabase Dashboard (วิธีอยู่หัวไฟล์)
      </Notice>
    )
  } else if (!isAdmin) {
    body = (
      <Notice icon={ShieldOff} title="หน้านี้สำหรับผู้ดูแลระบบเท่านั้น">
        ถ้าต้องการสิทธิ์ ให้ผู้ดูแลคนอื่นตั้งให้จากหน้านี้
      </Notice>
    )
  } else {
    body = (
      <>
        {mode === 'local' && (
          <div className="mb-5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            โหมดทดลอง: ข้อมูลคะแนนเก็บในเบราว์เซอร์นี้เท่านั้น และทุกบัญชีเป็นผู้ดูแล
          </div>
        )}

        <nav className="-mx-5 mb-6 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                tab === id ? 'bg-slate-800 text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {tab === 'users' && <UsersTab api={api} meId={user.id} />}
        {tab === 'logs' && <LogsTab api={api} />}
        {tab === 'appeals' && <AppealsTab api={api} />}
        {tab === 'coupons' && <CouponsTab api={api} />}
        {tab === 'devices' && <DevicesTab api={api} />}
        {tab === 'settings' && <SettingsTab api={api} />}
      </>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-100 text-sky-700">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">ผู้ดูแลระบบ</h1>
            <p className="text-sm text-slate-500">จัดการคะแนนความประพฤติ เหรียญ คูปอง และเซนเซอร์ตรวจจับเสียง</p>
          </div>
          {/* จอทีวีในโซน — เปิดแท็บใหม่ แล้วลากไปไว้บนจอทีวี (ไม่ต้องล็อกอิน) */}
          <a
            href="#/tv/auto"
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900"
          >
            <MonitorPlay className="h-4 w-4" />
            เปิดหน้าจอทีวี
          </a>
        </div>
        {body}
      </main>
    </div>
  )
}

// ============================================================
//  แท็บ 1: ผู้ใช้ & คะแนน
// ============================================================
function UsersTab({ api, meId }) {
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState(null) // null = กำลังโหลด
  const [editing, setEditing] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [flash, setFlash] = useFlash()

  const load = useCallback(
    async (q) => {
      const r = await api.listUsers(q)
      if (r.ok) setUsers(r.data)
      else {
        setUsers([])
        setFlash({ type: 'error', text: r.message })
      }
    },
    [api, setFlash],
  )

  // รอพิมพ์ค้นหาเสร็จ 0.3 วิ ค่อยโหลด (ไม่ยิงทุกตัวอักษร)
  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search, load])

  async function quick(u, delta) {
    setBusyId(u.id)
    const r = await api.adjust(u.id, delta, `ปรับด่วน ${delta > 0 ? '+' : ''}${delta} ความประพฤติ`)
    setBusyId(null)
    if (!r.ok) setFlash({ type: 'error', text: r.message })
    load(search.trim()) // ระดับสิทธิ์/การระงับอาจเปลี่ยนตาม
  }

  return (
    <div>
      <FlashBar flash={flash} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="field pl-10"
          placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="ค้นหาผู้ใช้"
        />
      </div>
      <p className="mt-3 text-sm text-slate-500">{users ? `ทั้งหมด ${users.length} คน` : 'กำลังโหลด...'}</p>

      <div className="mt-3 space-y-2">
        {users?.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="min-w-0 flex-1 basis-56">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
                {u.name}
                <LevelBadge level={u.level} />
                {u.isAdmin && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">ผู้ดูแล</span>
                )}
                {u.id === meId && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">คุณ</span>
                )}
              </p>
              <p className="truncate text-sm text-slate-500">{[u.email, u.phone].filter(Boolean).join(' · ')}</p>
              {u.suspendedUntil && <p className="text-xs text-rose-600">ระงับถึง {formatTime(u.suspendedUntil)}</p>}
            </div>

            <div className="flex items-end gap-4 text-right">
              <div className="w-16">
                <p className="text-2xl font-bold tabular-nums text-slate-800">{u.points}</p>
                <p className="text-xs text-slate-400">ความประพฤติ</p>
              </div>
              <div className="w-14">
                <p className="flex items-center justify-end gap-1 text-lg font-bold tabular-nums text-amber-600">
                  <Coins className="h-4 w-4" />
                  {u.coins}
                </p>
                <p className="text-xs text-slate-400">เหรียญ</p>
              </div>
              <div className="w-10">
                <p className="flex items-center justify-end gap-0.5 text-lg font-bold tabular-nums text-orange-500">
                  <Flame className="h-4 w-4" />
                  {u.streak}
                </p>
                <p className="text-xs text-slate-400">วัน</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {[-5, -1, 1, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={busyId === u.id}
                  onClick={() => quick(u, d)}
                  aria-label={`${d > 0 ? 'เพิ่ม' : 'ลด'}ความประพฤติ ${Math.abs(d)} ให้ ${u.name}`}
                  className={`h-9 min-w-[2.75rem] rounded-lg px-2 text-sm font-semibold tabular-nums transition disabled:opacity-50 ${
                    d < 0 ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-green-50 text-green-700 hover:bg-green-100'
                  }`}
                >
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEditing(u)}
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                ปรับ…
              </button>
            </div>
          </div>
        ))}
        {users?.length === 0 && <Empty>ไม่พบผู้ใช้</Empty>}
      </div>

      {editing && (
        <EditPointsModal
          user={editing}
          api={api}
          meId={meId}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null)
            setFlash({ type: 'ok', text })
            load(search.trim())
          }}
        />
      )}
    </div>
  )
}

function EditPointsModal({ user, api, meId, onClose, onSaved }) {
  const [meter, setMeter] = useState('standing') // standing = ความประพฤติ, coins = เหรียญ
  const [mode, setMode] = useState('add') // add = เพิ่ม, sub = ลด, set = ตั้งเป็นค่านี้
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const current = meter === 'coins' ? user.coins : user.points
  const max = meter === 'coins' ? Infinity : 100
  const unit = METER[meter].unit
  const n = Number(amount)
  const valid = amount !== '' && Number.isInteger(n) && n >= 0 && (mode === 'set' ? n <= max : n > 0)
  const clamp = (v) => Math.min(max, Math.max(0, v))
  const preview = !valid ? null : mode === 'add' ? clamp(current + n) : mode === 'sub' ? clamp(current - n) : n

  async function save(e) {
    e.preventDefault()
    if (!valid) return setError(meter === 'standing' ? 'กรอกเลขจำนวนเต็ม (ความประพฤติ 0–100)' : 'กรอกเลขจำนวนเต็ม')
    setBusy(true)
    setError('')
    const r =
      mode === 'set'
        ? await api.setPoints(user.id, n, reason, meter)
        : await api.adjust(user.id, mode === 'add' ? n : -n, reason, meter)
    setBusy(false)
    if (!r.ok) return setError(r.message)
    onSaved(`อัปเดต${METER[meter].label}ของ ${user.name} เป็น ${r.data} ${unit}แล้ว`)
  }

  async function toggleAdmin() {
    setBusy(true)
    setError('')
    const r = await api.setAdmin(user.id, !user.isAdmin)
    setBusy(false)
    if (!r.ok) return setError(r.message)
    onSaved(user.isAdmin ? `ถอนสิทธิ์ผู้ดูแลของ ${user.name} แล้ว` : `ตั้ง ${user.name} เป็นผู้ดูแลแล้ว`)
  }

  return (
    <Modal title={`ปรับคะแนน — ${user.name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Segmented
          label="ปรับอะไร"
          value={meter}
          onChange={setMeter}
          options={[
            ['standing', 'ความประพฤติ'],
            ['coins', 'เหรียญ'],
          ]}
        />

        <div className="rounded-2xl bg-slate-50 p-4 text-center">
          <p className="text-sm text-slate-500">{METER[meter].label}ตอนนี้</p>
          <p className="text-3xl font-bold tabular-nums text-slate-800">{current}</p>
        </div>

        <Segmented
          label="วิธีปรับ"
          value={mode}
          onChange={setMode}
          options={[
            ['add', 'เพิ่ม'],
            ['sub', 'ลด'],
            ['set', 'ตั้งเป็น'],
          ]}
        />

        <label className="block">
          <span className="label">{mode === 'set' ? `ค่าใหม่ (${unit})` : `จำนวน (${unit})`}</span>
          <input
            className="field"
            type="number"
            min="0"
            max={meter === 'standing' ? 100 : undefined}
            step="1"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </label>

        <label className="block">
          <span className="label">เหตุผล (เก็บไว้ในประวัติ ผู้ใช้เห็นด้วย)</span>
          <input
            className="field"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={meter === 'standing' ? 'เช่น คืนหนังสือตรงเวลา +3' : 'เช่น รางวัลกิจกรรมจิตอาสา'}
            maxLength={120}
          />
        </label>

        {preview !== null && (
          <p className="text-sm text-slate-600">
            หลังปรับ: <b className="text-slate-800">{preview}</b> {unit}
            {meter === 'standing' && ' (ความประพฤติอยู่ในช่วง 0–100 · ต่ำกว่า 20 = ระงับการเข้าใช้)'}
          </p>
        )}
        {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        <button type="submit" disabled={busy || !valid} className="btn-primary">
          บันทึก
        </button>
      </form>

      {/* ตั้ง/ถอนผู้ดูแล — ถอนสิทธิ์ตัวเองไม่ได้ (กันระบบไม่เหลือผู้ดูแล) */}
      {api.mode === 'cloud' && user.id !== meId && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={toggleAdmin}
            disabled={busy}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
              user.isAdmin
                ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                : 'border-sky-200 text-sky-700 hover:bg-sky-50'
            }`}
          >
            {user.isAdmin ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            {user.isAdmin ? 'ถอนสิทธิ์ผู้ดูแล' : 'ตั้งเป็นผู้ดูแล'}
          </button>
        </div>
      )}
    </Modal>
  )
}

function Segmented({ label, value, onChange, options }) {
  return (
    <div
      className={`grid gap-1 rounded-xl bg-slate-100 p-1 ${options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-lg py-2 text-sm font-semibold transition ${
            value === id ? 'bg-white text-slate-800 shadow' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

// ============================================================
//  แท็บ 2: ประวัติ
// ============================================================
function LogsTab({ api }) {
  const [source, setSource] = useState(null) // null = ทั้งหมด
  const [logs, setLogs] = useState(null)
  const [flash, setFlash] = useFlash()

  const load = useCallback(async () => {
    const r = await api.getLogs(200, source)
    if (r.ok) setLogs(r.data)
    else {
      setLogs([])
      setFlash({ type: 'error', text: r.message })
    }
  }, [api, source, setFlash])

  useEffect(() => {
    setLogs(null)
    load()
  }, [load])

  return (
    <div>
      <FlashBar flash={flash} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          [null, 'ทั้งหมด'],
          ['sensor', 'เซนเซอร์'],
          ['system', 'ระบบ'],
          ['admin', 'ผู้ดูแล'],
          ['redeem', 'แลกคูปอง'],
        ].map(([id, label]) => (
          <Chip key={label} active={source === id} onClick={() => setSource(id)}>
            {label}
          </Chip>
        ))}
        <button
          type="button"
          onClick={load}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-500 transition hover:bg-white"
        >
          <RefreshCw className="h-4 w-4" />
          โหลดใหม่
        </button>
      </div>

      {logs === null ? (
        <p className="text-sm text-slate-500">กำลังโหลด...</p>
      ) : logs.length === 0 ? (
        <Empty>ยังไม่มีประวัติ</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {logs.map((l) => {
            const meter = METER[l.meter] ?? METER.standing
            return (
              <li key={l.id} className="flex items-start gap-4 px-4 py-3">
                <span
                  className={`w-14 shrink-0 text-right text-lg font-bold tabular-nums ${
                    l.delta < 0 ? 'text-rose-600' : l.delta > 0 ? 'text-green-600' : 'text-slate-400'
                  }`}
                >
                  {l.delta > 0 ? `+${l.delta}` : l.delta}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">
                    {l.name}{' '}
                    <span className="font-normal text-slate-400">
                      → เหลือ {l.balanceAfter} {meter.unit}
                    </span>
                  </p>
                  <p className="text-sm text-slate-600">{l.reason}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${meter.cls}`}>{meter.label}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${SOURCE[l.source]?.cls ?? ''}`}>
                      {SOURCE[l.source]?.label ?? l.source}
                    </span>
                    {l.seatId && <span>{seatName(DEVICE_ZONE, l.seatId)}</span>}
                    {l.deviceId && <span>อุปกรณ์ {l.deviceId}</span>}
                    {l.actorName && <span>โดย {l.actorName}</span>}
                    <span>{formatTime(l.createdAt)}</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ============================================================
//  แท็บ 3: คำอุทธรณ์ (ผู้ใช้ที่ถูกระงับยื่นมา)
// ============================================================
const APPEAL_STATUS = {
  pending: { label: 'รอพิจารณา', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'อนุมัติแล้ว', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'bg-slate-100 text-slate-600' },
}

function AppealsTab({ api }) {
  const [status, setStatus] = useState('pending')
  const [appeals, setAppeals] = useState(null)
  const [notes, setNotes] = useState({}) // หมายเหตุของผู้ดูแลแยกทีละเรื่อง
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useFlash()

  const load = useCallback(async () => {
    const r = await api.listAppeals(status)
    if (r.ok) setAppeals(r.data)
    else {
      setAppeals([])
      setFlash({ type: 'error', text: r.message })
    }
  }, [api, status, setFlash])

  useEffect(() => {
    setAppeals(null)
    load()
  }, [load])

  async function decide(a, approve) {
    if (!window.confirm(approve ? `อนุมัติ — ยกเลิกการระงับของ ${a.name} ทันที?` : `ไม่อนุมัติ — ${a.name} ถูกระงับต่อจนครบกำหนด?`)) {
      return
    }
    setBusy(a.id)
    const r = await api.decideAppeal(a.id, approve, notes[a.id] ?? '')
    setBusy(null)
    setFlash(
      r.ok
        ? { type: 'ok', text: approve ? `อนุมัติแล้ว — ${a.name} กลับมาใช้ห้องสมุดได้ (ความประพฤติอย่างน้อย 20)` : 'บันทึกว่าไม่อนุมัติแล้ว' }
        : { type: 'error', text: r.message },
    )
    load()
  }

  return (
    <div>
      <FlashBar flash={flash} />
      <p className="mb-4 text-sm text-slate-500">
        ผู้ใช้ที่ความประพฤติต่ำกว่า 20 ถูกระงับชั่วคราวและยื่นอุทธรณ์ได้ — อนุมัติ = ยกเลิกการระงับทันที (คะแนนกลับมาอย่างน้อย 20)
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ['pending', 'รอพิจารณา'],
          ['approved', 'อนุมัติแล้ว'],
          ['rejected', 'ไม่อนุมัติ'],
          [null, 'ทั้งหมด'],
        ].map(([id, label]) => (
          <Chip key={label} active={status === id} onClick={() => setStatus(id)}>
            {label}
          </Chip>
        ))}
      </div>

      {appeals === null ? (
        <p className="text-sm text-slate-500">กำลังโหลด...</p>
      ) : appeals.length === 0 ? (
        <Empty>ไม่มีคำอุทธรณ์</Empty>
      ) : (
        <div className="space-y-3">
          {appeals.map((a) => (
            <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">{a.name}</p>
                  <p className="text-xs text-slate-400">
                    ยื่นเมื่อ {formatTime(a.createdAt)} · ความประพฤติ {a.points}
                    {a.suspendedUntil && ` · ระงับถึง ${formatTime(a.suspendedUntil)}`}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${APPEAL_STATUS[a.status].cls}`}>
                  {APPEAL_STATUS[a.status].label}
                </span>
              </div>
              <blockquote className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{a.message}</blockquote>

              {a.status === 'pending' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    className="field min-w-[12rem] flex-1 py-2"
                    placeholder="หมายเหตุถึงผู้ใช้ (ไม่บังคับ)"
                    value={notes[a.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                    maxLength={200}
                  />
                  <DevButton tone="green" disabled={busy === a.id} onClick={() => decide(a, true)}>
                    <Check className="h-4 w-4" /> อนุมัติ
                  </DevButton>
                  <DevButton tone="rose" disabled={busy === a.id} onClick={() => decide(a, false)}>
                    ไม่อนุมัติ
                  </DevButton>
                </div>
              ) : (
                a.adminNote && <p className="mt-2 text-sm text-slate-500">หมายเหตุ: {a.adminNote}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
//  แท็บ 4: คูปอง — เจ้าหน้าที่กรอกรหัสที่ผู้ใช้ยื่นมา + ดูรายการที่แลกแล้ว
// ============================================================
function CouponsTab({ api }) {
  const [code, setCode] = useState('')
  const [coupons, setCoupons] = useState(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useFlash()

  const load = useCallback(async () => {
    const r = await api.listCoupons()
    if (r.ok) setCoupons(r.data)
    else {
      setCoupons([])
      setFlash({ type: 'error', text: r.message })
    }
  }, [api, setFlash])

  useEffect(() => {
    load()
  }, [load])

  async function use(c) {
    setBusy(true)
    const r = await api.markCouponUsed(c)
    setBusy(false)
    setFlash(r.ok ? { type: 'ok', text: `ใช้คูปอง ${r.data.code} (${r.data.name}) แล้ว` } : { type: 'error', text: r.message })
    if (r.ok) setCode('')
    load()
  }

  return (
    <div>
      <FlashBar flash={flash} />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim()) use(code)
        }}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h3 className="font-semibold text-slate-800">ใช้คูปอง</h3>
        <p className="mt-1 text-sm text-slate-500">กรอกรหัสที่ผู้ใช้ยื่นมา (เช่น LB-1A2B3C4D) — ใช้แล้วใช้ซ้ำไม่ได้</p>
        <div className="mt-3 flex gap-2">
          <input
            className="field font-mono uppercase tracking-wider"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="LB-XXXXXXXX"
            aria-label="รหัสคูปอง"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="shrink-0 rounded-xl bg-slate-800 px-5 font-semibold text-white transition hover:bg-slate-900 disabled:opacity-60"
          >
            ใช้คูปอง
          </button>
        </div>
      </form>

      <p className="mt-5 text-xs text-slate-400">ชื่อ/ราคาคูปองแก้ได้ที่ตาราง coupon_catalog ใน Supabase (ตอนนี้ 50 / 100 / 200 เหรียญ)</p>
      <div className="mt-2">
        {coupons === null ? (
          <p className="text-sm text-slate-500">กำลังโหลด...</p>
        ) : coupons.length === 0 ? (
          <Empty>ยังไม่มีใครแลกคูปอง</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {coupons.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-bold tracking-wider text-slate-800">{c.code}</p>
                  <p className="text-sm text-slate-500">
                    {c.name} · {c.cost} เหรียญ · {c.userName} · {formatTime(c.createdAt)}
                  </p>
                </div>
                {c.status === 'used' ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                    ใช้แล้ว {c.usedAt && formatTime(c.usedAt)}
                  </span>
                ) : (
                  <DevButton tone="green" disabled={busy} onClick={() => use(c.code)}>
                    <Check className="h-4 w-4" /> ใช้คูปองนี้
                  </DevButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ============================================================
//  แท็บ 5: อุปกรณ์เซนเซอร์ (ESP32)
// ============================================================
function DevicesTab({ api }) {
  const [devices, setDevices] = useState(null)
  const [name, setName] = useState('')
  const [seat, setSeat] = useState('')
  const [busy, setBusy] = useState(null) // id อุปกรณ์ที่กำลังทำงาน หรือ 'create'
  const [keyInfo, setKeyInfo] = useState(null) // { id, key } — คีย์แสดงครั้งเดียว
  const [moving, setMoving] = useState(null) // อุปกรณ์ที่กำลังจะย้ายโต๊ะ
  const [flash, setFlash] = useFlash()

  const load = useCallback(async () => {
    const r = await api.listDevices()
    if (r.ok) setDevices(r.data)
    else {
      setDevices((d) => d ?? [])
      setFlash({ type: 'error', text: r.message })
    }
  }, [api, setFlash])

  // โหลดใหม่ทุก 10 วิ ให้สถานะออนไลน์/ออฟไลน์เป็นปัจจุบัน
  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  // ที่นั่งที่มีเซนเซอร์ผูกอยู่แล้ว (โชว์ในตัวเลือกที่นั่ง)
  const usedSeats = new Set((devices ?? []).map((d) => d.seatId))

  async function create(e) {
    e.preventDefault()
    if (!seat) return setFlash({ type: 'error', text: 'กรุณาเลือกที่นั่งที่จะติดอุปกรณ์' })
    setBusy('create')
    const r = await api.createDevice({ name, zoneId: DEVICE_ZONE, seatId: seat })
    setBusy(null)
    if (!r.ok) return setFlash({ type: 'error', text: r.message })
    setKeyInfo(r.data)
    setName('')
    setSeat('')
    load()
  }

  // ทำงานกับอุปกรณ์ 1 ตัว แล้วโหลดรายการใหม่
  async function act(device, fn) {
    setBusy(device.id)
    const r = await fn()
    setBusy(null)
    if (!r.ok) setFlash({ type: 'error', text: r.message })
    load()
    return r
  }

  const label = (d) => d.name || d.id

  async function simulate(d) {
    const r = await act(d, () => api.simulateNoise(d.id))
    if (r.ok) {
      setFlash({ type: r.data?.status === 'DEDUCTED' ? 'ok' : 'info', text: `${label(d)}: ${noiseStatusText(r.data)}` })
    }
  }

  // ตัด/เชื่อมต่อ = เปิด-ปิดอุปกรณ์ในฐานข้อมูล — บอร์ดรู้เองจาก heartbeat ไม่ต้องแก้โค้ด
  async function toggle(d) {
    if (
      d.active &&
      !window.confirm(
        `ตัดการเชื่อมต่อ ${label(d)} กับเว็บ?\n` +
          'บอร์ดจะหยุดเฝ้าเสียงและไม่หักคะแนนใคร (ภายใน 30 วินาที)\n' +
          'กด "เชื่อมต่ออีกครั้ง" ได้ทุกเมื่อ ไม่ต้องแก้โค้ดบนบอร์ด',
      )
    ) {
      return
    }
    const r = await act(d, () => api.updateDevice(d.id, { active: !d.active }))
    if (r.ok) {
      setFlash({
        type: 'ok',
        text: d.active
          ? `ตัดการเชื่อมต่อ ${label(d)} แล้ว — บอร์ดจะหยุดเฝ้าเสียงภายใน 30 วินาที`
          : `เชื่อมต่อ ${label(d)} แล้ว — บอร์ดจะกลับมาเฝ้าเสียงภายใน 30 วินาที`,
      })
    }
  }

  async function move(d, seatId) {
    const r = await act(d, () => api.updateDevice(d.id, { seatId }))
    if (r.ok) {
      setMoving(null)
      setFlash({
        type: 'ok',
        text: `ย้าย ${label(d)} ไป ${seatName(d.zoneId, seatId)} แล้ว — ใช้คีย์เดิม ไม่ต้องแก้โค้ด บอร์ดจะรู้ภายใน 30 วินาที`,
      })
    }
  }

  async function newKey(d) {
    if (!window.confirm(`สร้างคีย์ใหม่ให้ ${label(d)}?\nคีย์เก่าจะใช้ไม่ได้ทันที ต้องใส่คีย์ใหม่ในโค้ดบอร์ดแล้วอัปโหลดใหม่`)) return
    const r = await act(d, () => api.resetDeviceKey(d.id))
    if (r.ok) setKeyInfo({ id: d.id, key: r.data })
  }

  async function remove(d) {
    if (!window.confirm(`ลบอุปกรณ์ ${label(d)} ถาวร?\nคีย์ของบอร์ดตัวนี้จะใช้ไม่ได้อีก (ถ้าแค่หยุดทดสอบ ใช้ "ตัดการเชื่อมต่อ" แทน)`)) return
    const r = await act(d, () => api.deleteDevice(d.id))
    if (r.ok) setFlash({ type: 'ok', text: `ลบ ${label(d)} แล้ว` })
  }

  return (
    <div>
      <FlashBar flash={flash} />

      {/* ---------- วิธีเชื่อม / ตัด / ย้าย ---------- */}
      <div className="mb-5 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-900">
        <p className="font-semibold">เชื่อมต่อ / ตัดการเชื่อมต่อเซนเซอร์กับเว็บ</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
          <li>
            <b>เชื่อมต่อ:</b> เพิ่มอุปกรณ์ (เลือกโต๊ะ) → เอาคีย์ไปใส่ในส่วนที่ 1 ของ main.py บนบอร์ด (ทำครั้งเดียว)
          </li>
          <li>
            <b>หยุดทดสอบชั่วคราว:</b> กด “ตัดการเชื่อมต่อ” — บอร์ดหยุดเฝ้าเสียง ไม่หักคะแนน กลับมาเชื่อมใหม่ได้ ไม่ต้องแก้โค้ด
          </li>
          <li>
            <b>ย้ายไปโต๊ะอื่น:</b> กด “ย้ายโต๊ะ” — ใช้คีย์เดิม ไม่ต้องแก้โค้ด
          </li>
          <li>
            <b>เลิกใช้ถาวร:</b> กด “ลบ” — คีย์นี้ใช้ไม่ได้อีก
          </li>
        </ul>
      </div>

      {/* ---------- เพิ่มอุปกรณ์ ---------- */}
      <form onSubmit={create} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800">เพิ่มอุปกรณ์ ESP32</h3>
        <p className="mt-1 text-sm text-slate-500">
          1 อุปกรณ์ = 1 ที่นั่ง — บอร์ดส่งมาเมื่อเสียงดังตั้งแต่ครั้งที่ 3 ระบบหักความประพฤติทุกคนที่จองที่นั่งนั้นอยู่
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="field"
            placeholder="ชื่อเรียก (ไม่บังคับ) เช่น เซนเซอร์โต๊ะ D14"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            aria-label="ชื่อเรียกอุปกรณ์"
          />
          <SeatSelect value={seat} onChange={setSeat} usedSeats={usedSeats} />
          <button
            type="submit"
            disabled={busy === 'create'}
            className="rounded-xl bg-slate-800 px-5 py-3 font-semibold text-white transition hover:bg-slate-900 disabled:opacity-60"
          >
            เพิ่มอุปกรณ์
          </button>
        </div>
      </form>

      {/* ---------- รายการอุปกรณ์ ---------- */}
      <div className="mt-5 space-y-3">
        {devices === null ? (
          <p className="text-sm text-slate-500">กำลังโหลด...</p>
        ) : devices.length === 0 ? (
          <Empty>ยังไม่มีอุปกรณ์ — กดเพิ่มอุปกรณ์ แล้วเอาคีย์ไปใส่ในโค้ด ESP32 (ดู esp32/README.md)</Empty>
        ) : (
          devices.map((d) => {
            const online = d.active && d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < ONLINE_MS
            return (
              <div
                key={d.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${d.active ? 'border-slate-200' : 'border-dashed border-slate-300'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
                      {d.name || 'ไม่มีชื่อ'}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{d.id}</code>
                    </p>
                    <p className="text-sm text-slate-500">
                      ผูกกับ <b className="text-slate-700">{seatName(d.zoneId, d.seatId)}</b> · {getZone(d.zoneId)?.name ?? d.zoneId}
                    </p>
                  </div>
                  <StatusPill active={d.active} online={online} />
                </div>

                {!d.active && (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    ตัดการเชื่อมต่ออยู่ — บอร์ดไม่เฝ้าเสียงและไม่หักคะแนนใคร (จอบอร์ดขึ้น OFF)
                  </p>
                )}

                <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <Stat label="ติดต่อล่าสุด" value={d.lastSeenAt ? ago(d.lastSeenAt) : 'ยังไม่เคย'} />
                  <Stat label="ระดับเสียงล่าสุด" value={d.lastLevel != null ? `${d.lastLevel} dB` : '–'} />
                  <Stat label="หักคะแนนล่าสุด" value={d.lastPenaltyAt ? ago(d.lastPenaltyAt) : '–'} />
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <DevButton onClick={() => toggle(d)} disabled={busy === d.id} tone={d.active ? 'slate' : 'green'}>
                    {d.active ? <Unplug className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                    {d.active ? 'ตัดการเชื่อมต่อ' : 'เชื่อมต่ออีกครั้ง'}
                  </DevButton>
                  <DevButton onClick={() => setMoving(d)} disabled={busy === d.id}>
                    <ArrowRightLeft className="h-4 w-4" /> ย้ายโต๊ะ
                  </DevButton>
                  <DevButton onClick={() => simulate(d)} disabled={busy === d.id || !d.active} tone="amber">
                    <Volume2 className="h-4 w-4" /> จำลองเสียงดัง
                  </DevButton>
                  <DevButton onClick={() => newKey(d)} disabled={busy === d.id}>
                    <KeyRound className="h-4 w-4" /> สร้างคีย์ใหม่
                  </DevButton>
                  <DevButton onClick={() => remove(d)} disabled={busy === d.id} tone="rose">
                    <Trash2 className="h-4 w-4" /> ลบ
                  </DevButton>
                </div>
              </div>
            )
          })
        )}
      </div>

      {keyInfo && <KeyModal info={keyInfo} onClose={() => setKeyInfo(null)} />}
      {moving && (
        <MoveModal
          device={moving}
          usedSeats={usedSeats}
          busy={busy === moving.id}
          onMove={(seatId) => move(moving, seatId)}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  )
}

// เลือกที่นั่ง (จัดกลุ่มตามประเภท) — บอกด้วยว่าโต๊ะไหนมีเซนเซอร์อยู่แล้ว
function SeatSelect({ value, onChange, usedSeats, currentSeat }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-label="ที่นั่งที่ติดอุปกรณ์">
      <option value="">เลือกที่นั่ง ({getZone(DEVICE_ZONE)?.name})…</option>
      {['carrel', 'table', 'desk', 'room'].map((kind) => (
        <optgroup key={kind} label={KIND_LABEL[kind]}>
          {QUIET_SEATS.filter((s) => s.kind === kind).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ? `${s.label} (${s.id})` : s.id}
              {s.id === currentSeat ? ' — ตอนนี้' : usedSeats?.has(s.id) ? ' — มีเซนเซอร์แล้ว' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

// ย้ายเซนเซอร์ไปโต๊ะอื่น — ใช้คีย์เดิม บอร์ดรู้เองจาก heartbeat
function MoveModal({ device, usedSeats, busy, onMove, onClose }) {
  const [seat, setSeat] = useState(device.seatId)
  return (
    <Modal title={`ย้ายโต๊ะ — ${device.name || device.id}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-600">
          ตอนนี้ผูกกับ <b className="text-slate-800">{seatName(device.zoneId, device.seatId)}</b> — เลือกโต๊ะใหม่
          แล้วยกบอร์ดไปวางที่โต๊ะนั้น (ใช้คีย์เดิม ไม่ต้องแก้โค้ด บอร์ดรู้เองภายใน 30 วินาที)
        </p>
        <SeatSelect value={seat} onChange={setSeat} usedSeats={usedSeats} currentSeat={device.seatId} />
        <button
          type="button"
          disabled={busy || !seat || seat === device.seatId}
          onClick={() => onMove(seat)}
          className="btn-primary"
        >
          ย้ายไปโต๊ะนี้
        </button>
      </div>
    </Modal>
  )
}

function StatusPill({ active, online }) {
  const [cls, dot, text] = !active
    ? ['bg-slate-100 text-slate-500', 'bg-slate-400', 'ตัดการเชื่อมต่อ']
    : online
      ? ['bg-green-50 text-green-700', 'bg-green-500', 'เชื่อมต่อแล้ว · ออนไลน์']
      : ['bg-amber-50 text-amber-700', 'bg-amber-400', 'เชื่อมต่อแล้ว · บอร์ดออฟไลน์']
  return (
    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex gap-2 sm:block">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  )
}

const TONE = {
  slate: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  green: 'bg-green-50 text-green-700 hover:bg-green-100',
  amber: 'bg-amber-50 text-amber-800 hover:bg-amber-100',
  rose: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
}

function DevButton({ tone = 'slate', children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${TONE[tone]}`}
    >
      {children}
    </button>
  )
}

// คีย์ + โค้ดตั้งค่าสำหรับวางใน ESP32 (คีย์จริงแสดงครั้งเดียว ฐานข้อมูลเก็บแค่ hash)
function KeyModal({ info, onClose }) {
  const [copied, setCopied] = useState(false)
  const url = import.meta.env.VITE_SUPABASE_URL || 'https://xxxx.supabase.co'
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'ใส่ anon key ของโปรเจกต์'
  const snippet = [
    `SUPABASE_URL = "${url}"`,
    `SUPABASE_ANON_KEY = "${anonKey}"`,
    `DEVICE_ID = "${info.id}"`,
    `DEVICE_KEY = "${info.key}"`,
  ].join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* บางเบราว์เซอร์ไม่ให้ใช้คลิปบอร์ด — ลากคลุมข้อความแล้วคัดลอกเองได้ */
    }
  }

  return (
    <Modal title={`คีย์ของอุปกรณ์ ${info.id}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          คีย์นี้แสดงแค่ครั้งเดียว คัดลอกไปวางในโค้ด ESP32 ตอนนี้เลย (ถ้าทำหาย กด “สร้างคีย์ใหม่”)
        </p>
        <div>
          <p className="mb-1.5 text-sm text-slate-600">
            วาง 4 บรรทัดนี้ทับของเดิมใน “ส่วนที่ 1 — ตั้งค่า” ของ <code>esp32/noise_meter/main.py</code> (ไฟล์ที่ใส่คีย์แล้วห้ามอัปขึ้น GitHub)
          </p>
          <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{snippet}</pre>
        </div>
        <button type="button" onClick={copy} className="btn-primary flex items-center justify-center gap-2">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'คัดลอกแล้ว' : 'คัดลอกโค้ด'}
        </button>
      </div>
    </Modal>
  )
}

// ============================================================
//  แท็บ 6: ตั้งค่า
// ============================================================
// [ชื่อช่อง, ข้อความ, หน่วย, คำอธิบาย]
const SETTING_GROUPS = [
  {
    title: 'หักความประพฤติ (จากเซนเซอร์)',
    fields: [
      ['noisePenalty', 'หักครั้งแรกของวัน', 'คะแนน', 'บอร์ดส่งมาเมื่อเสียงดังตั้งแต่ครั้งที่ 3 · หักทุกคนในการจองโต๊ะนั้น'],
      ['penaltyStep', 'ครั้งต่อไปหักแรงขึ้นครั้งละ', 'คะแนน'],
      ['penaltyMax', 'เพดานต่อครั้ง', 'คะแนน'],
      ['dailyCap', 'หักรวมสูงสุดต่อวัน', 'คะแนน', 'กันหน้าผา “ไม่มีอะไรจะเสีย” — พลาดวันเดียวไม่ถึงขั้นโดนตัดสิทธิ์'],
      ['cooldownSeconds', 'ช่วงพักหลังหัก', 'วินาที', 'กันบอร์ดส่งซ้ำรัว ๆ — บอร์ดนับครั้งละ 5 วินาทีเอง จึงไม่ควรเกิน 5'],
      ['suspendDays', 'ต่ำกว่า 20 ระงับการเข้าใช้', 'วัน'],
    ],
  },
  {
    title: 'ได้ความประพฤติคืน',
    fields: [
      ['refundMinutes', 'เงียบต่อหลังโดนหักกี่นาทีถึงคืน', 'นาที'],
      ['refundPercent', 'คืนกี่ %', '%'],
      ['sessionBonus', 'จบการจองแบบเงียบ', 'คะแนน', 'วันละครั้ง ต้องเช็คอินที่โต๊ะ'],
      ['weeklyBonus', 'ไม่ทำผิดครบ 1 สัปดาห์', 'คะแนน'],
      ['startingPoints', 'ความประพฤติเริ่มต้น', 'คะแนน', 'ใช้กับบัญชีใหม่ และตอนกดรีเซ็ต (สูงสุด 100)'],
    ],
  },
  {
    title: 'เหรียญรางวัล',
    fields: [
      ['sessionCoins', 'จบการจองแบบเงียบ', 'เหรียญ'],
      ['coinGate', 'ได้เหรียญเฉพาะตอนความประพฤติ ≥', 'คะแนน'],
    ],
  },
]
const SETTING_KEYS = SETTING_GROUPS.flatMap((g) => g.fields.map(([key]) => key))

function SettingsTab({ api }) {
  const [saved, setSaved] = useState(null) // ค่าที่บันทึกอยู่ในระบบ
  const [form, setForm] = useState(null) // ค่าที่กำลังแก้ (เก็บเป็นข้อความตามช่องกรอก)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useFlash()

  const applySaved = useCallback((s) => {
    setSaved(s)
    setForm({
      ...Object.fromEntries(SETTING_KEYS.map((k) => [k, String(s[k] ?? '')])),
      sensorEnabled: s.sensorEnabled,
    })
  }, [])

  useEffect(() => {
    ;(async () => {
      const r = await api.getSettings()
      if (r.ok) applySaved(r.data)
      else setFlash({ type: 'error', text: r.message })
    })()
  }, [api, applySaved, setFlash])

  const toInt = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN)

  async function save(e) {
    e.preventDefault()
    const next = { sensorEnabled: form.sensorEnabled }
    for (const k of SETTING_KEYS) next[k] = toInt(form[k])
    if (SETTING_KEYS.some((k) => Number.isNaN(next[k]))) {
      return setFlash({ type: 'error', text: 'กรอกเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไปทุกช่อง' })
    }
    setBusy(true)
    const r = await api.updateSettings(next)
    setBusy(false)
    if (!r.ok) return setFlash({ type: 'error', text: r.message })
    applySaved(r.data)
    setFlash({ type: 'ok', text: 'บันทึกการตั้งค่าแล้ว' })
  }

  async function resetAll() {
    if (
      !window.confirm(
        `รีเซ็ตความประพฤติของทุกคนเป็น ${saved.startingPoints} และยกเลิกการระงับทั้งหมด?\n(เหรียญไม่เปลี่ยน · ย้อนกลับไม่ได้ · ประวัติเดิมยังเก็บไว้)`,
      )
    ) {
      return
    }
    setBusy(true)
    const r = await api.resetAll('รีเซ็ตความประพฤติทุกคน')
    setBusy(false)
    setFlash(r.ok ? { type: 'ok', text: `รีเซ็ตแล้ว — เปลี่ยน ${r.data} คน` } : { type: 'error', text: r.message })
  }

  if (!form) {
    return (
      <>
        <FlashBar flash={flash} />
        <p className="text-sm text-slate-500">กำลังโหลด...</p>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <FlashBar flash={flash} />

      <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Toggle
          checked={form.sensorEnabled}
          onChange={(v) => setForm((f) => ({ ...f, sensorEnabled: v }))}
          label="หักความประพฤติเมื่อเซนเซอร์ตรวจพบเสียงดัง"
          hint="ปิดไว้ = เซนเซอร์ยังส่งข้อมูลได้ แต่ระบบจะไม่หักคะแนนใคร"
        />

        {SETTING_GROUPS.map((g) => (
          <fieldset key={g.title} className="space-y-3">
            <legend className="mb-2 font-semibold text-slate-800">{g.title}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {g.fields.map(([key, label, unit, hint]) => (
                <NumberField
                  key={key}
                  label={label}
                  unit={unit}
                  hint={hint}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              ))}
            </div>
          </fieldset>
        ))}

        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
          โบนัสเงียบติดต่อกัน 7 / 14 / 30 วัน = +10 / +20 / +50 เหรียญ (ทุก ๆ 30 วันต่อจากนั้น +50) · ช่วงระดับสิทธิ์ 80 / 60 / 40 / 20
          คงที่ตามบันไดบทลงโทษ
        </p>

        <button type="submit" disabled={busy} className="btn-primary">
          บันทึกการตั้งค่า
        </button>
      </form>

      <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-rose-700">รีเซ็ตความประพฤติทุกคน</h3>
        <p className="mt-1 text-sm text-slate-500">
          ตั้งความประพฤติของผู้ใช้ทุกคนกลับเป็น {saved.startingPoints} และยกเลิกการระงับ เช่นตอนเริ่มภาคเรียนใหม่ — เหรียญไม่เปลี่ยน
          ประวัติเดิมยังเก็บไว้
        </p>
        <button
          type="button"
          onClick={resetAll}
          disabled={busy}
          className="mt-4 rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        >
          รีเซ็ตความประพฤติทุกคน
        </button>
      </div>
    </div>
  )
}

function NumberField({ label, unit, value, onChange, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input className="field max-w-[8rem]" type="number" min="0" step="1" inputMode="numeric" value={value} onChange={onChange} />
        <span className="text-sm text-slate-500">{unit}</span>
      </span>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 text-left transition hover:bg-slate-50"
    >
      <span>
        <span className="block font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-green-500' : 'bg-slate-300'}`}>
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[1.375rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

// ============================================================
//  ชิ้นส่วนใช้ร่วมกัน
// ============================================================
function useFlash() {
  const [flash, setFlash] = useState(null) // { type: 'ok' | 'error' | 'info', text }
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 5000)
    return () => clearTimeout(t)
  }, [flash])
  return [flash, setFlash]
}

const FLASH_CLS = {
  ok: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  info: 'border-amber-200 bg-amber-50 text-amber-800',
}

function FlashBar({ flash }) {
  if (!flash) return null
  return (
    <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${FLASH_CLS[flash.type]}`}>
      {flash.text}
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
        active ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

function Notice({ icon: Icon, title, children }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <Icon className="mx-auto h-10 w-10 text-slate-300" />
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      {children && <p className="mt-1 text-sm text-slate-500">{children}</p>}
    </div>
  )
}

function Empty({ children }) {
  return (
    <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-500">
      {children}
    </p>
  )
}
