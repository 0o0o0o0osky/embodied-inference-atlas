import copy
import unittest
from pathlib import Path

from extractors.pi0_kernel_pairs import build_kernel_pair_bundle
from tools.lib.site import load_validated_datasets
from tools.lib.contracts import validate_document, load_manifest
from tools.lib.profiler_privacy import scan_profiler_bundle
from tools.lib.privacy import scan_json
from tools.lib.roofline import roofline_problems

ROOT = Path(__file__).resolve().parents[1]


class Pi0KernelPairsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.datasets = load_validated_datasets(ROOT / 'data', ROOT)

    def test_exact_shapes_stay_in_ten_windows_with_modeled_bytes_and_no_attainment(self):
        windows = [(f'pi0_steady_{i:02d}', i * 1000000, (i + 1) * 1000000) for i in range(10)]
        shapes = [(16384, 304, 2048), (2048, 304, 16384), (4304, 256, 1152)]
        payload = {'workload': {'views': 1, 'prompt_tokens': 48, 'action_chunk': 50,
                              'denoising_steps': 10, 'warmup_predictions': 5, 'measured_predictions': 10}, 'groups': []}
        for g, (m, n, k) in enumerate(shapes):
            payload['groups'].append({'shape': {'m': m, 'n': n, 'k': k, 'at': 14, 'bt': 14, 'ct': 0, 'compute': 68},
                'work_flop_per_launch': 2*m*n*k, 'modeled_compulsory_bytes_per_launch': 2*m*k+2*k*n+4*m*n,
                'launches': [{'iteration': name, 'start': start+g*10000, 'end': start+g*10000+1000+i,
                    'duration_ns': 1000+i, 'nodes_in_cublas_call': 1, 'streamId': 14,
                    'globalPid': 'private', 'graphNodeId': 123456} for i, (name, start, end) in enumerate(windows)]})
        result = build_kernel_pair_bundle(payload, windows, self.datasets, tool_version='2025.3.2.367', logical_cpu_count=14)
        records = result['datasets']
        self.assertEqual(len(records['timelines']), 10)
        self.assertEqual(len(records['roofline_points']), 30)
        for point in records['roofline_points']:
            self.assertEqual(point['traffic']['value_kind'], 'modeled')
            self.assertIsNone(point['derived']['efficiency'])
            self.assertIsNone(point['derived']['gap'])
            self.assertGreater(point['derived']['achieved_flop_per_second'], 0)
            self.assertIn(point['entity']['entity_id'], {o['observation_id'] for o in records['kernel_observations']})
        self.assertEqual(records['roofline_points'][0]['timing']['observed_second'], 1000 / 1e9)
        self.assertEqual(records['kernel_signatures'][0]['precision_path']['input_dtype_class'], 'bf16')
        self.assertEqual(scan_json(result), [])
        self.assertEqual(scan_profiler_bundle(result), [])
        self.assertNotIn('private', str(result))
        self.assertNotIn('graphNodeId', str(result))
        for name, items in records.items():
            version = '2.0.0' if name.startswith('roofline_') else '1.0.0'
            self.assertEqual(validate_document(name, {'schema_version':version, 'dataset':name, 'records':items}, ROOT), [], name)
        combined = copy.deepcopy(self.datasets)
        for name, items in records.items():
            primary = load_manifest(ROOT)['datasets'][name]['primary_key']
            keyed = {item[primary]:item for item in combined[name]}
            keyed.update({item[primary]:item for item in items})
            combined[name] = list(keyed.values())
        self.assertEqual(roofline_problems(combined), [])
        next(point for point in combined['roofline_points'] if point['point_id'] == records['roofline_points'][0]['point_id'])['traffic']['value_kind'] = 'measured'
        self.assertIn('kernel_traffic', {issue.code for issue in roofline_problems(combined)})
