"""Original synthetic adapter fixtures, not output from an executed upstream parser."""
import copy
from dataclasses import replace
import json
import unittest
from research.document_processing.contract import Context, digest, normalise_docling, verify_citation


class DocumentContractTests(unittest.TestCase):
    def setUp(self):
        self.original = b'SYNTHETIC original placeholder, not a PDF or parser benchmark.'
        self.context = Context('tenant-fiction', 'case-fiction', 'evidence-fiction',
            'authority-fiction', 1, digest(self.original), '2026-10-25T10:00:00Z', '2026-10-27T10:00:00Z')
        self.data = {'texts': [self.item(0, 'Fictional Café £42 🧪', 1),
                               self.item(1, 'Fictional Café £42 🧪', 2),
                               self.item(2, 'Fictício: São Vicente. مراجعة', 3)]}
        self.config = {'pipeline': 'synthetic-contract-fixture', 'ocr': False}

    def item(self, n, text, page):
        return {'self_ref': f'#/texts/{n}', 'text': text, 'prov': [{'page_no': page,
            'charspan': [0, len(text)], 'bbox': {'l': 1, 't': 2, 'r': 100, 'b': 20, 'coord_origin': 'TOPLEFT'}}]}

    def raw(self):
        return json.dumps(self.data, ensure_ascii=False).encode()

    def build(self, **kwargs):
        args = dict(worker_context=self.context, tool_version='synthetic-fixture',
                    tool_revision='90234a71b16785d08fd2f46ec62668dd2396db76', configuration=self.config)
        args.update(kwargs)
        return normalise_docling(self.original, self.raw(), self.context, **args)

    def cite(self, record, **kwargs):
        r = record['references'][1]
        args = dict(item_ref=r['item_ref'], start_byte=r['start_byte'], end_byte=r['end_byte'], quote=self.data['texts'][1]['text'])
        args.update(kwargs)
        return verify_citation(record, self.original, self.raw(), self.context, self.config, **args)

    def test_deterministic_and_preserves_source_times(self):
        a = self.build()
        self.assertEqual(a, self.build())
        self.assertEqual(a['context']['source_time'], self.context.source_time)
        self.assertNotEqual(a['context']['source_time'], a['context']['received_time'])
        self.assertEqual(a['state'], 'unreviewed_derivative')

    def test_repeated_quote_selects_second_page(self):
        a = self.build()
        c = self.cite(a)
        self.assertEqual(c['page'], 2)
        self.assertEqual(c['state'], 'unreviewed_derivative_citation')
        self.assertGreater(c['end_byte'] - c['start_byte'], len(c['quote']))

    def test_scope_and_authority_mismatch(self):
        for key, value in [('tenant_id', 'other'), ('case_id', 'other'), ('evidence_id', 'other'), ('authority_version', 2)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.build(worker_context=replace(self.context, **{key: value}))

    def test_original_tamper(self):
        self.original += b'x'
        with self.assertRaises(ValueError): self.build()

    def test_derivative_tamper(self):
        a = self.build(); a['text'] += 'x'
        with self.assertRaises(ValueError): self.cite(a)

    def test_raw_provenance_tamper(self):
        a = self.build(); self.data['texts'][1]['prov'][0]['page_no'] = 9
        with self.assertRaises(ValueError): self.cite(a)

    def test_config_changes_identity(self):
        a = self.build(); self.config['ocr'] = True
        self.assertNotEqual(a['extraction_id'], self.build()['extraction_id'])
        with self.assertRaises(ValueError): self.cite(a)

    def test_bad_quotes_and_cross_item_span(self):
        a = self.build()
        for args in [{'quote': 'invented'}, {'start_byte': -1}, {'end_byte': 9999}, {'item_ref': '#/texts/0'}, {'quote': ''}, {'start_byte': True}]:
            with self.subTest(args=args), self.assertRaises(ValueError): self.cite(a, **args)

    def test_missing_page_and_partial_spans(self):
        for field, value in [('page_no', None), ('page_no', 0), ('charspan', [0, 1])]:
            original = copy.deepcopy(self.data)
            self.data['texts'][0]['prov'][0][field] = value
            with self.assertRaises(ValueError): self.build()
            self.data = original

    def test_missing_and_multiple_provenance(self):
        for p in [[], self.data['texts'][0]['prov'] * 2]:
            self.data['texts'][0]['prov'] = p
            with self.assertRaises(ValueError): self.build()

    def test_invalid_boxes(self):
        for field, value in [('coord_origin', 'unknown'), ('r', 0), ('t', float('nan')), ('b', -1)]:
            old = copy.deepcopy(self.data)
            self.data['texts'][0]['prov'][0]['bbox'][field] = value
            with self.assertRaises(ValueError): self.build()
            self.data = old

    def test_duplicate_items(self):
        self.data['texts'].append(self.data['texts'][0])
        with self.assertRaises(ValueError): self.build()

    def test_limits(self):
        self.data['texts'] = self.data['texts'] * 1000
        with self.assertRaises(ValueError): self.build()
        self.original = b'x' * 2_000_001
        with self.assertRaises(ValueError): self.build()

    def test_empty_and_malformed_results(self):
        for data in [{'texts': []}, {}, []]:
            self.data = data
            with self.assertRaises(ValueError): self.build()

    def test_bottom_left_coordinates(self):
        for item in self.data['texts']:
            item['prov'][0]['bbox'].update(t=20, b=2, coord_origin='BOTTOMLEFT')
        self.assertEqual(self.cite(self.build())['bbox']['coord_origin'], 'BOTTOMLEFT')


if __name__ == '__main__': unittest.main()
