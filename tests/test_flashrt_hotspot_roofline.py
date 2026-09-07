import copy
import unittest
from pathlib import Path
from unittest.mock import patch
from extractors.flashrt_hotspot_roofline import build_bundle
from extractors.flashrt_fixed_hotspot_links import CLASSES,PREFIX,CAPTURE,signature_digest
from tools.lib.site import load_validated_datasets

class FlashrtHotspotRooflineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=load_validated_datasets(Path('data'),Path.cwd())
        cls.manifest=[dict(kernel_signature_id=PREFIX+name,symbol='audited-'+suffix,launch=next(o['launch'] for o in cls.data['kernel_observations'] if o['capture_id']==CAPTURE and o['kernel_signature_id']==PREFIX+name)) for suffix,(name,_,_) in CLASSES.items()]
        cls.digests={s['kernel_signature_id'].split('-')[-1]:signature_digest(s) for s in cls.manifest}
    def test_two_homogeneous_populations_keep_nsys_time_and_modeled_bytes(self):
        with patch('extractors.flashrt_fixed_hotspot_links.AUDITED_DIGESTS',self.digests):
            bundle=build_bundle(self.data,self.manifest)['datasets']
        self.assertEqual(set(bundle),{'roofline_scenarios','roofline_bases','roofline_points'})
        for p,shape,calls,ns in zip(bundle['roofline_points'],[(304,2048,16384),(11,8192,1024)],[17,180],[3042144,6374464]):
            m,n,k=shape
            self.assertEqual(p['calls'],calls)
            self.assertEqual(p['work']['total_flop'],2*m*n*k*calls)
            self.assertEqual(p['traffic']['total_byte'],(m*k+n*k+2*m*n)*calls)
            self.assertEqual(p['timing']['observed_second'],ns/1e9)
            self.assertIn('same-window-shape',p['entity']['coverage_key'])
            self.assertIsNone(p['derived']['efficiency']);self.assertIsNone(p['derived']['gap'])
        self.assertEqual(bundle['roofline_scenarios'][1]['precision_path']['segments'][0]['selector']['refs'],['action-merged-gate-up'])
    def test_rejects_changed_trace_or_precision_evidence(self):
        bad=copy.deepcopy(self.data)
        realization=next(r for r in bad['runtime_realizations'] if r['runtime_id']=='flashrt')
        path=next(p for p in realization['precision_paths'] if p['precision_path_id']=='flashrt-fixed-fp8-gemm-fp32-fp16')
        path['output_dtype']='bf16'
        with patch('extractors.flashrt_fixed_hotspot_links.AUDITED_DIGESTS',self.digests):
            with self.assertRaisesRegex(ValueError,'precision'):build_bundle(bad,self.manifest)
if __name__=='__main__':unittest.main()
