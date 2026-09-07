import unittest
import json
from tools.lib.contracts import validate_document
from pathlib import Path
from extractors.pi0_realtime_realization import build_realization
from tools.lib.site import load_validated_datasets
from tools.lib.runtime_realization import runtime_realization_problems

class RealtimeRealizationTest(unittest.TestCase):
    def test_source_flow_has_true_graph_boundary_and_reuse(self):
        record, links = build_realization([], [])
        data = load_validated_datasets(Path('data'), Path.cwd())
        graph = next(g for g in data['model_graphs'] if g['model_graph_id'] == record['model_graph_id'])
        self.assertEqual(runtime_realization_problems(record, graph), [])
        wrapper = json.loads(Path('data/runtime_realizations/pi0.json').read_text())
        wrapper['records'] = [record]
        self.assertEqual(validate_document('runtime_realizations', wrapper, Path.cwd()), [])
        self.assertEqual(links, [])
        graph_nodes = next(g['node_ids'] for g in record['system_flow']['groups'] if g['kind'] == 'cuda_graph')
        self.assertEqual(graph_nodes, ['prompt', 'vision', 'prefix', 'action'])
        self.assertNotIn('upload', graph_nodes)
        self.assertNotIn('download', graph_nodes)
        self.assertEqual({r['reuse_id']: r['lifetime'] for r in record['reuse']}['prefix-kv'], 'observation')
        self.assertIsNone(record['precision_paths'][0]['accumulation_dtype'])
        self.assertEqual(record['precision_paths'][0]['precision_path_id'], 'bf16')
        self.assertEqual(record['precision_paths'][1]['precision_path_id'], 'bf16-fused-fp32-accumulation')

    def test_only_exact_decoder_symbols_link_current_capture(self):
        signatures = [dict(kernel_signature_id='sig-qkv', symbol='scaled_matmul_rope_qkv'), dict(kernel_signature_id='sig-shared', symbol='matmul_small_res'), dict(kernel_signature_id='sig-prefix', symbol='matmul_small_gate')]
        observations = [dict(capture_id='capture-test', kernel_signature_id='sig-qkv', observation_id='obs-test', run_id='run-test', calls=180), dict(capture_id='capture-test', kernel_signature_id='sig-prefix', observation_id='obs-prefix', run_id='run-test', calls=17)]
        record, links = build_realization(signatures, observations, capture_id='capture-test')
        groups = {g['execution_group_id']: g for g in record['execution_groups']}
        self.assertEqual(groups['action-qkv-rope']['kernel_signature_ids'], ['sig-qkv'])
        self.assertEqual(groups['action-gate-up']['kernel_signature_ids'], [])
        self.assertEqual(len(links), 2)
        self.assertEqual(groups['prefix-gate-up']['kernel_signature_ids'], ['sig-prefix'])
        self.assertEqual(groups['prefix-gate-up']['repeat_selectors'][0]['indices'], list(range(17)))
        links = [link for link in links if link['kernel_signature_id'] == 'sig-qkv']
        self.assertEqual(links[0]['coverage']['mapped_launches'], 180)
        self.assertEqual(links[0]['status'], 'resolved')
        self.assertEqual(build_realization(signatures, observations, capture_id='other')[1], [])
