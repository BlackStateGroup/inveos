"""Independent frozen reasoning checks; these are not parser or human-review evidence."""
import copy
import unittest
from tools.verify_document_package import verify_document_work_links
from tools.verify_report import InvalidReport


def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'


def report():
    return {'case': {'id': uid(1)}, 'documentFindings': [{'id': uid(2)}], 'investigation': {
        'status': 'working_context_not_findings', 'objectives': [], 'hypotheses': [], 'blockers': [],
        'questions': [{'id': uid(3), 'caseId': uid(1)}], 'documentLinks': [{
            'id': uid(4), 'caseId': uid(1), 'itemId': uid(3), 'kind': 'document_finding', 'findingId': uid(2),
            'relation': 'contradicts', 'reason': 'Fictional older record differs; ownership change remains possible.',
            'createdBy': uid(5), 'createdAt': '2026-10-29T12:00:00.000Z'}]}}


class DocumentWorkLinks(unittest.TestCase):
    def test_current_and_historical_contracts(self):
        data = report()
        self.assertEqual(verify_document_work_links(data), 1)
        del data['investigation']['documentLinks']
        self.assertEqual(verify_document_work_links(data), 0)

    def test_foreign_or_missing_bindings_and_invalid_relations_fail(self):
        for key, value in [('caseId', uid(9)), ('itemId', uid(9)), ('findingId', uid(9)), ('kind', 'claim'),
                           ('relation', 'proves'), ('reason', ' '), ('reason', 'x\x00y'), ('createdAt', 'yesterday')]:
            data = report()
            data['investigation']['documentLinks'][0][key] = value
            with self.subTest(key=key), self.assertRaises(InvalidReport):
                verify_document_work_links(data)

    def test_duplicates_unverified_fields_and_scope_fail(self):
        data = report()
        data['investigation']['documentLinks'].append(copy.deepcopy(data['investigation']['documentLinks'][0]))
        with self.assertRaises(InvalidReport):
            verify_document_work_links(data)
        data = report()
        data['investigation']['documentLinks'][0]['withdrawal'] = {'reason': 'Unsupported claim'}
        with self.assertRaises(InvalidReport):
            verify_document_work_links(data)
        data = report()
        data['investigation']['questions'][0]['caseId'] = uid(9)
        with self.assertRaises(InvalidReport):
            verify_document_work_links(data)
