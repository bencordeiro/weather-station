# ESP Weather Shelburne

A battery-powered ESP32 weather station and public dashboard for Shelburne,
Ontario. The recovered [V5 firmware](weather-station-v5/README.md) sends
observations to the [server and dashboard](weather-station-v5/server/README.md).
The earlier V3.2.1 bench sketch is kept under [legacy](legacy/weather-station.ino).

## Current status

The station has successfully sent temperature, humidity, pressure, ambient
light, UV and sound-amplitude readings to the replacement server. Its serial
output matches the recovered V5 reporting sequence, though the installed
firmware has not been verified byte-for-byte against the recovered source.

Rain and wind are planned accessories. The Hall-effect inputs exist in the
firmware, but the sensors are not currently connected or in use. The server
disables those measurements by default, so stray readings from the unused
inputs are not displayed as weather data.

UV and sound are raw ADC values, not a calibrated UV index or sound level in
decibels. The MAX9814 microphone outputs an audio waveform; V5 samples it for
five seconds and reports only its peak-to-peak ADC amplitude. It does not save
or transmit audio recordings. Pressure includes a provisional sea-level
estimate; elevation and sensor offset still need calibration.

## Power and reporting

The station uses a two-transistor power gate for a switched sensor rail, and
its hardware includes a 100 µF capacitor. The reported transistor markings are
`PN222A` and `2NA338`; the exact part identification, capacitor connection,
and list of loads on the switched rail are being confirmed.
The recovered V5 firmware drives the gate through GPIO 10, initializes the I²C
sensors, collects readings, switches the sensor rail off, and sends an HTTP
upload. GPIO 10 HIGH enables the gate according to the recovered sketch.

V5 specifies a 60-second wait after each completed cycle, plus the sampling and
upload time. A serial capture showed two cycle starts about 66 seconds apart and
a five-second sound window, consistent with that timing. V5 does not put the
ESP32 into deep sleep; battery life has not been measured for this firmware.

## Server and dashboard

The server runs on Node.js 24, receives authenticated ESP32 uploads, stores
readings in SQLite, and serves a responsive weather page and read-only APIs.
The dashboard provides light and dark themes, sensor history, pressure trends,
and local Toronto time. See the [server README](weather-station-v5/server/README.md)
for setup, privacy, deployment, backups, and calibration.

For an unchanged V5 station, configure the server's address, port, and API key
to match the settings already on that station. Keep private settings out of the
repository. A public tunnel can serve the dashboard while the station sends over
a restricted private network.

The [barometric pressure research](weather-station-v5/research/barometric-pressure/README.md)
documents regional historical comparisons, uncertainty, and recommended next steps.

## Photographs from the project

### Bench photos
<img src="https://github.com/user-attachments/assets/1ba4d966-7950-4f3b-a9c4-ba976ed3ec77" width="700" height="800">
<img src="https://github.com/user-attachments/assets/095a8ee3-d092-437e-8802-54a6f5f2130e" width="800">

### Prototype wind cups
<img src="https://github.com/user-attachments/assets/a404c130-d7e6-4a88-ac96-33835dd71b4a" width="700" height="400">

### Old V1 outdoor ESP8266 node
<img src="https://github.com/user-attachments/assets/54ca6866-b004-46f3-b46e-15d67e447ffb" width="400">
