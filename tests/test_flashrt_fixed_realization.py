import copy
import json
from pathlib import Path
import unittest
from extractors.flashrt_fixed_realization import extend_fixed_geglu, SYMBOL
from tools.lib.runtime_realization import runtime_realization_problems
from tools.lib.site import load_validated_datasets

class FlashrtFixedRealizationTest(unittest.TestCase):
    def test_split_launch_classes_preserve_legacy_shared_evidence(self):
        data=load_validated_datasets(Path('data'),Path.cwd())
        record=next(r for r in data['runtime_realizations'] if r['runtime_id']=='flashrt')
        before=copy.deepcopy(record)
        manifest=[]; observations=[]
        for i,(grid,calls) in enumerate([(4864,17),(44,180)]):
            launch=dict(grid=[grid,1,1],block=[256,1,1],registers_per_thread=21,static_shared_memory_bytes=0,dynamic_shared_memory_bytes=0,waves_per_sm=None)
            manifest.append(dict(symbol=SYMBOL,kernel_signature_id=f'sig-{i}',launch=launch))
            observations.append(dict(capture_id='capture-test',run_id='run-test',observation_id=f'kernel-observation-test-{i:03d}',kernel_signature_id=f'sig-{i}',launch=launch,calls=calls))
        result,links=extend_fixed_geglu(record,manifest,observations,'capture-test',['cfg-test'])
        self.assertEqual(record,before)
        self.assertEqual([l['execution_group_ids'] for l in links],[['prefix-geglu-fp8'],['action-geglu-fp8']])
        self.assertEqual([l['coverage']['mapped_launches'] for l in links],[17,180])
        for old in before['execution_groups']:
            new=next(g for g in result['execution_groups'] if g['execution_group_id']==old['execution_group_id'])
            self.assertTrue(set(old['kernel_signature_ids']).issubset(new['kernel_signature_ids']))
        graph=next(g for g in data['model_graphs'] if g['model_graph_id']==result['model_graph_id'])
        self.assertEqual(runtime_realization_problems(result,graph),[])
        observations[1]['calls']=17
        with self.assertRaisesRegex(ValueError,'population'):extend_fixed_geglu(record,manifest,observations,'capture-test',[])
