# Pressure interpretation: implementation and validation plan

The regional study did not establish a near-certain storm predictor. This plan
separates observations from any future weather-outcome prediction and official
alerts. See [the research report](README.md) for methods, results and limitations.

## Implemented: observed trend and coverage

- Compare the current BME280 station pressure to the closest valid reading near
  three hours earlier, retaining the existing ±0.5 hPa display heuristic. Show
  the actual change and elapsed time rather than a storm probability.
- Inspect stored observations between the two endpoints. Mark reporting as
  limited if a BME pressure reading failed, fewer than two valid samples exist,
  or the gap between valid samples or at a boundary exceeds 15 minutes. The
  15-minute boundary is an engineering choice, not a calibrated confidence
  threshold. Sample count and largest gap make that choice inspectable.
- Suppress weather interpretation for limited coverage and stale/offline data.
  Identify missing current sensor pressure separately from insufficient history.
  A consistent time series does not prove sensor accuracy or weather outcomes.
- Provide conditional context for rising or falling pressure, without claiming
  a storm is imminent or that steady pressure guarantees fair weather. Link to
  the Environment Canada forecast and alerts. The link is not an alert feed.
- Exercise missing, intermittent and stale data, the public API, and the sample
  preview. Keep raw stored observations unchanged.

## Next: evaluate the installed station

1. Install the BME280 in its final outdoor location and verify station elevation,
   sensor ventilation, power-up behavior, and clock. Save enough continuous
   data across different weather, seasons and outages to assess real performance.
2. Compare simultaneous changes—not raw absolute pressure values—with ECCC
   Egbert and Mount Forest data. The sites differ in elevation and experience
   different local weather. Investigate calibration offset, sensor temperature
   effects, gaps, unusual steps, and drift before trusting changes.
3. Decide and document what constitutes an acceptable coverage rule and test it
   against observed outages and sample intervals. Record false good-coverage and
   false limited-coverage cases; avoid a quality percentage without evidence.

## Before publishing any prediction

Define a specific observable event and horizon, such as a measured rainfall
amount in a fixed number of hours, and a source that can provide ground truth
near Shelburne. The station currently lacks working wind and rain instruments;
missing readings cannot be assumed to mean calm or dry conditions.

Evaluate pressure plus any additional variables against simple baseline
forecasts and the official forecast available at the time. Keep candidate
selection separate from a chronological, independent holdout. Account for
overlapping windows and weather systems; examine false alarms, missed events,
lead time, seasonal variation, calibration and uncertainty. Run prospectively
before making public claims. Do not label an empirical precipitation proxy a
storm warning, and do not claim an event is guaranteed or impossible.

## Optional: official alerts as a separate feature

If requested, investigate Environment Canada's official alert feed for the
correct area and show attribution, issue time, expiry, cancellations and feed
freshness. On a failed or stale fetch, show that alerts are unavailable rather
than “no alerts.” A local pressure trend must not be promoted to an official
watch or warning. The present implementation links to the official page and
does not fetch, store, or independently issue alerts.
