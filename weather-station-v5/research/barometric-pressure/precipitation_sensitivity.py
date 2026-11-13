#!/usr/bin/env python3
"""Explore how a pressure rule behaves for different precipitation amounts."""
import json
from pathlib import Path
from analyze import load, cases_for, summarize

output = {'note': 'Exploratory post-hoc sensitivity; rainfall amount is not a storm label.', 'stations': {}}
for station in ('egbert', 'mount-forest'):
    rows = load(station)
    output['stations'][station] = {}
    for dry in (True, False):
        group = 'dry_now' if dry else 'all_current_conditions'
        output['stations'][station][group] = {}
        for tenths in (2, 20, 50, 100):
            cases = cases_for(rows, 2025, 2025, require_dry=dry, min_precip_tenths=tenths)
            stats = summarize(cases, 20)
            output['stations'][station][group][str(tenths / 10)] = stats
            if stats['precision'] is not None and stats['recall'] is not None:
                print(f"{station} {group} >= {tenths/10:g} mm: base={stats['event_rate']:.1%}, precision={stats['precision']:.1%}, recall={stats['recall']:.1%}, signal={stats['signal_hours']}")
Path(__file__).with_name('precipitation-results.json').write_text(json.dumps(output, indent=2) + '\n')
