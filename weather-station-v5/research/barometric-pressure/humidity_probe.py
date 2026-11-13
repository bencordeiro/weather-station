#!/usr/bin/env python3
"""Exploratory comparison of fixed humidity and pressure rules on matched cases."""
import csv
import datetime as dt
import json
from pathlib import Path
from analyze import DATA, load, cases_for, parse_number, summarize

output = {'description': 'Exploratory, post-hoc fixed thresholds; not a validated forecast.', 'stations': {}}
for station in ('egbert', 'mount-forest'):
    rows = load(station)
    humidity = {}
    for path in sorted(DATA.glob(f'{station}-*.csv')):
        with path.open(encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                humidity[dt.datetime.strptime(row['Date/Time (LST)'], '%Y-%m-%d %H:%M')] = parse_number(row, 'Rel Hum (%)', 'Rel Hum Flag')
    output['stations'][station] = {}
    for year in (2024, 2025):
        output['stations'][station][str(year)] = {}
        for dry in (True, False):
            group = 'dry_now' if dry else 'all_current_conditions'
            cases = [c for c in cases_for(rows, year, year, require_dry=dry) if humidity.get(c[0]) is not None]
            cases_by_rule = {
                'pressure_fall_gt_2': [(t, -1 if delta < -20 else 0, event) for t, delta, event in cases],
                'humidity_at_least_80': [(t, -1 if humidity[t] >= 80 else 0, event) for t, delta, event in cases],
                'both': [(t, -1 if delta < -20 and humidity[t] >= 80 else 0, event) for t, delta, event in cases],
            }
            result = {key: summarize(value, 0) for key, value in cases_by_rule.items()}
            output['stations'][station][str(year)][group] = result
            for name, item in result.items():
                print(f"{station} {year} {group} {name}: n={item['evaluated_hours']} baseline={item['event_rate']:.1%} signals={item['signal_hours']} precision={item['precision']:.1%} recall={item['recall']:.1%}")
Path(__file__).with_name('humidity-results.json').write_text(json.dumps(output, indent=2) + '\n')
