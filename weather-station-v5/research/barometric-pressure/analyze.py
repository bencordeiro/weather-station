#!/usr/bin/env python3
"""Exploratory pressure/precipitation evaluation using ECCC hourly CSV files.

The 2020–2023 / 2024 / 2025 split, 6h outcome, and thresholds were fixed
before reviewing results. This is a station proxy study, not a storm forecast.
"""
import csv
import datetime as dt
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
SPLITS = {'development': (2020, 2023), 'validation': (2024, 2024), 'holdout': (2025, 2025)}
RULES = {'fall_gt_0.5': 5, 'fall_gt_1': 10, 'fall_gt_2': 20, 'fall_gt_3': 30, 'fall_gt_5': 50}

def parse_number(row, name, flag):
    if row.get(flag) is None or row.get(name) is None or row[flag].strip() or not row[name].strip():
        return None
    try:
        return float(row[name])
    except ValueError:
        return None

def load(station='egbert'):
    rows = {}
    climate_id = {'egbert': '611E001', 'mount-forest': '6145504'}[station]
    files = sorted(DATA.glob(f'{station}-*.csv'))
    if len(files) != 72:
        raise ValueError(f'Expected 72 monthly files; found {len(files)}. Run fetch_eccc.py.')
    for path in files:
        with path.open(encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                if row['Climate ID'] != climate_id:
                    raise ValueError('Wrong climate station')
                stamp = dt.datetime.strptime(row['Date/Time (LST)'], '%Y-%m-%d %H:%M')
                if stamp in rows:
                    raise ValueError(f'Duplicate observation {stamp}')
                p = parse_number(row, 'Stn Press (kPa)', 'Stn Press Flag')
                rain = parse_number(row, 'Precip. Amount (mm)', 'Precip. Amount Flag')
                rows[stamp] = (None if p is None else round(p * 100), rain)
    return rows

def cases_for(rows, first, last, outcomes=None, require_dry=True, min_precip_tenths=2):
    hour = dt.timedelta(hours=1)
    outcomes = rows if outcomes is None else outcomes
    first_ts, end_ts = dt.datetime(first,1,1), dt.datetime(last+1,1,1)
    cases=[]
    for t, (pressure, _) in sorted(rows.items()):
        if not (first_ts <= t-3*hour and t+6*hour < end_ts):
            continue
        previous = rows.get(t-3*hour)
        current_outcome = outcomes.get(t)
        rain = None if current_outcome is None else current_outcome[1]
        future = [outcomes.get(t+n*hour) for n in range(1,7)]
        if pressure is None or previous is None or previous[0] is None:
            continue
        if require_dry and (rain is None or rain != 0):
            continue
        if any(item is None or item[1] is None for item in future):
            continue
        # Pressures are integer tenths of hPa to avoid floating threshold errors.
        future_rain = sum(round(item[1]*10) for item in future)
        cases.append((t, pressure - previous[0], future_rain >= min_precip_tenths))
    return cases

def summarize(cases, cutoff):
    positives = [x for x in cases if x[1] < -cutoff]
    events = sum(x[2] for x in cases)
    tp = sum(x[2] for x in positives)
    fp = len(positives) - tp
    neg = len(cases) - events
    return {'evaluated_hours': len(cases), 'event_hours': events, 'signal_hours': len(positives),
            'true_positives': tp, 'false_positives': fp, 'false_negatives': events-tp,
            'event_rate': events/len(cases) if cases else None,
            'precision': tp/len(positives) if positives else None,
            'false_discovery_rate': fp/len(positives) if positives else None,
            'recall': tp/events if events else None,
            'false_positive_rate': fp/neg if neg else None}

def bootstrap_precision(cases, cutoff, rounds=1000):
    days = defaultdict(list)
    for item in cases:
        days[item[0].date()].append(item)
    buckets=list(days.values()); rng=random.Random(22418); estimates=[]
    if not buckets: return None
    for _ in range(rounds):
        tp=fp=0
        for _ in buckets:
            bucket=buckets[rng.randrange(len(buckets))]
            for _, delta, event in bucket:
                if delta < -cutoff:
                    tp += bool(event); fp += not event
        if tp+fp: estimates.append(tp/(tp+fp))
    estimates.sort()
    return [estimates[int((len(estimates)-1)*.025)], estimates[int((len(estimates)-1)*.975)]] if estimates else None

def main():
    station = sys.argv[1] if len(sys.argv) > 1 else 'egbert'
    metadata = {'egbert': ('EGBERT CS', '611E001', 27604), 'mount-forest': ('MOUNT FOREST (AUT)', '6145504', 7844)}
    if station not in metadata:
        raise ValueError('Choose egbert or mount-forest')
    station_name, climate_id, station_id = metadata[station]
    rows=load(station)
    output={'station':station_name, 'climate_id':climate_id, 'station_id':station_id,
            'years':[2020,2025], 'source_rows':len(rows),
            'outcome':'At least 0.2 mm recorded in next six hourly periods, conditional on current hourly precipitation being zero.',
            'clock':'ECCC Local Standard Time, without daylight-saving conversion',
            'signals':'Three-hour station pressure fall strictly greater than stated hPa.', 'splits':{}}
    for label,(first,last) in SPLITS.items():
        cases=cases_for(rows,first,last)
        rules={name:summarize(cases,cutoff) for name,cutoff in RULES.items()}
        if label=='holdout':
            for name,cutoff in RULES.items(): rules[name]['daily_block_bootstrap_precision_95pct']=bootstrap_precision(cases,cutoff)
        output['splits'][label]={'years':[first,last], 'rules':rules}
    output['holdout_seasons']={}
    holdout=cases_for(rows,2025,2025)
    for season,months in {'winter':[12,1,2], 'spring':[3,4,5], 'summer':[6,7,8], 'fall':[9,10,11]}.items():
        selected=[x for x in holdout if x[0].month in months]
        output['holdout_seasons'][season]=summarize(selected,20)
    path=HERE/('results.json' if station == 'egbert' else f'{station}-results.json'); path.write_text(json.dumps(output,indent=2)+'\n')
    for split,info in output['splits'].items():
        print(split)
        for name,rule in info['rules'].items():
            def pct(x): return f'{100*x:.1f}%' if x is not None else 'n/a'
            print(f"  {name}: n={rule['evaluated_hours']}, event baseline={pct(rule['event_rate'])}, signal={rule['signal_hours']}, precision={pct(rule['precision'])}, recall={pct(rule['recall'])}, FPR={pct(rule['false_positive_rate'])}")
    print('Saved',path)

if __name__ == '__main__': main()
