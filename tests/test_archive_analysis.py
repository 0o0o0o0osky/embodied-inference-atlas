import json
import tempfile
import unittest
from pathlib import Path

from tools.archive_analysis import apply_archive, make_plan


class ArchiveAnalysisTests(unittest.TestCase):
    def test_review_plan_is_readonly_and_apply_backs_up_exact_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'data/sample.json'
            path.parent.mkdir()
            original = b'{"records": [{"id": "old"}, {"id": "kept"}]}\n'
            path.write_bytes(original)
            selected = {'data/sample.json': b'{"records":[{"id":"kept"}]}\n'}
            plan = make_plan(root, selected, {'kept_capture_ids': ['kept']})
            self.assertEqual(path.read_bytes(), original)
            archive = apply_archive(root, plan)
            self.assertEqual((archive / 'data/sample.json').read_bytes(), original)
            self.assertEqual(path.read_bytes(), selected['data/sample.json'])
            manifest = json.loads((archive / 'manifest.json').read_text())
            self.assertEqual(manifest['selection']['kept_capture_ids'], ['kept'])
            self.assertEqual(manifest['changes'][0]['before_bytes'], len(original))

    def test_stale_plan_refuses_all_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'data/sample.json'
            path.parent.mkdir()
            path.write_bytes(b'original')
            plan = make_plan(root, {'data/sample.json': b'new'}, {})
            path.write_bytes(b'concurrent edit')
            with self.assertRaisesRegex(ValueError, 'changed since'):
                apply_archive(root, plan)
            self.assertEqual(path.read_bytes(), b'concurrent edit')


class RepresentativeSelectionTests(unittest.TestCase):
    def test_singleton_stability_summary_requires_matching_identity_and_stable_metrics(self):
        from copy import deepcopy
        from tools.lib.profiler import profiler_semantic_issues
        capture = {
            'capture_id': 'capture-021', 'run_id': 'run-021', 'source_id': 'source',
            'tool': 'nsys', 'evidence': 'measured_local', 'nsys': {'report_mode': 'node'},
            'coverage': {'is_complete_for_population': True},
            'analysis_sample': {'batch_id': 'batch', 'input_case_id': 'case',
                'sample_index': 0, 'measured_iterations': 10, 'warmup_iterations': 5},
            'analysis_summary': {'batch_id': 'batch', 'input_case_id': 'case',
                'status': 'stable', 'representative_capture_id': 'capture-021',
                'sample_count': 10, 'warmup_iterations': 5,
                'wall': {'median_ns': 100, 'cv': .02},
                'hotspots': [{'id': 'gemm', 'median_ns': 20, 'cv': .01,
                              'calls': 2, 'counts_match': True}]},
        }
        run = {'run_id': 'run-021', 'capture_method': 'nsys',
               'evidence': 'measured_local', 'source_id': 'source'}
        def check(value):
            return [issue for issue in profiler_semantic_issues({
                'runs': [run], 'profiler_captures': [value]})
                if issue.code == 'analysis_summary_stability']
        self.assertEqual(check(capture), [])
        for field, value in [('representative_capture_id', 'capture-022'),
                             ('batch_id', 'other-batch'), ('input_case_id', 'other-input')]:
            with self.subTest(field=field):
                changed = deepcopy(capture)
                changed['analysis_summary'][field] = value
                self.assertEqual(len(check(changed)), 1)
        for field in ['wall', 'hotspot']:
            with self.subTest(cv=field):
                changed = deepcopy(capture)
                target = (changed['analysis_summary']['wall'] if field == 'wall'
                          else changed['analysis_summary']['hotspots'][0])
                target['cv'] = .051
                self.assertEqual(len(check(changed)), 1)

    def test_batch_representative_preserves_actual_events_and_rejects_instability(self):
        from tools.lib.representative_data import _batch_summary
        captures, timelines = [], {}
        for index in range(10):
            capture_id = f'capture-{index}'
            captures.append({'capture_id': capture_id, 'analysis_sample': {
                'batch_id': 'batch', 'input_case_id': 'case', 'sample_index': index,
                'warmup_iterations': 5, 'measured_iterations': 10},
                'coverage': {'is_complete_for_population': True}})
            timelines[capture_id] = {'window': {'start_ns': 0, 'duration_ns': 100 + index},
                'summaries': [], 'events': [{'event_kind': 'kernel', 'kernel_signature_id': 'gemm',
                    'start_ns': 0, 'duration_ns': 20, 'count': 2}]}
        summary = _batch_summary(captures, timelines, {'gemm': {'function_family': 'gemm'}})
        self.assertEqual(summary['representative_capture_id'], 'capture-4')
        self.assertEqual(summary['sample_count'], 10)
        self.assertEqual(summary['wall']['median_ns'], 104.5)
        self.assertEqual(summary['hotspots'][0]['calls'], 2)
        self.assertIsNone(summary['system_medians']['cpu_core_time_ns'])
        self.assertIsNone(_batch_summary(captures[:-1], timelines, {'gemm': {'function_family': 'gemm'}}))
        captures[0]['coverage']['is_complete_for_population'] = False
        self.assertIsNone(_batch_summary(captures, timelines, {'gemm': {'function_family': 'gemm'}}))
        captures[0]['coverage']['is_complete_for_population'] = True
        timelines['capture-0']['events'][0]['count'] = 3
        self.assertIsNone(_batch_summary(captures, timelines, {'gemm': {'function_family': 'gemm'}}))

    def test_snapshot_policy_requires_bf16_and_complete_any_populated_basis(self):
        from unittest.mock import patch
        from tools.lib.roofline_materialize import logical_snapshot_problems
        scenarios = [{'scenario_id': precision, 'origin': 'default_precomputed',
            'modeling_scope': 'ideal_analytical', 'precision_path': {'precision_path_id': precision}}
            for precision in ['bf16_dense', 'fp16_dense']]
        bases = [{'basis_id': s['scenario_id'], 'scenario_id': s['scenario_id']} for s in scenarios]
        def point(precision, index):
            return {'point_id': f'{precision}-{index}', 'basis_id': precision,
                'traffic': {'components': [], 'total_byte': 0}, 'entity': {'coverage_key': 'same'}}
        expected = [point(s['scenario_id'], i) for s in scenarios for i in range(2)]
        data = {'roofline_scenarios': scenarios, 'roofline_bases': bases,
                'roofline_points': expected[:2]}
        with patch('tools.lib.roofline_materialize.logical_points', return_value=expected):
            self.assertEqual(logical_snapshot_problems(data), [])
            data['roofline_points'] = expected[:1]
            self.assertEqual([p.code for p in logical_snapshot_problems(data)], ['logical_snapshot_missing'])
            data['roofline_points'] = expected[:3]
            self.assertEqual([p.code for p in logical_snapshot_problems(data)], ['logical_snapshot_missing'])
            data['roofline_points'] = list(expected)
            self.assertEqual(logical_snapshot_problems(data), [])
            data['roofline_points'][-1] = {**expected[-1], 'traffic': {'components': [], 'total_byte': 7}}
            self.assertEqual([p.code for p in logical_snapshot_problems(data)], ['scenario_traffic_mismatch'])

    def test_one_capture_per_case_preserves_all_selected_events_and_samples(self):
        from tools.lib.representative_data import select_representative_data
        captures, timelines, runs = [], [], []
        for index, mode in enumerate(['graph', 'node'], 1):
            run_id, capture_id = f'run-{index}', f'capture-{index}'
            runs.append({'run_id': run_id, 'configuration_id': f'config-{index}',
                'model_id': 'pi0', 'runtime_id': 'stack', 'device_id': 'thor',
                'model_artifact_id': 'artifact', 'precision': {'activation': 'bf16'},
                'workload': {'views': 1}})
            captures.append({'capture_id': capture_id, 'run_id': run_id, 'tool': 'nsys',
                'nsys': {'report_mode': mode}, 'coverage': {'is_complete_for_population': True}})
            timelines.append({'capture_id': capture_id, 'events': [
                {'kernel_signature_id': 'gemm', 'event_kind': 'kernel', 'duration_ns': 12}],
                'cpu_samples': [{'instruction': 'source-backed'}]})
        data = {name: [] for name in ['kernel_signatures', 'kernel_observations',
            'profiler_metrics', 'telemetry', 'operator_kernel_links', 'roofline_bases',
            'roofline_points', 'roofline_scenarios', 'runtime_realizations']}
        data.update(runs=runs, profiler_captures=captures, timelines=timelines)
        selected, report = select_representative_data(data)
        self.assertEqual(report['kept_capture_ids'], ['capture-2'])
        self.assertEqual(selected['timelines'], [timelines[1]])
        self.assertEqual(selected['runs'], [runs[1]])
        self.assertNotIn('analysis_summary', selected['profiler_captures'][0])
        self.assertEqual(len(data['timelines']), 2)
        again, _ = select_representative_data(selected)
        self.assertEqual(again, selected)
        selected['profiler_captures'][0]['analysis_summary'] = {
            'status': 'stable', 'representative_capture_id': 'capture-2',
            'sample_count': 10, 'wall': {'median_ns': 100, 'cv': .01}}
        again, _ = select_representative_data(selected)
        self.assertEqual(again, selected)
        self.assertEqual(again['profiler_captures'][0]['analysis_summary']['sample_count'], 10)

    def test_only_stable_retained_singleton_may_keep_original_ordinal(self):
        from tools.lib.profiler_privacy import _scan_generated_ids
        run = {'run_id': 'run-pi0-stack-nsys-node-021',
            'configuration_id': 'config-pi0-stack-nsys-node-021', 'model_id': 'pi0', 'runtime_id': 'stack'}
        capture = {'capture_id': 'capture-pi0-stack-nsys-node-021', 'run_id': run['run_id'],
            'tool': 'nsys', 'nsys': {'report_mode': 'node', 'scheduler_scope': 'process_tree'}}
        data = {'profiler_captures': [capture]}
        check = lambda: _scan_generated_ids(data, [(0, run)], allow_partial_run_sequence=False)
        self.assertTrue(any(i.path.endswith('.run_id') for i in check()))
        capture['analysis_summary'] = {'status': 'stable', 'representative_capture_id': capture['capture_id']}
        self.assertEqual(check(), [])
        run['configuration_id'] = 'config-pi0-stack-nsys-node-999'
        self.assertTrue(any(i.path.endswith('.configuration_id') for i in check()))
