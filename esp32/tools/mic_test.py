# ============================================================
#  ทดสอบไมค์ INMP441 (บอร์ดที่ 1) — Thonny: เปิดไฟล์นี้แล้วกด Run (F5)
#  ** ไม่ต้อง Save ลงบอร์ด / ไม่ทับ main.py ** กด Stop (Ctrl+F2) เพื่อหยุด
#
#  ขั้นที่ 1 (4 วินาที): เช็คสาย — มีข้อมูลมาไหม / เสียงมาทางช่องไหน (ระหว่างนี้พูดหรือเคาะใกล้ไมค์)
#  ขั้นที่ 2 (ต่อเนื่อง): ทุก 0.5 วินาทีโชว์
#     ความดังทั้งหมด | ความดังช่วงเสียงพูด + แถบ | สัดส่วน ต่ำ(<250 Hz) / พูด(250–3400 Hz) / อื่น
#     | จังหวะขึ้นลง (พยางค์) | เป็นเสียงพูดไหม (ใช้ตัวกรอง + เกณฑ์เดียวกับ main.py เป๊ะ)
#  ลองตามลำดับ: เงียบ 5 วิ -> พูดปกติใกล้ไมค์ -> พูดดัง -> ตบมือ -> เป่าลมใส่ไมค์
#
#  ต่อสาย (บอร์ดที่ 1): SCK->D18, WS->D19, SD->D23, L/R->GND, VDD->3V3, GND->GND
# ============================================================
import math
import time
from array import array

import micropython
from machine import I2S, Pin

PIN_MIC_SCK = 18
PIN_MIC_WS = 19
PIN_MIC_SD = 23
SAMPLE_RATE = 16000
MIC_SENSITIVITY_DBFS = -26   # INMP441: เสียง 94 dB อ่านได้ -26 dBFS
CHUNK_BYTES = 2048           # อ่านทีละ 512 ค่า (ตัวกรองรองรับสูงสุดเท่านี้ — ห้ามเพิ่ม)
PRINT_MS = 500
SPEECH_RATIO_MIN = 0.5       # เกณฑ์เดียวกับ main.py: ของเสียงเหนือ 250 Hz อยู่ในช่วงพูดกี่ส่วน
SPEECH_MOD_DB = 6.0          # ช่วงดัง-ช่วงเบาของพยางค์ใน 1 วิ ต่างกันกี่ dB
LIMIT_DB = 65
CALIBRATE_SECONDS = 15       # ฟังเสียงพื้นหลังของห้องก่อนกี่วินาที (เหมือน main.py)
FLOOR_MAX_DB = 72
LOUD_ABOVE_DB = 15          # เสียงพื้นหลัง = 0 — ต้องดังกว่าพื้นหลังอย่างน้อยกี่ dB ถึงนับว่าดัง (เหมือน main.py)

buf = bytearray(CHUNK_BYTES)


def open_mic(fmt):
    return I2S(0, sck=Pin(PIN_MIC_SCK), ws=Pin(PIN_MIC_WS), sd=Pin(PIN_MIC_SD),
               mode=I2S.RX, bits=32, format=fmt, rate=SAMPLE_RATE, ibuf=16384)


# ---------- ตัวกรองเดียวกับ main.py ----------
def biquad_q12(kind, fc, fs):
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
    hpe = 0
    cnt = 0
    blk = 0
    nz = 0
    i = 0
    while i + 8 <= nbytes:
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
        de = acc - (q << 12)
        d = x - dx1 + q
        dx1 = x
        dy1 = d
        acc = hb0 * d + hb1 * hx1 + hb2 * hx2 - ha1 * hy1 - ha2 * hy2 + he
        h = acc >> 12
        he = acc - (h << 12)
        hx2 = hx1
        hx1 = d
        hy2 = hy1
        hy1 = h
        hq = (h + 2) >> 2  # พลังงานเหนือ 250 Hz (ไม่รวมเสียงหึ่งต่ำ)
        hpe += hq * hq
        acc = lb0 * h + lb1 * lx1 + lb2 * lx2 - la1 * ly1 - la2 * ly2 + le
        y = acc >> 12
        le = acc - (y << 12)
        lx2 = lx1
        lx1 = h
        ly2 = ly1
        ly1 = y
        yq = (y + 2) >> 2
        dq = (d + 2) >> 2
        band += yq * yq
        total += dq * dq
        cnt += 1
        if cnt == 8:
            out[blk] = band
            out[32 + blk] = total
            out[65 + blk] = hpe
            blk += 1
            band = 0
            total = 0
            hpe = 0
            cnt = 0
        i += 8
    if cnt > 0 and blk < 32:
        out[blk] = band
        out[32 + blk] = total
        out[65 + blk] = hpe
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


@micropython.viper
def raw_stats(buf, nbytes: int, out, stereo: int):
    # ค่าดิบต่อช่อง: out[0..3] = ช่องที่ 1 (ต่ำสุด, สูงสุด, จำนวนค่า 0, ผลรวม/256), out[4..7] = ช่องที่ 2
    b = ptr8(buf)
    o = ptr32(out)
    ch = 0
    i = 0
    while i + 4 <= nbytes:
        v = b[i + 1] | (b[i + 2] << 8) | (b[i + 3] << 16)
        if v & 0x800000:
            v -= 0x1000000
        k = ch * 4
        if v < o[k]:
            o[k] = v
        if v > o[k + 1]:
            o[k + 1] = v
        if v == 0:
            o[k + 2] += 1
        o[k + 3] += v >> 8
        if stereo:
            ch = 1 - ch
        i += 4


def new_stats():
    return array("i", [0x7FFFFFFF, -0x7FFFFFFF, 0, 0, 0x7FFFFFFF, -0x7FFFFFFF, 0, 0])


def to_db(rms):
    if rms < 1:
        return 0.0
    return 20 * math.log10(rms / 8388608) - MIC_SENSITIVITY_DBFS + 94


def level_db(mean_square):
    return to_db(math.sqrt(mean_square) * 1024) if mean_square > 0 else 0.0


def spread(values):
    # จังหวะพยางค์: ต่างระหว่างช่วงดัง (90%) กับช่วงเบา (10%) — ไม่ถูกเสียงพื้นหลังดัง ๆ กดให้ดูเรียบ
    n = len(values)
    if n < 5:
        return 0.0
    s = sorted(values)
    return s[n * 9 // 10] - s[n // 10]


class Band:
    # ตัวกรองช่วงความถี่ 1 ช่วง (ใช้โค้ดเดียวกับ main.py)
    def __init__(self, low_hz, high_hz):
        fs = SAMPLE_RATE // 2
        self.co = array("i", biquad_q12("hp", low_hz, fs) + biquad_q12("lp", high_hz, fs))
        self.st = array("i", [0] * 13)
        self.sums = array("i", [0] * 97)

    def feed(self, b, n):
        blocks = speech_filter(b, n, self.sums, self.st, self.co)
        band = 0
        total = 0
        hp = 0
        for k in range(blocks):
            band += self.sums[k]
            total += self.sums[32 + k]
            hp += self.sums[65 + k]
        return band, total, hp


# ============================================================
#  ขั้นที่ 1: เช็คสาย + ช่องเสียง
# ============================================================
def stereo_check(seconds=4):
    print("\n=== ขั้นที่ 1: เช็คสายไมค์ (%d วินาที) — พูดหรือเคาะเบา ๆ ใกล้ไมค์ ===" % seconds)
    mic = open_mic(I2S.STEREO)
    st = new_stats()
    n_words = 0
    t0 = time.ticks_ms()
    try:
        while time.ticks_diff(time.ticks_ms(), t0) < seconds * 1000:
            n = mic.readinto(buf)
            raw_stats(buf, n, st, 1)
            n_words += n // 4
    finally:
        mic.deinit()
    per_ch = max(1, n_words // 2)
    ranges = []
    for name, k in (("ช่องที่ 1 (ซ้าย)", 0), ("ช่องที่ 2 (ขวา)", 4)):
        lo, hi, zeros = st[k], st[k + 1], st[k + 2]
        span = max(0, hi - lo)
        ranges.append((span, zeros / per_ch))
        print("%s: ต่ำสุด %9d  สูงสุด %9d  กว้าง %5.1f dB  ค่า 0 = %3d%%" % (
            name, lo, hi, to_db(span / 2.83), int(100 * zeros / per_ch)))
    (s1, z1), (s2, z2) = ranges
    if n_words == 0:
        print("!! อ่านไมค์ไม่ได้เลย — เช็คสาย SCK->D18, WS->D19")
    elif z1 > 0.95 and z2 > 0.95:
        print("!! ไมค์ส่งแต่ค่า 0 — เช็คสาย SD->D23, VDD->3V3, GND->GND (ไมค์อาจไม่ได้รับไฟ)")
    elif s1 > 8 * max(s2, 1):
        print("OK เสียงมาทางช่องที่ 1 (ซ้าย) ถูกต้อง — ขา L/R ต่อ GND ถูกแล้ว")
    elif s2 > 8 * max(s1, 1):
        print("!! เสียงมาทางช่องที่ 2 (ขวา) — ขา L/R ของไมค์ต้องต่อ GND (ตอนนี้น่าจะต่อ 3V3 หรือลอยอยู่)")
        print("   main.py อ่านช่องที่ 1 อย่างเดียว -> จะได้ยินแต่สัญญาณรบกวน ไม่ได้ยินเสียงพูด")
    else:
        print("!! ทั้ง 2 ช่องมีสัญญาณพอ ๆ กัน — ขา L/R อาจลอยหรือสายหลวม (ต้องต่อ GND ให้แน่น)")


# ============================================================
#  ขั้นที่ 2: วัดเสียงต่อเนื่อง
# ============================================================
def talker_db(speech_db, floor):
    # ความดังของเสียงคนพูดเอง (หักพลังงานเสียงพื้นหลังออก)
    p = 10 ** (speech_db / 10) - 10 ** (floor / 10)
    return 10 * math.log10(p) if p > 1 else 0.0


def calibrate(mic, speech, low, seconds):
    # ฟังเสียงพื้นหลังของห้อง (ขอให้เงียบ) -> ค่ากลางของความดังช่วงพูด
    print("กำลังฟังเสียงพื้นหลังของห้อง %d วินาที — ขอให้เงียบ..." % seconds)
    levels = []
    t0 = time.ticks_ms()
    shown = -1
    while time.ticks_diff(time.ticks_ms(), t0) < seconds * 1000:
        n = mic.readinto(buf)
        if not n:
            continue
        sb, _, _ = speech.feed(buf, n)
        low.feed(buf, n)
        levels.append(max(level_db(sb / (n // 8)), 30.0))
        left = seconds - time.ticks_diff(time.ticks_ms(), t0) // 1000
        if left != shown and left % 5 == 0:
            shown = left
            print("  เหลือ %d วินาที" % left)
    s = sorted(levels)
    floor = min(s[len(s) // 2] if s else 30.0, FLOOR_MAX_DB)
    need = max(floor + LOUD_ABOVE_DB, 10 * math.log10(10 ** (LIMIT_DB / 10) + 10 ** (floor / 10)))
    print("เสียงพื้นหลัง (ช่วงพูด) = %.1f dB -> เสียงพูดต้องดังถึง ~%.1f dB ถึงนับว่าดัง (เหมือนบอร์ด)" % (floor, need))
    return floor


def meter(seconds=None, calib_seconds=None):
    calib_seconds = CALIBRATE_SECONDS if calib_seconds is None else calib_seconds
    print("\n=== ขั้นที่ 2: วัดเสียงต่อเนื่อง (กด Stop เพื่อหยุด) ===")
    print("ลอง: เงียบ 5 วิ -> พูดปกติ -> พูดดัง -> ตบมือ -> เป่าลม")
    print("เป็นเสียงพูด = ช่วงพูด(ของเสียงเหนือ 250 Hz) >= %d%% และ จังหวะดัง-เบา >= %.0f dB" % (
        int(SPEECH_RATIO_MIN * 100), SPEECH_MOD_DB))
    print("นับว่าดัง = เสียงพูดที่ดังกว่าพื้นหลัง >= %d dB และเสียงคนพูดเอง (หักพื้นหลังแล้ว) > %d dB" % (
        LOUD_ABOVE_DB, LIMIT_DB))
    print("(\"ดังเกิน\" แต่ละบรรทัด = แค่ครึ่งวินาทีนั้น — บอร์ดจะเตือน 1 ครั้งเมื่อดังสะสมครบ 5 วินาที)")
    mic = open_mic(I2S.MONO)  # แบบเดียวกับ main.py
    speech = Band(250, 3400)  # ช่วงเสียงพูด (เหมือน main.py)
    low = Band(30, 250)       # เสียงหึ่งความถี่ต่ำ (แอร์ พัดลม ไฟฟ้า)
    levels = []               # dB ช่วงพูดของแต่ละก้อน ~1 วินาทีล่าสุด (ดูจังหวะพยางค์)
    e_speech = e_low = e_total = e_hp = 0
    pairs = 0
    st = new_stats()
    try:
        floor = calibrate(mic, speech, low, calib_seconds)
        print("ลอง: พูดเบา ๆ -> พูดปกติ -> พูดดัง -> ตบมือ")
        t0 = last = time.ticks_ms()
        while seconds is None or time.ticks_diff(time.ticks_ms(), t0) < seconds * 1000:
            n = mic.readinto(buf)
            if not n:
                continue
            sb, tot, hp = speech.feed(buf, n)
            lb, _, _ = low.feed(buf, n)
            raw_stats(buf, n, st, 0)
            p = n // 8
            e_speech += sb
            e_low += lb
            e_total += tot
            e_hp += hp
            pairs += p
            levels.append(max(level_db(sb / p), 30.0))
            if len(levels) > 31:
                levels.pop(0)
            now = time.ticks_ms()
            if time.ticks_diff(now, last) >= PRINT_MS and pairs:
                last = now
                report(e_speech, e_low, e_total, e_hp, pairs, levels, st, pairs * 2, floor)
                e_speech = e_low = e_total = e_hp = 0
                pairs = 0
                st = new_stats()
    finally:
        mic.deinit()


def report(e_speech, e_low, e_total, e_hp, pairs, levels, st, n_samples, floor):
    total_db = level_db(e_total / pairs)
    speech_db = level_db(e_speech / pairs)
    tot = e_total if e_total > 0 else 1
    sp = min(100, 100 * e_speech // tot)
    lo = min(100 - sp, 100 * e_low // tot)
    other = max(0, 100 - sp - lo)
    mod = spread(levels)
    ratio = e_speech / e_hp if e_hp > 0 else 0
    voice = ratio >= SPEECH_RATIO_MIN and mod >= SPEECH_MOD_DB
    bar = "#" * int(max(0, min(20, (speech_db - 30) / 3)))
    loud = speech_db >= floor + LOUD_ABOVE_DB and talker_db(speech_db, floor) > LIMIT_DB
    tag = ("เสียงพูด ✓" + (" ดังเกิน!" if loud else " (ยังไม่ถึงเกณฑ์ดัง)")) if voice else "ไม่ใช่เสียงพูด"
    print("ทั้งหมด %5.1f dB | ช่วงพูด %5.1f dB %-20s เหนือพื้นหลัง %+5.1f/+%d | ต่ำ %3d%% พูด %3d%% อื่น %3d%% | พูด/เหนือ250 %3d%% | จังหวะ %4.1f dB | %s" % (
        total_db, speech_db, bar, speech_db - floor, LOUD_ABOVE_DB, lo, sp, other, min(100, int(100 * ratio)), mod, tag))
    peak = max(abs(st[0]), abs(st[1]))
    if st[2] > n_samples * 0.9:
        print("   !! ไมค์ส่งแต่ค่า 0 — เช็คสาย SD->D23 / L/R->GND / VDD->3V3")
    elif peak >= 8300000:
        print("   !! เสียงแตก (ดังสุดที่ไมค์รับได้) — อยู่ห่างไมค์ขึ้นอีกนิด")
    elif lo >= 70 and total_db > 55:
        print("   !! เสียงหึ่งความถี่ต่ำเยอะมาก — แอร์/พัดลมใกล้ไมค์ หรือไฟเลี้ยง/สาย GND ไม่ดี (ลองใช้ USB/สาย GND เส้นอื่น)")


if __name__ == "__main__":
    stereo_check(4)
    meter()
