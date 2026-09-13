# ============================================================
#  เครื่องเฝ้าเสียงประจำโต๊ะ — ESP32 + ไมค์ INMP441 + จอ OLED + LED 3 ดวง
#  ระบบจองห้องสมุด / MicroPython สำหรับ Thonny (บันทึกลงบอร์ดชื่อ main.py)
#
#  การทำงาน
#   1. ถามเว็บทุก 30 วินาที: "ตอนนี้โต๊ะนี้มีคนจองอยู่ไหม จองถึงกี่โมง"
#   2. เฝ้าเสียงเฉพาะช่วงเวลาที่มีการจอง
#      ดังเกิน 65 dB สะสมครบ 5 วินาที = เสียงดัง 1 ครั้ง
#      (ระหว่างจับเวลา ถ้าเงียบติดกันเกิน 10 วินาที = ไม่นับ ไม่หัก ล้างเวลาทิ้งเริ่มใหม่)
#   3. จอ: ตอนเงียบเป็นตา 2 ข้างมีคิ้ว (เป็นมิตร) มองไปมา สลับกับ "เงียบมาแล้วกี่วินาที/นาที/ชั่วโมง"
#      มีเสียงพูดดัง -> 2 วินาทีแรกตาโกรธ (คิ้วขมวด จ้อง) -> 3 วินาทีสุดท้ายนับถอยหลัง 3-2-1 ตัวใหญ่
#   4. ครบ 5 วินาที = ไฟเตือน: ครั้งที่ 1 เขียว / ครั้งที่ 2 เหลือง / ครั้งที่ 3 ขึ้นไป แดง (แดงค้างจนหมดเวลาจอง)
#      ขึ้นไฟเตือนแล้ว เวลาที่เงียบกลับเป็น 0 เริ่มจับใหม่
#   5. ตั้งแต่ครั้งที่ 3 ส่งไปเว็บให้หักคะแนน — หักเท่าไรเป็นไปตามระบบคะแนนบนเว็บ (บอร์ดไม่ได้กำหนดเอง)
#   6. หมดเวลาจอง -> ไฟดับ นับใหม่จาก 0 สำหรับการจองรอบถัดไป
#   * จับเฉพาะเสียงคนพูด: กรองช่วงความถี่เสียงพูด + ดูจังหวะพยางค์ (พัดลม เครื่องจักร เสียงบี๊บ ไม่นับ)
#   * ลดเสียงรบกวน (denoise): หักเสียงพื้นหลังของห้อง + ตัดเสียงกระแทกสั้น ๆ ก่อนตัดสินว่าดัง
#
#  ไฟล์บนบอร์ด: main.py (ไฟล์นี้) + lib/ssd1306.py (ไลบรารีจอ)
#  ต่อสาย (ขาฝั่งขวาของบอร์ด) และวิธีติดตั้ง: ดู esp32/README.md
# ============================================================
import gc
import json
import math
import random
import time
from array import array

import framebuf
import micropython
import network
from machine import I2C, I2S, Pin

try:
    import ssd1306
except ImportError:
    ssd1306 = None

try:
    import esp32  # ดูหน่วยความจำฝั่งระบบ (ESP-IDF) — ใช้ตอนหาสาเหตุ HTTPS หน่วยความจำไม่พอ
except ImportError:
    esp32 = None

try:
    import os
except ImportError:
    os = None

try:
    import urequests as requests
except ImportError:
    import requests


# ============================================================
#  ส่วนที่ 1 — ตั้งค่า
# ============================================================

# ---------- WiFi (ESP32 ใช้ได้แค่ 2.4 GHz) + เว็บ (บรรทัดจากหน้าผู้ดูแล > อุปกรณ์เซนเซอร์) ----------
# เชื่อมกับโต๊ะไหน = ใช้ค่าของโต๊ะนั้น: หน้าผู้ดูแล > อุปกรณ์เซนเซอร์ > เพิ่มอุปกรณ์ > เลือกโต๊ะ (เช่น D18)
#   -> ได้ DEVICE_ID + DEVICE_KEY ของโต๊ะนั้น -> บอร์ดเฝ้าเสียงเฉพาะการจองของโต๊ะนั้น
#   (ย้ายไปโต๊ะอื่นกด "ย้ายโต๊ะ" ในหน้าผู้ดูแลได้เลย ไม่ต้องแก้ไฟล์นี้)
# !! ไฟล์ที่ใส่คีย์จริงแล้ว ห้ามอัปขึ้น GitHub
WIFI_SSID = "ชื่อWiFi"
WIFI_PASS = "รหัสWiFi"
SUPABASE_URL = "https://xxxx.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_xxxx"
DEVICE_ID = "ESP-XXXXXX"
DEVICE_KEY = "ใส่คีย์อุปกรณ์"

# ---------- กติกาเสียงดัง ----------
LIMIT_DB = 65              # ดังเกินค่านี้ = เสียงดัง
LOUD_SECONDS = 5           # ดังสะสมครบกี่วินาที ถึงนับเป็น 1 ครั้ง
QUIET_RESET_SECONDS = 10   # ระหว่างจับเวลา ถ้าเงียบติดกันเกินกี่วินาที = ไม่นับ (ไม่หัก) เริ่มจับใหม่
COUNTDOWN_SECONDS = 3      # แสดงนับถอยหลังบนจอกี่วินาทีสุดท้าย
DEDUCT_FROM_STRIKE = 3     # ตั้งแต่ครั้งที่เท่าไรเป็นต้นไปถึงส่งไปหักคะแนน
DB_OFFSET = 0.0            # ปรับให้ตรงกับแอปวัดเสียงในมือถือ (จออ่านต่ำไป 4 dB -> ใส่ 4)

# ---------- ลดเสียงรบกวน (denoise) ----------
DENOISE = True             # True = หักเสียงพื้นหลัง + ตัดเสียงกระแทกสั้น ๆ / False = ใช้ค่าดิบจากไมค์
CALIBRATE_SECONDS = 3      # หลังเปิดเครื่อง ฟังเสียงพื้นหลังของห้องกี่วินาที (ช่วงนี้ขอให้เงียบ)
FLOOR_MAX_DB = 55          # เสียงพื้นหลังที่ยอมหักออกได้สูงสุด (กันเปิดเครื่องตอนคนคุยแล้วหักเยอะเกิน)
MEDIAN_WINDOWS = 5         # ตัดเสียงกระแทกสั้นกว่า ~0.3 วิ (ใช้ค่ากลางของ 5 ช่วงล่าสุด = 0.625 วิ)
DB_MIN = 30                # ค่าต่ำสุดที่แสดง (เงียบมาก)

# ---------- จับเฉพาะเสียงคนพูด ----------
VOICE_ONLY = True          # True = นับเฉพาะเสียงคนพูด (พัดลม เครื่องจักร เสียงบี๊บ ไม่นับ) / False = นับทุกเสียง
SPEECH_LOW_HZ = 250        # ช่วงความถี่เสียงพูด ต่ำสุด — ตัดเสียงหึ่งของแอร์ พัดลม ไฟฟ้า
SPEECH_HIGH_HZ = 3400      # ช่วงความถี่เสียงพูด สูงสุด — ตัดเสียงซ่า เสียงแหลม
SPEECH_RATIO_MIN = 0.35    # พลังงานเสียงต้องอยู่ในช่วงเสียงพูดอย่างน้อยกี่ส่วน (0–1)
SPEECH_MOD_DB = 4.0        # เสียงต้องขึ้น-ลงเป็นพยางค์อย่างน้อยกี่ dB (เสียงคงที่อย่างพัดลม ~1 dB)
MOD_CHUNKS = 31            # ดูจังหวะขึ้น-ลงย้อนหลังกี่ก้อน (~1 วินาที)

# ---------- โหมดทดสอบ ----------
# True = ทดสอบวงจรโดยไม่ต่อเว็บ: ถือว่ามีคนจองอยู่ตลอด, ไม่หักคะแนนจริง, กดปุ่ม BOOT = เริ่มรอบใหม่
TEST_MODE = False


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
MIC_IBUF = 8192              # ที่พักเสียงของไมค์ (ไบต์) — เล็กลงเหลือหน่วยความจำให้ HTTPS มากขึ้น
WINDOW_MS = 125              # สรุปค่า dB ทุก 1/8 วินาที
DRAW_MS = 200                # วาดจอใหม่ทุก 0.2 วินาที
PRINT_MS = 1000              # พิมพ์ค่าลง Shell ของ Thonny ทุก 1 วินาที
WARMUP_MS = 1000             # ไมค์เพิ่งเปิด ค่าช่วงแรกยังไม่นิ่ง ข้ามไปก่อน
HEARTBEAT_MS = 30000         # ถามสถานะการจองจากเว็บทุก 30 วินาที
WIFI_RETRY_MS = 20000        # WiFi หลุด -> ลองต่อใหม่ทุก 20 วินาที
REPORT_RETRY_MS = 10000      # ส่งหักคะแนนไม่สำเร็จ -> ลองใหม่ทุก 10 วินาที
NOTE_MS = 2500               # ข้อความแจ้งเตือนบนจอค้างไว้กี่มิลลิวินาที
EYES_MS = 6000               # ตอนเงียบ: โชว์ตากี่มิลลิวินาที ...
TIMER_MS = 4000              # ... แล้วสลับไปโชว์ "เงียบมาแล้วกี่วินาที" กี่มิลลิวินาที
CALM_AFTER_MS = 1500         # ระหว่างจับเวลา ถ้าหยุดพูดเกินเท่านี้ ตากลับมาเป็นมิตร (เวลาที่ดังยังเก็บไว้ตามกติกา 10 วิ)


# ============================================================
#  ส่วนที่ 3 — คำนวณความดังเสียง + จับเฉพาะเสียงคนพูด + ลดเสียงรบกวน
# ============================================================
def biquad_q12(kind, fc, fs):
    # ออกแบบตัวกรอง 2nd-order (Butterworth) แล้วแปลงค่าเป็นจำนวนเต็ม (คูณ 4096) ให้ viper ใช้
    #   kind = "hp" (ผ่านสูง) หรือ "lp" (ผ่านต่ำ), fc = ความถี่ตัด, fs = อัตราสุ่ม
    w0 = 2 * math.pi * fc / fs
    cw = math.cos(w0)
    alpha = math.sin(w0) / (2 * 0.7071)
    if kind == "hp":
        b0, b1 = (1 + cw) / 2, -(1 + cw)
    else:
        b0, b1 = (1 - cw) / 2, 1 - cw
    a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    return [int(round(v / a0 * 4096)) for v in (b0, b1, b0, a1, a2)]


@micropython.viper
def speech_filter(buf, nbytes: int, sums, st, co) -> int:
    # กรองเสียงให้เหลือช่วงเสียงพูด แล้วเก็บพลังงาน (viper = แปลงเป็นโค้ดเครื่อง เร็วพอทำทุกค่า)
    #  1) รวม 2 ค่าติดกันเป็น 1 (16 kHz -> 8 kHz พอสำหรับเสียงพูด) + ย่อเหลือ 16 บิต
    #  2) ตัดค่า DC  3) กรองผ่านสูง (ตัดเสียงหึ่ง)  4) กรองผ่านต่ำ (ตัดเสียงซ่า)
    #  ทุกขั้น "เก็บเศษ" ที่หายไปตอน >>12 ไว้บวกรอบถัดไป — ถ้าตัดทิ้งเฉย ๆ ตัวกรองจะเพี้ยนจนเสียงดังเกินจริง
    #  หรือสั่นค้างเองตอนห้องเงียบ
    #  ผลรวมกำลังสองทุก 8 ค่า: sums[0..31] = เฉพาะช่วงเสียงพูด, sums[32..63] = ทั้งหมด, sums[64] = ค่าที่ไม่ใช่ 0
    #  ตัวเลขทุกตัวไม่เกินขนาด int 32 บิต แม้เสียงดังสุดที่ไมค์รับได้ (ชุดทดสอบมีเคสนี้)
    b = ptr8(buf)
    out = ptr32(sums)
    s = ptr32(st)
    c = ptr32(co)
    hb0 = c[0]
    hb1 = c[1]
    hb2 = c[2]
    ha1 = c[3]
    ha2 = c[4]
    lb0 = c[5]
    lb1 = c[6]
    lb2 = c[7]
    la1 = c[8]
    la2 = c[9]
    dx1 = s[0]
    dy1 = s[1]
    hx1 = s[2]
    hx2 = s[3]
    hy1 = s[4]
    hy2 = s[5]
    lx1 = s[6]
    lx2 = s[7]
    ly1 = s[8]
    ly2 = s[9]
    de = s[10]
    he = s[11]
    le = s[12]
    band = 0
    total = 0
    cnt = 0
    blk = 0
    nz = 0
    i = 0
    while i + 8 <= nbytes:
        # ไมค์ส่งมาค่าละ 4 ไบต์ ข้อมูลเสียงจริง 24 บิตอยู่ในไบต์ที่ 2–4
        v0 = b[i + 1] | (b[i + 2] << 8) | (b[i + 3] << 16)
        if v0 & 0x800000:
            v0 -= 0x1000000
        v1 = b[i + 5] | (b[i + 6] << 8) | (b[i + 7] << 16)
        if v1 & 0x800000:
            v1 -= 0x1000000
        if (v0 | v1) != 0:
            nz += 1
        x = (v0 + v1) >> 9
        acc = 4076 * dy1 + de
        q = acc >> 12
        de = acc - (q << 12)  # เศษที่เหลือ (0–4095) เก็บไว้บวกรอบหน้า
        d = x - dx1 + q  # ตัด DC
        dx1 = x
        dy1 = d
        acc = hb0 * d + hb1 * hx1 + hb2 * hx2 - ha1 * hy1 - ha2 * hy2 + he
        h = acc >> 12  # ผ่านสูง
        he = acc - (h << 12)
        hx2 = hx1
        hx1 = d
        hy2 = hy1
        hy1 = h
        acc = lb0 * h + lb1 * lx1 + lb2 * lx2 - la1 * ly1 - la2 * ly2 + le
        y = acc >> 12  # ผ่านต่ำ
        le = acc - (y << 12)
        lx2 = lx1
        lx1 = h
        ly2 = ly1
        ly1 = y
        yq = (y + 2) >> 2  # ย่อก่อนยกกำลังสอง ไม่ให้เกิน int 32 บิต
        dq = (d + 2) >> 2
        band += yq * yq
        total += dq * dq
        cnt += 1
        if cnt == 8:
            out[blk] = band
            out[32 + blk] = total
            blk += 1
            band = 0
            total = 0
            cnt = 0
        i += 8
    if cnt > 0 and blk < 32:
        out[blk] = band
        out[32 + blk] = total
        blk += 1
    out[64] = nz
    s[0] = dx1
    s[1] = dy1
    s[2] = hx1
    s[3] = hx2
    s[4] = hy1
    s[5] = hy2
    s[6] = lx1
    s[7] = lx2
    s[8] = ly1
    s[9] = ly2
    s[10] = de
    s[11] = he
    s[12] = le
    return blk


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


def level_db(mean_square):
    # พลังงานเฉลี่ย (หน่วยของตัวกรอง) -> dB  (1 หน่วย = 1024 ของสัญญาณ 24 บิต)
    if mean_square <= 0:
        return 0.0
    return to_db(math.sqrt(mean_square) * 1024)


def stdev(values):
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((v - mean) ** 2 for v in values) / n)


class VoiceMeter:
    # จับเฉพาะเสียงคนพูด
    #  - วัดความดังเฉพาะช่วงความถี่เสียงพูด (SPEECH_LOW_HZ–SPEECH_HIGH_HZ)
    #  - "เป็นเสียงคน" = พลังงานส่วนใหญ่อยู่ในช่วงเสียงพูด และขึ้น-ลงเป็นจังหวะพยางค์
    #    (พัดลม เสียงซ่า เสียงบี๊บ ดังเท่ากันตลอด / เสียงหึ่งเครื่องจักรอยู่นอกช่วง -> ไม่ใช่เสียงคน)
    FS = SAMPLE_RATE // 2  # หลังรวม 2 ค่าเป็น 1 เหลือ 8 kHz

    def __init__(self):
        self.coef = array("i", biquad_q12("hp", SPEECH_LOW_HZ, self.FS) + biquad_q12("lp", SPEECH_HIGH_HZ, self.FS))
        self.state = array("i", [0] * 13)
        self.sums = array("i", [0] * 65)
        self.levels = []  # ความดังช่วงเสียงพูดของแต่ละก้อน (~32 ms) ย้อนหลัง ~1 วินาที
        self.discard()

    def discard(self):
        # ทิ้งค่าที่สะสมไว้ (ใช้หลังบอร์ดติดคุยกับเว็บ)
        self.band = 0.0
        self.total = 0.0
        self.n = 0

    def feed(self, buf, nbytes):
        # ใส่เสียงจากไมค์ 1 ก้อน -> คืนจำนวนค่าที่ไม่ใช่ 0 (0 = ไมค์ไม่ส่งเสียงมา)
        blocks = speech_filter(buf, nbytes, self.sums, self.state, self.coef)
        sm = self.sums
        band = 0.0
        total = 0.0
        for k in range(blocks):
            band += sm[k]
            total += sm[32 + k]
        pairs = nbytes // 8
        if pairs:
            self.band += band
            self.total += total
            self.n += pairs
            self.levels.append(max(level_db(band / pairs), DB_MIN))
            if len(self.levels) > MOD_CHUNKS:
                self.levels.pop(0)
        return sm[64]

    def window(self):
        # สรุปทุก 1/8 วินาที -> (dB ช่วงเสียงพูด, dB ทั้งหมด, สัดส่วนในช่วงเสียงพูด, จังหวะขึ้น-ลง dB, เป็นเสียงคนไหม)
        if self.n == 0:
            return 0.0, 0.0, 0.0, 0.0, False
        band_db = level_db(self.band / self.n)
        total_db = level_db(self.total / self.n)
        ratio = self.band / self.total if self.total > 0 else 0.0
        modu = stdev(self.levels)
        self.discard()
        voice = ratio >= SPEECH_RATIO_MIN and modu >= SPEECH_MOD_DB
        return band_db, total_db, ratio, modu, voice


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
            # เงียบระหว่างจับเวลา: เวลาที่ดังไปแล้วเก็บไว้ก่อน ถ้าเงียบติดกันเกิน 10 วินาที = ล้างทิ้ง (ไม่นับ ไม่หัก)
            self.quiet_ms += dt_ms
            if self.quiet_ms > QUIET_RESET_SECONDS * 1000:
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


def start_mic():
    # เปิดไมค์ (ถ้ายังไม่เปิด)
    global mic
    if mic is None:
        mic = I2S(
            0,
            sck=Pin(PIN_MIC_SCK),
            ws=Pin(PIN_MIC_WS),
            sd=Pin(PIN_MIC_SD),
            mode=I2S.RX,
            bits=32,
            format=I2S.MONO,  # ขา L/R ของไมค์ต่อ GND = ส่งเสียงช่องซ้าย
            rate=SAMPLE_RATE,
            ibuf=MIC_IBUF,
        )


def stop_mic():
    # ปิดไมค์ชั่วคราวตอนคุยกับเว็บ: ESP32 รุ่นนี้ไม่มี RAM เสริม (PSRAM) หน่วยความจำไม่พอให้ไมค์กับ HTTPS
    # ทำงานพร้อมกัน -> ปิดไมค์คืนหน่วยความจำให้ HTTPS ก่อน ส่งเสร็จเปิดใหม่ (ช่วงนั้นไม่นับเสียงอยู่แล้ว)
    global mic
    if mic is not None:
        try:
            mic.deinit()
        except Exception:
            pass
        mic = None


def setup_hardware():
    global samples, oled, led_green, led_yellow, led_red, boot_button, wlan
    led_green = Pin(PIN_LED_GREEN, Pin.OUT, value=0)
    led_yellow = Pin(PIN_LED_YELLOW, Pin.OUT, value=0)
    led_red = Pin(PIN_LED_RED, Pin.OUT, value=0)
    boot_button = Pin(PIN_BOOT, Pin.IN, Pin.PULL_UP)
    oled = setup_oled()
    start_mic()
    samples = bytearray(CHUNK_SAMPLES * 4)
    wlan = network.WLAN(network.STA_IF)
    try:
        version = os.uname().release
    except Exception:
        version = "?"
    print("MicroPython %s | %s" % (version, mem_report()))


def mem_report():
    # หน่วยความจำ 2 ก้อน: ของ Python (gc) กับของระบบ ESP-IDF (WiFi + HTTPS ใช้ก้อนนี้ ต้องมีก้อนว่าง ~40,000 ไบต์)
    gc.collect()
    text = "Python ว่าง %d" % gc.mem_free()
    try:
        info = esp32.idf_heap_info(esp32.HEAP_DATA)  # [(ทั้งหมด, ว่าง, ก้อนว่างใหญ่สุด, ว่างน้อยสุด), ...]
        text += " | ระบบว่าง %d (ก้อนใหญ่สุด %d)" % (sum(x[1] for x in info), max(x[2] for x in info))
    except Exception:
        pass
    return text + " ไบต์"


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
last_allowed = True   # ผู้ดูแลเชื่อมต่อเซนเซอร์นี้อยู่ไหม (ครั้งก่อน) — ใช้ดูว่าเพิ่งถูกตัด/เชื่อมต่อ
last_seat = None      # โต๊ะที่ผูกอยู่ (ครั้งก่อน) — ใช้ดูว่าผู้ดูแลเพิ่งย้ายโต๊ะ
wifi_announced = False  # พิมพ์ "ต่อ WiFi สำเร็จ" ไปแล้วหรือยัง
last_rpc_error = None   # คุยกับเว็บครั้งล่าสุดพังเพราะอะไร (None = ครั้งล่าสุดสำเร็จ)
mem_dumped = False      # พิมพ์รายละเอียดหน่วยความจำไปแล้วหรือยัง (พิมพ์ครั้งเดียวพอ)
web_seen = False        # เคยคุยกับเว็บสำเร็จแล้วหรือยัง


def wifi_status_text():
    # แปลสถานะ WiFi เป็นภาษาไทย (ช่วยหาสาเหตุตอนต่อไม่ติด)
    try:
        st = wlan.status()
    except Exception:
        return "ไม่ทราบสถานะ"
    for attr, text in (
        ("STAT_WRONG_PASSWORD", "รหัส WiFi ผิด"),
        ("STAT_NO_AP_FOUND", "ไม่เจอชื่อ WiFi นี้ (ต้องเป็น 2.4 GHz และอยู่ใกล้เราเตอร์)"),
        ("STAT_CONNECT_FAIL", "ต่อไม่สำเร็จ"),
        ("STAT_CONNECTING", "กำลังต่อ"),
        ("STAT_IDLE", "ยังไม่ได้เริ่มต่อ"),
    ):
        if st == getattr(network, attr, None):
            return text
    # ESP32 บางเฟิร์มแวร์ส่งรหัสเหตุผลมาเป็นตัวเลข
    return {
        201: "ไม่เจอชื่อ WiFi นี้ (ต้องเป็น 2.4 GHz และอยู่ใกล้เราเตอร์)",
        202: "รหัส WiFi ผิด",
        203: "เราเตอร์ไม่ให้ต่อ",
        204: "รหัส WiFi ผิด หรือสัญญาณอ่อน",
        15: "รหัส WiFi ผิด (ยืนยันตัวไม่ผ่าน)",
        2: "เราเตอร์ตัดการยืนยันตัว",
    }.get(st, "สถานะ %s" % st)


def keep_wifi(now):
    # ต่อ WiFi แบบไม่รอ (จอไม่ค้าง) — ต่อไม่ติด/หลุดเมื่อไร ตัดแล้วต่อใหม่ทุก 20 วินาที
    global last_wifi_try, wifi_announced
    if wlan.isconnected():
        if not wifi_announced:
            wifi_announced = True
            print("ต่อ WiFi \"%s\" สำเร็จ — IP %s | %s" % (WIFI_SSID, wlan.ifconfig()[0], mem_report()))
            print("กำลังถามเว็บครั้งแรก — ระหว่างนี้จอค้างได้ถึง ~20 วินาที ไม่ต้องกด Restart")
        return True
    if wifi_announced:
        wifi_announced = False
        print("!! WiFi หลุด — กำลังต่อใหม่")
    if last_wifi_try is None or time.ticks_diff(now, last_wifi_try) > WIFI_RETRY_MS:
        if last_wifi_try is not None:
            print("!! ยังต่อ WiFi \"%s\" ไม่ได้ — %s (ลองใหม่)" % (WIFI_SSID, wifi_status_text()))
            try:
                wlan.disconnect()  # ล้างสถานะค้างก่อนต่อใหม่
            except Exception:
                pass
        last_wifi_try = now
        wlan.active(True)
        try:
            wlan.connect(WIFI_SSID, WIFI_PASS)
        except OSError as e:
            print("!! สั่งต่อ WiFi ไม่ได้: %s" % e)
        print("กำลังต่อ WiFi \"%s\" ..." % WIFI_SSID)
    return False


def rpc_error_hint(e):
    # แปลข้อผิดพลาดตอนส่งข้อมูลเป็นภาษาไทย
    msg = str(e)
    if "-202" in msg or "EHOSTUNREACH" in msg:
        return "หาเว็บไม่เจอ — WiFi นี้ออกอินเทอร์เน็ตได้ไหม (ลองเปิดเว็บจากมือถือที่ต่อ WiFi เดียวกัน)"
    if "ENOMEM" in msg or "-17040" in msg or isinstance(e, MemoryError):
        return "หน่วยความจำไม่พอสำหรับ HTTPS (%s) — อัปเดตเฟิร์มแวร์ MicroPython" % msg
    if "ETIMEDOUT" in msg or "110" in msg or "timed out" in msg:
        return "หมดเวลารอเว็บ — เน็ตช้าหรือ WiFi นี้บล็อกเว็บภายนอก"
    if "-29" in msg or "SSL" in msg or "ECONNRESET" in msg or "104" in msg:
        return "เชื่อมต่อแบบปลอดภัย (HTTPS) ไม่สำเร็จ — ลองใหม่อัตโนมัติ / ถ้าเป็นตลอด อัปเดตเฟิร์มแวร์ MicroPython"
    return "%s %s" % (type(e).__name__, msg)


def call_rpc(fn, level):
    # เรียกฟังก์ชันบนเว็บ (ปิดไมค์ระหว่างส่ง ให้ HTTPS มีหน่วยความจำพอ แล้วเปิดไมค์กลับเสมอ)
    stop_mic()
    try:
        return post_rpc(fn, level)
    finally:
        start_mic()


def post_rpc(fn, level):
    # POST <SUPABASE_URL>/rest/v1/rpc/<fn>  -> คืนผลเป็น dict (ไม่สำเร็จคืน None)
    global last_rpc_error, web_seen, mem_dumped
    body = json.dumps({"p_device": DEVICE_ID, "p_key": DEVICE_KEY, "p_level": int(level)})
    headers = {"Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY}
    url = SUPABASE_URL + "/rest/v1/rpc/" + fn
    for attempt in (1, 2):  # พลาดครั้งแรก (มักเป็นหน่วยความจำ/HTTPS สะดุด) เก็บกวาดแล้วลองอีกรอบ
        gc.collect()  # HTTPS ใช้หน่วยความจำเยอะ เก็บกวาดก่อน
        loud = last_rpc_error or not web_seen  # ยังไม่เคยสำเร็จ/เพิ่งพัง -> บอกทุกขั้นใน Shell
        if loud:
            print("[%s] กำลังถามเว็บ... (ครั้งที่ %d | %s)" % (fn, attempt, mem_report()))
        t0 = time.ticks_ms()
        try:
            try:
                r = requests.post(url, data=body, headers=headers, timeout=8)
            except TypeError:  # เฟิร์มแวร์เก่า requests ไม่มี timeout
                r = requests.post(url, data=body, headers=headers)
            code, text = r.status_code, r.text
            r.close()
            if loud:
                print("[%s] เว็บตอบกลับแล้ว HTTP %d (%.1f วินาที)" % (fn, code, time.ticks_diff(time.ticks_ms(), t0) / 1000))
            break
        except Exception as e:
            last_rpc_error = "ส่งไม่สำเร็จ: " + rpc_error_hint(e)
            print("[%s] %s (ครั้งที่ %d, %.1f วินาที | %s)" % (
                fn, last_rpc_error, attempt, time.ticks_diff(time.ticks_ms(), t0) / 1000, mem_report()))
            if attempt == 2:
                if "ENOMEM" in str(e) and not mem_dumped:
                    mem_dumped = True
                    micropython.mem_info()  # รายละเอียดหน่วยความจำ (ถ่ายภาพส่งให้คนช่วยดูได้)
                    print("!! HTTPS ต้องใช้หน่วยความจำระบบก้อนใหญ่ — แก้: อัปเดตเฟิร์มแวร์ MicroPython เป็นรุ่นล่าสุด"
                          " (esp32/README.md หัวข้อ 'HTTPS หน่วยความจำไม่พอ')")
                return None
    if code != 200:
        if "BAD_DEVICE" in text:
            last_rpc_error = "คีย์อุปกรณ์ไม่ถูกต้อง (BAD_DEVICE) — วางค่าจากหน้าผู้ดูแลใหม่"
        elif code == 401:
            last_rpc_error = "SUPABASE_ANON_KEY ไม่ถูกต้อง (HTTP 401)"
        elif code == 404:
            last_rpc_error = "ไม่เจอฟังก์ชัน %s บนเว็บ — รัน supabase/points.sql (HTTP 404)" % fn
        else:
            last_rpc_error = "เว็บตอบ HTTP %d" % code
        print("[%s] HTTP %d %s" % (fn, code, text[:200]))
        print("!! " + last_rpc_error)
        return None
    try:
        data = json.loads(text)
    except ValueError:
        last_rpc_error = "เว็บตอบกลับมาอ่านไม่ออก"
        return None
    if last_rpc_error or not web_seen:
        print("คุยกับเว็บได้แล้ว (%s)" % fn)
    last_rpc_error = None
    web_seen = True
    return data


def idle_reason(online, allowed, seat):
    # ตอนนี้ทำไมยังไม่เฝ้าเสียง — พิมพ์ลง Shell ทุกวินาที ช่วยหาสาเหตุ
    if TEST_MODE:
        return "TEST_MODE"
    if not server_ready():
        return "ยังไม่ได้ตั้งค่า WiFi/เว็บ (ส่วนที่ 1)"
    if not online:
        return "ยังต่อ WiFi \"%s\" ไม่ได้ — %s" % (WIFI_SSID, wifi_status_text())
    if last_rpc_error:
        return "ยังคุยกับเว็บไม่ได้ — " + last_rpc_error
    if not web_seen:
        return "ต่อ WiFi แล้ว กำลังถามเว็บ..."
    if not allowed:
        return "ผู้ดูแลตัดการเชื่อมต่อเซนเซอร์นี้"
    return "เว็บยืนยันแล้ว: โต๊ะ %s ไม่มีการจองตอนนี้" % seat


def apply_status(res, booking, counter, now):
    # อ่านคำตอบจาก device_heartbeat -> อัปเดตการจอง / ผู้ดูแลเปิด-ปิด / แต้มที่หัก
    # คืนค่า (เฝ้าเสียงได้ไหม, แต้มที่หักต่อครั้ง, ชื่อที่นั่ง, การจองเปลี่ยนไหม)
    global last_allowed, last_seat
    allowed = bool(res.get("active", True)) and bool(res.get("sensor_enabled", True))
    penalty = int(res.get("penalty", 5))
    seat = res.get("seat") or "----"
    if "booking" not in res:
        print("!! เว็บยังไม่ส่งข้อมูลการจองมา — รัน supabase/points.sql เวอร์ชันล่าสุดอีกรอบ")
    b = res.get("booking")
    changed = False

    # ผู้ดูแลกด "ตัดการเชื่อมต่อ" (หรือปิดการหักแต้มจากเซนเซอร์) -> หยุดเฝ้าเสียง ล้างการนับ ไฟดับ
    if allowed != last_allowed:
        print("ผู้ดูแลเชื่อมต่อเซนเซอร์นี้แล้ว — เริ่มเฝ้าเสียง" if allowed
              else "ผู้ดูแลตัดการเชื่อมต่อเซนเซอร์นี้ — หยุดเฝ้าเสียง ไม่หักแต้ม (จอขึ้น OFF)")
        last_allowed = allowed
    if not allowed and (counter.strikes or counter.loud_ms):
        counter.reset()
        show_leds(0)
        changed = True

    # ผู้ดูแลกด "ย้ายโต๊ะ" -> เริ่มนับใหม่สำหรับโต๊ะใหม่ (ใช้คีย์เดิม ไม่ต้องแก้โค้ด)
    if last_seat is None:
        print("เชื่อมกับโต๊ะ %s แล้ว — เฝ้าเสียงเฉพาะการจองของโต๊ะนี้" % seat)
    elif seat != last_seat:
        print("ผู้ดูแลย้ายเซนเซอร์จากโต๊ะ %s ไปโต๊ะ %s — เริ่มนับใหม่" % (last_seat, seat))
        counter.reset()
        show_leds(0)
        changed = True
    last_seat = seat

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
#  ส่วนที่ 8 — จอ OLED 128x64 (ตัวอักษรภาษาอังกฤษเท่านั้น)
#   แถวบน: โต๊ะ + ครั้งที่เตือน | เวลาจองที่เหลือ / สถานะ
#   ตรงกลางเป็น "ฉาก" (เลือกใน pick_scene):
#     sleep     ไม่มีการจอง / ถูกตัดการเชื่อมต่อ / กำลังฟังเสียงพื้นหลัง -> ตาหลับ
#     eyes      เงียบ -> ตา 2 ข้างมีคิ้ว หน้าเป็นมิตร มองไปมา กะพริบ (สลับกับ timer)
#     timer     "QUIET FOR" เงียบมาแล้วกี่วินาที/นาที/ชั่วโมง (ขึ้นไฟเตือน = เริ่มนับจาก 0)
#     angry     มีเสียงพูดดัง 2 วินาทีแรก -> ตาโกรธ คิ้วขมวด จ้อง
#     countdown 3 วินาทีสุดท้าย -> ตัวเลข 3 2 1 ตัวใหญ่ + บอกว่าครั้งนี้จะโดนอะไร
#     note      ข้อความใหญ่หลังขึ้นไฟเตือน / ส่งหักคะแนน
# ============================================================
EYE_L = 36    # จุดกลางตาซ้าย (แกน x)
EYE_R = 92    # จุดกลางตาขวา
EYE_Y = 40    # จุดกลางตา (แกน y)
EYE_RX = 20   # ครึ่งความกว้างตา
EYE_RY = 14   # ครึ่งความสูงตา

gaze_x = 0.0      # ตามองไปทางไหนตอนนี้ (-1..1)
gaze_y = 0.0
target_x = 0.0    # กำลังจะมองไปทางไหน
target_y = 0.0
next_gaze = 0     # เปลี่ยนทิศที่มองรอบถัดไปเมื่อไร
next_blink = 0    # กะพริบตารอบถัดไปเมื่อไร


def big_text(s, x, y, scale, color=1):
    # ตัวหนังสือขนาดใหญ่: วาดตัวอักษร 8x8 ลงหน่วยความจำ แล้วขยายทีละพิกเซล
    w = len(s) * 8
    fb = framebuf.FrameBuffer(bytearray(w), w, 8, framebuf.MONO_HLSB)
    fb.text(s, 0, 0, 1)
    for j in range(8):
        for i in range(w):
            if fb.pixel(i, j):
                oled.fill_rect(x + i * scale, y + j * scale, scale, scale, color)


def center_text(s, y, color=1):
    oled.text(s, max(0, (128 - 8 * len(s)) // 2), y, color)


def fill_ellipse(cx, cy, rx, ry, color):
    # วงรีทึบ (วาดทีละเส้นแนวนอน — ใช้ได้ทุกเฟิร์มแวร์)
    for dy in range(-ry, ry + 1):
        w = int(rx * math.sqrt(1 - (dy / ry) ** 2) + 0.5)
        oled.hline(cx - w, cy + dy, 2 * w + 1, color)


def fmt_quiet(ms):
    # เวลาที่เงียบ -> "45s" / "12m05s" / "1h02m"
    s = max(0, ms // 1000)
    if s < 60:
        return "%ds" % s
    if s < 3600:
        return "%dm%02ds" % (s // 60, s % 60)
    return "%dh%02dm" % (s // 3600, (s % 3600) // 60)


def pick_scene(counter, watching, note, now):
    # เลือกว่าจอจะโชว์อะไร (แยกออกมาให้ทดสอบบนคอมได้)
    if note:
        return "note"
    if not watching:
        return "sleep"
    talking = counter.loud_ms > 0 and counter.quiet_ms <= CALM_AFTER_MS
    if talking:
        # ดังครบ 5 วิ = 2 วิแรกตาโกรธ + 3 วิสุดท้ายนับถอยหลัง
        return "countdown" if counter.countdown() is not None else "angry"
    return "eyes" if now % (EYES_MS + TIMER_MS) < EYES_MS else "timer"


def update_gaze(now):
    # ตากลอกไปมาเอง (เปลี่ยนทิศทุก 1.5–3.5 วิ ค่อย ๆ เลื่อน) + คืน True ถ้าถึงรอบกะพริบ (ทุก 3–7 วิ)
    global gaze_x, gaze_y, target_x, target_y, next_gaze, next_blink
    if time.ticks_diff(now, next_gaze) >= 0:
        if random.getrandbits(8) < 50:
            target_x = target_y = 0.0  # บางทีก็มองตรงมาที่คนหน้าโต๊ะ
        else:
            target_x = (random.getrandbits(8) - 128) / 128
            target_y = (random.getrandbits(8) - 128) / 128
        next_gaze = time.ticks_add(now, 1500 + random.getrandbits(11))
    gaze_x += (target_x - gaze_x) * 0.5
    gaze_y += (target_y - gaze_y) * 0.5
    if time.ticks_diff(now, next_blink) >= 0:
        next_blink = time.ticks_add(now, 3000 + random.getrandbits(12))
        return True
    return False


def draw_eye(cx, inward, mood, blink):
    # inward = ทิศเข้าหากลางหน้า (+1 ตาซ้าย, -1 ตาขวา) ใช้ตอนทำหน้าโกรธ
    if mood == "sleep":
        for dx in range(-14, 15):  # ตาหลับ: เส้นโค้งหนา 2 พิกเซล
            oled.fill_rect(cx + dx, EYE_Y - 2 + (196 - dx * dx) // 40, 1, 2, 1)
        return
    if blink:
        oled.fill_rect(cx - EYE_RX + 2, EYE_Y, 2 * EYE_RX - 3, 2, 1)
        return
    fill_ellipse(cx, EYE_Y, EYE_RX, EYE_RY, 1)
    if mood == "angry":
        px, py, pr = cx + 2 * inward, EYE_Y + 4, 5  # จ้องตรงมาที่คนหน้าโต๊ะ รูม่านตาเล็ก
    else:
        px, py, pr = cx + int(gaze_x * 9), EYE_Y + int(gaze_y * 5), 7
    fill_ellipse(px, py, pr, pr, 0)
    oled.fill_rect(px - 3, py - 3, 2, 2, 1)  # ประกายแสงในตา
    if mood == "angry":
        # เปลือกตาบนลดลงเฉียง หัวตา (ด้านใน) ต่ำกว่า = ตาหรี่จ้อง
        top = EYE_Y - EYE_RY - 1
        for dx in range(-EYE_RX, EYE_RX + 1):
            lid = EYE_Y - 6 + dx * inward * 5 // EYE_RX
            oled.vline(cx + dx, top, lid - top, 0)
            # เส้นขอบเปลือกตา — วาดเฉพาะส่วนที่อยู่ในตา (ไม่ให้มีขีดโผล่เลยหางตา)
            if (dx / EYE_RX) ** 2 + ((lid - EYE_Y) / EYE_RY) ** 2 <= 1:
                oled.pixel(cx + dx, lid, 1)


def draw_brow(cx, inward, mood):
    outer = cx - 15 * inward
    inner = cx + 15 * inward
    if mood == "angry":
        pts = ((outer, 16), (inner, 24))            # หัวคิ้วกดลง = คิ้วขมวด
    else:
        pts = ((outer, 22), (cx, 17), (inner, 22))  # โค้งยก = หน้าเป็นมิตร
    for k in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[k], pts[k + 1]
        oled.line(x0, y0, x1, y1, 1)
        oled.line(x0, y0 + 1, x1, y1 + 1, 1)  # หนา 2 พิกเซล


def draw_face(mood, blink):
    for cx, inward in ((EYE_L, 1), (EYE_R, -1)):
        draw_eye(cx, inward, mood, blink)
        if mood != "sleep":
            draw_brow(cx, inward, mood)
    if mood == "sleep":
        oled.text("z", 108, 20)
        oled.text("Z", 118, 12)


def draw(counter, booking, now, online, seat, penalty, note=None, allowed=True, quiet_ms=0, calibrating=False):
    # note = (ข้อความใหญ่, ข้อความเล็ก) หรือ None / penalty = ครั้งถัดไปจะหักเท่าไร (เว็บบอกมา)
    if oled is None:
        return
    oled.fill(0)
    watching = booking.active(now) and allowed and not calibrating

    # แถวบน: โต๊ะ (+ เตือนไปแล้วกี่ครั้ง) | สถานะ
    if TEST_MODE:
        status = "TEST"
    elif not server_ready():
        status = "NO SETUP"
    elif not online:
        status = "NO WIFI"
    elif last_rpc_error:
        status = "BAD KEY" if "BAD_DEVICE" in last_rpc_error else "WEB ERR"  # รายละเอียดดูใน Shell
    elif not allowed:
        status = "OFF"  # ผู้ดูแลตัดการเชื่อมต่อ
    elif booking.active(now):
        status = "%dm LEFT" % booking.minutes_left(now)
    else:
        status = "FREE"
    left = seat[:4]
    if watching and counter.strikes:
        left += " W%d" % counter.strikes
    oled.text(left, 0, 0)
    oled.text(status, 128 - 8 * len(status), 0)

    scene = pick_scene(counter, watching, note, now)
    if scene == "note":
        big, small = note
        if len(big) * 16 <= 128:
            big_text(big, (128 - len(big) * 16) // 2, 22, 2)
        else:
            center_text(big, 26)
        if small:
            center_text(small, 46)
    elif scene == "countdown":
        # กล่องขาว ตัวเลขดำตัวใหญ่ + ครั้งนี้ครบแล้วจะโดนอะไร
        oled.fill_rect(0, 11, 128, 43, 1)
        big_text(str(counter.countdown()), 44, 12, 5, 0)
        nxt = counter.strikes + 1
        if nxt >= DEDUCT_FROM_STRIKE:
            center_text("NEXT -%dPT" % penalty, 56)
        else:
            center_text("NEXT: " + ("GREEN" if nxt == 1 else "YELLOW"), 56)
    elif scene == "timer":
        center_text("QUIET FOR", 14)
        t = fmt_quiet(quiet_ms)
        scale = 3 if len(t) * 24 <= 128 else 2
        big_text(t, (128 - len(t) * 8 * scale) // 2, 28 if scale == 3 else 30, scale)
        center_text("KEEP IT UP!", 56)
    else:
        mood = {"eyes": "happy", "angry": "angry", "sleep": "sleep"}[scene]
        draw_face(mood, update_gaze(now) if mood == "happy" else False)
        if scene == "sleep":
            if calibrating:
                center_text("CALIBRATING", 56)
            elif not allowed:
                center_text("DISCONNECTED", 56)
            elif not TEST_MODE and server_ready() and (not online or last_rpc_error):
                center_text("SEE SHELL", 56)  # ต่อ WiFi/เว็บไม่ได้ — สาเหตุพิมพ์อยู่ใน Shell
            else:
                center_text("NO BOOKING", 56)
    oled.show()


# ============================================================
#  ส่วนที่ 9 — ลูปหลัก
# ============================================================
def main():
    setup_hardware()
    counter = NoiseCounter()
    booking = Booking()
    denoiser = Denoiser()
    meter = VoiceMeter()     # กรองช่วงเสียงพูด + ตรวจว่าเป็นเสียงคนไหม
    allowed = True           # ผู้ดูแลเปิดอุปกรณ์ + การหักแต้มอยู่ไหม
    penalty = 5              # ครั้งถัดไปจะหักเท่าไร (เว็บบอกมาตามระบบคะแนน — บอร์ดไม่ได้กำหนดเอง)
    seat = "TEST" if TEST_MODE else "----"
    pending = 0              # จำนวนครั้งที่รอส่งไปหักคะแนน
    last_report_try = None
    last_heartbeat = None
    force_heartbeat = True
    note = None              # ข้อความใหญ่บนจอ (บรรทัดใหญ่, บรรทัดเล็ก)
    note_until = 0
    quiet_since = None       # เริ่มเงียบตั้งแต่เมื่อไร (ขึ้นไฟเตือน = เริ่มนับจาก 0 ใหม่)
    silent_since = None
    mic_warned = False

    start = time.ticks_ms()
    win_start = start
    chunks = 0
    raw_db = 0.0
    voice = False            # ตอนนี้เป็นเสียงคนพูดไหม
    ratio = 0.0
    modu = 0.0
    db = 0.0
    last_draw = start
    last_print = start
    online = False

    if TEST_MODE:
        booking.start_test(start)
    show_leds(0)
    print("เริ่มเฝ้าเสียง — เกณฑ์ %d dB, ดังสะสม %d วิ = 1 ครั้ง" % (LIMIT_DB, LOUD_SECONDS))
    if DENOISE:
        print("ลดเสียงรบกวน: เปิด — %d วิแรกขอให้เงียบ บอร์ดกำลังฟังเสียงพื้นหลังของห้อง" % CALIBRATE_SECONDS)
    if VOICE_ONLY:
        print("นับเฉพาะเสียงคนพูด: เปิด (ช่วง %d–%d Hz)" % (SPEECH_LOW_HZ, SPEECH_HIGH_HZ))
    if not TEST_MODE and not server_ready():
        print("!! ยังไม่ได้ตั้งค่า WiFi/เว็บ (ส่วนที่ 1 ด้านบน) — จะแสดงแค่ค่า dB หรือเปิด TEST_MODE = True เพื่อทดสอบ")

    while True:
        # ---------- อ่านเสียงจากไมค์ ----------
        nbytes = mic.readinto(samples)
        nonzero = meter.feed(samples, nbytes)  # กรองช่วงเสียงพูด + เก็บพลังงานเสียง
        chunks += 1
        now = time.ticks_ms()

        # เช็คว่าไมค์ส่งเสียงมาจริงไหม (ค่า 0 ตลอด = ต่อสายผิด)
        if nonzero == 0:
            if silent_since is None:
                silent_since = now
            elif not mic_warned and time.ticks_diff(now, silent_since) > 3000:
                mic_warned = True
                print("!! ไมค์ไม่ส่งเสียงมา — เช็คสาย SD->D23, WS->D19, SCK->D18, L/R->GND, VDD->3V3")
        else:
            silent_since = None

        # ---------- ทุก 1/8 วินาที: สรุป dB -> ตรวจเสียงคน -> ลดเสียงรบกวน -> นับเสียงดัง ----------
        elapsed = time.ticks_diff(now, win_start)
        if elapsed >= WINDOW_MS and chunks:
            band_db, total_db, ratio, modu, voice = meter.window()
            raw_db = band_db if VOICE_ONLY else total_db  # ความดังเฉพาะช่วงเสียงพูด / ทุกความถี่
            chunks = 0
            win_start = now
            dt = min(elapsed, WINDOW_MS * 2)  # ช่วงที่บอร์ดติดคุยกับเว็บ ไม่นับเป็นเวลาดัง/เงียบ
            warm = time.ticks_diff(now, start) > WARMUP_MS
            db = denoiser.update(raw_db) if warm else max(raw_db, DB_MIN)

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
                if quiet_since is None:
                    quiet_since = now  # เริ่มเฝ้าเสียง = เริ่มจับเวลาที่เงียบ
                # นับเฉพาะเสียงคนพูด: เสียงอื่น (พัดลม เครื่องจักร เสียงบี๊บ) ถือว่าเงียบ
                loud_db = db if (voice or not VOICE_ONLY) else DB_MIN
                if counter.update(loud_db, dt):
                    n = counter.strikes
                    show_leds(n)
                    quiet_since = now  # ขึ้นไฟเตือน -> เวลาที่เงียบกลับเป็น 0 เริ่มจับใหม่
                    if n >= DEDUCT_FROM_STRIKE:
                        pending += 1
                        note = ("-%d PT" % penalty, "RED LIGHT")
                        print(">> เสียงดังครั้งที่ %d — ไฟแดง ส่งไปให้เว็บหักคะแนน (ระบบคะแนนแจ้งว่าครั้งนี้ %d)" % (n, penalty))
                    else:
                        note = ("WARN %d" % n, "GREEN LIGHT" if n == 1 else "YELLOW LIGHT")
                        print(">> เสียงดังครั้งที่ %d — ไฟ%s" % (n, "เขียว" if n == 1 else "เหลือง"))
                    note_until = time.ticks_add(now, NOTE_MS)
            else:
                counter.pause()
                quiet_since = None

        # ---------- ปุ่ม BOOT: เริ่มรอบใหม่ (ใช้ตอนทดสอบ) ----------
        if boot_button.value() == 0:
            counter.reset()
            show_leds(0)
            pending = 0
            if TEST_MODE:
                booking.start_test(now)
            note = ("RESET", "")
            quiet_since = None
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
                    draw(counter, booking, now, online, seat, penalty, ("SENDING", ""), allowed)
                    res = call_rpc("report_noise", db)
                    if res is not None:
                        pending -= 1
                        status = res.get("status")
                        print("[report_noise] %s" % res)
                        if status == "DEDUCTED":
                            # จำนวนที่หักจริงตามระบบคะแนนบนเว็บ
                            note = ("-%d PT" % res.get("penalty", penalty), "DEDUCTED")
                            note_until = time.ticks_add(time.ticks_ms(), NOTE_MS)
                            force_heartbeat = True  # ถามเว็บว่าครั้งถัดไปจะหักเท่าไร (ระบบหักแรงขึ้นทีละขั้น)
                        elif status == "DAILY_CAP":
                            note = ("DAY MAX", "NO MORE TODAY")  # วันนี้โดนหักครบยอดสูงสุดแล้ว
                            note_until = time.ticks_add(time.ticks_ms(), NOTE_MS)
                        elif status == "COOLDOWN":
                            print("!! เว็บยังอยู่ในช่วงพัก — ตั้ง 'ช่วงพักหลังหักแต้ม' ในหน้าผู้ดูแลเป็น 5 วินาที")
                    win_start = time.ticks_ms()  # ข้ามช่วงที่ติดส่งข้อมูล
                    meter.discard()
                    chunks = 0

                # 2) ถามสถานะการจองทุก 30 วินาที
                #    (ถ้ากำลังจับเวลาเสียงดังอยู่ ขอเลื่อนไปก่อน จอจะได้ไม่ค้างตอนนับถอยหลัง)
                since = None if last_heartbeat is None else time.ticks_diff(now, last_heartbeat)
                due = force_heartbeat or since is None or since >= HEARTBEAT_MS
                busy = counter.loud_ms > 0 and since is not None and since < HEARTBEAT_MS * 3
                if due and not busy:
                    last_heartbeat = now
                    force_heartbeat = False
                    if not web_seen or last_rpc_error:  # ยังเชื่อมเว็บไม่สำเร็จ -> บอกบนจอว่ากำลังทำอะไร (จอจะค้างช่วงนี้)
                        draw(counter, booking, now, online, seat, penalty, ("LINKING", "ASKING WEB"), allowed)
                    res = call_rpc("device_heartbeat", db)
                    if res is not None:
                        allowed, penalty, seat, changed = apply_status(res, booking, counter, time.ticks_ms())
                        if changed:
                            pending = 0
                            quiet_since = None
                    win_start = time.ticks_ms()
                    meter.discard()
                    chunks = 0

        # ---------- จอ + Shell ----------
        if note and time.ticks_diff(now, note_until) > 0:
            note = None
        if time.ticks_diff(now, last_draw) >= DRAW_MS:
            last_draw = now
            quiet_ms = time.ticks_diff(now, quiet_since) if quiet_since is not None else 0
            draw(counter, booking, now, online, seat, penalty, note, allowed, quiet_ms, denoiser.calibrating())
        if time.ticks_diff(now, last_print) >= PRINT_MS:
            last_print = now
            gc.collect()  # เก็บกวาดทุกวินาที กันหน่วยความจำแตกเป็นก้อนเล็ก ๆ (HTTPS ต้องการก้อนใหญ่)
            raw = " (ดิบ %.1f, พื้นหลัง %.1f)" % (raw_db, denoiser.floor) if DENOISE and denoiser.floor is not None else ""
            if VOICE_ONLY:
                raw += " | %s (ช่วงพูด %d%%, จังหวะ %.1f dB)" % ("เสียงคน" if voice else "ไม่ใช่เสียงคน", int(ratio * 100), modu)
            if booking.active(now):
                print(
                    "dB %.1f%s | ดังสะสม %.1f วิ | ครั้งที่ %d | จอง %s–%s เหลือ %d นาที"
                    % (db, raw, counter.loud_ms / 1000, counter.strikes, booking.start, booking.end,
                       booking.minutes_left(now))
                )
            else:
                print("dB %.1f%s | %s" % (db, raw, idle_reason(online, allowed, seat)))


if __name__ == "__main__":
    main()
