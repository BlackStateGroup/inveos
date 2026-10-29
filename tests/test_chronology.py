import copy
import unittest
from tools.verify_report import verify_chronology


def uid(n):
    return '00000000-0000-4000-8000-%012d' % n


def fixture():
    return {'case': {'id': uid(1)}, 'findings': [{'id': uid(2)}], 'documentFindings': [{'id': uid(3)}],
            'investigation': {'status': 'working_context_not_findings', 'chronology': [{
                'id': uid(4), 'caseId': uid(1), 'title': 'Fictional account', 'account': 'A source alleges an event; truth is unestablished.',
                'status': 'disputed', 'source': {'kind': 'document_finding', 'findingId': uid(3)},
                'time': {'precision': 'month', 'start': '2026-10', 'end': None, 'timezone': '', 'note': 'Only the month was stated.'},
                'version': 2, 'createdBy': uid(5), 'createdAt': '2026-10-29T00:00:00.000Z',
                'recordedAt': '2026-10-29T01:00:00.000Z', 'interpretation': 'recorded_account_not_finding'}]}}


class ChronologyTests(unittest.TestCase):
    def test_preserves_calendar_and_unknown_precision(self):
        data = fixture()
        before = copy.deepcopy(data)
        self.assertEqual(verify_chronology(data), 1)
        self.assertEqual(data, before)
        data['investigation']['chronology'][0]['time'].update(precision='unknown', start=None)
        self.assertEqual(verify_chronology(data), 1)

    def test_both_source_families_and_legacy(self):
        data = fixture()
        data['investigation']['chronology'][0]['source'] = {'kind': 'text_finding', 'findingId': uid(2)}
        self.assertEqual(verify_chronology(data), 1)
        del data['investigation']['chronology']
        self.assertEqual(verify_chronology(data), 0)

    def test_rejects_cross_case_missing_mistyped_and_duplicate_sources(self):
        for key, value in [('caseId', uid(8)), ('source', {'kind': 'text_finding', 'findingId': uid(3)}),
                           ('source', {'kind': 'document_finding', 'findingId': uid(8)}), ('version', True),
                           ('interpretation', 'reviewed_finding')]:
            data = fixture()
            data['investigation']['chronology'][0][key] = value
            with self.assertRaises(ValueError):
                verify_chronology(data)
        data = fixture()
        data['investigation']['chronology'] *= 2
        with self.assertRaises(ValueError):
            verify_chronology(data)

    def test_rejects_impossible_dates_and_unknown_offsets(self):
        for precision, start, end in [('day', '2026-02-29', None), ('month', '2026-13', None),
                ('unknown', '2026-01', None), ('instant', '2026-10-25T01:00:00-00:00', None),
                ('instant', '2026-10-25T01:00:00+14:01', None), ('instant', '2026-10-25T24:00:00Z', None),
                ('range', '2026-10-25T01:00:00Z', '2026-10-25T01:30:00+01:00')]:
            data = fixture()
            data['investigation']['chronology'][0]['time'].update(precision=precision, start=start, end=end)
            with self.assertRaises(ValueError):
                verify_chronology(data)

    def test_range_compares_instants_without_rewriting_offsets(self):
        data = fixture()
        data['investigation']['chronology'][0]['time'].update(precision='range', start='2026-10-25T01:30:00+01:00', end='2026-10-25T01:00:00Z')
        self.assertEqual(verify_chronology(data), 1)
