"""Bind the audited FlashRT T1 launch class to prefix Gate/Up projections.

Uses the existing representative; source files, full symbols and the per-layer
order audit remain local. No new capture, inferred event label, or timing edit.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess

from extractors.flashrt_kernel_links import REVISION
from tools.lib.jsonio import write_json_atomic
from tools.lib.promotion import plan_promotion
from tools.lib.site import load_validated_datasets

SIGNATURE = 'kernel-signature-pi0-flashrt-large-gemm-027'
CAPTURE = 'capture-pi0-flashrt-nsys-node-002'
GROUP = 'prefix-merged-gate-up'
PREFIX = 'prefix-encoder/prefix-blocks'
PREVIOUS = 'kernel-signature-pi0-flashrt-residual-rms-026'
FOLLOWING = 'kernel-signature-pi0-flashrt-geglu-fp8-028'
LAUNCH = dict(grid=[6,128,1], block=[256,1,1], registers_per_thread=119,
              static_shared_memory_bytes=0, dynamic_shared_memory_bytes=230400, waves_per_sm=None)


def gate_up_bundle(data, sequence):
    record = copy.deepcopy(next(r for r in data['runtime_realizations'] if r['runtime_id']=='flashrt' and r['model_id']=='pi0'))
    if record['runtime_revision'] != REVISION:
        raise ValueError('The audited FlashRT revision is required')
    timeline = next(t for t in data['timelines'] if t['capture_id']==CAPTURE)
    run = next(r for r in data['runs'] if r['run_id']==timeline['run_id'])
    w = run['workload']['vla']
    if [w.get(k) for k in ('camera_views','executed_prompt_tokens','action_chunk','denoise_steps')] != [1,48,10,10]:
        raise ValueError('The audited V1/P48/C10/D10 workload is required')
    observation = next(o for o in data['kernel_observations'] if o['capture_id']==CAPTURE and o['kernel_signature_id']==SIGNATURE)
    events = sorted((e for e in timeline['events'] if e['kernel_signature_id']==SIGNATURE), key=lambda e:e['start_ns'])
    if len(events)!=17 or observation['calls']!=17 or observation['launch']!=LAUNCH:
        raise ValueError('The audited launch population changed')
    if len(sequence)!=17 or [s['layer_index'] for s in sequence]!=list(range(17)) or [s['event_id'] for s in sequence]!=[e['event_id'] for e in events]:
        raise ValueError('The audited source-order sequence changed')
    if len({e['lane_id'] for e in events})!=1 or sum(e['duration_ns'] for e in events)!=observation['duration']['value_ns']:
        raise ValueError('The audited population or stream changed')
    stream = sorted((e for e in timeline['events'] if e['event_kind']=='kernel' and e['lane_id']==events[0]['lane_id']), key=lambda e:e['start_ns'])
    for event, association in zip(events, sequence):
        i = stream.index(event)
        if event['count']!=1 or event['evidence_semantics']!='exact_interval' or event['launch']!=LAUNCH or i==0 or i+1==len(stream):
            raise ValueError('Expected one exact audited launch in the source sequence')
        before, after = stream[i-1], stream[i+1]
        if (before['kernel_signature_id'],after['kernel_signature_id']) != (PREVIOUS,FOLLOWING) or (before['event_id'],after['event_id']) != (association['previous_event_id'],association['next_event_id']):
            raise ValueError('The surrounding normalization/GELU sequence changed')
    # Source data dependency is known; do not assert end<=next.start. Nsys node
    # timestamps have small overlaps, and all original intervals remain intact.
    source_specs = [
        ('flashrt-pi0-t1-template-source','csrc/gemm/gemm_types_sm100.h#sm100_t1'),
        ('flashrt-pi0-t1-wrapper-source','csrc/gemm/cutlass_sm100.cu#cutlass_fp8_t1'),
        ('flashrt-pi0-gate-up-weight-source','flash_rt/frontends/torch/_thor_spec_common.py#paligemma_encoder_block'),
    ]
    evidence = [dict(evidence_id=eid, kind='source_code', source_id='source-flashrt', revision=REVISION,
        locator=locator, run_ids=[], observation_ids=[]) for eid,locator in source_specs]
    trace_id = 'flashrt-fixed-prefix-gate-up-trace'
    evidence.append(dict(evidence_id=trace_id, kind='profiler_correlation', source_id='source-local-thor', revision=None,
        locator=None, run_ids=[run['run_id']], observation_ids=[observation['observation_id']]))
    ids = [e['evidence_id'] for e in evidence]
    record['evidence'] = [e for e in record['evidence'] if e['evidence_id'] not in ids] + evidence
    proof = ['flashrt-pi0-encoder-source','flashrt-pi0-torch-capture-source',*ids]
    pid = 'flashrt-gate-up-fp8-fp16'
    precision = dict(precision_path_id=pid,label='FP8 E4M3 输入与权重 → FP32 累加 → FP16 Gate/Up',
        weight_dtype='fp8_e4m3',activation_dtype='fp8_e4m3',accumulation_dtype='fp32',output_dtype='fp16',
        quant_scheme='static_fp8_e4m3',missing_fields=[],missing_reason_code=None,evidence_ids=proof[:2]+ids[:3])
    record['precision_paths'] = [p for p in record['precision_paths'] if p['precision_path_id']!=pid]+[precision]
    repeats = [dict(scope_ref=PREFIX,selection='indices',indices=list(range(17)))]
    targets = [dict(ref=f'{PREFIX}/feed-forward/{op}',repeat_selectors=copy.deepcopy(repeats)) for op in ['gate-projection','up-projection']]
    group = dict(execution_group_id=GROUP,label='前缀 Gate/Up 合并投影',kind='backend_op',
        implementation='前缀第 1–17 层：FP8 X[304,2048] × 合并权重[2048,32768]，FP32 累加与 alpha 缩放，输出 FP16 Gate/Up。后续 GEGLU 独立执行。层覆盖由唯一调用点与同 stream 顺序关联，原 trace 未标层号。',
        precision_path_id=pid,repeat_selectors=repeats,dependency_group_ids=[],kernel_signature_ids=[SIGNATURE],
        kernel_resolution='resolved',unmapped_reason_code=None,evidence_ids=proof)
    record['execution_groups'] = [g for g in record['execution_groups'] if g['execution_group_id']!=GROUP]+[group]
    mapping = dict(mapping_id='map-'+GROUP,logical_targets=targets,execution_group_ids=[GROUP],relation='fused',
        path='primary',certainty='exact',method='source_audit',confidence='high',reason_code=None,evidence_ids=proof)
    record['mappings'] = [m for m in record['mappings'] if m['mapping_id']!=mapping['mapping_id']]+[mapping]
    link = dict(link_id='operator-kernel-link-'+observation['observation_id'].removeprefix('kernel-observation-')+'_001',
        observation_id=observation['observation_id'],kernel_signature_id=SIGNATURE,run_id=run['run_id'],
        model_graph_id=record['model_graph_id'],logical_targets=targets,realization_id=record['realization_id'],
        execution_group_ids=[GROUP],mapping_method='combined',status='resolved',confidence='high',
        coverage=dict(mapped_launches=17,population_launches=17,unit='launch'),evidence_ids=[CAPTURE],reason_code=None)
    return dict(bundle_version='1.0.0',source_label='flashrt-fixed-gate-up-links',
        datasets=dict(runtime_realizations=[record],operator_kernel_links=[link]))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('audit','source','manifest','output'):
        p.add_argument('--'+name,type=Path,required=True)
    a = p.parse_args(); root = Path.cwd()
    if not a.output.resolve().is_relative_to(root/'.local/staging'):
        p.error('Use a local staging output')
    audit = json.loads(a.audit.read_text()); manifest = json.loads(a.manifest.read_text())
    if audit['revision']!=REVISION or audit['signature_id']!=SIGNATURE or audit['capture_id']!=CAPTURE:
        p.error('The reviewed source and fixed capture are required')
    for item in audit['source_files']:
        committed = subprocess.check_output(['git','show',f"{REVISION}:{item['path']}"],cwd=a.source)
        if (a.source/item['path']).read_bytes()!=committed or hashlib.sha256(committed).hexdigest()!=item['sha256']:
            p.error('A source file differs from the reviewed revision')
    symbols = {s['kernel_signature_id']:s for s in manifest}
    if symbols[SIGNATURE]['symbol']!=audit['symbol'] or symbols[SIGNATURE]['launch']!=LAUNCH or symbols[PREVIOUS]['symbol']!=audit['upstream_symbol'] or symbols[FOLLOWING]['symbol']!=audit['downstream_symbol']:
        p.error('The exact native symbols/resources differ from the audit')
    if [audit['shape'][k] for k in ('M','N','K')]!=[304,32768,2048] or audit['precision']['output_dtype_class']!='fp16':
        p.error('The reviewed workload/epilogue contract changed')
    bundle = gate_up_bundle(load_validated_datasets(root/'data',root),audit['event_sequence'])
    plan_promotion(bundle,root)
    write_json_atomic(a.output,bundle)
    print('Staged one Gate/Up association with implementation precision; profiler records unchanged')


if __name__=='__main__': main()
