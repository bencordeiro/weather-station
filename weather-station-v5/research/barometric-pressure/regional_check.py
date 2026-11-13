#!/usr/bin/env python3
"""Check 2025 at a second station and across stations using the fixed rules."""
import json
from pathlib import Path
from analyze import load, cases_for, summarize, RULES

egbert = load('egbert')
mount = load('mount-forest')
comparisons = {
    'egbert_to_egbert': (egbert, egbert),
    'mount_forest_to_mount_forest': (mount, mount),
    'egbert_to_mount_forest': (egbert, mount),
    'mount_forest_to_egbert': (mount, egbert),
}
result = {'period': '2025', 'outcome': 'At least 0.2 mm in next six hours.', 'comparisons': {}}
for require_dry in (True, False):
    group = 'dry_now' if require_dry else 'all_current_conditions'
    result['comparisons'][group] = {}
    for name, (pressure, outcome) in comparisons.items():
        cases = cases_for(pressure, 2025, 2025, outcomes=outcome, require_dry=require_dry)
        data = {key: summarize(cases, cutoff) for key, cutoff in RULES.items()}
        result['comparisons'][group][name] = data
        item = data['fall_gt_2']
        print(f"{group} {name}: n={item['evaluated_hours']} baseline={item['event_rate']:.1%} signals={item['signal_hours']} precision={item['precision']:.1%} recall={item['recall']:.1%}")
Path(__file__).with_name('regional-results.json').write_text(json.dumps(result, indent=2) + '\n')
