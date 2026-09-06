from copy import deepcopy
from pathlib import Path
import unittest
from extractors.pi0_instance_realization import CLASSES, REALIZATION, extend_down_projections, verify_shapes
from tools.lib.jsonio import load_json
from tools.lib.runtime_realization import runtime_realization_problems

ROOT=Path(__file__).resolve().parents[1]
class DownProjectionLinksTests(unittest.TestCase):
    def test_links_preserve_instance_and_distinguish_source_shape_from_replay_order(self):
        record=next(r for r in load_json(ROOT/'data/runtime_realizations/pi0.json')['records'] if r['realization_id']==REALIZATION)
        observations=load_json(ROOT/'data/profiler/kernel_observations.json')['records']
        enriched,links=extend_down_projections(record,observations)
        self.assertEqual(enriched['reuse'],record['reuse'])
        self.assertEqual(enriched['system_flow'],record['system_flow'])
        self.assertEqual(extend_down_projections(enriched,observations),(enriched,links))
        graph=load_json(ROOT/'data/model_graphs/pi0.json')['records'][0]
        self.assertEqual(runtime_realization_problems(enriched,graph),[])
        native=[link for link in links if link['status']=='resolved']
        replay=[link for link in links if link['status']=='partial']
        self.assertEqual(sorted(link['coverage']['population_launches'] for link in native),[17,180])
        self.assertEqual(len(replay),2)
        self.assertTrue(all(link['mapping_method']=='geometry_and_order' and link['confidence']=='medium' for link in replay))
        prefix=next(g for g in enriched['execution_groups'] if g['execution_group_id']=='prefix-mlp-down')
        self.assertEqual(prefix['repeat_selectors'][0]['indices'],list(range(17)))
        self.assertTrue(all(link['logical_targets'][0]['ref'].endswith('/down-projection') for link in links))
        for flag in ['same_input_order_association', 'work_id_unavailable']:
            with self.subTest(missing_flag=flag):
                missing_flag=deepcopy(observations)
                replay_observation=next(o for o in missing_flag if o['observation_kind']=='ncu_replayed_launch' and '2048x304x16384' in o['kernel_signature_id'])
                replay_observation['quality'].remove(flag)
                with self.assertRaisesRegex(ValueError,'order association'):
                    extend_down_projections(record,missing_flag)
        bad=deepcopy(observations)
        next(o for o in bad if o['capture_id']=='capture-pi0-vla-cpp-nsys-node-021' and o['calls']==17 and '2048x304x16384' in o['kernel_signature_id'])['calls']=18
        with self.assertRaisesRegex(ValueError,'population'):extend_down_projections(record,bad)

    def test_shape_audit_requires_actual_cublas_precision_and_separate_window_counts(self):
        groups=[dict(shape=dict(zip(('m','n','k'),shape),at=14,bt=14,ct=0,compute=68),
            per_iteration_counts={str(i):calls for i in range(10)},calls_node_counts=[1]) for _,_,_,shape,calls in CLASSES]
        verify_shapes(groups)
        groups[0]['shape']['ct']=14
        with self.assertRaisesRegex(ValueError,'FP32'):verify_shapes(groups)
