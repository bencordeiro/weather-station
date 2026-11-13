#!/usr/bin/env python3
"""Fetch public ECCC hourly observations; cache is deliberately not committed."""
import csv
import datetime
import hashlib
import io
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
URL = 'https://climate.weather.gc.ca/climate_data/bulk_data_e.html'
STATIONS = {'egbert': ('27604', '611E001'), 'mount-forest': ('7844', '6145504')}

def download(period):
    station, year, month = period
    station_id, climate_id = STATIONS[station]
    path = DATA / f'{station}-{year}-{month:02d}.csv'
    query = urllib.parse.urlencode({'format': 'csv', 'stationID': station_id, 'Year': year,
                                    'Month': month, 'Day': 1, 'timeframe': 1,
                                    'submit': 'Download Data'})
    if path.exists():
        content = path.read_bytes()
    else:
        for attempt in range(3):
            try:
                request = urllib.request.Request(URL + '?' + query, headers={'User-Agent': 'ShelburneWeatherResearch/1.0'})
                with urllib.request.urlopen(request, timeout=45) as response:
                    content = response.read()
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
    rows = list(csv.DictReader(io.StringIO(content.decode('utf-8-sig'))))
    if not rows or any(row.get('Climate ID') != climate_id for row in rows):
        raise ValueError(f'Unexpected or missing station in {station} {year}-{month:02d}')
    if any(not row.get('Date/Time (LST)', '').startswith(f'{year}-{month:02d}') for row in rows):
        raise ValueError(f'Unexpected dates in {year}-{month:02d}')
    if not path.exists():
        path.write_bytes(content)
    return len(rows)

if __name__ == '__main__':
    DATA.mkdir(exist_ok=True)
    periods = [(station, year, month) for station in STATIONS for year in range(2020, 2026) for month in range(1, 13)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(download, period): period for period in periods}
        for index, job in enumerate(as_completed(jobs), 1):
            station, y, m = jobs[job]
            print(f'{index}/{len(periods)}: {station} {y}-{m:02d}: {job.result()} rows', flush=True)
    manifest = {'generated_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'station_ids': STATIONS, 'months': {}}
    for path in sorted(DATA.glob('*.csv')):
        manifest['months'][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    (HERE / 'data-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
