# ============================================================
#  บอร์ดต่อเว็บ (บอร์ดที่ 2) — ESP32 ตัวที่ 2: ต่อ WiFi + คุยกับเว็บอย่างเดียว
#  ระบบจองห้องสมุด / MicroPython สำหรับ Thonny (บันทึกลงบอร์ดนี้ชื่อ main.py)
#
#  ทำไมต้องแยก 2 บอร์ด: ESP32 ธรรมดา (ไม่มี RAM เสริม) หน่วยความจำไม่พอให้ไมค์ + จอ + HTTPS อยู่บนตัวเดียวกัน
#    บอร์ดที่ 1 (esp32/noise_meter/main.py) = ไมค์ นับเสียง จอ OLED ไฟ 3 ดวง — ไม่ต่อ WiFi
#    บอร์ดที่ 2 (ไฟล์นี้)                    = WiFi + ถามการจองจากเว็บทุก 30 วิ + ส่งหักคะแนน
#
#  ต่อสายระหว่าง 2 บอร์ด (3 เส้น):
#    บอร์ด 2 D17 (TX)  ->  บอร์ด 1 D15 (RX)
#    บอร์ด 2 D16 (RX)  <-  บอร์ด 1 D5  (TX)
#    บอร์ด 2 GND       ---  บอร์ด 1 GND
#
#  คุยกันเป็นข้อความ JSON บรรทัดละ 1 ข้อความ
#    บอร์ด 1 -> 2 : {"t":"hi"} ขอสถานะเดี๋ยวนี้, {"t":"lv","db":62} ระดับเสียงล่าสุด,
#                  {"t":"strike","db":70} เสียงดังครั้งที่ 3 ขึ้นไป -> ส่งไปหักคะแนน
#    บอร์ด 2 -> 1 : {"t":"st",...} สถานะทุก 5 วิ (WiFi / ปัญหา / คำตอบการจองจากเว็บ)
#                  {"t":"rep",...} ผลการส่งหักคะแนน (หักไปเท่าไรตามระบบคะแนนบนเว็บ)
#
#  ไฟสีฟ้าบนบอร์ด (D2): กะพริบ = กำลังต่อ WiFi/เว็บ, ติดค้าง = คุยกับเว็บได้แล้ว
# ============================================================
import gc
import json
import time

import network
from machine import UART, Pin

try:
    import esp32  # ดูหน่วยความจำฝั่งระบบ (ESP-IDF) ที่ HTTPS ใช้
except ImportError:
    esp32 = None

try:
    import urequests as requests
except ImportError:
    import requests


# ============================================================
#  ส่วนที่ 1 — ตั้งค่า (WiFi + ค่าของโต๊ะจากหน้าผู้ดูแล > อุปกรณ์เซนเซอร์ > เพิ่มอุปกรณ์ เลือกโต๊ะ เช่น D18)
#  !! ไฟล์ที่ใส่คีย์จริงแล้ว ห้ามอัปขึ้น GitHub
# ============================================================
WIFI_SSID = "ชื่อWiFi"
WIFI_PASS = "รหัสWiFi"
SUPABASE_URL = "https://xxxx.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_xxxx"
DEVICE_ID = "ESP-XXXXXX"
DEVICE_KEY = "ใส่คีย์อุปกรณ์"


# ============================================================
#  ส่วนที่ 2 — ขาที่ต่อ + ค่าทางเทคนิค
# ============================================================
PIN_LINK_TX = 17        # ส่งไปบอร์ด 1 (ต่อเข้า D15 ของบอร์ด 1)
PIN_LINK_RX = 16        # รับจากบอร์ด 1 (ต่อจาก D5 ของบอร์ด 1)
PIN_STATUS_LED = 2      # ไฟสีฟ้าบนบอร์ด (ไม่ต้องต่อสาย)
LINK_BAUD = 115200      # ความเร็วสาย UART (ต้องตรงกับบอร์ด 1)

HEARTBEAT_MS = 30000    # ถามสถานะการจองจากเว็บทุก 30 วินาที
STATUS_MS = 5000        # ส่งสถานะให้บอร์ด 1 ทุก 5 วินาที
WIFI_RETRY_MS = 20000   # WiFi ต่อไม่ติด/หลุด -> ลองใหม่ทุก 20 วินาที
REPORT_RETRY_MS = 5000  # ส่งหักคะแนนไม่สำเร็จ -> ลองใหม่ทุก 5 วินาที (เก็บคิวไว้ ไม่หาย)
HTTP_TIMEOUT = 8        # รอเว็บตอบนานสุดกี่วินาที


# ============================================================
#  ส่วนที่ 3 — WiFi + คุยกับเว็บ (Supabase)
# ============================================================
wlan = None
last_wifi_try = None
wifi_announced = False
last_rpc_error = None   # คุยกับเว็บครั้งล่าสุดพังเพราะอะไร (None = สำเร็จ)
web_seen = False        # เคยคุยกับเว็บสำเร็จแล้วหรือยัง


def server_ready():
    return (bool(WIFI_SSID) and WIFI_SSID != "ชื่อWiFi" and "xxxx" not in SUPABASE_URL
            and not DEVICE_ID.endswith("XXXXXX"))


def mem_report():
    # หน่วยความจำ 2 ก้อน: Python (gc) กับระบบ ESP-IDF (WiFi + HTTPS ใช้ก้อนนี้)
    gc.collect()
    text = "Python ว่าง %d" % gc.mem_free()
    try:
        info = esp32.idf_heap_info(esp32.HEAP_DATA)
        text += " | ระบบว่าง %d (ก้อนใหญ่สุด %d)" % (sum(x[1] for x in info), max(x[2] for x in info))
    except Exception:
        pass
    return text + " ไบต์"


def wifi_status_text():
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
    return {
        201: "ไม่เจอชื่อ WiFi นี้ (ต้องเป็น 2.4 GHz และอยู่ใกล้เราเตอร์)",
        202: "รหัส WiFi ผิด",
        203: "เราเตอร์ไม่ให้ต่อ",
        204: "รหัส WiFi ผิด หรือสัญญาณอ่อน",
        15: "รหัส WiFi ผิด (ยืนยันตัวไม่ผ่าน)",
        2: "เราเตอร์ตัดการยืนยันตัว",
    }.get(st, "สถานะ %s" % st)


def keep_wifi(now):
    # ต่อ WiFi แบบไม่รอ — ต่อไม่ติด/หลุดเมื่อไร ตัดแล้วต่อใหม่ทุก 20 วินาที
    global last_wifi_try, wifi_announced
    if wlan.isconnected():
        if not wifi_announced:
            wifi_announced = True
            print("ต่อ WiFi \"%s\" สำเร็จ — IP %s | %s" % (WIFI_SSID, wlan.ifconfig()[0], mem_report()))
        return True
    if wifi_announced:
        wifi_announced = False
        print("!! WiFi หลุด — กำลังต่อใหม่")
    if last_wifi_try is None or time.ticks_diff(now, last_wifi_try) > WIFI_RETRY_MS:
        if last_wifi_try is not None:
            print("!! ยังต่อ WiFi \"%s\" ไม่ได้ — %s (ลองใหม่)" % (WIFI_SSID, wifi_status_text()))
            try:
                wlan.disconnect()
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
    msg = str(e)
    if "-202" in msg or "EHOSTUNREACH" in msg:
        return "หาเว็บไม่เจอ — WiFi นี้ออกอินเทอร์เน็ตได้ไหม"
    if "ENOMEM" in msg or "-17040" in msg or isinstance(e, MemoryError):
        return "หน่วยความจำไม่พอสำหรับ HTTPS (%s)" % msg
    if "ETIMEDOUT" in msg or "110" in msg or "timed out" in msg:
        return "หมดเวลารอเว็บ — เน็ตช้าหรือ WiFi นี้บล็อกเว็บภายนอก"
    if "-29" in msg or "SSL" in msg or "ECONNRESET" in msg or "104" in msg:
        return "เชื่อมต่อแบบปลอดภัย (HTTPS) ไม่สำเร็จ"
    return "%s %s" % (type(e).__name__, msg)


def call_rpc(fn, level):
    # POST <SUPABASE_URL>/rest/v1/rpc/<fn>  -> คืนผลเป็น dict (ไม่สำเร็จคืน None, สาเหตุอยู่ใน last_rpc_error)
    global last_rpc_error, web_seen
    body = json.dumps({"p_device": DEVICE_ID, "p_key": DEVICE_KEY, "p_level": int(level)})
    headers = {"Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY}
    url = SUPABASE_URL + "/rest/v1/rpc/" + fn
    code = text = None
    for attempt in (1, 2):  # พลาดครั้งแรก เก็บกวาดหน่วยความจำแล้วลองอีกรอบ
        gc.collect()
        loud = last_rpc_error or not web_seen  # ยังไม่เคยสำเร็จ/เพิ่งพัง -> บอกทุกขั้นใน Shell
        if loud:
            print("[%s] กำลังถามเว็บ... (ครั้งที่ %d | %s)" % (fn, attempt, mem_report()))
        t0 = time.ticks_ms()
        try:
            try:
                r = requests.post(url, data=body, headers=headers, timeout=HTTP_TIMEOUT)
            except TypeError:  # เฟิร์มแวร์เก่า requests ไม่มี timeout
                r = requests.post(url, data=body, headers=headers)
            code, text = r.status_code, r.text
            r.close()
            if loud:
                print("[%s] เว็บตอบกลับแล้ว HTTP %d (%.1f วินาที)" % (fn, code, time.ticks_diff(time.ticks_ms(), t0) / 1000))
            break
        except Exception as e:
            last_rpc_error = "ส่งไม่สำเร็จ: " + rpc_error_hint(e)
            print("[%s] %s (ครั้งที่ %d | %s)" % (fn, last_rpc_error, attempt, mem_report()))
            if attempt == 2:
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


# ============================================================
#  ส่วนที่ 4 — คุยกับบอร์ด 1 ทางสาย UART
# ============================================================
class LinkBoard:
    def __init__(self, uart, led):
        self.uart = uart
        self.led = led
        self.buf = b""
        self.hb = None             # คำตอบ device_heartbeat ล่าสุด
        self.hb_at = 0             # ได้คำตอบนั้นมาเมื่อไร (ใช้ลดเวลาจองที่เหลือตอนส่งต่อ)
        self.level = 0             # ระดับเสียงล่าสุดจากบอร์ด 1 (ส่งไปกับ heartbeat)
        self.queue = []            # เสียงดังที่รอส่งหักคะแนน (ส่งไม่สำเร็จจะเก็บไว้ลองใหม่ ไม่หาย)
        self.want_hb = True        # ถามเว็บเดี๋ยวนี้เลย (เปิดเครื่อง / บอร์ด 1 ขอ / เพิ่งหักคะแนน)
        self.last_hb_try = None
        self.last_report_fail = None  # ส่งหักคะแนนพลาดล่าสุดเมื่อไร (พลาดแล้วค่อยเว้น 5 วิ ไม่พลาดส่งทันที)
        self.last_status = None
        self.board1_seen = False

    def send(self, obj):
        try:
            self.uart.write(json.dumps(obj) + "\n")
        except Exception as e:
            print("!! ส่งข้อความให้บอร์ด 1 ไม่ได้: %s" % e)

    def read_messages(self):
        msgs = []
        n = self.uart.any()
        if n:
            data = self.uart.read(n)
            if data:
                self.buf += data
            if len(self.buf) > 2048:  # สายรบกวน/ข้อมูลเสีย -> ทิ้งของเก่า
                self.buf = self.buf[-2048:]
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n", 1)
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if isinstance(msg, dict):
                    msgs.append(msg)
        return msgs

    def handle(self, msg, now):
        if not self.board1_seen:
            self.board1_seen = True
            print("ได้ยินบอร์ด 1 แล้ว (สาย UART ใช้ได้)")
        t = msg.get("t")
        if t == "hi":
            self.want_hb = True
            self.send_status(now)
        elif t == "lv":
            self.level = int(msg.get("db", 0))
        elif t == "strike":
            self.queue.append(int(msg.get("db", 0)))
            print(">> บอร์ด 1 แจ้งเสียงดัง (ครั้งที่ 3 ขึ้นไป) — ส่งไปหักคะแนน (รอส่ง %d)" % len(self.queue))

    def fresh_hb(self, now):
        # ส่งต่อคำตอบการจองโดยลดเวลาที่เหลือตามเวลาที่ผ่านไปแล้ว (บอร์ด 1 จะได้นับหมดเวลาถูก)
        hb = dict(self.hb)
        b = hb.get("booking")
        if b:
            b = dict(b)
            b["ends_in"] = int(b.get("ends_in", 0)) - time.ticks_diff(now, self.hb_at) // 1000
            hb["booking"] = b if b["ends_in"] > 0 else None
        return hb

    def send_status(self, now):
        ready = server_ready()
        online = ready and wlan.isconnected()
        st = {"t": "st", "setup": ready, "wifi": online, "err": last_rpc_error, "q": len(self.queue)}
        if ready and not online:
            st["wifi_text"] = wifi_status_text()
        if self.hb is not None:
            st["hb"] = self.fresh_hb(now)
        self.send(st)
        self.last_status = now

    def step(self, now):
        for msg in self.read_messages():
            self.handle(msg, now)

        online = keep_wifi(now) if server_ready() else False
        if online:
            # 1) มีเสียงดังที่ต้องหักคะแนน -> ส่งก่อน (ส่งทีละครั้ง ตามลำดับ)
            if self.queue and (self.last_report_fail is None
                               or time.ticks_diff(now, self.last_report_fail) >= REPORT_RETRY_MS):
                res = call_rpc("report_noise", self.queue[0])
                if res is None:
                    self.last_report_fail = now  # เว็บพัง -> เก็บไว้ในคิว ลองใหม่อีก 5 วินาที
                    self.send_status(now)        # บอกบอร์ด 1 ทันที (จอขึ้น WEB ERR)
                else:
                    self.last_report_fail = None
                    self.queue.pop(0)
                    print("[report_noise] %s" % res)
                    rep = dict(res)
                    rep["t"] = "rep"
                    self.send(rep)
                    self.want_hb = True  # ถามว่าครั้งถัดไปจะหักเท่าไร (ระบบคะแนนหักแรงขึ้นทีละขั้น)
            # 2) ถามสถานะการจองทุก 30 วินาที (หรือเดี๋ยวนี้ถ้ามีคนขอ)
            if self.want_hb or self.last_hb_try is None or time.ticks_diff(now, self.last_hb_try) >= HEARTBEAT_MS:
                self.want_hb = False
                self.last_hb_try = now
                res = call_rpc("device_heartbeat", self.level)
                if res is not None:
                    if self.hb is None or (self.hb.get("booking") or {}).get("id") != (res.get("booking") or {}).get("id"):
                        b = res.get("booking")
                        print("เว็บ: โต๊ะ %s — %s" % (res.get("seat"), ("มีการจอง %s–%s" % (b.get("start"), b.get("end")))
                                                     if b else "ไม่มีการจองตอนนี้"))
                    self.hb = res
                    self.hb_at = time.ticks_ms()
                self.send_status(time.ticks_ms())

        # 3) ส่งสถานะให้บอร์ด 1 สม่ำเสมอ (บอร์ด 1 จะรู้ว่าสายยังต่ออยู่)
        if self.last_status is None or time.ticks_diff(now, self.last_status) >= STATUS_MS:
            self.send_status(now)

        # ไฟสีฟ้า: ติดค้าง = คุยกับเว็บได้ / กะพริบ = กำลังต่อหรือมีปัญหา
        linked = online and web_seen and not last_rpc_error
        self.led.value(1 if linked else (now // 300) % 2)


# ============================================================
#  ส่วนที่ 5 — ลูปหลัก
# ============================================================
def main():
    global wlan
    led = Pin(PIN_STATUS_LED, Pin.OUT, value=0)
    uart = UART(2, baudrate=LINK_BAUD, tx=PIN_LINK_TX, rx=PIN_LINK_RX)
    wlan = network.WLAN(network.STA_IF)
    board = LinkBoard(uart, led)
    print("บอร์ดต่อเว็บเริ่มทำงาน | %s" % mem_report())
    if not server_ready():
        print("!! ยังไม่ได้ตั้งค่า WiFi/เว็บ (ส่วนที่ 1 ด้านบน) — วางค่าจากหน้าผู้ดูแล > อุปกรณ์เซนเซอร์")
    last_print = time.ticks_ms()
    while True:
        now = time.ticks_ms()
        board.step(now)
        if time.ticks_diff(now, last_print) >= 10000:  # สรุปสถานะใน Shell ทุก 10 วินาที
            last_print = now
            b = (board.hb or {}).get("booking")
            print("WiFi %s | เว็บ %s | บอร์ด 1 %s | รอส่งหักคะแนน %d | %s" % (
                "ต่อแล้ว" if wlan.isconnected() else "ยังไม่ต่อ",
                ("ได้ — " + ("จอง %s–%s" % (b.get("start"), b.get("end")) if b else "ไม่มีการจอง")) if web_seen and not last_rpc_error
                else (last_rpc_error or "ยังไม่ได้ถาม"),
                "ได้ยินแล้ว" if board.board1_seen else "ยังไม่ได้ยิน (เช็คสาย)",
                len(board.queue), mem_report()))
        time.sleep_ms(20)


if __name__ == "__main__":
    main()
