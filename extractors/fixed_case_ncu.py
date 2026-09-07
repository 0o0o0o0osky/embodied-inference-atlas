"""Stage one independently replayed launch from an existing fixed-input case.

Full symbols and input hashes are checked locally and never exported. Shape
information is not inferred from the name, launch grid, or NCU duration.
"""
from __future__ import annotations

import argparse
import copy
import csv
import io
import json
from pathlib import Path
import re
import subprocess

from extractors.ncu import _IDENTITY_COLUMNS, import_ncu_report
from extractors.profiler_common import ProfilerImportContext
from tools.lib.jsonio import write_json_atomic


def verify_same_case(native, replay):
    fields = ('runtime', 'views', 'prompt', 'chunk', 'denoise', 'warmup', 'input_case_id', 'output_shape', 'input_hashes')
    if any(native.get(k) != replay.get(k) for k in fields) or not native.get('input_hashes'):
        raise ValueError('Replay inputs differ from the native fixed case')
    if not replay.get('profiled') or not replay.get('finite'):
        raise ValueError('Expected a finite independent profiler replay')


def verify_launch(native, replay):
    fields = ('grid', 'block', 'registers_per_thread', 'static_shared_memory_bytes', 'dynamic_shared_memory_bytes')
    if any(native.get(k) is None or native.get(k) != replay.get(k) for k in fields):
        raise ValueError('Replay launch resources differ from the retained native class')


def stage_replay(case_bundle, manifest, signature_id, report, log, native, replay):
    verify_same_case(native, replay)
    candidates = [r for r in manifest if r['kernel_signature_id'] == signature_id]
    if len(candidates) != 1:
        raise ValueError('Expected one locally audited native signature')
    match = candidates[0]
    def details(base):
        # NCU's default display renames strip namespaces/template casts. Disable
        # them only for the exact-symbol comparison; the existing importer uses
        # its normal function-name identity for the sanitized metric exports.
        display = ['--rename-kernels', '0'] if base == 'demangled' else []
        result = subprocess.run(['ncu', '--config-file', 'off', '--import', str(report), '--csv',
            '--print-kernel-base', base, '--print-units', 'base', '--print-fp', '--page', 'details', *display],
            check=True, capture_output=True, text=True)
        rows = list(csv.DictReader(io.StringIO(result.stdout)))
        identities = {tuple(row[k] for k in _IDENTITY_COLUMNS) for row in rows}
        if len(identities) != 1:
            raise ValueError('Only one explicitly selected launch is accepted')
        return rows[0]
    if details('demangled')['Kernel Name'] != match['symbol']:
        raise ValueError('NCU symbol differs from the audited native symbol')
    row = details('function')
    identity = {k: row[k] for k in _IDENTITY_COLUMNS}
    ds = case_bundle['datasets']
    observations = [o for o in ds['kernel_observations'] if o['kernel_signature_id'] == signature_id]
    if len(observations) != 1:
        raise ValueError('Expected one retained native population')
    observation = observations[0]
    verify_launch(match['launch'], observation['launch'])
    run = copy.deepcopy(next(r for r in ds['runs'] if r['run_id'] == observation['run_id']))
    suffix = signature_id.removeprefix(f"kernel-signature-{run['model_id']}-")
    source_label = f"{run['model_id']}-{run['runtime_id']}-ncu-{suffix}"
    run.pop('analysis_batch', None)
    run.update(run_id=f'run-{source_label}-001', configuration_id=f'config-{source_label}-001', capture_method='ncu')
    signature = copy.deepcopy(next(s for s in ds['kernel_signatures'] if s['kernel_signature_id'] == signature_id))
    signature.pop('runtime_id'); signature.pop('model_id')
    passes = re.findall(r'- (\d+) passes', log)
    if len(passes) != 1:
        raise ValueError('Expected one replay pass count in collection log')
    context = ProfilerImportContext(source_label=source_label, source_id=run['source_id'], system_id=run['system_id'],
        run=run, capture_label=source_label, signature_policy_id='fixed-case-selected-launch-v1', window_policy_id='not-applicable')
    origins = {key: 'session_command' for key in ('selection_policy', 'replay_mode', 'cache_control_request', 'clock_control_request')}
    origins.update(replay_passes='collection_log_manual_audit', warmup_count='harness_source_audit',
        backing_store_bytes='unavailable', gpu_frequency_not_fixed='collection_log_manual_audit')
    policy = dict(policy_id=context.signature_policy_id, section_mode='section_set', replay_mode='kernel',
        replay_passes=int(passes[0]), cache_control_request='none', clock_control_request='none', warmup_count=5,
        backing_store_bytes=None, warnings=['gpu_frequency_not_fixed', 'work_id_unavailable'], origins=origins,
        expected_result_identity=identity, expected_geometry={k: match['launch'][k] for k in ('grid', 'block')}, signature=signature)
    bundle = import_ncu_report(report, context, policy)
    verify_launch(observation['launch'], bundle['datasets']['kernel_observations'][0]['launch'])
    return bundle


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('case-bundle', 'manifest', 'report', 'log', 'native-results', 'replay-results', 'output'):
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--signature', required=True)
    a = p.parse_args()
    if not a.output.resolve().is_relative_to(Path.cwd()/'.local/staging'):
        p.error('Use a local staging output; promote through the normal validator')
    read = lambda path: json.loads(path.read_text())
    bundle = stage_replay(read(a.case_bundle), read(a.manifest), a.signature, a.report, a.log.read_text(),
        read(a.native_results), read(a.replay_results))
    write_json_atomic(a.output, bundle)
    print('Staged one independent replay with exact symbol, input and launch-resource checks')


if __name__ == '__main__': main()
