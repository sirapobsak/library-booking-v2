/*
 * ============================================================
 *  เซนเซอร์ตรวจจับเสียง (ESP32) — ระบบจองห้องสมุด
 *
 *  ตรวจพบเสียงดังต่อเนื่อง -> ส่งไปที่ Supabase (ฟังก์ชัน report_noise)
 *  -> ระบบหักคะแนนสะสมของทุกคนที่จองโต๊ะที่อุปกรณ์นี้ติดอยู่ "ในเวลานั้น"
 *
 *  ฮาร์ดแวร์: ESP32 + โมดูลไมโครโฟนแบบมีขา Analog (เช่น MAX4466, MAX9814, KY-038)
 *    VCC -> 3V3,  GND -> GND,  AOUT/OUT -> GPIO34
 *
 *  ขั้นตอน (ละเอียดใน esp32/README.md)
 *    1) หน้าเว็บ > ผู้ดูแล > อุปกรณ์เซนเซอร์ > เพิ่มอุปกรณ์ (เลือกที่นั่ง)
 *    2) คัดลอก 4 บรรทัดที่หน้าเว็บให้ มาวางแทนส่วน "ตั้งค่าเซิร์ฟเวอร์" ด้านล่าง
 *    3) ใส่ชื่อ/รหัส WiFi แล้วอัปโหลด (Board: ESP32 Dev Module)
 *    4) เปิด Serial Plotter (115200) ดูกราฟ level แล้วปรับ LOUD_THRESHOLD ให้เข้ากับห้องจริง
 * ============================================================
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---------- ตั้งค่า WiFi ----------
const char* WIFI_SSID = "ชื่อWiFi";
const char* WIFI_PASS = "รหัสWiFi";

// ---------- ตั้งค่าเซิร์ฟเวอร์ (คัดลอกจากหน้าผู้ดูแล > อุปกรณ์เซนเซอร์) ----------
const char* SUPABASE_URL      = "https://xxxx.supabase.co";
const char* SUPABASE_ANON_KEY = "sb_publishable_xxxx";
const char* DEVICE_ID         = "ESP-XXXXXX";
const char* DEVICE_KEY        = "ใส่คีย์อุปกรณ์";

// ---------- ตั้งค่าเซนเซอร์ ----------
const int MIC_PIN = 34;                        // ขา Analog ของไมค์ (ต้องเป็น ADC1: GPIO32–39 เพราะ ADC2 ใช้ไม่ได้ตอนเปิด WiFi)
const int LED_PIN = 2;                         // ไฟบนบอร์ด: ติดตอนส่งเสียงดังไปที่เซิร์ฟเวอร์
const int SAMPLE_WINDOW_MS = 50;               // วัดความดัง (peak-to-peak) ทุก 50 ms
const int LOUD_THRESHOLD = 1500;               // ค่าที่ถือว่า "ดัง" (0–4095) — ปรับตามห้องจริง
const int LOUD_WINDOWS_TO_TRIGGER = 20;        // ดังเกินเกณฑ์ ~20 ช่วง (~1 วินาที) ถึงจะนับว่าเสียงดังจริง
const unsigned long LOCAL_COOLDOWN_MS = 30000; // ส่งแล้วพักฝั่งบอร์ด 30 วิ (เซิร์ฟเวอร์มีช่วงพักของตัวเองอีกชั้น)
const unsigned long HEARTBEAT_MS = 60000;      // บอกเซิร์ฟเวอร์ว่ายังออนไลน์ทุก 1 นาที

int loudCount = 0;                 // นับช่วงที่ดังเกินเกณฑ์ (ลดลงทีละ 1 ตอนเงียบ)
int peakLevel = 0;                 // เสียงดังสุดในรอบนี้ (ส่งไปให้ผู้ดูแลเห็น)
unsigned long lastReportAt = 0;
unsigned long lastHeartbeatAt = 0;
bool serverAllowsPenalty = true;   // ผู้ดูแลปิดอุปกรณ์/ปิดเซนเซอร์ไว้หรือเปล่า (รู้จาก heartbeat)

// ------------------------------------------------------------
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Connecting WiFi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " FAILED");
}

// เรียกฟังก์ชันใน Supabase: POST /rest/v1/rpc/<fn>  คืน HTTP status (-1 = ต่อเน็ตไม่ได้)
int callRpc(const char* fn, const String& body, String& response) {
  connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClientSecure client;
  client.setInsecure();  // ไม่ตรวจใบรับรอง HTTPS (ง่ายสำหรับทดลอง — ใช้งานจริงควรใส่ root CA)
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(client, String(SUPABASE_URL) + "/rest/v1/rpc/" + fn)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);

  int code = http.POST(body);
  response = http.getString();
  http.end();
  return code;
}

String deviceBody(int level) {
  return String("{\"p_device\":\"") + DEVICE_ID + "\",\"p_key\":\"" + DEVICE_KEY +
         "\",\"p_level\":" + level + "}";
}

// คำตอบ JSON มีคำว่า "<key>": false หรือไม่ (รองรับทั้งแบบมี/ไม่มีช่องว่าง)
bool isFalse(const String& json, const char* key) {
  String k = String("\"") + key + "\"";
  return json.indexOf(k + ": false") >= 0 || json.indexOf(k + ":false") >= 0;
}

void reportNoise(int level) {
  String res;
  int code = callRpc("report_noise", deviceBody(level), res);
  Serial.printf("[report_noise] HTTP %d  %s\n", code, res.c_str());
  // ตัวอย่างคำตอบ: {"ok": true, "status": "DEDUCTED", "users": 2, "penalty": 5}
  //   DEDUCTED = หักแต้มแล้ว   NO_BOOKING = ไม่มีคนจองที่นั่งนี้ตอนนี้   COOLDOWN = เพิ่งหักไป
  //   SENSOR_OFF / DEVICE_DISABLED = ผู้ดูแลปิดไว้
  if (res.indexOf("BAD_DEVICE") >= 0) Serial.println("!! DEVICE_ID หรือ DEVICE_KEY ไม่ถูกต้อง");
}

void heartbeat(int level) {
  String res;
  int code = callRpc("device_heartbeat", deviceBody(level), res);
  Serial.printf("[heartbeat] HTTP %d  %s\n", code, res.c_str());
  if (code == 200) serverAllowsPenalty = !isFalse(res, "active") && !isFalse(res, "sensor_enabled");
  if (res.indexOf("BAD_DEVICE") >= 0) Serial.println("!! DEVICE_ID หรือ DEVICE_KEY ไม่ถูกต้อง");
}

// วัดความดังช่วงสั้น ๆ = ค่าสูงสุด - ต่ำสุด ของสัญญาณไมค์ (peak-to-peak)
int measureLevel() {
  int lo = 4095, hi = 0;
  unsigned long start = millis();
  while (millis() - start < SAMPLE_WINDOW_MS) {
    int v = analogRead(MIC_PIN);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

// ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  analogReadResolution(12);                   // ค่า 0–4095
  analogSetPinAttenuation(MIC_PIN, ADC_11db); // อ่านได้เต็มช่วง 0–3.3V
  connectWiFi();
  heartbeat(0);
  lastHeartbeatAt = millis();
}

void loop() {
  int level = measureLevel();
  Serial.printf("level:%d threshold:%d\n", level, LOUD_THRESHOLD);  // เปิด Serial Plotter ดูกราฟได้

  if (level > LOUD_THRESHOLD) {
    loudCount++;
    if (level > peakLevel) peakLevel = level;
  } else if (loudCount > 0) {
    loudCount--;  // เงียบลงค่อย ๆ ลดตัวนับ (ไม่รีเซ็ตทันที เพราะเสียงคุยจะขาดเป็นช่วง ๆ)
  }
  if (loudCount == 0) peakLevel = 0;

  bool cooledDown = lastReportAt == 0 || millis() - lastReportAt > LOCAL_COOLDOWN_MS;
  if (loudCount >= LOUD_WINDOWS_TO_TRIGGER && cooledDown) {
    Serial.printf(">> เสียงดังต่อเนื่อง (peak %d)\n", peakLevel);
    if (serverAllowsPenalty) {
      digitalWrite(LED_PIN, HIGH);
      reportNoise(peakLevel);
      digitalWrite(LED_PIN, LOW);
    } else {
      Serial.println("   ผู้ดูแลปิดอุปกรณ์/การหักแต้มไว้ — ไม่ส่ง");
    }
    lastReportAt = millis();
    loudCount = 0;
    peakLevel = 0;
  }

  if (millis() - lastHeartbeatAt > HEARTBEAT_MS) {
    heartbeat(level);
    lastHeartbeatAt = millis();
  }
}
