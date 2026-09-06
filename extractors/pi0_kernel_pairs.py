"""Import the audited Pi0 GEMM handoff; never collect or modify inference code.

The handoff remains local. Only allowlisted shapes, relative intervals and
source-derived work/traffic enter staging. Every prediction stays separate.
"""
from __future__ import annotations

import argparse
import copy
import sqlite3
from pathlib import Path

from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.site import load_validated_datasets
from tools.lib.contracts import validate_document, load_manifest
from tools.lib.profiler_privacy import scan_profiler_bundle
from tools.lib.privacy import scan_json
from tools.lib.roofline import roofline_problems
from tools.lib.promotion import plan_promotion

LABEL = 'pi0-vla-cpp-nsys-node'
REALIZATION = 'rr-vla-cpp-pi0-thor-bf16-f32-v1'
SCENARIO = 'scenario-pi0-vlacpp-bf16-gemm-capture'
SHAPES = ((16384, 304, 2048), (2048, 304, 16384), (4304, 256, 1152))
CONDITION = ('Only three exact GEMM shapes; BF16 inputs and FP32 accumulation/output. '
             'Kernel boundary excludes conversion, other kernels, CPU and transfers. '
             'Nsys node-traced ordinary execution; not unprofiled timing or NCU replay. '
             'Conditional 120W/1.386GHz/273GB/s curve; no matched observed clocks or DRAM traffic.')


def _provenance(expression, *, measured=False):
    return {'evidence': 'measured_local' if measured else 'analytical',
            'class': 'measured_empirical' if measured else 'analytical_model',
            'source_ids': ['source-local-thor', 'source-vla-cpp'],
            'derivation': {'kind': 'formula', 'expression': expression,
                           'input_refs': ['ggml/src/ggml-cuda/ggml-cuda.cu#ggml_cuda_op_mul_mat_cublas']},
            'condition': CONDITION}


def _child(kind, ordinal, index):
    return f'{kind}-{LABEL}-{index:03d}' if ordinal == 1 else f'{kind}-{LABEL}_r{ordinal:03d}_{index:03d}'


def _union(events):
    end = total = 0
    for event in sorted(events, key=lambda item: item['start_ns']):
        right = event['start_ns'] + event['duration_ns']
        total += max(0, right - max(end, event['start_ns']))
        end = max(end, right)
    return total


def build_kernel_pair_bundle(payload, windows, datasets, *, tool_version, logical_cpu_count, all_bf16_shapes=False):
    expected = {'views': 1, 'prompt_tokens': 48, 'action_chunk': 50, 'denoising_steps': 10,
                'warmup_predictions': 5, 'measured_predictions': 10}
    if payload.get('workload') != expected or len(windows) != 10:
        raise ValueError('Expected the audited five-warmup, ten-prediction Pi0 workload')
    if [name for name, _, _ in windows] != [f'pi0_steady_{i:02d}' for i in range(10)]:
        raise ValueError('Prediction windows must preserve recorded order')
    groups = payload['groups']
    shapes = tuple(tuple(group['shape'][field] for field in ('m', 'n', 'k')) for group in groups) if all_bf16_shapes else SHAPES
    if [tuple(group['shape'][field] for field in ('m', 'n', 'k')) for group in groups] != list(shapes):
        raise ValueError('Only the three source-audited GEMM shapes are supported')
    for group, (m, n, k) in zip(groups, shapes):
        shape = group['shape']
        if tuple(shape[field] for field in ('at', 'bt', 'ct', 'compute')) != (14, 14, 0, 68):
            raise ValueError('Exact BF16 input and FP32 output/accumulation evidence is required')
        if group['work_flop_per_launch'] != 2*m*n*k or group['modeled_compulsory_bytes_per_launch'] != 2*m*k+2*k*n+4*m*n:
            raise ValueError('Work and compulsory tensor bytes do not recompute')
        if {launch['iteration'] for launch in group['launches']} != {name for name, _, _ in windows}:
            raise ValueError('All ten prediction windows must be represented')
    records = {name: [] for name in ('runs', 'profiler_captures', 'timelines', 'kernel_signatures',
                                    'kernel_observations', 'roofline_scenarios', 'roofline_bases', 'roofline_points')}
    template = next(run for run in datasets['runs'] if run['run_id'] == 'run-pi0-vlacpp-w5-r10-001')
    ceiling = next(item for item in datasets['roofline_ceilings'] if item['ceiling_id'] == 'thor-t5000-120w-1386mhz')
    compute = next(item['flop_per_second'] for item in ceiling['compute'] if item['compute_class'] == 'tensor_bf16_dense')
    bandwidth = ceiling['bandwidth'][0]
    scenario = copy.deepcopy(next(item for item in datasets['roofline_scenarios'] if item['scenario_id'] == 'scenario-pi0-bf16_dense-default'))
    scenario.update(scenario_id=SCENARIO, label='Pi0 native BF16 GEMM kernel boundary', origin='captured_kernel',
                    modeling_scope='implementation_modeled', model_artifact_id=template['model_artifact_id'],
                    missing=[], provenance=_provenance('exact cublasGemmEx shape labels linked through CUDA Graph node clone ancestry'))
    scenario['workload'].update(active_camera_views=1, executed_camera_views=1, semantic_prompt_tokens=48, public_action_dimension=32)
    scenario['precision_path'].update(runtime_support='proven', realization_ids=[REALIZATION])
    segment = scenario['precision_path']['segments'][0]
    segment['output'].update(format='fp32', bits_per_value=32)
    for encoding in ('weight', 'activation', 'output'):
        segment[encoding]['provenance'] = _provenance('cublasGemmEx CUDA_R_16BF A/B; CUDA_R_32F C; CUBLAS_COMPUTE_32F')
    records['roofline_scenarios'].append(scenario)
    for m, n, k in shapes:
        label = f'vlacpp BF16 GEMM {m}x{n}x{k}'
        records['kernel_signatures'].append({
            'kernel_signature_id': f'kernel-signature-pi0-vlacpp-bf16-gemm-{m}x{n}x{k}',
            'runtime_id': 'vla-cpp', 'model_id': 'pi0', 'label_sanitized': label,
            'function_family': 'gemm', 'implementation_family': 'nvjet',
            'precision_path': {'input_dtype_class': 'bf16', 'accumulator_dtype_class': 'fp32',
                               'output_dtype_class': 'fp32', 'sparsity': 'off', 'missing': {}},
            'classification_method': 'combined', 'classification_confidence': 'high', 'missing': {},
        })
    for ordinal, (name, start, end) in enumerate(windows, 1):
        if not isinstance(start, int) or not isinstance(end, int) or end <= start:
            raise ValueError('Invalid prediction window')
        run = copy.deepcopy(template)
        run.pop("analysis_batch", None)
        run.update(run_id=f'run-{LABEL}-{ordinal:03d}', configuration_id=f'config-{LABEL}-{ordinal:03d}', capture_method='nsys')
        # The post-capture 120W query is not in-window operating-point evidence.
        run['operating_point'] = {'operating_point_id': 'unknown', 'power_mode': None,
                                  'clock_policy': None, 'throttle_status': None}
        run['comparison_context']['platform']['operating_point_id'] = 'unknown'
        run['missing'] = {f'operating_point.{field}': 'not_collected' for field in ('power_mode', 'clock_policy', 'throttle_status')}
        records['runs'].append(run)
        capture_id = f'capture-{LABEL}-{ordinal:03d}'
        records['profiler_captures'].append({
            'capture_id': capture_id, 'run_id': run['run_id'], 'source_id': run['source_id'], 'evidence': 'measured_local',
            'tool': 'nsys', 'tool_version': tool_version, 'collection_scope': 'prediction_window',
            'target_window_label': 'predict', 'target_window_count': 1, 'selection_policy': 'single_predict_window',
            'coverage': {'population': 'one_profiled_prediction', 'observed_count': 1, 'is_complete_for_population': False},
            'warnings': ['intrusive_node_trace', 'partial_kernel_signature_coverage', 'gpu_frequency_not_fixed'],
            'nsys': {'report_mode': 'node', 'scheduler_scope': 'process_tree', 'logical_cpu_count': logical_cpu_count,
                     'cuda_graph_trace_present': False, 'graph_node_trace_present': True,
                     'scheduler_trace_present': False, 'profiler_overhead_trace_present': False},
            'ncu': None, 'missing': {'ncu': 'not_applicable'},
        })
        stream_ids = sorted({launch['streamId'] for group in groups for launch in group['launches'] if launch['iteration'] == name})
        lanes = [{'lane_id': f'lane-{i:03d}', 'kind': 'gpu_kernel', 'role': 'kernel-stream', 'ordinal': i-1, 'coverage': 'partial'}
                 for i in range(1, len(stream_ids)+1)]
        stream_lanes = dict(zip(stream_ids, lanes))
        events = []
        for index, (group, (m, n, k), signature) in enumerate(zip(groups, shapes, records['kernel_signatures']), 1):
            launches = [launch for launch in group['launches'] if launch['iteration'] == name]
            if not launches:
                raise ValueError('Missing selected shape in one prediction')
            for launch in launches:
                if launch['nodes_in_cublas_call'] != 1 or launch['end']-launch['start'] != launch['duration_ns']:
                    raise ValueError('Ambiguous graph node or inconsistent timing')
                if not (start <= launch['start'] < launch['end'] <= end):
                    raise ValueError('Selected launch not enclosed in its prediction')
                events.append({'event_id': f'event-{len(events)+1:05d}', 'lane_id': stream_lanes[launch['streamId']]['lane_id'],
                               'event_kind': 'kernel', 'label': 'kernel', 'start_ns': launch['start']-start,
                               'duration_ns': launch['duration_ns'], 'count': 1,
                               'kernel_signature_id': signature['kernel_signature_id'], 'bytes': None,
                               'copy_direction': None, 'evidence_semantics': 'exact_interval'})
            calls = len(launches)
            duration = sum(launch['duration_ns'] for launch in launches)
            observation_id = _child('kernel-observation', ordinal, index)
            launch_config = {}
            missing = {'duration_share': 'incomplete_population'}
            fields = {'grid': ('gridX', 'gridY', 'gridZ'), 'block': ('blockX', 'blockY', 'blockZ'),
                      'registers_per_thread': 'registersPerThread', 'static_shared_memory_bytes': 'staticSharedMemory',
                      'dynamic_shared_memory_bytes': 'dynamicSharedMemory', 'waves_per_sm': 'wavesPerSm'}
            for field, raw in fields.items():
                values = [tuple(launch.get(key) for key in raw) if isinstance(raw, tuple) else launch.get(raw) for launch in launches]
                known = all(value is not None and (not isinstance(value, tuple) or None not in value) for value in values)
                same = len(set(values)) == 1
                launch_config[field] = list(values[0]) if known and same and isinstance(values[0], tuple) else values[0] if known and same else None
                if launch_config[field] is None:
                    missing[f'launch.{field}'] = 'varies_across_population' if known and not same else 'not_collected'
            records['kernel_observations'].append({
                'observation_id': observation_id, 'capture_id': capture_id, 'run_id': run['run_id'], 'source_id': run['source_id'],
                'kernel_signature_id': signature['kernel_signature_id'], 'observation_kind': 'nsys_window_aggregate',
                'population': 'all_matching_launches_in_one_predict_window', 'calls': calls,
                'duration': {'statistic': 'sum', 'value_ns': duration, 'sample_count': calls},
                'launch': launch_config, 'duration_share': None, 'quality': ['intrusive_node_trace', 'gpu_frequency_not_fixed'], 'missing': missing,
            })
            basis_id = f'basis-pi0-vlacpp-gemm-{ordinal:03d}-{index:03d}'
            records['roofline_bases'].append({
                'schema_version': '2.0.0', 'basis_id': basis_id, 'label': f'BF16 GEMM {m}x{n}x{k}; window {ordinal}; kernel-boundary modeled traffic',
                'level': 'kernel', 'scenario_id': SCENARIO, 'precision_path_id': 'bf16_dense', 'ceiling_id': ceiling['ceiling_id'],
                'bandwidth_ceiling_id': bandwidth['bandwidth_ceiling_id'], 'device_id': run['device_id'],
                'operating_point_id': ceiling['operating_point']['operating_point_id'], 'work_unit': 'kernel_launch',
                'time_basis': 'nsys_interval', 'traffic_basis': 'kernel_boundary_modeled', 'work_basis': 'runtime_executed_formula',
                'aggregation': 'entity', 'runtime_overhead': 'excluded', 'runtime_id': 'vla-cpp', 'realization_id': REALIZATION,
                'run_id': run['run_id'], 'capture_id': capture_id, 'comparison_mode': 'inventory',
                'provenance': _provenance('one-window shape-matched launch sum; same work and bytes for theoretical and observed points'),
                'missing': [],
            })
            flop, byte = 2*m*n*k*calls, (2*m*k+2*k*n+4*m*n)*calls
            compute_s, memory_s, observed_s = flop/compute, byte/bandwidth['byte_per_second'], duration/1e9
            roof_s = max(compute_s, memory_s)
            records['roofline_points'].append({
                'schema_version': '2.0.0', 'point_id': f'point-pi0-vlacpp-gemm-{ordinal:03d}-{index:03d}', 'basis_id': basis_id,
                'entity': {'kind': 'kernel', 'entity_id': observation_id, 'label': f'GEMM {m} × {n} × {k}',
                           'logical_refs': [], 'coverage_key': f'{observation_id}:same-window-shape',
                           'shape_or_coverage': f'M={m}, N={n}, K={k}; BF16 A/B, FP32 accumulation/C; {calls} launches in prediction {ordinal} only'},
                'calls': calls, 'values_scope': 'all_calls',
                'work': {'components': [{'component_id': 'gemm', 'kind': 'gemm', 'compute_class': 'tensor_bf16_dense',
                                        'flop': flop, 'comparison_ops': 0, 'transcendental_ops': 0, 'integer_ops': 0,
                                        'provenance': _provenance(f'2*{m}*{n}*{k}*{calls}; FMA=2')}], 'total_flop': flop},
                'traffic': {'memory_domain': 'system_memory', 'value_kind': 'modeled',
                            'components': [{'component_id': label, 'kind': kind, 'byte': value*calls, 'tensor_ref': label,
                                            'provenance': _provenance('BF16 A/B read once; FP32 C written once; alpha=1,beta=0; no cache or DRAM measurement')}
                                           for label, kind, value in [('A','weight_read',2*m*k), ('B','input_read',2*k*n), ('C','boundary_output_write',4*m*n)]],
                            'excluded_internal': [], 'total_byte': byte},
                'timing': {'observed_second': observed_s, 'statistic': 'sum', 'sample_count': calls,
                           'timing_boundary_id': 'nsys_selected_kernel_intervals_one_prediction'},
                'coverage': {'status': 'partial', 'included_refs': [signature['kernel_signature_id']],
                             'omitted': [{'ref': 'outside_selected_kernel_boundary', 'reason': 'Conversion, other kernels, CPU and transfers are outside these three shape groups.'}]},
                'aggregation': {'member_point_ids': [], 'dependency_edges': [], 'dependency_lower_bound_second': None,
                                'resource_compute_lower_bound_second': None, 'resource_memory_lower_bound_second': None},
                'derived': {'status': 'partial_lower_bound', 'arithmetic_intensity_flop_per_byte': flop/byte,
                            'compute_second': compute_s, 'memory_second': memory_s, 'roof_second': roof_s,
                            'roof_flop_per_second': flop/roof_s, 'achieved_flop_per_second': flop/observed_s,
                            'efficiency': None, 'gap': None, 'limiter': 'compute' if compute_s > memory_s else 'memory'},
                'provenance': _provenance('unchanged-call cublasGemmEx labels -> graph-node clone ancestry -> Nsys kernel intervals; model work and boundary bytes', measured=True),
                'legacy_record_refs': [], 'missing': [{'field': 'efficiency', 'reason': 'incompatible_basis', 'detail': 'Capture-window GPU/EMC clocks and measured traffic are unavailable; no attainment or end-to-end speedup.'}],
            })
        input_refs = [lane['lane_id'] for lane in lanes]
        records['timelines'].append({'timeline_id': _child('timeline', ordinal, 1), 'capture_id': capture_id,
            'run_id': run['run_id'], 'source_id': run['source_id'], 'window': {'label': 'predict', 'start_ns': 0, 'duration_ns': end-start},
            'time_basis': 'relative_to_target_window_start', 'lanes': lanes, 'events': events,
            'summaries': [{'metric_name': 'recorded_gpu_activity_union', 'value': _union(events), 'unit': 'ns',
                           'denominator': 'predict_window', 'derivation_version': 'interval-union-v1', 'input_refs': input_refs}],
            'missing': {'cpu_idle_conclusion': 'not_computable_from_scheduler_activity'}})
    return {'bundle_version': '1.0.0', 'source_label': 'pi0-vlacpp-gemm-pairs', 'datasets': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('handoff', type=Path)
    parser.add_argument('--sqlite', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('.local/staging/pi0-kernel-pairs.json'))
    args = parser.parse_args()
    root = Path.cwd().resolve()
    if not args.output.resolve().is_relative_to(root / '.local/staging'):
        parser.error('output must remain under .local/staging')
    with sqlite3.connect(args.sqlite.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        windows = connection.execute("SELECT text,start,end FROM NVTX_EVENTS WHERE text LIKE 'pi0_steady_%' ORDER BY start").fetchall()
        version = connection.execute("SELECT value FROM META_DATA_EXPORT WHERE name='EXPORT_PRODUCT_VERSION'").fetchone()[0]
        cpus = int(connection.execute("SELECT value FROM TARGET_INFO_SYSTEM_ENV WHERE name='CpuCores'").fetchone()[0])
    datasets = load_validated_datasets(root / 'data', root)
    bundle = build_kernel_pair_bundle(load_json(args.handoff), windows, datasets, tool_version=version, logical_cpu_count=cpus)
    issues = scan_json(bundle) + scan_profiler_bundle(bundle)
    combined = copy.deepcopy(datasets)
    for name, records in bundle['datasets'].items():
        version = '2.0.0' if name.startswith('roofline_') else '1.0.0'
        issues += validate_document(name, {'schema_version': version, 'dataset': name, 'records': records}, root)
        primary = load_manifest(root)['datasets'][name]['primary_key']
        existing = {record[primary]: record for record in combined[name]}
        existing.update({record[primary]: record for record in records})
        combined[name] = list(existing.values())
    issues += roofline_problems(combined)
    if issues:
        for issue in issues: print(issue)
        return 1
    plan_promotion(bundle, root)
    write_json_atomic(args.output, bundle)
    print(f'Staged {len(bundle["datasets"]["roofline_points"])} kernel pairs in ten separate prediction windows.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
