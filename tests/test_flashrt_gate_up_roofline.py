import copy
import json
from pathlib import Path
import unittest
from extractors.flashrt_gate_up_roofline import build_bundle, CAPTURE, SIGNATURE

class FlashrtGateRooflineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root=Path(__file__).resolve().parents[1]
        paths={'runs':'measurements','timelines':'profiler','kernel_observations':'profiler','roofline_scenarios':'analysis','roofline_bases':'analysis','roofline_points':'analysis','roofline_ceilings':'analysis'}
        cls.data={name:json.loads((root/'data'/directory/(name+'.json')).read_text())['records']for name,directory in paths.items()}
        t=next(t for t in cls.data['timelines']if t['capture_id']==CAPTURE)
        events=sorted([e for e in t['events']if e.get('kernel_signature_id')==SIGNATURE],key=lambda e:e['start_ns'])
        cls.data['runtime_realizations']=json.loads((root/'data/runtime_realizations/pi0.json').read_text())['records']
        cls.audit=dict(revision='054bea4d02ebc63f6a0c45991c6061b1e1caa46c',signature_id=SIGNATURE,capture_id=CAPTURE,shape={'M':304,'N':32768,'K':2048},event_sequence=events,duration_sum_ns=sum(e['duration_ns']for e in events),launch=events[0]['launch'])

    def test_real_nsys_pair_recomputes_and_does_not_claim_matched_attainment(self):
        before=copy.deepcopy(self.data);b=build_bundle(self.data,self.audit)['datasets'];p=b['roofline_points'][0]
        self.assertEqual(p['work']['total_flop'],2*304*32768*2048*17)
        self.assertEqual(p['traffic']['total_byte'],(304*2048+32768*2048+2*304*32768)*17)
        self.assertEqual(p['timing']['observed_second'],.007515808)
        self.assertEqual(p['calls'],17)
        self.assertIsNone(p['derived']['efficiency']);self.assertIsNone(p['derived']['gap'])
        self.assertIn('same-window-shape',p['entity']['coverage_key'])
        self.assertEqual(b['roofline_scenarios'][0]['precision_path']['segments'][0]['output']['format'],'fp16')
        self.assertEqual(b['roofline_scenarios'][0]['precision_path']['segments'][0]['selector'],{'kind':'execution_groups','refs':['prefix-merged-gate-up']})
        self.assertEqual(b['roofline_scenarios'][0]['workload']['action_horizon'],10)
        self.assertEqual(self.data,before)

    def test_wrong_shape_or_event_sequence_rejected(self):
        for wrong in [dict(self.audit,shape={'M':560,'N':32768,'K':2048}),dict(self.audit,event_sequence=self.audit['event_sequence'][:-1])]:
            with self.assertRaises(ValueError):build_bundle(self.data,wrong)

if __name__=='__main__':unittest.main()
