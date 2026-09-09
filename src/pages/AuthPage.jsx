import { useState } from 'react'
import { AlertCircle, BookOpen, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth, looksLikeEmail, normalizePhone } from '../auth.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function AuthPage() {
  const { login, register, offline } = useAuth()
  const [mode, setMode] = useState('login')       // 'login' หรือ 'register'
  const [form, setForm] = useState({
    identifier: '', firstName: '', lastName: '', phone: '', email: '',
    password: '', confirmPassword: '',
  })
  const [errors, setErrors] = useState({})        // ข้อความ error ของแต่ละช่อง
  const [formError, setFormError] = useState('')  // error รวมจากเซิร์ฟเวอร์
  const [notice, setNotice] = useState('')        // ข้อความแจ้งเตือนทั่วไป
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)

  // แก้ค่าในฟอร์ม + ลบ error ของช่องนั้นทิ้งทันทีที่ผู้ใช้เริ่มพิมพ์แก้
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  function switchMode(next) {
    setMode(next)
    setErrors({})
    setFormError('')
    setNotice('')
  }

  // ตรวจข้อมูลก่อนส่ง — คืน object ของ error ที่เจอ
  function validate() {
    const e = {}
    if (mode === 'login') {
      const id = form.identifier.trim()
      if (!id) e.identifier = 'กรุณากรอกอีเมลหรือเบอร์โทรศัพท์'
      else if (looksLikeEmail(id)) {
        if (!EMAIL_RE.test(id)) e.identifier = 'รูปแบบอีเมลไม่ถูกต้อง'
      } else if (normalizePhone(id).length < 9) e.identifier = 'เบอร์โทรศัพท์ไม่ถูกต้อง'
      if (!form.password) e.password = 'กรุณากรอกรหัสผ่าน'
    } else {
      if (!form.firstName.trim()) e.firstName = 'กรุณากรอกชื่อ'
      if (!form.lastName.trim()) e.lastName = 'กรุณากรอกนามสกุล'

      const phone = normalizePhone(form.phone)
      if (!phone) e.phone = 'กรุณากรอกเบอร์โทรศัพท์'
      else if (phone.length !== 10) e.phone = 'เบอร์โทรศัพท์ต้องมี 10 หลัก'

      if (!form.email.trim()) e.email = 'กรุณากรอกอีเมล'
      else if (!EMAIL_RE.test(form.email.trim())) e.email = 'รูปแบบอีเมลไม่ถูกต้อง'

      if (!form.password) e.password = 'กรุณากรอกรหัสผ่าน'
      else if (form.password.length < 6) e.password = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'

      if (!form.confirmPassword) e.confirmPassword = 'กรุณายืนยันรหัสผ่าน'
      else if (form.password !== form.confirmPassword) e.confirmPassword = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'
    }
    return e
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    setNotice('')

    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setBusy(true)
    const result =
      mode === 'login'
        ? await login({ identifier: form.identifier.trim(), password: form.password })
        : await register({
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            phone: form.phone,
            email: form.email.trim(),
            password: form.password,
          })
    setBusy(false)

    if (!result.ok) setFormError(result.message)
    else if (result.message) {
      // สมัครสำเร็จแต่ต้องยืนยันอีเมลก่อน -> กลับไปหน้าล็อกอินพร้อมข้อความ
      setNotice(result.message)
      setMode('login')
      setForm((f) => ({ ...f, identifier: f.email, password: '', confirmPassword: '' }))
    }
    // ถ้าสำเร็จและล็อกอินเลย App.jsx จะพาไปหน้าหลักให้เอง
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-sky-50 via-slate-50 to-indigo-50 px-4 py-10">
      <div className="w-full max-w-md">
        {/* หัวเรื่อง */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-200">
            <BookOpen className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">ระบบจองห้องสมุด</h1>
          <p className="mt-1 text-sm text-slate-500">เข้าสู่ระบบเพื่อจองโต๊ะและห้องประชุม</p>
        </div>

        {offline && (
          <div className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>เชื่อมต่อฐานข้อมูลไม่ได้ — กำลังใช้โหมดทดลอง (ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น)</span>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
          {/* ปุ่มสลับระหว่างเข้าสู่ระบบ / ลงทะเบียน */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {[
              { key: 'login', label: 'เข้าสู่ระบบ' },
              { key: 'register', label: 'ลงทะเบียน' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => switchMode(tab.key)}
                className={`rounded-lg py-2.5 text-sm font-semibold transition ${
                  mode === tab.key ? 'bg-white text-sky-700 shadow' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {notice && (
            <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>
          )}
          {formError && (
            <p className="mb-4 flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {mode === 'login' ? (
              <Field
                label="อีเมล หรือ เบอร์โทรศัพท์"
                placeholder="you@example.com หรือ 0812345678"
                value={form.identifier}
                onChange={set('identifier')}
                error={errors.identifier}
                autoComplete="username"
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="ชื่อ" placeholder="สมชาย" value={form.firstName}
                         onChange={set('firstName')} error={errors.firstName} autoComplete="given-name" />
                  <Field label="นามสกุล" placeholder="ใจดี" value={form.lastName}
                         onChange={set('lastName')} error={errors.lastName} autoComplete="family-name" />
                </div>
                <Field label="เบอร์โทรศัพท์" placeholder="0812345678" value={form.phone}
                       onChange={set('phone')} error={errors.phone} type="tel" inputMode="numeric"
                       autoComplete="tel" maxLength={12} />
                <Field label="อีเมล" placeholder="you@example.com" value={form.email}
                       onChange={set('email')} error={errors.email} type="email" autoComplete="email" />
              </>
            )}

            <Field
              label="รหัสผ่าน"
              placeholder={mode === 'register' ? 'อย่างน้อย 6 ตัวอักษร' : '••••••••'}
              value={form.password}
              onChange={set('password')}
              error={errors.password}
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  className="text-slate-400 transition hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              }
            />

            {mode === 'register' && (
              <Field
                label="ยืนยันรหัสผ่าน"
                placeholder="พิมพ์รหัสผ่านอีกครั้ง"
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                error={errors.confirmPassword}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
              />
            )}

            <button type="submit" disabled={busy} className="btn-primary !mt-6 flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'login' ? 'เข้าสู่ระบบ' : 'ลงทะเบียน'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            {mode === 'login' ? 'ยังไม่มีบัญชี? ' : 'มีบัญชีอยู่แล้ว? '}
            <button
              type="button"
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              className="font-semibold text-sky-600 hover:underline"
            >
              {mode === 'login' ? 'ลงทะเบียนที่นี่' : 'เข้าสู่ระบบ'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

// ช่องกรอกข้อมูล 1 ช่อง พร้อม label และข้อความ error ใต้ช่อง
function Field({ label, error, trailing, ...props }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input {...props} className={`field ${trailing ? 'pr-12' : ''} ${error ? 'field-error' : ''}`} />
        {trailing && <span className="absolute inset-y-0 right-3 grid place-items-center">{trailing}</span>}
      </div>
      {error && <p className="mt-1.5 text-sm text-rose-600">{error}</p>}
    </div>
  )
}
