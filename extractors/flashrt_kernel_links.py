"""Stage one source-audited, shared FlashRT GEGLU association; never split timing."""
import argparse
import copy
import sqlite3
import subprocess
from pathlib import Path

from tools.lib.jsonio import write_json_atomic
from tools.lib.site import load_validated_datasets
from tools.lib.promotion import plan_promotion

REVISION = '054bea4d02ebc63f6a0c45991c6061b1e1caa46c'
SIGNATURE = 'kernel-signature-pi0-encoder-geglu'
OBSERVATION = 'kernel-observation-pi0-flashrt-nsys-node-007'
GROUP_IDS = ['prefix-geglu-fp8', 'action-geglu-fp8']


def shared_geglu_bundle(datasets):
    realization = copy.deepcopy(next(r for r in datasets['runtime_realizations']
                                     if r['model_id']=='pi0' and r['runtime_id']=='flashrt'))
    observation = next(o for o in datasets['kernel_observations'] if o['observation_id']==OBSERVATION)
    if observation['kernel_signature_id'] != SIGNATURE or observation['calls'] != 197 or observation['duration']['value_ns'] != 2974784:
        raise ValueError('The audited shared-signature observation has changed')
    evidence = [
        {'evidence_id':'flashrt-pi0-geglu-kernel-source', 'kind':'source_code', 'source_id':'source-flashrt',
         'revision':REVISION, 'locator':'csrc/kernels/activation.cu#gate_geglu_merged_fp8_fp16', 'run_ids':[], 'observation_ids':[]},
        {'evidence_id':'flashrt-pi0-torch-capture-source', 'kind':'source_code', 'source_id':'source-flashrt',
         'revision':REVISION, 'locator':'flash_rt/frontends/torch/pi0_thor.py#_capture_enc_ae_graph', 'run_ids':[], 'observation_ids':[]},
        {'evidence_id':'flashrt-pi0-geglu-shared-trace', 'kind':'profiler_correlation', 'source_id':'source-local-thor',
         'revision':None, 'locator':None, 'run_ids':[observation['run_id']], 'observation_ids':[OBSERVATION]},
    ]
    evidence_ids = [item['evidence_id'] for item in evidence]
    realization['evidence'] = [item for item in realization['evidence'] if item['evidence_id'] not in evidence_ids] + evidence
    precision_id = 'flashrt-geglu-fp16-fp8'
    precision = {'precision_path_id':precision_id, 'label':'FP16 gate/up → FP32 elementwise → FP8 E4M3',
                 'weight_dtype':None, 'activation_dtype':'fp16', 'accumulation_dtype':'fp32', 'output_dtype':'fp8_e4m3',
                 'quant_scheme':'activation_static_fp8_e4m3', 'missing_fields':['weight_dtype'],
                 'missing_reason_code':'not_applicable_no_weight_tensor', 'evidence_ids':[evidence_ids[0]]}
    realization['precision_paths'] = [item for item in realization['precision_paths'] if item['precision_path_id'] != precision_id] + [precision]
    groups, mappings, targets = [], [], []
    for group_id, prefix, source_id in zip(GROUP_IDS,
            ['prefix-encoder/prefix-blocks', 'action-flow-decoder/action-expert-blocks'],
            ['flashrt-pi0-encoder-source', 'flashrt-pi0-decoder-source']):
        repeats = [{'scope_ref':prefix, 'selection':'indices', 'indices':list(range(17))}] if group_id.startswith('prefix') else [
            {'scope_ref':'action-flow-decoder/action-flow-loop', 'selection':'all', 'indices':[]},
            {'scope_ref':prefix, 'selection':'all', 'indices':[]}]
        group_targets = [{'ref':f'{prefix}/feed-forward/{op}', 'repeat_selectors':copy.deepcopy(repeats)}
                         for op in ['gate-gelu','gate-product']]
        groups.append({'execution_group_id':group_id, 'label':'Prefix GELU × up + FP8 cast' if group_id.startswith('prefix') else 'Action GELU × up + FP8 cast',
                       'kind':'custom_op', 'implementation':'GELU(gate) × up, static rescale, clamp and FP8 cast in one kernel; signature shared across prefix and action groups',
                       'precision_path_id':precision_id, 'repeat_selectors':repeats, 'dependency_group_ids':[],
                       'kernel_signature_ids':[SIGNATURE], 'kernel_resolution':'partial',
                       'unmapped_reason_code':None, 'evidence_ids':[source_id,*evidence_ids]})
        mappings.append({'mapping_id':f'map-{group_id}', 'logical_targets':group_targets, 'execution_group_ids':[group_id],
                         'relation':'fused', 'path':'primary', 'certainty':'exact', 'method':'source_audit', 'confidence':'high',
                         'reason_code':None, 'evidence_ids':[source_id,evidence_ids[0]]})
        targets.extend(group_targets)
    realization['execution_groups'] = [g for g in realization['execution_groups'] if g['execution_group_id'] not in GROUP_IDS] + groups
    realization['mappings'] = [m for m in realization['mappings'] if m['mapping_id'] not in {x['mapping_id'] for x in mappings}] + mappings
    link = {'link_id':'operator-kernel-link-pi0-flashrt-nsys-node-007-001', 'observation_id':OBSERVATION,
            'kernel_signature_id':SIGNATURE, 'run_id':observation['run_id'], 'model_graph_id':realization['model_graph_id'],
            'logical_targets':targets, 'realization_id':realization['realization_id'], 'execution_group_ids':GROUP_IDS,
            'mapping_method':'source_audit', 'status':'partial', 'confidence':'high',
            'coverage':{'mapped_launches':197, 'population_launches':197, 'unit':'launch'},
            'evidence_ids':[observation['capture_id']], 'reason_code':'ambiguous_attribution'}
    return {'bundle_version':'1.0.0', 'source_label':'pi0-flashrt-shared-geglu',
            'datasets':{'runtime_realizations':[realization], 'operator_kernel_links':[link]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--nsys', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    if subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip() != REVISION:
        parser.error('source revision differs from the audited revision')
    for path in ['csrc/kernels/activation.cu','csrc/bindings.cpp','flash_rt/hardware/thor/shared_primitives.py',
                 'flash_rt/models/pi0/pipeline_thor.py','flash_rt/frontends/torch/pi0_thor.py']:
        committed = subprocess.check_output(['git','show',f'{REVISION}:{path}'],cwd=source)
        if (source/path).read_bytes() != committed:
            parser.error('audited source has local modifications')
    with sqlite3.connect(args.nsys.resolve().as_uri()+'?mode=ro',uri=True) as connection:
        window = connection.execute("SELECT start,end FROM NVTX_EVENTS WHERE text='pi0_steady_predict'").fetchall()
        if len(window) != 1: parser.error('expected the one audited prediction window')
        # Exact fully qualified source symbol; no tile/name-prefix attribution.
        values = connection.execute("SELECT COUNT(*),SUM(k.end-k.start) FROM CUPTI_ACTIVITY_KIND_KERNEL k JOIN StringIds s ON s.id=k.demangledName WHERE s.value=? AND k.start>=? AND k.end<=?",(
            'gate_geglu_merged_fp8_kernel_fp16(const __half *, __nv_fp8_e4m3 *, int, int, const float *)', *window[0])).fetchone()
        if values != (197,2974784): parser.error('source symbol population differs from canonical observation')
    root = Path.cwd()
    bundle = shared_geglu_bundle(load_validated_datasets(root/'data',root))
    plan_promotion(bundle,root)
    output = root/'.local/staging/flashrt-shared-geglu.json'
    write_json_atomic(output,bundle)
    print('Staged one shared GEGLU link to two execution groups; whole signature timing remains indivisible.')


if __name__ == '__main__':
    main()
