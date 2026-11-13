import datetime as dt
import unittest
from analyze import cases_for, parse_number, summarize

class ResearchAnalysisTest(unittest.TestCase):
    def test_missing_or_flagged_observations_are_not_valid_zeroes(self):
        self.assertIsNone(parse_number({'p': '', 'flag': 'M'}, 'p', 'flag'))
        self.assertIsNone(parse_number({'p': None, 'flag': None}, 'p', 'flag'))
        self.assertEqual(parse_number({'p': '0.0', 'flag': ''}, 'p', 'flag'), 0)

    def test_case_needs_dry_current_hour_and_complete_future(self):
        start = dt.datetime(2025, 1, 1)
        rows = {start + dt.timedelta(hours=i): (10000 - 10*i, 0.0) for i in range(24)}
        rows[start + dt.timedelta(hours=9)] = (9910, 0.2)
        cases = {t: (delta, event) for t, delta, event in cases_for(rows, 2025, 2025)}
        self.assertEqual(cases[start + dt.timedelta(hours=3)], (-30, True))
        self.assertNotIn(start + dt.timedelta(hours=9), cases)
        rows[start + dt.timedelta(hours=8)] = (9920, None)
        cases = {t: (delta, event) for t, delta, event in cases_for(rows, 2025, 2025)}
        self.assertNotIn(start + dt.timedelta(hours=3), cases)
        cases = {t: (delta, event) for t, delta, event in cases_for(rows, 2025, 2025, require_dry=False)}
        self.assertIn(start + dt.timedelta(hours=9), cases)

    def test_confusion_counts_distinguish_false_alarms_and_misses(self):
        t = dt.datetime(2025, 1, 1)
        cases = [(t, -30, True), (t, -30, False), (t, 0, True), (t, 0, False)]
        result = summarize(cases, 20)
        self.assertEqual((result['true_positives'], result['false_positives'], result['false_negatives']), (1, 1, 1))
        self.assertEqual(result['precision'], 0.5)
        self.assertEqual(result['recall'], 0.5)

if __name__ == '__main__': unittest.main()
