#!/usr/bin/env python3
"""Summarize source coverage and numeric/flag exclusions by station and year."""
import csv
import json
from pathlib import Path
from analyze import DATA, parse_number

columns = {'pressure': ('Stn Press (kPa)', 'Stn Press Flag'),
           'precipitation': ('Precip. Amount (mm)', 'Precip. Amount Flag'),
           'relative_humidity': ('Rel Hum (%)', 'Rel Hum Flag')}
results = {}
for station in ('egbert', 'mount-forest'):
    results[station] = {}
    for year in range(2020, 2026):
        total = 0
        valid = {key: 0 for key in columns}
        for path in sorted(DATA.glob(f'{station}-{year}-*.csv')):
            with path.open(encoding='utf-8-sig', newline='') as f:
                for row in csv.DictReader(f):
                    total += 1
                    for key, (name, flag) in columns.items():
                        valid[key] += parse_number(row, name, flag) is not None
        results[station][str(year)] = {'source_rows': total, 'valid_unflagged': valid}
        print(station, year, 'hours', total, 'valid', valid)
Path(__file__).with_name('quality-results.json').write_text(json.dumps(results, indent=2) + '\n')
