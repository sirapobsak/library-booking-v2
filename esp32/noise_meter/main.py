# ============================================================
#  เครื่องเฝ้าเสียงประจำโต๊ะ — ESP32 + ไมค์ INMP441 + จอ OLED + LED 3 ดวง
#  ระบบจองห้องสมุด / MicroPython สำหรับ Thonny (บันทึกลงบอร์ดชื่อ main.py)
#
#  การทำงาน
#   1. ถามเว็บทุก 30 วินาที: "ตอนนี้โต๊ะนี้มีคนจองอยู่ไหม จองถึงกี่โมง"
#   2. เฝ้าเสียงเฉพาะช่วงเวลาที่มีการจอง
#      ดังเกิน 65 dB สะสมครบ 5 วินาที = เสียงดัง 1 ครั้ง
#      (ระหว่างจับเวลา ถ้าเงียบติดกันครบ 10 วินาที = ไม่นับ ล้างเวลาทิ้งเริ่มใหม่)
#   3. 3 วินาทีสุดท้ายก่อนครบ 5 วินาที จอขึ้นนับถอยหลัง 3-2-1
#   4. ครั้งที่ 1 ไฟเขียว / ครั้งที่ 2 ไฟเหลือง / ครั้งที่ 3 ไฟแดง (แดงค้างจนหมดเวลาจอง)
#   5. ตั้งแต่ครั้งที่ 3 เป็นต้นไป ทุกครั้งส่งไปเว็บให้หักคะแนน (ครั้งละ 5 แต้ม ตั้งค่าได้ในหน้าผู้ดูแล)
#   6. หมดเวลาจอง -> ไฟดับ นับใหม่จาก 0 สำหรับการจองรอบถัดไป
#   * ลดเสียงรบกวน (denoise): หักเสียงพื้นหลังของห้อง + ตัดเสียงกระแทกสั้น ๆ ก่อนตัดสินว่าดัง
#
#  ไฟล์บนบอร์ด: main.py (ไฟล์นี้) + config.py (WiFi/คีย์อุปกรณ์) + lib/ssd1306.py (ไลบรารีจอ)
#  ต่อสาย (ขาฝั่งขวาของบอร์ด) และวิธีติดตั้ง: ดู esp32/README.md
# ============================================================
import gc
import json
import math
import time

import framebuf
import micropython
import network
from machine import I2C, I2S, Pin

try:
    import ssd1306
except ImportError:
    ssd1306 = None

try:
    import urequests as requests
except ImportError:
    import requests


# ============================================================
#  ส่วนที่ 1 — ตั้งค่า
# ============================================================

# ---------- WiFi + เว็บ (แนะนำให้ใส่ในไฟล์ config.py แทน — ดูท้ายส่วนนี้) ----------
WIFI_SSID = "ชื่อWiFi"
WIFI_PASS = "รหัสWiFi"
SUPABASE_URL = "https://xxxx.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_xxxx"
DEVICE_ID = "ESP-XXXXXX"
DEVICE_KEY = "ใส่คีย์อุปกรณ์"

# ---------- กติกาเสียงดัง ----------
LIMIT_DB = 65              # ดังเกินค่านี้ = เสียงดัง
LOUD_SECONDS = 5           # ดังสะสมครบกี่วินาที ถึงนับเป็น 1 ครั้ง
QUIET_RESET_SECONDS = 10   # ระหว่างจับเวลา ถ้าเงียบติดกันครบกี่วินาที = ไม่นับ เริ่มจับใหม่
COUNTDOWN_SECONDS = 3      # แสดงนับถอยหลังบนจอกี่วินาทีสุดท้าย
DEDUCT_FROM_STRIKE = 3     # ตั้งแต่ครั้งที่เท่าไรเป็นต้นไปถึงส่งไปหักคะแนน
DB_OFFSET = 0.0            # ปรับให้ตรงกับแอปวัดเสียงในมือถือ (จออ่านต่ำไป 4 dB -> ใส่ 4)

# ---------- ลดเสียงรบกวน (denoise) ----------
DENOISE = True             # True = หักเสียงพื้นหลัง + ตัดเสียงกระแทกสั้น ๆ / False = ใช้ค่าดิบจากไมค์
CALIBRATE_SECONDS = 3      # หลังเปิดเครื่อง ฟังเสียงพื้นหลังของห้องกี่วินาที (ช่วงนี้ขอให้เงียบ)
FLOOR_MAX_DB = 55          # เสียงพื้นหลังที่ยอมหักออกได้สูงสุด (กันเปิดเครื่องตอนคนคุยแล้วหักเยอะเกิน)
MEDIAN_WINDOWS = 5         # ตัดเสียงกระแทกสั้นกว่า ~0.3 วิ (ใช้ค่ากลางของ 5 ช่วงล่าสุด = 0.625 วิ)
DB_MIN = 30                # ค่าต่ำสุดที่แสดง (เงียบมาก)

# ---------- โหมดทดสอบ ----------
# True = ทดสอบวงจรโดยไม่ต่อเว็บ: ถือว่ามีคนจองอยู่ตลอด, ไม่หักคะแนนจริง, กดปุ่ม BOOT = เริ่มรอบใหม่
TEST_MODE = False

# ---------- ค่าจริงจากไฟล์ config.py ----------
# ใส่ WiFi + คีย์อุปกรณ์ในไฟล์ config.py แยก (ดูตัวอย่างใน config.example.py) จะได้ไม่เผลออัปคีย์ขึ้น GitHub
# ถ้ามีไฟล์ config.py บนบอร์ด ค่าในไฟล์นั้นจะทับค่าข้างบน
try:
    from config import *  # noqa: F401,F403
except ImportError:
    pass


# ============================================================
#  ส่วนที่ 2 — ขาที่ต่อ (ฝั่งขวาของบอร์ด) และค่าทางเทคนิค
# ============================================================
PIN_MIC_SCK = 18       # INMP441 SCK
PIN_MIC_WS = 19        # INMP441 WS
PIN_MIC_SD = 23        # INMP441 SD   (ไมค์ VDD -> 3V3, GND -> GND, L/R -> GND)
PIN_OLED_SDA = 21      # OLED SDA
PIN_OLED_SCL = 22      # OLED SCK     (จอ VDD -> 3V3, GND -> GND)
PIN_LED_GREEN = 17     # LED เขียว (ผ่านตัวต้านทาน 220Ω)
PIN_LED_YELLOW = 16    # LED เหลือง (ผ่านตัวต้านทาน 220Ω)
PIN_LED_RED = 4        # LED แดง (ผ่านตัวต้านทาน 220Ω)
PIN_BOOT = 0           # ปุ่ม BOOT บนบอร์ด (ไม่ต้องต่อสาย)

SAMPLE_RATE = 16000          # อ่านเสียง 16,000 ครั้งต่อวินาที
MIC_SENSITIVITY_DBFS = -26   # INMP441: เสียง 94 dB อ่านได้ -26 dBFS (จาก datasheet ของไมค์)
CHUNK_SAMPLES = 512          # อ่านทีละ 512 ค่า (~0.03 วินาที)
STEP = 4                     # คำนวณจากทุก ๆ 4 ค่า ประหยัดแรงบอร์ด ความดังที่ได้แทบไม่ต่าง
WINDOW_MS = 125              # สรุปค่า dB ทุก 1/8 วินาที
DRAW_MS = 200                # วาดจอใหม่ทุก 0.2 วินาที
PRINT_MS = 1000              # พิมพ์ค่าลง Shell ของ Thonny ทุก 1 วินาที
WARMUP_MS = 1000             # ไมค์เพิ่งเปิด ค่าช่วงแรกยังไม่นิ่ง ข้ามไปก่อน
HEARTBEAT_MS = 30000         # ถามสถานะการจองจากเว็บทุก 30 วินาที
WIFI_RETRY_MS = 20000        # WiFi หลุด -> ลองต่อใหม่ทุก 20 วินาที
REPORT_RETRY_MS = 10000      # ส่งหักคะแนนไม่สำเร็จ -> ลองใหม่ทุก 10 วินาที
NOTE_MS = 2500               # ข้อความแจ้งเตือนบนจอค้างไว้กี่มิลลิวินาที


# ============================================================
#  ส่วนที่ 3 — คำนวณความดังเสียง + ลดเสียงรบกวน
# ============================================================
@micropython.native
def chunk_rms(buf, count, step):
    # ค่า RMS (ความแรงเฉลี่ย) ของเสียงช่วงสั้น ๆ นี้
    # ไมค์ส่งมาค่าละ 4 ไบต์ ข้อมูลเสียงจริง 24 บิตอยู่ในไบต์ที่ 2–4
    # ลบค่าเฉลี่ย (DC) ของไมค์ออกก่อน = denoise ชั้นแรก (ร่วมกับตัวกรองความถี่ต่ำ ~60 Hz ในตัวไมค์)
    n = 0
    total = 0.0
    i = 0
    while i < count:
        b = i * 4
        v = buf[b + 1] | (buf[b + 2] << 8) | (buf[b + 3] << 16)
        if v & 0x800000:
            v -= 0x1000000
        total += v
        n += 1
        i += step
    if n == 0:
        return 0.0
    mean = total / n
    acc = 0.0
    i = 0
    while i < count:
        b = i * 4
        v = buf[b + 1] | (buf[b + 2] << 8) | (buf[b + 3] << 16)
        if v & 0x800000:
            v -= 0x1000000
        d = v - mean
        acc += d * d
        i += step
    return math.sqrt(acc / n)


def to_db(rms):
    # แปลงความแรง -> เดซิเบล (dB SPL โดยประมาณ)
    #   dBFS = เทียบกับเสียงดังสุดที่ไมค์ 24 บิตอ่านได้ (8,388,608)
    #   แล้วบวกกลับตามความไวของไมค์: -26 dBFS = 94 dB  ->  dB = dBFS + 120
    if rms < 1:
        return 0.0
    dbfs = 20 * math.log10(rms / 8388608)
    return dbfs - MIC_SENSITIVITY_DBFS + 94 + DB_OFFSET


def median(values):
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


class Denoiser:
    # ลดเสียงรบกวนอีก 2 ชั้น (ทำกับค่า dB ทุก 1/8 วินาที ใช้แรงบอร์ดน้อยมาก)
    #  ชั้น 2) หักเสียงพื้นหลัง (แอร์ พัดลม คอม): เรียนรู้ระดับเสียงห้องตอนเงียบ แล้วลบพลังงานส่วนนั้นออก
    #  ชั้น 3) ตัดเสียงกระแทกสั้น ๆ (ของตก ปิดประตู): ใช้ค่ากลาง (median) ของ 5 ช่วงล่าสุด
    def __init__(self):
        self.floor = None   # ระดับเสียงพื้นหลัง (dB) — None = ยังวัดไม่เสร็จ
        self.calib = []     # ค่าที่เก็บตอนวัดเสียงพื้นหลังหลังเปิดเครื่อง
        self.history = []   # ค่าล่าสุดสำหรับหา median

    def calibrating(self):
        return DENOISE and self.floor is None

    def update(self, db_raw):
        # ใส่ค่า dB ดิบจากไมค์ -> คืนค่า dB หลังลดเสียงรบกวน
        if not DENOISE:
            return db_raw

        # ช่วงแรกหลังเปิดเครื่อง: ฟังเสียงห้องก่อน (ยังไม่นับเสียงดัง)
        if self.floor is None:
            self.calib.append(db_raw)
            if len(self.calib) * WINDOW_MS >= CALIBRATE_SECONDS * 1000:
                self.floor = min(median(self.calib), FLOOR_MAX_DB)
                self.calib = []
                print("วัดเสียงพื้นหลังเสร็จ: %.1f dB" % self.floor)
            return max(db_raw, DB_MIN)

        # ปรับระดับเสียงพื้นหลังตามห้อง:
        #   ห้องเงียบลง -> ตามลงเร็ว / ดังขึ้นนิดหน่อย (ไม่เกิน 6 dB) -> ตามขึ้นช้า ๆ
        #   ดังกว่าพื้นหลังเกิน 6 dB (เสียงคนพูด) -> ไม่นับเป็นพื้นหลัง
        if db_raw < self.floor:
            self.floor += (db_raw - self.floor) * 0.2
        elif db_raw < self.floor + 6:
            self.floor += (db_raw - self.floor) * 0.01
        self.floor = min(self.floor, FLOOR_MAX_DB)

        # หักพลังงานเสียงพื้นหลังออก (เสียงรวมกันแบบบวกพลังงาน ไม่ใช่บวกเลข dB ตรง ๆ)
        p = 10 ** (db_raw / 10) - 10 ** (self.floor / 10)
        clean = 10 * math.log10(p) if p > 1 else 0.0
        clean = max(clean, DB_MIN)

        # ตัดเสียงกระแทก: ค่ากลางของ 5 ช่วงล่าสุด (เสียงที่ดังแค่ 1–2 ช่วง ~0.25 วิ จะหายไป)
        self.history.append(clean)
        if len(self.history) > MEDIAN_WINDOWS:
            self.history.pop(0)
        return median(self.history)


# ============================================================
#  ส่วนที่ 4 — ตัวนับเสียงดัง (กติกา 5 วินาที / เงียบ 10 วินาที)
# ============================================================
class NoiseCounter:
    def __init__(self):
        self.reset()

    def reset(self):
        self.strikes = 0    # ดังไปแล้วกี่ครั้งในการจองรอบนี้
        self.loud_ms = 0    # เวลาที่ดังสะสมอยู่ (มิลลิวินาที)
        self.quiet_ms = 0   # เงียบติดกันมานานเท่าไรแล้ว (ระหว่างจับเวลา)

    def pause(self):
        # นอกเวลาจอง: ล้างเวลาที่จับอยู่ แต่ไม่ล้างจำนวนครั้ง
        self.loud_ms = 0
        self.quiet_ms = 0

    def update(self, db, dt_ms):
        # ใส่ค่า dB ล่าสุด + เวลาที่ผ่านไป  ->  คืน True ถ้าเพิ่งครบ "เสียงดัง 1 ครั้ง" พอดี
        if db > LIMIT_DB:
            self.loud_ms += dt_ms
            self.quiet_ms = 0
            if self.loud_ms >= LOUD_SECONDS * 1000:
                self.strikes += 1
                self.loud_ms = 0
                return True
        elif self.loud_ms > 0:
            # เงียบระหว่างจับเวลา: เวลาที่ดังไปแล้วเก็บไว้ก่อน ถ้าเงียบติดกันครบ 10 วินาทีค่อยล้างทิ้ง
            self.quiet_ms += dt_ms
            if self.quiet_ms >= QUIET_RESET_SECONDS * 1000:
                self.loud_ms = 0
                self.quiet_ms = 0
        return False

    def countdown(self):
        # เหลืออีกกี่วินาทีจะครบ 1 ครั้ง — แสดงเฉพาะ 3 วินาทีสุดท้าย (คืน 3, 2, 1 หรือ None)
        if self.loud_ms <= 0:
            return None
        left_ms = LOUD_SECONDS * 1000 - self.loud_ms
        if left_ms > COUNTDOWN_SECONDS * 1000:
            return None
        return (left_ms + 999) // 1000


# ============================================================
#  ส่วนที่ 5 — ข้อมูลการจองของโต๊ะนี้ (ได้มาจากเว็บ)
# ============================================================
class Booking:
    def __init__(self):
        self.clear()

    def clear(self):
        self.id = None       # รหัสการจอง (None = ตอนนี้ไม่มีการจอง)
        self.deadline = 0    # เวลาบอร์ด (ticks_ms) ที่การจองจะหมด
        self.start = ""
        self.end = ""
        self.people = 1

    def set_from_server(self, b, now):
        self.id = b.get("id")
        self.deadline = time.ticks_add(now, int(b.get("ends_in", 0)) * 1000)
        self.start = b.get("start", "")
        self.end = b.get("end", "")
        self.people = int(b.get("people", 1))

    def start_test(self, now):
        self.id = "TEST"
        self.deadline = time.ticks_add(now, 60 * 60 * 1000)
        self.start = "TEST"
        self.end = "TEST"
        self.people = 1

    def active(self, now):
        return self.id is not None and time.ticks_diff(self.deadline, now) > 0

    def minutes_left(self, now):
        return max(0, time.ticks_diff(self.deadline, now) // 60000)


# ============================================================
#  ส่วนที่ 6 — ฮาร์ดแวร์ (ไมค์ จอ ไฟ ปุ่ม WiFi)
# ============================================================
mic = None
samples = None
oled = None
led_green = None
led_yellow = None
led_red = None
boot_button = None
wlan = None


def setup_oled():
    if ssd1306 is None:
        print("!! ไม่มีไฟล์ ssd1306.py บนบอร์ด — Thonny > Tools > Manage packages > ssd1306")
        return None
    # ลองตามที่ต่อไว้ก่อน ถ้าไม่เจอลองสลับ SDA/SCK (เผื่อต่อสลับกัน)
    for sda, scl in ((PIN_OLED_SDA, PIN_OLED_SCL), (PIN_OLED_SCL, PIN_OLED_SDA)):
        i2c = I2C(0, sda=Pin(sda), scl=Pin(scl), freq=400000)
        found = i2c.scan()
        for addr in (0x3C, 0x3D):
            if addr in found:
                if sda != PIN_OLED_SDA:
                    print("(เจอจอแบบต่อสาย SDA/SCK สลับกัน — ใช้งานได้ปกติ)")
                return ssd1306.SSD1306_I2C(128, 64, i2c, addr=addr)
    print("!! ไม่เจอจอ OLED — เช็คสาย SDA->D21, SCK->D22, VDD->3V3, GND->GND")
    return None


def setup_hardware():
    global mic, samples, oled, led_green, led_yellow, led_red, boot_button, wlan
    led_green = Pin(PIN_LED_GREEN, Pin.OUT, value=0)
    led_yellow = Pin(PIN_LED_YELLOW, Pin.OUT, value=0)
    led_red = Pin(PIN_LED_RED, Pin.OUT, value=0)
    boot_button = Pin(PIN_BOOT, Pin.IN, Pin.PULL_UP)
    oled = setup_oled()
    mic = I2S(
        0,
        sck=Pin(PIN_MIC_SCK),
        ws=Pin(PIN_MIC_WS),
        sd=Pin(PIN_MIC_SD),
        mode=I2S.RX,
        bits=32,
        format=I2S.MONO,  # ขา L/R ของไมค์ต่อ GND = ส่งเสียงช่องซ้าย
        rate=SAMPLE_RATE,
        ibuf=16384,
    )
    samples = bytearray(CHUNK_SAMPLES * 4)
    wlan = network.WLAN(network.STA_IF)


def show_leds(strikes):
    # ติดทีละดวง: 1 = เขียว, 2 = เหลือง, 3 ขึ้นไป = แดง, 0 = ดับหมด
    led_green.value(1 if strikes == 1 else 0)
    led_yellow.value(1 if strikes == 2 else 0)
    led_red.value(1 if strikes >= 3 else 0)


# ============================================================
#  ส่วนที่ 7 — คุยกับเว็บ (Supabase)
# ============================================================
def wifi_configured():
    return bool(WIFI_SSID) and WIFI_SSID != "ชื่อWiFi"


def server_ready():
    return wifi_configured() and "xxxx" not in SUPABASE_URL and not DEVICE_ID.endswith("XXXXXX")


last_wifi_try = None


def keep_wifi(now):
    # ต่อ WiFi แบบไม่รอ (จอไม่ค้าง) — หลุดเมื่อไรลองใหม่ทุก 20 วินาที
    global last_wifi_try
    if wlan.isconnected():
        return True
    if last_wifi_try is None or time.ticks_diff(now, last_wifi_try) > WIFI_RETRY_MS:
        last_wifi_try = now
        wlan.active(True)
        try:
            wlan.connect(WIFI_SSID, WIFI_PASS)
        except OSError:
            pass  # กำลังต่ออยู่แล้ว
        print("กำลังต่อ WiFi \"%s\" ..." % WIFI_SSID)
    return False


def call_rpc(fn, level):
    # เรียกฟังก์ชันบนเว็บ: POST <SUPABASE_URL>/rest/v1/rpc/<fn>  -> คืนผลเป็น dict (ไม่สำเร็จคืน None)
    gc.collect()  # HTTPS ใช้หน่วยความจำเยอะ เก็บกวาดก่อน
    body = json.dumps({"p_device": DEVICE_ID, "p_key": DEVICE_KEY, "p_level": int(level)})
    headers = {"Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY}
    url = SUPABASE_URL + "/rest/v1/rpc/" + fn
    try:
        try:
            r = requests.post(url, data=body, headers=headers, timeout=10)
        except TypeError:  # เฟิร์มแวร์เก่า requests ไม่มี timeout
            r = requests.post(url, data=body, headers=headers)
        code, text = r.status_code, r.text
        r.close()
    except Exception as e:
        print("[%s] ส่งไม่สำเร็จ: %s" % (fn, e))
        return None
    if code != 200:
        print("[%s] HTTP %d %s" % (fn, code, text))
        if "BAD_DEVICE" in text:
            print("!! DEVICE_ID หรือ DEVICE_KEY ไม่ถูกต้อง — กด 'สร้างคีย์ใหม่' ในหน้าผู้ดูแล")
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def apply_status(res, booking, counter, now):
    # อ่านคำตอบจาก device_heartbeat -> อัปเดตการจอง / ผู้ดูแลเปิด-ปิด / แต้มที่หัก
    # คืนค่า (เฝ้าเสียงได้ไหม, แต้มที่หักต่อครั้ง, ชื่อที่นั่ง, การจองเปลี่ยนไหม)
    allowed = bool(res.get("active", True)) and bool(res.get("sensor_enabled", True))
    penalty = int(res.get("penalty", 5))
    seat = res.get("seat") or "----"
    if "booking" not in res:
        print("!! เว็บยังไม่ส่งข้อมูลการจองมา — รัน supabase/points.sql เวอร์ชันล่าสุดอีกรอบ")
    b = res.get("booking")
    changed = False
    if not b:
        if booking.id is not None:
            print("การจองรอบนี้จบแล้ว (หมดเวลา/ถูกยกเลิก) — ไฟดับ เริ่มนับใหม่")
            counter.reset()
            show_leds(0)
            changed = True
        booking.clear()
    else:
        if b.get("id") != booking.id:
            print("มีการจอง %s–%s (%d คน) — เริ่มเฝ้าเสียง" % (b.get("start"), b.get("end"), int(b.get("people", 1))))
            counter.reset()
            show_leds(0)
            changed = True
        booking.set_from_server(b, now)
    return allowed, penalty, seat, changed


# ============================================================
#  ส่วนที่ 8 — จอ OLED (128x64 ตัวอักษรภาษาอังกฤษเท่านั้น)
# ============================================================
def big_text(s, x, y, scale, color=1):
    # ตัวหนังสือขนาดใหญ่: วาดตัวอักษร 8x8 ลงหน่วยความจำ แล้วขยายทีละพิกเซล
    w = len(s) * 8
    fb = framebuf.FrameBuffer(bytearray(w), w, 8, framebuf.MONO_HLSB)
    fb.text(s, 0, 0, 1)
    for j in range(8):
        for i in range(w):
            if fb.pixel(i, j):
                oled.fill_rect(x + i * scale, y + j * scale, scale, scale, color)


def db_to_x(db):
    # แถบระดับเสียง: 30 dB = ซ้ายสุด, 100 dB = ขวาสุด
    return max(0, min(127, int((db - 30) * 128 / 70)))


def draw(db, counter, booking, now, online, seat, penalty, note):
    if oled is None:
        return
    oled.fill(0)

    # แถวบน: ชื่อที่นั่ง | สถานะ
    if TEST_MODE:
        status = "TEST"
    elif not server_ready():
        status = "NO SETUP"
    elif not online:
        status = "NO WIFI"
    elif booking.active(now):
        status = "%dm LEFT" % booking.minutes_left(now)
    else:
        status = "FREE"
    oled.text(seat[:7], 0, 0)
    oled.text(status, 128 - 8 * len(status), 0)

    # ตัวเลข dB ตัวใหญ่
    big_text("%d" % int(db + 0.5), 0, 12, 3)
    oled.text("dB", 74, 28)

    # นับถอยหลัง 3-2-1 (กล่องสีขาว ตัวเลขสีดำ)
    cd = counter.countdown() if booking.active(now) else None
    if cd is not None:
        oled.fill_rect(96, 10, 32, 28, 1)
        big_text(str(cd), 100, 12, 3, 0)

    # แถบระดับเสียง + ขีดเกณฑ์ 65 dB
    oled.rect(0, 42, 128, 8, 1)
    oled.fill_rect(0, 42, db_to_x(db), 8, 1)
    lx = db_to_x(LIMIT_DB)
    for yy in range(39, 53, 2):
        oled.pixel(lx, yy, 0 if 42 <= yy < 50 and lx < db_to_x(db) else 1)

    # แถวล่าง
    if note:
        oled.text(note, 0, 56)
    elif booking.active(now):
        n = counter.strikes
        oled.text(("W %d/3" % n) if n <= 3 else ("W %d" % n), 0, 56)
        if cd is not None:
            right = ("-%dPT" % penalty) if n + 1 >= DEDUCT_FROM_STRIKE else "WARN"
        elif counter.loud_ms > 0:
            right = "%d.%ds" % (counter.loud_ms // 1000, (counter.loud_ms % 1000) // 100)
        else:
            right = ""
        oled.text(right, 128 - 8 * len(right), 56)
    else:
        oled.text("LIMIT %d dB" % LIMIT_DB, 0, 56)
    oled.show()


# ============================================================
#  ส่วนที่ 9 — ลูปหลัก
# ============================================================
def main():
    setup_hardware()
    counter = NoiseCounter()
    booking = Booking()
    denoiser = Denoiser()
    allowed = True           # ผู้ดูแลเปิดอุปกรณ์ + การหักแต้มอยู่ไหม
    penalty = 5              # แต้มที่หักต่อครั้ง (อัปเดตจากเว็บ)
    seat = "TEST" if TEST_MODE else "----"
    pending = 0              # จำนวนครั้งที่รอส่งไปหักคะแนน
    last_report_try = None
    last_heartbeat = None
    force_heartbeat = True
    note = ""
    note_until = 0
    silent_since = None
    mic_warned = False

    start = time.ticks_ms()
    win_start = start
    power = 0.0
    chunks = 0
    raw_db = 0.0
    db = 0.0
    shown_db = 0.0
    last_draw = start
    last_print = start
    online = False

    if TEST_MODE:
        booking.start_test(start)
    show_leds(0)
    print("เริ่มเฝ้าเสียง — เกณฑ์ %d dB, ดังสะสม %d วิ = 1 ครั้ง" % (LIMIT_DB, LOUD_SECONDS))
    if DENOISE:
        print("ลดเสียงรบกวน: เปิด — %d วิแรกขอให้เงียบ บอร์ดกำลังฟังเสียงพื้นหลังของห้อง" % CALIBRATE_SECONDS)
    if not TEST_MODE and not server_ready():
        print("!! ยังไม่ได้ตั้งค่า WiFi/เว็บ (ไฟล์ config.py) — จะแสดงแค่ค่า dB หรือเปิด TEST_MODE = True เพื่อทดสอบ")

    while True:
        # ---------- อ่านเสียงจากไมค์ ----------
        nbytes = mic.readinto(samples)
        rms = chunk_rms(samples, nbytes // 4, STEP)
        power += rms * rms
        chunks += 1
        now = time.ticks_ms()

        # เช็คว่าไมค์ส่งเสียงมาจริงไหม (ค่า 0 ตลอด = ต่อสายผิด)
        if rms < 1:
            if silent_since is None:
                silent_since = now
            elif not mic_warned and time.ticks_diff(now, silent_since) > 3000:
                mic_warned = True
                print("!! ไมค์ไม่ส่งเสียงมา — เช็คสาย SD->D23, WS->D19, SCK->D18, L/R->GND, VDD->3V3")
        else:
            silent_since = None

        # ---------- ทุก 1/8 วินาที: สรุป dB -> ลดเสียงรบกวน -> นับเสียงดัง ----------
        elapsed = time.ticks_diff(now, win_start)
        if elapsed >= WINDOW_MS and chunks:
            raw_db = to_db(math.sqrt(power / chunks))
            power = 0.0
            chunks = 0
            win_start = now
            dt = min(elapsed, WINDOW_MS * 2)  # ช่วงที่บอร์ดติดคุยกับเว็บ ไม่นับเป็นเวลาดัง/เงียบ
            warm = time.ticks_diff(now, start) > WARMUP_MS
            db = denoiser.update(raw_db) if warm else max(raw_db, DB_MIN)
            shown_db = db if db > shown_db else shown_db * 0.7 + db * 0.3  # ตัวเลขขึ้นเร็ว ลงช้า อ่านง่าย

            # หมดเวลาการจอง -> ดับไฟ เริ่มนับใหม่
            if booking.id is not None and not booking.active(now):
                print("หมดเวลาการจองรอบนี้ — ไฟดับ เริ่มนับใหม่")
                booking.clear()
                counter.reset()
                show_leds(0)
                pending = 0
                force_heartbeat = True
                if TEST_MODE:
                    booking.start_test(now)

            if booking.active(now) and allowed and warm and not denoiser.calibrating():
                if counter.update(db, dt):
                    n = counter.strikes
                    show_leds(n)
                    if n >= DEDUCT_FROM_STRIKE:
                        pending += 1
                        note = "-%d POINTS!" % penalty
                        print(">> เสียงดังครั้งที่ %d — ไฟแดง ส่งไปหักคะแนน %d แต้ม" % (n, penalty))
                    else:
                        note = "WARNING %d/3" % n
                        print(">> เสียงดังครั้งที่ %d — ไฟ%s" % (n, "เขียว" if n == 1 else "เหลือง"))
                    note_until = time.ticks_add(now, NOTE_MS)
            else:
                counter.pause()

        # ---------- ปุ่ม BOOT: เริ่มรอบใหม่ (ใช้ตอนทดสอบ) ----------
        if boot_button.value() == 0:
            counter.reset()
            show_leds(0)
            pending = 0
            if TEST_MODE:
                booking.start_test(now)
            note = "RESET"
            note_until = time.ticks_add(now, NOTE_MS)
            print("กดปุ่ม BOOT — เริ่มนับใหม่")
            while boot_button.value() == 0:
                time.sleep_ms(20)

        # ---------- คุยกับเว็บ ----------
        if TEST_MODE:
            if pending:
                print("(TEST_MODE) ถ้าต่อเว็บจริงจะหักคะแนน %d แต้มตรงนี้" % penalty)
                pending = 0
        elif server_ready():
            online = keep_wifi(now)
            if online:
                # 1) มีครั้งที่ต้องหักคะแนน -> ส่งก่อน
                if pending and booking.active(now) and (
                    last_report_try is None or time.ticks_diff(now, last_report_try) >= REPORT_RETRY_MS
                ):
                    last_report_try = now
                    draw(shown_db, counter, booking, now, online, seat, penalty, "SENDING...")
                    res = call_rpc("report_noise", db)
                    if res is not None:
                        pending -= 1
                        status = res.get("status")
                        print("[report_noise] %s" % res)
                        if status == "DEDUCTED":
                            note = "SENT -%d PTS" % res.get("penalty", penalty)
                            note_until = time.ticks_add(time.ticks_ms(), NOTE_MS)
                        elif status == "COOLDOWN":
                            print("!! เว็บยังอยู่ในช่วงพัก — ตั้ง 'ช่วงพักหลังหักแต้ม' ในหน้าผู้ดูแลเป็น 5 วินาที")
                    win_start = time.ticks_ms()  # ข้ามช่วงที่ติดส่งข้อมูล
                    power = 0.0
                    chunks = 0

                # 2) ถามสถานะการจองทุก 30 วินาที
                #    (ถ้ากำลังจับเวลาเสียงดังอยู่ ขอเลื่อนไปก่อน จอจะได้ไม่ค้างตอนนับถอยหลัง)
                since = None if last_heartbeat is None else time.ticks_diff(now, last_heartbeat)
                due = force_heartbeat or since is None or since >= HEARTBEAT_MS
                busy = counter.loud_ms > 0 and since is not None and since < HEARTBEAT_MS * 3
                if due and not busy:
                    last_heartbeat = now
                    force_heartbeat = False
                    res = call_rpc("device_heartbeat", db)
                    if res is not None:
                        allowed, penalty, seat, changed = apply_status(res, booking, counter, time.ticks_ms())
                        if changed:
                            pending = 0
                    win_start = time.ticks_ms()
                    power = 0.0
                    chunks = 0

        # ---------- จอ + Shell ----------
        if note and time.ticks_diff(now, note_until) > 0:
            note = ""
        if time.ticks_diff(now, last_draw) >= DRAW_MS:
            last_draw = now
            draw(shown_db, counter, booking, now, online, seat, penalty,
                 note or ("CALIBRATING" if denoiser.calibrating() else ""))
        if time.ticks_diff(now, last_print) >= PRINT_MS:
            last_print = now
            raw = " (ดิบ %.1f, พื้นหลัง %.1f)" % (raw_db, denoiser.floor) if DENOISE and denoiser.floor is not None else ""
            if booking.active(now):
                print(
                    "dB %.1f%s | ดังสะสม %.1f วิ | ครั้งที่ %d | จอง %s–%s เหลือ %d นาที"
                    % (db, raw, counter.loud_ms / 1000, counter.strikes, booking.start, booking.end,
                       booking.minutes_left(now))
                )
            else:
                print("dB %.1f%s | ไม่มีการจองตอนนี้" % (db, raw))


if __name__ == "__main__":
    main()
