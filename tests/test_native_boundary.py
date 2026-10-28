import copy
from dataclasses import replace
import unittest
from research.document_processing.contract import Context,canonical,digest
from research.document_processing.native_boundary import build_envelope,cite_envelope

class NativeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.original=b'FICTIONAL adapter fixture, not parser execution'
        self.context=Context('tenant','case','evidence','authority',1,digest(self.original),'source-time','received-time')
        self.runtime={'tool_version':'test','tool_revision':'a'*40,'image_sha256':'b'*64,'wheel_inventory_sha256':'c'*64}
        self.data={'pages':{str(p):{'page_no':p,'size':{'width':100,'height':100}} for p in (1,2)},'texts':[
            {'self_ref':'#/texts/0','text':'Fictional café','prov':[{'page_no':2,'charspan':[0,14],'bbox':{'l':1,'r':90,'b':1,'t':90,'coord_origin':'BOTTOMLEFT'}}]}]}
        self.data['texts'][0]['prov'][0]['charspan']=[0,len(self.data['texts'][0]['text'])]
    def build(self,**kwargs):
        args={'worker_context':self.context,'runtime':self.runtime,'successful':True};args.update(kwargs)
        return build_envelope(self.original,canonical(self.data),self.context,**args)
    def cite(self,record):
        ref=record['extraction']['references'][0]
        return cite_envelope(record,self.original,canonical(self.data),self.context,runtime=self.runtime,item_ref=ref['item_ref'],start_byte=ref['start_byte'],end_byte=ref['end_byte'],quote=self.data['texts'][0]['text'])
    def test_unicode_citation_preserves_missing_page_warning(self):
        record=self.build();citation=self.cite(record)
        self.assertEqual(citation['page'],2)
        self.assertEqual(citation['coverage']['pagesWithoutText'],[1])
        self.assertEqual(citation['state'],'unreviewed_derivative_citation')
        self.assertEqual(citation['end_byte'],len('Fictional café'.encode()))
        self.assertEqual(record,self.build())
    def test_scope_and_partial_result_denied(self):
        for field,value in [('tenant_id','other'),('case_id','other'),('evidence_id','other'),('authority_id','other'),('authority_version',2)]:
            with self.assertRaises(ValueError):self.build(worker_context=replace(self.context,**{field:value}))
        with self.assertRaises(ValueError):self.build(successful=False)
    def test_page_identity_dimensions_and_off_page_boxes_denied(self):
        original=copy.deepcopy(self.data)
        for change in [lambda d:d['pages'].pop('1'),lambda d:d['pages']['2'].update(page_no=True),lambda d:d['pages']['2']['size'].update(width=0),lambda d:d['texts'][0]['prov'][0].update(page_no=3),lambda d:d['texts'][0]['prov'][0]['bbox'].update(r=101)]:
            self.data=copy.deepcopy(original);change(self.data)
            with self.assertRaises(ValueError):self.build()
    def test_runtime_and_envelope_tampering_denied(self):
        for field in ['image_sha256','wheel_inventory_sha256']:
            record=self.build();old=self.runtime[field];self.runtime[field]='d'*64
            with self.assertRaises(ValueError):self.cite(record)
            self.runtime[field]=old
        for field,value in [('reviewState','approved'),('coverage',{}),('envelope_sha256','f'*64)]:
            record=self.build();record[field]=value
            with self.assertRaises(ValueError):self.cite(record)
        with self.assertRaises(ValueError):self.build(runtime={})
    def test_duplicate_json_and_size_rejected(self):
        for raw in [b'{"pages":{},"pages":{}}',b'x'*2000001]:
            with self.assertRaises(ValueError):build_envelope(self.original,raw,self.context,worker_context=self.context,runtime=self.runtime,successful=True)
