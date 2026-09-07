import copy
from pathlib import Path
import unittest
from extractors.flashrt_gate_up_links import gate_up_bundle, SIGNATURE, CAPTURE
from tools.lib.site import load_validated_datasets
from tools.lib.runtime_realization import runtime_realization_problems


class FlashrtGateUpLinksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_validated_datasets(Path('data'), Path.cwd())
        cls.timeline = next(t for t in cls.data['timelines'] if t['capture_id'] == CAPTURE)
        events = sorted((e for e in cls.timeline['events'] if e['event_kind'] == 'kernel'), key=lambda e:e['start_ns'])
        cls.sequence = [dict(layer_index=i, event_id=e['event_id'],
            previous_event_id=events[events.index(e)-1]['event_id'], next_event_id=events[events.index(e)+1]['event_id'])
            for i,e in enumerate(e for e in events if e['kernel_signature_id'] == SIGNATURE)]

    def test_links_only_merged_linear_projections_and_preserves_timings(self):
        result = gate_up_bundle(self.data, self.sequence)['datasets']
        self.assertEqual(set(result), {'runtime_realizations', 'operator_kernel_links'})
        link = result['operator_kernel_links'][0]
        self.assertEqual(link['execution_group_ids'], ['prefix-merged-gate-up'])
        self.assertEqual([t['ref'].split('/')[-1] for t in link['logical_targets']], ['gate-projection', 'up-projection'])
        self.assertEqual(link['coverage']['mapped_launches'], 17)
        self.assertEqual(link['logical_targets'][0]['repeat_selectors'][0]['indices'], list(range(17)))
        record = result['runtime_realizations'][0]
        precision = next(p for p in record['precision_paths'] if p['precision_path_id']=='flashrt-gate-up-fp8-fp16')
        self.assertEqual(precision['output_dtype'], 'fp16')
        graph = next(g for g in self.data['model_graphs'] if g['model_graph_id'] == record['model_graph_id'])
        self.assertEqual(runtime_realization_problems(record, graph), [])

    def test_rejects_reordered_events_and_a_different_workload(self):
        sequence = copy.deepcopy(self.sequence)
        sequence[0]['event_id'], sequence[1]['event_id'] = sequence[1]['event_id'], sequence[0]['event_id']
        with self.assertRaisesRegex(ValueError, 'sequence'):
            gate_up_bundle(self.data, sequence)
        data = copy.deepcopy(self.data)
        next(r for r in data['runs'] if r['run_id'] == self.timeline['run_id'])['workload']['vla']['action_chunk'] = 50
        with self.assertRaisesRegex(ValueError, 'workload'):
            gate_up_bundle(data, self.sequence)
