# Weather station V5.0

Recovered from the Arduino build cache on 2026-10-21. Open
`weather-station-v5.ino` in Arduino IDE to continue working.

The replacement receiver and one-page Shelburne dashboard are in
[`server/`](server/README.md). The app stores V5 uploads and serves the public
page, sensor graphs, and read-only weather APIs. Server
configuration and hosting instructions are in its README. The currently installed
station has successfully uploaded to the replacement server using matching settings.
The public sketch uses placeholders; the original local recovery is unchanged.

## Recovery

Source: `../sketches/CF649F391B8D8E264B8E8E419D4CF689/sketch/sketch_feb18a.ino.cpp`

The cache identifies the original as an unsaved `sketch_feb18a` on Windows.
The public copy replaces recovered network credentials with placeholders. Arduino-generated scaffolding was removed: the injected `Arduino.h`
include, `#line` directives containing temporary paths, and the four generated
function declarations. The V5.0 application code is otherwise preserved. The original local recovery and cache are untouched.

Source SHA-256: `fab58747df8e40c0492696c21b9b42da7009dda5582f85f3c65141c8b9289411`

## Board and libraries

The cached build configuration targets **ESP32-C3** (`esp32:esp32:esp32c3`),
with USB CDC on boot enabled, 4 MB flash, and the default partition scheme.
Select the corresponding ESP32-C3 board in Arduino IDE.

Required libraries:

- Adafruit Unified Sensor
- Adafruit BME280 Library
- BH1750
- Wire, WiFi, and HTTPClient (provided by the ESP32 board package)

## Wiring

| Connection | GPIO / address |
| --- | --- |
| Rain Hall input, analog (not currently connected) | 0 |
| Wind Hall input, analog (not currently connected) | 1 |
| UV sensor, analog | 2 |
| Microphone, analog | 3 |
| I2C SDA | 6 |
| I2C SCL | 7 |
| Sensor power gate, NPN base control | 10; HIGH enables, LOW disables |
| BME280 I2C address | 0x76 |

The station uses a two-transistor power gate, and its hardware includes a
100 µF capacitor. The reported transistor markings are `PN222A` and `2NA338`;
their exact part identification is unconfirmed. The recovered code documents a
high-side switch with an NPN base input. The capacitor connection, switched
loads, and resistor values are not yet fully documented.

## Configuration and behavior

The network configuration block at the top of the sketch contains placeholders
for Wi-Fi credentials, ingestion URL, and API key. Set these for your own station
before reconnecting it. The original recovered configuration is kept locally.

`POST_INTERVAL_MS` is 60000 and `SOUND_SAMPLE_MS` is 5000. Each cycle powers
sensors on, samples sound and the other sensors, powers the sensor rail off,
and sends JSON to the configured server. The 60-second wait starts at the end
of the previous cycle, so the complete reporting period is longer than 60 seconds.
A serial capture of the installed station showed cycle starts about 66 seconds
apart and a sound-sampling window of about five seconds.

Existing behavior to consider when resuming development:

- Hall inputs are polled; blocking Wi-Fi and HTTP operations can miss pulses.
  The Hall sensors are not currently connected; wind and rain are disabled on
  the server until those instruments are built and commissioned.
- Rain and wind counters reset after each cycle even if the upload fails.
- A failed BME280 initialization substitutes zero for its readings.
- UV and sound are raw readings, rain is a tip count, and wind uses the existing
  calibration formula.

## Verification

Recovery was checked against the cached source before network settings were
replaced with placeholders for publication. The station's serial messages,
five-second sound window, payload, and successful uploads match the recovered
V5 behavior. The installed firmware has not been compared byte-for-byte, and no
firmware compilation or hardware upload has been performed during recovery.
