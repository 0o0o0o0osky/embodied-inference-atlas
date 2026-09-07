"""Stage launch-separated FlashRT V1/P48/C10 GEGLU links, preserving old evidence."""
import argparse
import copy
import json
from pathlib import Path
from extractors.flashrt_kernel_links import REVISION, GROUP_IDS
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.site import load_validated_datasets
from tools.lib.runtime_realization import runtime_realization_problems

SYMBOL='gate_geglu_merged_fp8_kernel_fp16(const __half *, __nv_fp8_e4m3 *, int, int, const float *)'


def attach_time_precompute_recipe(record):
    """Promote the already-audited Torch preparation recipe, preserving its evidence."""
    record = copy.deepcopy(record)
    if record['model_id'] != 'pi0' or record['runtime_id'] != 'flashrt' or record['runtime_revision'] != REVISION:
        raise ValueError('Audited FlashRT implementation required')
    item = next((r for r in record.get('reuse', []) if r['reuse_id'] == 'flashrt-time-projection'), None)
    if item is None:
        return record
    proof = next(e for e in record['evidence'] if e['evidence_id'] in item['evidence_ids']
                 and e['kind'] == 'source_code' and e['revision'] == REVISION
                 and e['locator'] == 'flash_rt/frontends/torch/pi0_thor.py#set_prompt')
    item['mechanism'] = dict(kind='time_precompute', model_id=record['model_id'], runtime_id=record['runtime_id'],
        revision=REVISION, evidence_id=proof['evidence_id'], source_locator=proof['locator'],
        preparation_device='GPU', execution_device='GPU',
        preparation_scope='设置 prompt 时准备；后续观测继续读取这张表。', repeat_scope='每次观测的每个去噪步骤',
        feature_operation='sin / cos', projection_operation='时间投影 + bias', action_operation='动作分支投影',
        output_operations=['相加', 'SiLU', '输出投影'])
    return record


def extend_fixed_geglu(record,manifest,observations,capture_id,configuration_ids):
    if record['runtime_id']!='flashrt' or record['runtime_revision']!=REVISION: raise ValueError('Audited FlashRT revision required')
    record=attach_time_precompute_recipe(record);links=[]
    # Source wrapper launches ceil((S*H/4)/256); Torch has S=304/H=16384
    # for prefix and S_dec=11/H=4096 for actions. Last prefix MLP is skipped.
    for gid,seq,hidden,calls in zip(GROUP_IDS,[304,11],[16384,4096],[17,180]):
        grid=(seq*hidden//4+255)//256
        selected=[s for s in manifest if s['symbol']==SYMBOL and s['launch']['grid']==[grid,1,1]
                  and s['launch']['block']==[256,1,1] and s['launch']['registers_per_thread']==21
                  and s['launch']['static_shared_memory_bytes']==0 and s['launch']['dynamic_shared_memory_bytes']==0]
        if len(selected)!=1: raise ValueError('Expected one audited symbol and complete launch class')
        signature=selected[0]
        native=[o for o in observations if o['capture_id']==capture_id and o['kernel_signature_id']==signature['kernel_signature_id']]
        if len(native)!=1 or native[0]['calls']!=calls or native[0]['launch']!=signature['launch']:
            raise ValueError('Observed launch population does not match audited stage')
        obs=native[0];evidence_id='flashrt-fixed-'+gid+'-trace'
        evidence=dict(evidence_id=evidence_id,kind='profiler_correlation',source_id='source-local-thor',revision=None,
            locator=None,run_ids=[obs['run_id']],observation_ids=[obs['observation_id']])
        record['evidence']=[e for e in record['evidence'] if e['evidence_id']!=evidence_id]+[evidence]
        group=next(g for g in record['execution_groups'] if g['execution_group_id']==gid)
        group['kernel_signature_ids']=list(dict.fromkeys([*group['kernel_signature_ids'],signature['kernel_signature_id']]))
        group['evidence_ids']=list(dict.fromkeys([*group['evidence_ids'],evidence_id]))
        group['implementation']='GELU(gate) × up、静态缩放、clamp 与 FP8 转换。新 V1/P48/C10 采集按启动配置和调用次数区分前缀/动作；旧共享签名仍保留共享归属。'
        mapping=next(m for m in record['mappings'] if m['execution_group_ids']==[gid])
        suffix=obs['observation_id'].removeprefix('kernel-observation-')
        links.append(dict(link_id='operator-kernel-link-'+suffix+('_001' if '_r' in suffix else '-001'),
            observation_id=obs['observation_id'],kernel_signature_id=signature['kernel_signature_id'],run_id=obs['run_id'],
            model_graph_id=record['model_graph_id'],logical_targets=copy.deepcopy(mapping['logical_targets']),
            realization_id=record['realization_id'],execution_group_ids=[gid],mapping_method='combined',status='resolved',
            confidence='high',coverage=dict(mapped_launches=calls,population_launches=calls,unit='launch'),
            evidence_ids=[capture_id],reason_code=None))
    record['configuration_ids']=list(dict.fromkeys([*record['configuration_ids'],*configuration_ids]))
    record['availability']='measured';record['availability_reason_code']='fixed_p48_measurement_and_launch_correlated_geglu'
    return record,links


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir',type=Path,default=Path('.local/flashrt-fixed-001'))
    parser.add_argument('--output',type=Path,default=Path('.local/staging/flashrt-fixed-realization.json'))
    args=parser.parse_args(argv);root=Path.cwd()
    if not args.output.resolve().is_relative_to((root/'.local/staging').resolve()):raise ValueError('Staging output required')
    trace=load_json(args.input_dir/'representative-staging.json')['datasets']
    e2e=load_json(args.input_dir/'e2e-staging.json')['datasets']
    if len(trace['profiler_captures'])!=1:raise ValueError('One representative required')
    capture_id=trace['profiler_captures'][0]['capture_id']
    manifest=json.loads((args.input_dir/'signature-manifest.json').read_text())
    data=load_validated_datasets(root/'data',root)
    record=next(r for r in data['runtime_realizations'] if r['runtime_id']=='flashrt' and r['model_id']=='pi0')
    configs=[r['configuration_id'] for r in trace['runs']+e2e['runs']]
    record,links=extend_fixed_geglu(record,manifest,trace['kernel_observations'],capture_id,configs)
    graph=next(g for g in data['model_graphs'] if g['model_graph_id']==record['model_graph_id'])
    problems=runtime_realization_problems(record,graph)
    if problems:raise ValueError(problems)
    write_json_atomic(args.output,dict(bundle_version='1.0.0',source_label='flashrt-fixed-geglu-links',
        datasets={'runtime_realizations':[record],'operator_kernel_links':links}))
    print(f'Staged {len(links)} GEGLU links for {capture_id}')

if __name__=='__main__':main()
