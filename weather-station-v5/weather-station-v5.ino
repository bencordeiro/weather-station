#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <BH1750.h>
#include <WiFi.h>
#include <HTTPClient.h>

/* =========================================================
 * WEATHER STATION V5.0 - WI-FI & HTTP POST INTEGRATION
 * I2C on 6/7 | Power Gate on 10 | 1-Minute Cycle
 * ========================================================= */

// ====== USER NETWORK CONFIG ======
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* INGEST_URL    = "http://YOUR_SERVER_IP:8787/ingest";
const char* API_KEY       = "YOUR_SERVER_INGEST_API_KEY";
const char* DEVICE_ID     = "outdoor-esp32-v5";

// ====== TIMING CONFIG ======
// Change this value to adjust how often the station reads and posts data.
// 60000 = 1 minute | 300000 = 5 minutes | 600000 = 10 minutes
static const uint32_t POST_INTERVAL_MS = 60000; 
static const uint32_t SOUND_SAMPLE_MS  = 5000;  // Listen to sound for 5 seconds

// ====== PIN MAPPING ======
#define PIN_SENS_EN  10   // High-Side Switch (NPN Base)
#define I2C_SDA      6    
#define I2C_SCL      7    
#define RAIN_PIN     0    
#define WIND_PIN     1    
#define UV_PIN       2    
#define MIC_PIN      3    

#define SEALEVEL_P   1013.25 

Adafruit_BME280 bme; 
BH1750 lightMeter;

uint32_t rainTips = 0;
uint32_t windPulses = 0;
bool rainArmed = true, windArmed = true;
uint32_t lastReportMs = 0;

// --- Hall Effect Polling (Runs constantly while awake) ---
void pollHalls() {
  int r = analogRead(RAIN_PIN);
  if (rainArmed && (r > 2800 || r < 1200)) { rainTips++; rainArmed = false; }
  else if (abs(r - 2048) < 400) rainArmed = true;

  int w = analogRead(WIND_PIN);
  if (windArmed && (w > 2800 || w < 1200)) { windPulses++; windArmed = false; }
  else if (abs(w - 2048) < 400) windArmed = true;
}

// --- Wi-Fi Connection Helper ---
void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t startAttemptTime = millis();
  // Wait up to 10 seconds for connection
  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 10000) {
    Serial.print(".");
    delay(500);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWi-Fi Failed. Will try again next cycle.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000); 
  
  pinMode(PIN_SENS_EN, OUTPUT);
  digitalWrite(PIN_SENS_EN, LOW); // Ensure sensors start OFF
  
  analogReadResolution(12);
  analogSetPinAttenuation(RAIN_PIN, ADC_11db);
  analogSetPinAttenuation(WIND_PIN, ADC_11db);
  analogSetPinAttenuation(UV_PIN, ADC_11db);
  analogSetPinAttenuation(MIC_PIN, ADC_11db);
  
  Serial.println("\n=== V5.0 WEATHER STATION BOOT ===");
  
  // Connect to Wi-Fi immediately on boot
  ensureWiFi();
}

void loop() {
  pollHalls(); 

  // --- MAIN 1-MINUTE CYCLE ---
  if (millis() - lastReportMs >= POST_INTERVAL_MS) {
    
    // 1. POWER UP SENSORS
    Serial.println("\n--- Waking Sensors ---");
    digitalWrite(PIN_SENS_EN, HIGH); 
    delay(300); // Give rail time to stabilize

    // 2. I2C START & INIT
    Wire.begin(I2C_SDA, I2C_SCL);
    bool bmeOk = bme.begin(0x76, &Wire);
    if (!bmeOk) Serial.println("WARNING: BME280 Not Found!");
    lightMeter.begin(BH1750::ONE_TIME_HIGH_RES_MODE);

    // 3. MEASURE SOUND (5 Second Window)
    Serial.println("Sampling Sound...");
    uint16_t sigMax = 0, sigMin = 4095;
    uint32_t soundStart = millis();
    while (millis() - soundStart < SOUND_SAMPLE_MS) {
      int m = analogRead(MIC_PIN);
      if (m > sigMax) sigMax = m;
      if (m < sigMin) sigMin = m;
      pollHalls(); // Keep checking rain/wind while sampling sound
      delay(1); 
    }
    uint16_t loudness = sigMax - sigMin;

    // 4. READ OTHER SENSORS
    float t = bmeOk ? bme.readTemperature() : 0.0;
    float h = bmeOk ? bme.readHumidity() : 0.0;
    float p = bmeOk ? (bme.readPressure() / 100.0F) : 0.0;
    float a = bmeOk ? bme.readAltitude(SEALEVEL_P) : 0.0;
    uint16_t lux = lightMeter.readLightLevel();
    uint16_t uv = analogRead(UV_PIN);

    // 5. WIND CALC
    float durationSec = (millis() - lastReportMs) / 1000.0f;
    float wind_kmh = (windPulses < 1) ? 0 : ((2.0 * 3.14159 * (2.75 * 0.0254)) * (windPulses / durationSec / 2.0) / 0.40) * 3.6;

    // 6. POWER DOWN SENSORS (Save battery before network tasks!)
    Wire.end(); 
    pinMode(I2C_SDA, INPUT);
    pinMode(I2C_SCL, INPUT);
    digitalWrite(PIN_SENS_EN, LOW); 
    Serial.println("Sensors Powered Down.");

    // 7. CONSTRUCT JSON PAYLOAD
    int rssi = WiFi.RSSI();
    String json = "{";
    json += "\"device\":\"" + String(DEVICE_ID) + "\",";
    json += "\"temp_c\":" + String(t, 2) + ",";
    json += "\"humidity\":" + String(h, 2) + ",";
    json += "\"pressure\":" + String(p, 2) + ",";
    json += "\"alt_m\":" + String(a, 2) + ",";
    json += "\"lux\":" + String(lux) + ",";
    json += "\"uv\":" + String(uv) + ",";
    json += "\"sound\":" + String(loudness) + ",";
    json += "\"wind_kmh\":" + String(wind_kmh, 2) + ",";
    json += "\"rain_tips\":" + String(rainTips) + ",";
    json += "\"rssi\":" + String(rssi);
    json += "}";

    // Print to Serial for debugging
    Serial.println("Payload: " + json);

    // 8. SEND OVER HTTP
    ensureWiFi(); // Make sure we haven't dropped connection
    
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(INGEST_URL);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Api-Key", API_KEY);
      http.setTimeout(5000); // 5 second timeout

      int httpResponseCode = http.POST(json);
      
      if (httpResponseCode > 0) {
        Serial.printf("HTTP POST Success! Response Code: %d\n", httpResponseCode);
      } else {
        Serial.printf("HTTP POST Failed. Error: %s\n", http.errorToString(httpResponseCode).c_str());
      }
      http.end();
    } else {
      Serial.println("Skipping POST: No Wi-Fi Connection.");
    }

    // 9. RESET COUNTERS & TIMER
    windPulses = 0;
    rainTips = 0;
    lastReportMs = millis();
    Serial.println("--- Cycle Complete. Waiting 1 Minute. ---\n");
  }
}
