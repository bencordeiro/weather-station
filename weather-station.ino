#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <BH1750.h>

// Fully functioning test code with quick cycles to analyze serial on the bench

#define PIN_SENS_EN 25
#define I2C_SDA     22
#define I2C_SCL     23
#define UV_PIN      35
#define WIND_PIN    32 
#define RAIN_PIN    34
#define MIC_PIN     36

// ----------------- SCHEDULE -----------------
static const uint32_t POST_INTERVAL_MS   = 60000; // 1 min for bench
static const uint32_t SOUND_SAMPLE_MS    = 8000;  // 8 seconds of audio snapshot
static const uint32_t RAIL_ON_DELAY      = 250;   // AGC stabilization

// ----------------- Thresholds -----------------
static const int HALL_THRESHOLD_LOW  = 1500; 
static const int HALL_THRESHOLD_HIGH = 2600; 
static const int HALL_IDLE_ZONE      = 400; 

// ----------------- Sensors & State -----------------
Adafruit_AHTX0 aht;
Adafruit_BMP280 bmp;
BH1750 lightMeter;

uint32_t rainTips = 0;
uint32_t windPulses = 0;
bool rainArmed = true;
bool windArmed = true;
uint32_t intervalStartMs = 0;

// ----------------- Core Functions -----------------

void pollHalls() {
  // Rain Poll
  int r = analogRead(RAIN_PIN);
  if (rainArmed) {
    if (r > HALL_THRESHOLD_HIGH || r < HALL_THRESHOLD_LOW) {
      rainTips++;
      rainArmed = false;
    }
  } else if (abs(r - 2048) < HALL_IDLE_ZONE) rainArmed = true;

  // Wind Poll
  int w = analogRead(WIND_PIN);
  if (windArmed) {
    if (w > HALL_THRESHOLD_HIGH || w < HALL_THRESHOLD_LOW) {
      windPulses++;
      windArmed = false;
    }
  } else if (abs(w - 2048) < HALL_IDLE_ZONE) windArmed = true;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SENS_EN, OUTPUT);
  digitalWrite(PIN_SENS_EN, LOW); 
  
  analogReadResolution(12);
  analogSetPinAttenuation(UV_PIN, ADC_11db);
  analogSetPinAttenuation(WIND_PIN, ADC_11db);
  analogSetPinAttenuation(RAIN_PIN, ADC_11db);
  analogSetPinAttenuation(MIC_PIN, ADC_11db);
  
  intervalStartMs = millis();
  Serial.println("V3.2.1: 8s Sound/Lux Snapshot + 24/7 Halls Active.");
}

void loop() {
  // 1. ALWAYS poll halls (on 3V3_MAIN)
  pollHalls();

  uint32_t now = millis();
  if (now - intervalStartMs >= POST_INTERVAL_MS) {
    
    // --- START SENSOR CYCLE ---
    digitalWrite(PIN_SENS_EN, HIGH); 
    delay(RAIL_ON_DELAY); 

    // Init I2C
    Wire.begin(I2C_SDA, I2C_SCL);
    aht.begin();
    bmp.begin(0x77);
    // BH1750 starts measuring here, needs ~180ms
    lightMeter.begin(BH1750::ONE_TIME_HIGH_RES_MODE);

    // --- MEASURE SOUND (8 Seconds) ---
    // This loop provides the time needed for BH1750 to finish
    Serial.println("Sampling Sound (8s)...");
    uint16_t sigMax = 0;
    uint16_t sigMin = 4095;
    uint32_t soundStart = millis();
    
    while (millis() - soundStart < SOUND_SAMPLE_MS) {
      int m = analogRead(MIC_PIN);
      if (m > sigMax) sigMax = m;
      if (m < sigMin) sigMin = m;
      
      pollHalls(); // Keep tracking wind/rain during sound check
      delay(1);
    }
    uint16_t loudness = sigMax - sigMin;

    // --- READ OTHER SENSORS ---
    // Now we fetch the lux value that was measuring during the sound loop
    uint16_t lux = lightMeter.readLightLevel(); 
    sensors_event_t h, t; aht.getEvent(&h, &t);
    float p = bmp.readPressure() / 100.0F;
    uint16_t uv = analogRead(UV_PIN);

    // --- CALCULATE WIND SPEED ---
    float durationSec = (millis() - intervalStartMs) / 1000.0f;
    float pps = windPulses / durationSec;
    float circ = 2.0f * 3.14159f * (2.75f * 0.0254f);
    float wind_kmh = (windPulses < 1) ? 0 : (circ * (pps / 2.0f) / 0.40f) * 3.6f;

    // --- REPORT ---
    Serial.println("\n--- CYCLE REPORT ---");
    Serial.printf("ENV: %.1fC | %.1f%% | %.1f hPa\n", t.temperature, h.relative_humidity, p);
    Serial.printf("LIGHT: UV Raw: %u | LUX: %u\n", uv, lux);
    Serial.printf("WIND: %.1f km/h (%u pulses) | RAIN: %u tips\n", wind_kmh, windPulses, rainTips);
    Serial.printf("SOUND LOUDNESS: %u\n", loudness);

    // --- POWER DOWN RAIL ---
    Wire.end();
    pinMode(I2C_SDA, OUTPUT); digitalWrite(I2C_SDA, LOW);
    pinMode(I2C_SCL, OUTPUT); digitalWrite(I2C_SCL, LOW);
    digitalWrite(PIN_SENS_EN, LOW);

    // RESET
    windPulses = 0;
    rainTips = 0;
    intervalStartMs = millis();
  }

  yield();
}
