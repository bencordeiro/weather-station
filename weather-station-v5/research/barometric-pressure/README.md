# Barometric pressure and weather research

Research for ESP Weather Shelburne. **Status: exploratory research, not an
operational forecast or storm-warning system.** No website prediction rules were
changed as part of this study. See the [implementation and validation plan](IMPLEMENTATION-PLAN.md)
for the subsequent observation-coverage improvement and steps required before
publishing a weather-outcome prediction.

## Decision in plain language

A pressure trend is useful information. In nearby official station records,
stronger three-hour falls were associated with precipitation more often than the
baseline, but many such falls were not followed by measurable precipitation and
many precipitation events occurred without such a fall. A pressure fall alone
does not establish that a storm will occur, whether it will affect Shelburne, or
whether no storm can occur when pressure is steady. We cannot give a guaranteed
forecast or an honest local storm-probability percentage from these tests.

**Recommended next product step:** improve the display of observed pressure
changes, label their data quality, and keep their interpretation conditional.
Use separately attributed official weather alerts for actual watches and
warnings. Do not turn the exploratory precipitation ratios below into website
forecast percentages.

## Existing system

The current server compares the latest unadjusted BME280 station-pressure
reading with one within 15 minutes of three hours earlier. More than +0.5 hPa
means rising; below −0.5 hPa means falling; otherwise steady. If the earlier
reading is absent, no trend is provided. The UI marks old data as stale. This
threshold was a UI heuristic, not a locally validated prediction rule. The
current sea-level pressure uses a standard-atmosphere estimate with a provisional
500 m elevation, not a calibrated meteorological sea-level calculation.

A fixed sensor offset cancels in a same-sensor difference, but drift, power-up
transients, temperature effects, missing readings, and changing installation
conditions still affect trends. BME280 pressure has a temperature coefficient;
a sensor failure is converted to a missing BME reading by the server.

## Sources and stations

- **ECCC Egbert CS**: climate ID `611E001`, download station ID `27604`, elevation
  251 m. Approximately 38 km from Shelburne town centre. [ECCC metadata](https://climate.weather.gc.ca/climate_normals/results_1991_2020_e.html?climate_id=611E001).
  ECCC's [Shelburne page](https://weather.gc.ca/en/location/index.html?coords=44.080%2C-80.203)
  has used Egbert for its current observation; that does not make Egbert a
  station located in Shelburne.
- **ECCC Mount Forest (AUT)**: climate ID `6145504`, download station ID `7844`,
  elevation 414.5 m, approximately 45 km from Shelburne town centre. [ECCC metadata](https://climate.weather.gc.ca/climate_normals/results_1991_2020_e.html?climate_id=6145502).
- ECCC [hourly data documentation](https://www.canada.ca/en/environment-climate-change/services/climate-change/canadian-centre-climate-services/display-download/technical-documentation-hourly-data.html)
  lists hourly station pressure, humidity, precipitation and weather where
  available. [ECCC's data FAQ](https://climate.weather.gc.ca/FAQ_e.html) notes
  that stations have different variable availability and hourly precipitation
  is not universally available. Missing, unobserved and flagged measurements
  must not be treated as dry weather.
- The WMO pressure-observation guidance uses a three-hour tendency and also
  describes the *shape* of the pressure curve. Its recommendation for more
  frequent observations to characterize the curve is relevant when considering
  a richer trend; it does not prescribe a storm prediction threshold. [WMO
  pressure chapter hosted by NWS](https://www.weather.gov/media/epz/mesonet/CWOP-WMO8.pdf).
- [NWS guidance](https://www.weather.gov/media/safety/ObservingHandbook1_2010_508_compliant.pdf)
  discusses falling pressure as one possible indicator of approaching systems,
  alongside other conditions. It does not prove that any specific pressure
  drop guarantees a local storm.
- [Bosch's BME280 notes](https://community.bosch-sensortec.com/knowledge-base-pg631enp/post/bme280-sensor-data-interpretation-DJxTc70m6bNFFXp)
  describe temperature-related pressure offset and sensor filtering.
- ECCC's [CAP weather-alert feed](https://eccc-msc.github.io/open-data/msc-data/alerts/readme_alerts-datamart_en/)
  is a potential source for official alerts, separate from local measurements.
  [ECCC explains the differences between warnings, watches, and advisories](https://www.canada.ca/en/services/environment/weather/severeweather/weather-alerts.html).
- [NWS forecast-verification definitions](https://www.weather.gov/media/owp/oh/rfcdev/docs/Glossary_Forecast_Verification_Metrics.pdf)
  distinguish false-alarm ratio, missed events, and the false-positive rate.

## Data and method

Downloaded the complete 2020–2025 monthly hourly CSV series for both stations:
144 files and 105,216 hourly timestamp rows. Raw files are cached locally in
`data/`, ignored by Git. They are public third-party observations, not this
station's private database. `data-manifest.json` records SHA-256 checksums and
retrieval time; files may be revised by the provider. Some rows lack values:
for example, Mount Forest has 6,613 unflagged precipitation values out of 8,784
rows in 2020. See `quality-results.json` for every station/year. The same-station
threshold analyses cover all six years at both stations; cross-station and
additional sensitivity checks use the periods identified below.

We examined a deliberately narrow *proxy question*, not storms:

> At an hourly timestamp, did the gauge report at least 0.2 mm of precipitation
> in the **next six hourly periods**, and was a three-hour pressure drop
> associated with that outcome?

For the main analysis the current hour must report 0.0 mm ("dry now"). A
separate analysis includes all current weather because our station has no
working rain gauge. These are different populations. Neither makes claims about
thunderstorms, dangerous weather, local impacts, or forecast lead time for
Shelburne. Hourly gauge readings can be missing or imperfect, particularly for
some precipitation types and localized showers. All results describe reported
measurements at the reference gauge, not truth at our installation.

- Three-hour change is `pressure(t) - pressure(t − 3h)`, measured in hPa; ECCC
  station pressure is in kPa and converted by multiplying by 10. Analysis uses
  integer tenths of hPa to avoid floating-point threshold ambiguity.
- Test signals are falls **strictly greater than** 0.5, 1, 2, 3 and 5 hPa in
  three hours. The comparison requires valid pressure at both endpoints; it does
  not require the intervening two hourly pressures. Future precipitation needs
  six valid unflagged readings; the dry-now test also needs a valid zero current
  precipitation measurement. Flagged values are conservatively excluded.
- ECCC timestamps are Local Standard Time; no daylight-saving adjustment was
  applied. Both Ontario stations use the same standard-time basis. Time windows
  crossing a year-split boundary are excluded.
- Egbert periods and thresholds were set before inspecting their results:
  **2020–2023 development, 2024 validation, 2025 holdout**. We did not train a
  fitted model or choose an operational threshold. The second-station,
  cross-station, seasonal, humidity and alternative-amount checks were added
  after observing initial results; all are **exploratory**, not a new blind
  test. Repeated hourly six-hour windows overlap: these are hours, not
  independent storms or independent forecast trials.

## Egbert: dry now, precipitation in the next six hours

The 2025 holdout includes **7,770 eligible hourly decision points**. The
overall outcome rate within this *dry-now* sample was **13.7%**.

| Three-hour pressure fall | Signal hours | Next six hours ≥0.2 mm | False-alarm ratio | Share of all positive outcome hours detected |
| --- | ---: | ---: | ---: | ---: |
| >0.5 hPa | 2,555 | 21.7% | 78.3% | 52.2% |
| >1 hPa | 1,623 | 24.1% | 75.9% | 36.9% |
| >2 hPa | 583 | 33.3% | 66.7% | 18.3% |
| >3 hPa | 198 | 47.0% | 53.0% | 8.8% |
| >5 hPa | 32 | 59.4% | 40.6% | 1.8% |

For the >2 hPa row, 194 of 583 signal hours had the defined outcome, 389 did
not, and 867 outcome hours lacked the signal. These are overlapping **hourly
windows**, not 583 independent alarms. The false-alarm ratio is false signal
hours / all signal hours; it is different from the false-positive rate among
actual non-outcomes (5.8% here). Missing an outcome is not proof the website
would have missed a storm: this test did not identify storms.

For >2 hPa, the same dry-now success ratio was 33.8% in 2020–2023 and 40.7% in
2024. A 1,000-resample day-block bootstrap gives an approximate 2025 interval of
26.4%–40.6% for the Egbert success ratio. The >5 hPa signal occurred in only
32 hourly windows; its rough 28.1%–85.7% bootstrap interval shows how little
confidence to place in that point estimate. Day blocks only partly handle
multi-day systems and overlapping windows, so these are exploratory uncertainty
ranges, not calibrated confidence for a Shelburne station or a storm.

A concrete counterexample: on **7 May 2024**, Egbert station pressure decreased
from 98.25 kPa at 09:00 LST to 98.03 kPa at 12:00 LST (−2.2 hPa). The
following six hourly precipitation records through 18:00 were all 0.0 mm. This
shows a >2 hPa fall can occur without the defined immediate local precipitation;
it does not describe weather elsewhere or later. [ECCC hourly CSV for May 2024](https://climate.weather.gc.ca/climate_data/bulk_data_e.html?format=csv&stationID=27604&Year=2024&Month=5&Day=1&timeframe=1&submit=Download+Data).

## Regional and seasonal checks

For >2 hPa, dry-now, next-six-hour ≥0.2 mm in **2025**:

| Pressure site → precipitation gauge | Eligible hours | Success ratio | Event baseline | Share of outcome hours caught |
| --- | ---: | ---: | ---: | ---: |
| Egbert → Egbert | 7,770 | 33.3% | 13.7% | 18.3% |
| Mount Forest → Mount Forest | 7,557 | 42.8% | 16.9% | 17.7% |
| Egbert → Mount Forest | 7,554 | 39.7% | 16.9% | 17.9% |
| Mount Forest → Egbert | 7,752 | 36.2% | 13.7% | 18.3% |

In the cross-station rows, the **target gauge's current dry observation** is
used as a filter. That information would not be available to our station from
its disconnected rain sensor; these are retrospective comparisons, not a
ready-to-run model. Neither reference gauge is a Shelburne ground-truth label.

Mount Forest's >2 hPa dry-now success ratio was 42.1% in 2020–2023, 52.1% in
2024, and 42.8% in 2025. This second-station analysis was added after reviewing
the first Egbert results and is therefore exploratory; it is not a fresh
pre-registered trial. `mount-forest-results.json` contains its complete splits.

At Egbert in 2025, grouping that calendar year's months by season, >2 hPa
dry-now success ratios varied from 25.0% in summer
(only 28 signal hours) to 40.7% in autumn. Sample size and correlated hours
make these weak seasonal estimates. `results.json` contains all splits, raw
counts and exploratory day-block bootstrap results; `regional-results.json`
contains cross-station and all-weather comparisons.

### Rain already occurring changes the answer

Including wet and dry hours in 2025, Egbert's baseline outcome rate rises from
13.7% to 20.3%, and the >2 hPa ratio rises from 33.3% to 48.7%. That includes
cases where precipitation was already occurring and may continue. It is **not**
evidence that the rule predicts rain onset with 48.7% accuracy. At Mount Forest
the analogous all-weather ratio is 57.2%, versus a 25.1% baseline. The current
station does not have an operational rain gauge to provide the dry-now filter.

A post-hoc humidity check combined >2 hPa pressure fall with ≥80% relative
humidity. In dry-now 2025 hours it had success ratios of 43.9% at Egbert and
52.8% at Mount Forest, but captured only 7.7% and 8.1% of outcome hours,
respectively. In all-weather hours the ratios rose to 68.1% and 74.3%, again
including ongoing precipitation. The thresholds were not optimized or validated
as a forecast, and the installed sensor's humidity exposure needs validation.
See `humidity-results.json`.

An additional post-hoc sensitivity check changes only the six-hour gauge
amount. For Egbert in 2025, dry now, the >2 hPa signal was followed by ≥2 mm
in 11.0% of signal hours and ≥5 mm in 3.1%. For Mount Forest the corresponding
figures were 18.9% and 4.9%. Larger-amount events are rarer and uncertain. A
rainfall amount is **not a storm label**; these numbers do not measure severe
storm prediction. See `precipitation-results.json`.

## Confidence and product design

Distinguish two separate questions:

1. **Measurement quality:** is the reported pressure change supported by recent,
   consistent observations from the local BME280? Show the change and time
   period, and decline to rate it if measurements are stale, missing, reset,
   implausible, or too sparse. A stable-looking signal is not a guarantee that
   the sensor is accurate. Coverage and gap thresholds need validation on the
   actual station; no arbitrary quality score should be displayed as a
   probability.
2. **Weather-outcome confidence:** how often does a specified event happen at a
   specified place within a specified horizon when this rule says it will?
   This requires measured calibration, separate chronological holdouts,
   reliability checks, enough distinct events, and evaluation of both false
   alarms and misses against simple baselines. We do not yet have this for the
   Shelburne site. The Egbert conditional ratios are not a public storm chance.

Example safe presentation: “Pressure fell 2.2 hPa over the past 3 hours. Falling
pressure can accompany changing weather.” For missing/stale data: “Pressure
trend unavailable.” Link to official ECCC forecasts and alerts with clear source
and update time. Do not imply the absence of a pressure alert means safety; do
not display “storm approaching”, “all clear”, guaranteed outcomes, or invented
confidence percentages.

## Next validation steps

1. Keep the installed BME280 running in its final sheltered outdoor location.
   Measure its true elevation and verify pressure against an appropriate
   reference. Compare like-for-like pressure products and timestamps: Egbert's
   251 m raw station pressure cannot be directly compared with Shelburne's
   roughly 500 m raw station pressure. Compare changes first; a locally recorded
   fixed offset alone does not validate sea-level pressure.
2. Quantify local sensor uptime, gaps, startup transients, noise, drift and
   agreement between same-time three-hour changes and both official reference
   stations. Preserve raw data, and don't tune to a single day or one storm.
3. Define explicit labels for distinct outcomes: precipitation over a stated
   amount/horizon, wind event, thunderstorm, or an official warning. A rain
   gauge, local radar or carefully matched official observations/alerts may be
   needed. Missing observations remain unknown; use the official timestamp,
   affected area, alert lifecycle and provenance. The Canadian Disaster Database
   covers selected major disasters, not every missed or ordinary storm.
4. Preselect candidate rules and no-signal baselines; split chronologically by
   whole weather systems or blocked periods, including unseen years and seasons.
   Evaluate false alarms, misses, lead time, reliability and sample size with
   uncertainty, and compare against a simple no-signal/climatology baseline.
   Evaluate the increment above a forecast already available from ECCC, not
   merely association with weather. Do not make a local claim until prospective
   observations support it.
5. If an official-alert integration is later built, preserve agency attribution,
   geographic matching, issue/expiry/cancellation times and feed freshness;
   show “unavailable” rather than “no alerts” when retrieval fails. This is a
   separate feature and has not been implemented by this research.

## Reproduce

Python 3, standard library only. From this directory:

```sh
python3 fetch_eccc.py               # downloads 144 public monthly CSVs
python3 quality_check.py            # coverage summary
python3 analyze.py                  # Egbert split, thresholds and uncertainty
python3 analyze.py mount-forest     # Same thresholds at the second station
python3 regional_check.py           # 2025 regional cross-check
python3 humidity_probe.py           # post-hoc humidity comparison
python3 precipitation_sensitivity.py # post-hoc outcome sensitivity
python3 -m unittest -v test_analysis.py
```

Raw cached data can be removed and redownloaded. ECCC may revise historical
records, so a later download may not match the committed checksum manifest or
these numbers. Scripts have no connection to the production database and do not
change site settings or station firmware.
