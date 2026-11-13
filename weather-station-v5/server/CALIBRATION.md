# Pressure and site calibration

The starting configuration is **500 m elevation, 0 hPa instrument offset**, with
`ELEVATION_VERIFIED=false`. This is a provisional town-scale estimate, not a
survey or a calibration of the BME280. The app does not automatically force a
barometer to standard sea-level pressure (1013.25 hPa).

## Site reference

The station coordinates are kept in the local project documentation and are not published here.

The [Town of Shelburne's production-well report](https://www.shelburne.ca/media/5mmdiite/m17025_combined-appendices_2025-06-19.pdf),
section 2.1, describes terrain around 500 m within parts of town and to the
northwest. That supports an initial approximation; it does not establish the
height at these particular coordinates.

[Natural Resources Canada's elevation API](https://geogratis.gc.ca/site/eng/elevation)
supports a CDEM coordinate lookup. Its documentation was accessible, but the
coordinate endpoint could not be retrieved from this development environment.
Consequently no point-specific altitude has been claimed or applied. To refine
the setting, use a verified terrain elevation/benchmark and add the sensor's
height above ground, accounting for the source's vertical datum and uncertainty.

## What the three pressures mean

- `pressure`: the original BME280 station pressure in hPa, retained in SQLite.
- `pressure_calibrated`: `pressure + PRESSURE_OFFSET_HPA`.
- `pressure_sea_level`: a standard-atmosphere reduction of the calibrated value,
  useful as an initial comparison display, explicitly labeled an estimate.

The implemented reduction is:

```text
sea_level_estimate = calibrated_station_pressure
                    / (1 - 0.0065 * elevation_m / 288) ^ 5.2561
```

This inverts the standard-atmosphere station/altimeter conversion used by the
[NWS station-pressure calculator](https://www.weather.gov/epz/wxcalc_stationpressure).
It is an altimeter-style reduction, not a full meteorological mean-sea-level
pressure computation using the observed temperature profile. The
[NWS pressure definitions](https://www.weather.gov/bou/pressure_definitions)
explain why these products differ. Temperature effects can matter when comparing
this estimate with official mean-sea-level observations.

## Establishing a reference

1. Confirm the sensor's elevation and set `STATION_ELEVATION_M`. Set
   `ELEVATION_VERIFIED=true` only when that height is known.
2. Compare the sensor against a trusted co-located barometer, at the same height
   and time. Average several matched readings in stable conditions.
3. If a persistent instrument error remains, set `PRESSURE_OFFSET_HPA` to
   `reference_station_pressure - raw_sensor_pressure`. Keep this adjustment
   separate from the elevation reduction.
4. If using a regional reference instead, compare equivalent pressure products
   at matching observation times and allow for spatial differences. Do not use
   the regional station's sea-level pressure as a target for your raw pressure.

The [Environment Canada Shelburne page](https://weather.gc.ca/en/location/index.html?coords=44.080,-80.203)
lists its regional current observations at **Egbert**. The retrieved snapshot
was dated October 16, 2026, rather than the development date; no snapshot pressure
was hardcoded as a current calibration target. ECCC reports kPa on that page;
multiply by 10 to compare with hPa.

All pressure adjustments are applied when reading the API, so changing an offset
does not overwrite original stored pressure. Restart after changing `.env`.

## Trend interpretation

The server compares the latest valid pressure against an actual reading closest
to three hours earlier, requiring that baseline to be within 15 minutes of the
target time. Without it, the page reports that history is still being collected.
The displayed rising/falling threshold is ±0.5 hPa over that period; it is a UI
heuristic, not an official pressure-tendency classification or forecasting model.
The reported change still compares the two endpoints. The API also checks all
stored readings in that interval: a window has consistent reporting only when
there are at least two valid pressure samples, no failed BME readings, and no
gap between valid samples or at the boundaries greater than 15 minutes. This
15-minute coverage rule is an implementation choice, not a verified accuracy
standard; a consistently reporting sensor may still be inaccurate. Gaps or
sensor failures are labelled as limited coverage, and stale data is identified.
The standard-atmosphere height correction and constant offset do not introduce
temperature-driven changes into that raw-pressure trend.

Pressure alone does not provide a dependable local forecast. The page describes
the tendency and links to official forecasts rather than inventing rain chances,
storm warnings, or forecasts from an uncalibrated sensor.

## Other sensors

Wind and rain are disabled by default because the mechanical meters are not ready.
Enable them individually after testing with `WIND_ENABLED=true` and/or
`RAIN_ENABLED=true`. Their old disabled measurements remain missing in history.
Rain depth needs a measured `RAIN_MM_PER_TIP`. UV stays in raw ADC units until
the sensor's transfer function is known. Microphone amplitude stays in ADC units
until the entire microphone/ADC path has been calibrated for sound pressure.
