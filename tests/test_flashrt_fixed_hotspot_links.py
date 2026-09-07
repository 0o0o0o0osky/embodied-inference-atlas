import copy
import unittest
from pathlib import Path
from unittest.mock import patch
from extractors.flashrt_fixed_hotspot_links import hotspot_bundle, signature_digest, CLASSES, PREFIX, CAPTURE
from tools.lib.site import load_validated_datasets
from tools.lib.runtime_realization import runtime_realization_problems

class FlashrtFixedHotspotLinksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=load_validated_datasets(Path('data'),Path.cwd())
        # Real retained event populations; synthetic symbols keep raw names out of fixtures.
        cls.manifest=[dict(kernel_signature_id=PREFIX+name,symbol='audited-'+suffix,
            launch=next(o['launch'] for o in cls.data['kernel_observations'] if o['capture_id']==CAPTURE and o['kernel_signature_id']==PREFIX+name)) for suffix,(name,_,_) in CLASSES.items()]
        cls.digests={s['kernel_signature_id'].split('-')[-1]:signature_digest(s) for s in cls.manifest}

    def test_real_population_maps_three_classes_without_splitting_shared_time(self):
        with patch('extractors.flashrt_fixed_hotspot_links.AUDITED_DIGESTS',self.digests):
            bundle=hotspot_bundle(self.data,self.manifest)
        self.assertEqual(set(bundle['datasets']),{'runtime_realizations','operator_kernel_links'})
        links=bundle['datasets']['operator_kernel_links']
        self.assertEqual([x['coverage']['mapped_launches'] for x in links],[17,180,360])
        shared=links[-1]
        self.assertEqual(shared['execution_group_ids'],['action-attention-output','action-down-projection'])
        self.assertEqual(len(shared['logical_targets']),2)
        record=bundle['datasets']['runtime_realizations'][0]
        previous=next(r for r in self.data['runtime_realizations'] if r['runtime_id']=='flashrt')
        self.assertTrue(all(g in record['execution_groups'] for g in previous['execution_groups']))
        graph=next(g for g in self.data['model_graphs'] if g['model_graph_id']==record['model_graph_id'])
        self.assertEqual(runtime_realization_problems(record,graph),[])

    def test_rejects_changed_order_or_launch_identity(self):
        modified=copy.deepcopy(self.data)
        timeline=next(t for t in modified['timelines'] if t['capture_id']==CAPTURE)
        e=next(e for e in timeline['events'] if e.get('kernel_signature_id')==PREFIX+'geglu-fp8-044')
        e['kernel_signature_id']=PREFIX+'geglu-fp8-028'
        with patch('extractors.flashrt_fixed_hotspot_links.AUDITED_DIGESTS',self.digests):
            with self.assertRaisesRegex(ValueError,'invocation population'):hotspot_bundle(modified,self.manifest)
            manifest=copy.deepcopy(self.manifest);manifest[0]['launch']['grid']=[1,1,1]
            with self.assertRaisesRegex(ValueError,'symbol/resource'):hotspot_bundle(self.data,manifest)
