from copy import deepcopy
from pathlib import Path
import unittest
from extractors.pi0_system_flow import describe
from tools.lib.contracts import validate_document
from tools.lib.jsonio import load_json
from tools.lib.runtime_realization import runtime_realization_problems

ROOT=Path(__file__).resolve().parents[1]

class SystemFlowTests(unittest.TestCase):
    def setUp(self):
        self.document=load_json(ROOT/'data/runtime_realizations/pi0.json')
        self.graph=load_json(ROOT/'data/model_graphs/pi0.json')['records'][0]

    def test_audited_flows_are_small_idempotent_and_preserve_stack_boundaries(self):
        original=deepcopy(self.document)
        records=[describe(r) for r in self.document['records']]
        self.assertEqual(self.document,original)
        self.assertEqual(validate_document('runtime_realizations',{**self.document,'records':records},ROOT),[])
        for record in records:
            self.assertEqual(describe(record),record)
            self.assertEqual(runtime_realization_problems(record,self.graph),[])
            flow=record['system_flow']
            self.assertEqual(flow['semantics'],'qualitative_order')
            self.assertEqual(len(flow['nodes']),7)
            self.assertEqual([n['step'] for n in flow['nodes']],list(range(7)))
            if record['runtime_id']=='flashrt':
                self.assertEqual([g['kind'] for g in flow['groups']],['cuda_graph','cuda_graph','repeat'])
                self.assertTrue(any(e['from']=='vision' and e['to']=='prefix' and e['kind']=='data' for e in flow['edges']))
                self.assertFalse(any(e['from']=='vision' and e['to']=='submit' for e in flow['edges']))
                self.assertTrue(any(e['from']=='prepare' and e['to']=='submit' and e['kind']=='control' for e in flow['edges']))
                self.assertIn('不在此分支归一化',flow['nodes'][1]['operation'])
            else:
                self.assertEqual(flow['nodes'][3]['lane'],'cpu')
                self.assertIn('回读',flow['nodes'][3]['operation'])
                self.assertEqual([e['label'] for e in flow['edges'][:6]],['原始图像','像素上传','视觉 embedding 回读','多模态输入上传','逐层 K/V','动作下载'])
                self.assertEqual([g['kind'] for g in flow['groups']],['backend_graph','backend_graph','repeat'])

    def test_flow_rejects_broken_references_and_misleading_device_boundaries(self):
        base=describe(next(r for r in self.document['records'] if 'q8-0' in r['realization_id']))
        changes=[
            (lambda f:f['nodes'][0].update(evidence_ids=['missing']), 'broken_reference'),
            (lambda f:f['nodes'][0].update(evidence_ids=[]), 'system_flow_evidence'),
            (lambda f:f['edges'][0].update(to='missing'), 'broken_reference'),
            (lambda f:f['edges'][0].update(**{'from':'action','to':'input'}), 'system_flow_order'),
            (lambda f:f['groups'][0].update(node_ids=['missing']), 'broken_reference'),
            (lambda f:f['groups'][0].update(node_ids=['prepare']), 'system_flow_graph_lane'),
            (lambda f:f['groups'][0].update(kind='cuda_graph'), 'system_flow_cuda_graph'),
        ]
        for change,code in changes:
            with self.subTest(code=code):
                record=deepcopy(base);change(record['system_flow'])
                self.assertIn(code,{i.code for i in runtime_realization_problems(record,self.graph)})
        bad=deepcopy(base);bad['system_flow']['nodes'][0]['step']=13
        self.assertTrue(validate_document('runtime_realizations',{**self.document,'records':[bad]},ROOT))
