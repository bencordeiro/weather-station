# ESP Weather Shelburne

A responsive one-page neighbourhood weather observatory, with a portable receiver
for the recovered ESP32 V5.0 firmware. It accepts authenticated sensor uploads,
stores them in SQLite, and serves the dashboard plus public read-only JSON/CSV.

The page emphasizes temperature, humidity, pressure, light, UV, and sound. Sensor cards open
to show recent graphs; the main graph has a measurement dropdown and 6-hour,
24-hour, and 7-day ranges. It includes Toronto local time, daily high/low, a
three-hour pressure tendency, CSV exports, and °C/°F display preferences.
The pressure panel shows its observed change and reports whether its historical
readings have sensor failures or gaps longer than 15 minutes. This is coverage
information, not a measure of sensor accuracy or confidence in a forecast.
Wind and rain are disabled until the physical meters are commissioned. UV and
sound retain their raw units until calibrated.

The desktop layout uses a wider canvas, a straightforward current-conditions heading, and larger text
and graph labels. The top-right **Light / Dark** control changes the complete
palette, including charts and the illustration, and remembers the visitor's
selection. On a first visit it follows the operating system's colour preference.
The controls remain available as sun/moon buttons on phones.

Dark mode separates a soft charcoal-grey canvas, a warm stone temperature panel,
muted forest-green sensor cards, and a charcoal chart panel. Sage accents tie
the controls to the landscape and barometer panel. Sensor cards have defined borders, hover/expanded
highlights, and full-width sparklines. Data lines use full opacity, brighter
dark-theme colours, and 2.4–2.6 px strokes to stay readable at desktop size.
Expanding a card hides its overview
sparkline and replaces it with the detailed graph; collapsing it restores the
sparkline. Sensor colours carry
through from icons to graphs, with UV and sound alongside the other readings.
The station elevation is shown below the trends, using the server configuration
and identifying the initial town-based value as approximate until verified.
The station write-up is deferred until its hardware and installation are
documented. Pressure/calibration notes and the official weather reference remain
available without an invented station biography.

After editing frontend files, restart `npm start`: static assets are loaded into
memory when the server starts. Hard-refresh an existing browser tab if it still
shows the previous version.

Runs on **Node.js 24.x**, using its built-in HTTP, cryptography, and SQLite modules.
There are no npm dependencies, external database services, or hosting-provider APIs.

## Run

From this directory:

```sh
npm run setup
npm start
```

Setup creates a private `.env` file with a randomly generated station key. Running
setup again preserves the existing file and key. You do not need `npm install`.
The default listener is `http://127.0.0.1:8787`.

Open that address in a browser. Use **Explore a sample day** while the physical
station is offline, or visit `http://127.0.0.1:8787/?demo=1`. The sample preview is
clearly marked, generated only in the browser, never uploaded, and never stored
in SQLite. Live mode never silently substitutes sample observations.

```sh
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/api/latest
```

Before any upload, the latest-reading response contains `reading: null` and a
station state of `waiting`. No sample readings are inserted automatically.

The recovered firmware has placeholder network settings. To connect it, set its `API_KEY` to the
`INGEST_API_KEY` value in `.env`, and change its `INGEST_URL` to your receiver's
`/ingest` URL. The server expects `DEVICE_ID=outdoor-esp32-v5`, matching V5.
Do not put the station key in frontend code.

### Connecting an unchanged recovered V5 station

For a station still running the recovered network settings, give the server the
address already configured in the station and set `HOST`, `PORT`, and
`INGEST_API_KEY` in `.env` to match that firmware. The recovered local sketch has
the original address and key; they are intentionally not included in GitHub.
Restart the server and allow the station's LAN address to reach that TCP port.
The firmware must still have access to its configured Wi-Fi network. Its actual
installed firmware and a successful upload must be verified on the hardware.

Legacy short keys are accepted for compatibility. Keep the HTTP listener on a
trusted private network, restrict access to the station and local proxy, and use
the generated long key once the station can be updated. If the tunnel uses the
same server, point it at the configured port. The Docker Compose port mapping
must also be changed if using Docker and accepting LAN uploads.

## Upload contract

```http
POST /ingest
Content-Type: application/json
X-Api-Key: <your station key>
```

```json
{
  "device": "outdoor-esp32-v5",
  "temp_c": 12.35,
  "humidity": 62.5,
  "pressure": 966.21,
  "alt_m": 402.1,
  "lux": 18300,
  "uv": 412,
  "sound": 90,
  "wind_kmh": 8.45,
  "rain_tips": 2,
  "rssi": -61
}
```

Enabled sensor fields are required. Disabled wind/rain fields may be omitted and
are ignored if present. Unknown fields and stations are rejected. Enabled sensor values
must be finite JSON numbers; strings and null are not accepted. The server allows
one stored upload every 10 seconds, including across restarts. This is comfortably
below V5's roughly one-minute reporting frequency. A successful response is
`200 {"ok":true}`, sent only after the SQLite insert has completed.

| Response | Meaning |
| --- | --- |
| 200 | Reading stored |
| 400 | Malformed JSON, unknown station/field, missing field, or invalid reading |
| 401 | Missing or incorrect key |
| 403 | Browser-originated write; only the device writes |
| 405 | Unsupported HTTP method |
| 413 | Upload exceeds 4096 bytes |
| 415 | Unsupported content type or compressed body |
| 429 | Upload interval or request rate exceeded; inspect `Retry-After` |
| 500 | Server/storage failure; no success acknowledgment |

The current firmware discards failed uploads and does not read the response body.
This receiver cannot recover readings that the firmware never sends or retries.

## Public read endpoints

| Endpoint | Returns |
| --- | --- |
| `/` | The one-page public weather dashboard |
| `/healthz` | Process/database readiness |
| `/api/config` | Shelburne/Ontario, time zone, refresh hints, measurement units, rain calibration |
| `/api/latest` | Latest reading, station freshness and BME status, today's summary, last-24-hour summary |
| `/api/history?range=6h` | History in 1-minute buckets |
| `/api/history?range=24h` | History in 5-minute buckets; default range |
| `/api/history?range=7d` | History in 30-minute buckets |
| `/api/export.csv?range=24h` | The same bucketed data as CSV; accepts the same three ranges |

GET and HEAD are supported. Public responses exclude the ingestion key, device ID,
row IDs, and Wi-Fi signal strength. RSSI is kept in the private database.

When `WIND_ENABLED` or `RAIN_ENABLED` is false, that measurement is stored as NULL,
not as zero or a working instrument's observation. Those uncommissioned readings
cannot later pollute the history when the meters are enabled. Invalid values from
those disabled instruments do not reject an otherwise valid environmental upload.

`received_at`, `server_time`, and `today_start` are **UTC Unix milliseconds** in
JSON. CSV uses ISO 8601 UTC timestamps. A history timestamp is the start of a UTC
bucket. Other sensor readings are averaged within each bucket, rain tips are
summed, and `samples` records the number of received uploads. Missing intervals
are omitted, not filled with invented readings. Exports are bounded by the same
range and bucket size as history.

Today's summary uses **America/Toronto**, including EST/EDT transitions. The
latest-reading endpoint reports `waiting`, `online`, or `stale`. Freshness defaults
to five minutes and is configurable for future battery-powered reporting intervals.

### Measurement meaning

- Temperature: °C; humidity: % RH; pressure: local station pressure in hPa.
- Altitude is the firmware's pressure-derived estimate using 1013.25 hPa, not a
  surveyed station elevation. Pressure is not corrected to sea level.
- `pressure` remains the original measurement. `pressure_calibrated` adds only
  the configured sensor offset; `pressure_sea_level` adds a standard-atmosphere
  elevation reduction. The latter is an **estimate**, not a calibrated observed-
  temperature meteorological sea-level pressure. See [pressure calibration](CALIBRATION.md).
- Light is lux. UV is raw ADC output, not a calibrated UV index.
- Sound is raw peak-to-peak ADC amplitude, not decibels.
- Wind is the firmware's calculated km/h; the receiver applies no new calibration.
- Rain tips are incremental counts for the reporting interval, not a cumulative
  lifetime counter. Totals are sums of received uploads. Each count is attributed
  to its receipt time, so a reporting interval crossing midnight is not split.
- `RAIN_MM_PER_TIP` is optional calibration metadata for the frontend.
  The API preserves raw counts; it does not silently convert them to millimetres.
- V5 sends four zeros for temperature, humidity, pressure, and altitude when its
  BME280 initialization fails. This exact pattern is stored as four NULL values,
  surfaced as JSON null / blank CSV cells, and excluded from environmental
  averages and high/low values. Other readings in that upload are retained.

## Configuration

See `.env.example`. The defaults are suitable for one V5 station.

| Variable | Default / use |
| --- | --- |
| `INGEST_API_KEY` | Required: 1–256 non-whitespace characters; setup generates a random 64-character key |
| `DEVICE_ID` | `outdoor-esp32-v5`; allowed uploading station |
| `HOST`, `PORT` | `127.0.0.1`, `8787` |
| `DB_PATH` | `./data/weather.sqlite`, relative to the working directory |
| `TOWN`, `REGION` | `Shelburne`, `Ontario` |
| `TIME_ZONE` | `America/Toronto` |
| `STALE_AFTER_SECONDS` | `300`; set above the intended reporting interval |
| `RETENTION_DAYS` | `365`; raw readings older than this are deleted during hourly upload-triggered cleanup |
| `RAIN_MM_PER_TIP` | Unset until calibrated |
| `WIND_ENABLED`, `RAIN_ENABLED` | `false`; physical instruments still being built |
| `STATION_ELEVATION_M` | `500`; provisional Shelburne town elevation, not a verified sensor height |
| `ELEVATION_VERIFIED` | `false`; set true only after confirming station elevation |
| `PRESSURE_OFFSET_HPA` | `0`; separate instrument calibration offset |
| `PUBLIC_ORIGIN` | Optional exact HTTPS origin, such as `https://weather.example.com`; enables HSTS |
| `TRUST_PROXY` | `false`; see below before enabling |

The public API is intentionally read-only. There are no public management routes,
accounts, file uploads, or endpoints that execute commands or accept SQL.

## Hosting behind a tunnel or reverse proxy

Point your existing proxy at `http://127.0.0.1:8787` when it runs on the same host.
Visitors and the ESP32 should use the public **HTTPS** address. The application
speaks HTTP on its private listener; HTTPS is terminated by your proxy/tunnel.
No provider-specific configuration is required.

The server serves the frontend and its APIs together. Proxy the entire app under
one public origin. The API intentionally does not enable cross-origin browser access.

Keep the origin port private. If your proxy runs on another machine or inside a
separate container, configure `HOST` and network/firewall access for that private
path instead of exposing the listener to the Internet.

IP rate limits use the direct connection address by default. Behind a proxy,
visitors may therefore share a 240-request/minute allowance. Enable `TRUST_PROXY`
only if the server is reachable exclusively through a trusted proxy that
**overwrites `X-Forwarded-For` with a single verified client IP**. Comma-separated
chains and malformed values are ignored. Do not enable it for an origin directly
reachable by untrusted clients. There is also a process-wide request limit, an
upload interval limit, and separate authentication-attempt/export limits.

Do not cache `/api/*` at your proxy; the API sets `Cache-Control: no-store`.
The server still uses short internal read caches, invalidated by new uploads.

### ESP32 HTTPS follow-up

The recovered sketch currently uses plain HTTP. A public deployment needs a
certificate-validated TLS client on the ESP32, using the correct CA trust and
clock synchronization. Merely changing the URL can select an unverified TLS
path in Arduino's legacy HTTPClient overload. Do not solve connection failures
by disabling certificate validation. This transport change is intentionally
separate from this server-first work; the recovered sketch remains untouched.
See [Espressif's verified HTTPS example](https://github.com/espressif/arduino-esp32/blob/master/libraries/HTTPClient/examples/BasicHttpsClient/BasicHttpsClient.ino).

## Keep it running

### Docker

After `npm run setup`, configure `.env` and run:

```sh
docker compose up -d --build
docker compose logs --tail=50 weather
```

The container runs as an unprivileged user with a read-only application filesystem,
and publishes port 8787 to the host's loopback interface. SQLite lives in the
`weather-data` named volume. `docker compose down` preserves it; `down -v` deletes
it. Keep that volume when upgrading the app.

If the tunnel is another container, put both on your chosen private Docker
network and use the service address `http://weather:8787` from that network.

### systemd

`deploy/weather-station.service` is a template. Install the server under
`/opt/weather-station/server`, create a dedicated `weather` user/group, and make
the `data` directory writable by that user. Give it read access to the private
`.env`. Adjust `ExecStart` to your Node 24 installation path before installing
the unit. The template restricts application writes to the data directory and
restarts the process after a failure.

Only run **one receiver process per database**. SQLite transactions, WAL mode,
full synchronous writes, and a five-second busy timeout are used. Do not put the
live database on a network filesystem. Persist and back up the database volume.

## Back up and restore

With a native Node deployment, a consistent backup can be made while the service
is running:

```sh
npm run backup -- /path/to/backups/weather-2026-10-21.sqlite
```

The helper uses [SQLite's online backup API through Node](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsourceDb-path-options),
creates a private file, and refuses to overwrite an existing destination. Schedule
this using your usual host backup tooling. The destination must be writable by
the command's user. Docker deployments can back up the persistent volume using
their existing volume tooling or run the helper with a mounted backup destination.

To restore, stop the receiver, preserve the current database and any `-wal`/`-shm`
files, and replace the database with the backup with the correct ownership and
permissions. Remove only the old database's sidecars from the active location
before starting with the restored database. The receiver must remain stopped
throughout the replacement.

## Checks

```sh
npm run check
npm test
```

Tests serialize HTTP requests through Node's real parser using in-memory streams;
they exercise ingestion, authentication, validation, chunked payload limits,
rate limits, persistent storage/restarts, aggregation, exports, pressure estimates,
uncommissioned sensors, display calculations, theme selection/persistence, and DST boundaries.
They never modify the recovered firmware or insert fake data into the live DB.

To run the same suite over actual loopback TCP sockets on your host:

```sh
WEATHER_TEST_TRANSPORT=tcp npm test
```

The development workspace prohibits listening on local ports, so TCP startup,
live proxy traffic, and the Docker image have not been verified here. Its installed
Firefox also exits before rendering, so browser visual QA is not verified here.
The HTTP parser/storage integration tests and syntax checks run locally without
network dependencies. Confirm the page, `/healthz`, and an authenticated test
upload on your host before connecting the station.
