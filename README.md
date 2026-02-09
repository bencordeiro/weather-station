# Weather-Station V2

A DIY, high-efficiency environmental monitoring node powered by an ESP32. This project measures barometric pressure, lux, temperature, humidity, UV, wind speed, rain (mm), sound pollution and lightning. 3D printed enclosure, tipping bucket and wind cups mechanism.

# Key Features

Power-Gated Sensor Rail: Uses a PNP high-side switch (2N2907/2N3904) to completely disable I2C and high-draw sensors between readings, eliminating "zombie" power and backfeed.

Robust Hall Telemetry: Treats SS49E linear Hall sensors as analog devices with a software-based hysteresis (Schmitt trigger) to prevent false interrupts and "logic flicker."

Acoustic Snapshot: Integrated MAX9814 with Automatic Gain Control (AGC) for 8-second ambient loudness monitoring.

Dual-Rail Strategy: * 3V3_MAIN: Powers ESP32 and Hall sensors for 24/7 rain/wind tracking.

3V3_SENSOR: Switched rail for I2C (Temp/Lux/Pressure) and Microphone.

# Hardware-Stack

AHT20,Temp & Humidity,I2C (0x38)
BMP280,Barometric Pressure,I2C (0x77)
BH1750,Precision Lux (Digital),I2C (0x23)
GUVA-S12SD,UV Index,Analog (GPIO35)
MAX9814,Sound/Loudness,Analog (GPIO36/VP)
SS49E (x2),Wind Speed & Rain Tip,Analog (GPIO32/34)

# Logic & Power Management

Deep Sleep Cycle: The ESP32 remains in Deep Sleep for the majority of its life, waking only on a 30-minute interval to perform a "Full Report."
Deterministic Power Gating: All high-draw sensors (Microphone, I2C Bus) are isolated on a switched 3V3_SENSOR rail. This rail is only energized during the active window to prevent "zombie" power consumption and bus backfeed.
24/7 Pulse Tracking: Low-power Hall sensors remain on the 3V3_MAIN rail to ensure no rain tips or wind gusts are missed during the sleep interval.
Acoustic/Environmental Snapshot: Upon waking, the system performs an 8-second high-frequency sampling window to capture ambient sound levels and wind speed averages before transmitting data and returning to sleep.

By using a 37 Wh 1S pouch cell that is fed through a protection board and 3.3v buck/boost I estimate over 4 months of battery life.

# Bench Photos
<img src="https://github.com/user-attachments/assets/1ba4d966-7950-4f3b-a9c4-ba976ed3ec77" width="700" height="800">
<img src="https://github.com/user-attachments/assets/095a8ee3-d092-437e-8802-54a6f5f2130e" width="800">

# Prototype Wind Cups
![wind-cupsV1](https://github.com/user-attachments/assets/a404c130-d7e6-4a88-ac96-33835dd71b4a)


# Old V1 Outdoor ESP8266 Node
<img src="https://github.com/user-attachments/assets/54ca6866-b004-46f3-b46e-15d67e447ffb" width="400">
