"""Stage three source-ordered FlashRT GEMM classes from the existing representative."""
import argparse
import copy
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path
from extractors.flashrt_gate_up_links import CAPTURE, REVISION
from tools.lib.jsonio import write_json_atomic
from tools.lib.promotion import plan_promotion
from tools.lib.site import load_validated_datasets
from tools.lib.runtime_realization import runtime_realization_problems

PREFIX='kernel-signature-pi0-flashrt-'
CLASSES={
 '029':('second-gemm-029',17,{('027','028','029','030','018'):17}),
 '043':('nvjet-512x16-043',180,{('041','042','043','044','041'):180}),
 '041':('nvjet-64x16-041',360,{('039','040','041','042','043'):180,('043','044','041','042','034'):170,('043','044','041','045','046'):10}),
}
# Exact symbols and complete resource configurations inspected in the fixed manifest.
AUDITED_DIGESTS = {'029': '3955eec6690103b7d804251d4ccebd7d3010a361ea4227e1284c3b93c9780f01', '043': 'b5945461e41e33b63cafcb91573b101642f2ce6fcf10b32bddd3643e47abcb73', '041': '695ff6160c74ca01c83ee3dd892db3e2744de8cc34345c17a404d1abc09e5671'}
SOURCE_FILES=['flash_rt/frontends/torch/pi0_thor.py','flash_rt/hardware/thor/shared_primitives.py',
 'flash_rt/models/pi0/pipeline_thor.py','csrc/kernels/decoder_fused.cu','csrc/gemm/gemm_types_sm100.h','csrc/gemm/cutlass_sm100.cu']

def signature_digest(item):
    return hashlib.sha256(json.dumps([item['symbol'],item['launch']],sort_keys=True).encode()).hexdigest()

def hotspot_bundle(data,manifest):
    record=copy.deepcopy(next(r for r in data['runtime_realizations'] if r['runtime_id']=='flashrt' and r['model_id']=='pi0'))
    if record['runtime_revision']!=REVISION: raise ValueError('Reviewed revision required')
    timeline=next(t for t in data['timelines'] if t['capture_id']==CAPTURE)
    events=sorted([e for e in timeline['events'] if e.get('kernel_signature_id')],key=lambda e:e['start_ns'])
    symbols={s['kernel_signature_id']:s for s in manifest}; observations={}
    for suffix,(name,count,neighbors) in CLASSES.items():
        sid=PREFIX+name; native=symbols[sid]
        if signature_digest(native)!=AUDITED_DIGESTS[suffix]:raise ValueError('Exact symbol/resource audit changed')
        indices=[i for i,e in enumerate(events) if e['kernel_signature_id']==sid]
        actual=Counter(tuple(x['kernel_signature_id'].split('-')[-1] for x in events[max(0,i-2):i+3]) for i in indices)
        if actual!=neighbors or len(indices)!=count:raise ValueError('Source-ordered invocation population changed')
        for i in indices:
            if events[i].get('launch')!=native['launch'] or len({e.get('lane_id') for e in events[i-2:i+3]})!=1:
                raise ValueError('Launch or stream association changed')
        obs=[o for o in data['kernel_observations'] if o['capture_id']==CAPTURE and o['kernel_signature_id']==sid]
        if len(obs)!=1 or obs[0]['calls']!=count or obs[0]['launch']!=native['launch']:
            raise ValueError('Native observation population changed')
        observations[suffix]=obs[0]
    evidence=[]
    for i,path in enumerate(SOURCE_FILES):
        evidence.append(dict(evidence_id=f'flashrt-fixed-hotspot-source-{i}',kind='source_code',source_id='source-flashrt',revision=REVISION,locator=path+'#'+['_capture_enc_ae_graph','encoder_forward','decoder_forward_pi0','fp8_gemm_descale_fp16','sm100_wide','cutlass_fp8_wide'][i],run_ids=[],observation_ids=[]))
    eid='flashrt-fixed-hotspot-sequence'
    evidence.append(dict(evidence_id=eid,kind='profiler_correlation',source_id='source-local-thor',revision=None,locator=None,
        run_ids=[observations['029']['run_id']],observation_ids=[o['observation_id'] for o in observations.values()]))
    proof=[e['evidence_id'] for e in evidence]
    record['evidence']=[e for e in record['evidence'] if e['evidence_id'] not in proof]+evidence
    pid='flashrt-fixed-fp8-gemm-fp32-fp16'
    precision=dict(precision_path_id=pid,label='FP8 E4M3 输入与权重 → FP32 累加 → FP16 输出',weight_dtype='fp8_e4m3',activation_dtype='fp8_e4m3',accumulation_dtype='fp32',output_dtype='fp16',quant_scheme='static_fp8_e4m3',missing_fields=[],missing_reason_code=None,evidence_ids=proof[:-1])
    record['precision_paths']=[p for p in record['precision_paths'] if p['precision_path_id']!=pid]+[precision]
    pscope='prefix-encoder/prefix-blocks'; ascope='action-flow-decoder/action-expert-blocks'
    pr=[dict(scope_ref=pscope,selection='indices',indices=list(range(17)))]
    ar=[dict(scope_ref='action-flow-decoder/action-flow-loop',selection='all',indices=[]),dict(scope_ref=ascope,selection='all',indices=[])]
    specs=[
        ('prefix-down-projection','前缀 Down 投影','029',pscope,['feed-forward/down-projection'],pr,'X[304,16384] × W[16384,2048]；静态缩放后输出 FP16。每层 GEGLU 后调用一次，共 17 次。'),
        ('action-merged-gate-up','动作 Gate/Up 合并投影','043',ascope,['feed-forward/gate-projection','feed-forward/up-projection'],ar,'X[11,1024] × 合并权重[1024,8192]；静态缩放后输出 FP16 Gate/Up，随后独立 GEGLU。10 步 × 18 层。'),
        ('action-attention-output','动作注意力输出投影','041',ascope,['self-attention/output-projection'],ar,'X[11,2048] × W[2048,1024]。与动作 Down 共用同一签名和启动配置；显示两种用途合计 360 次。'),
        ('action-down-projection','动作 Down 投影','041',ascope,['feed-forward/down-projection'],ar,'X[11,4096] × W[4096,1024]。与注意力输出投影共用同一签名和启动配置；显示两种用途合计 360 次。'),
    ]
    mappings=[]
    for gid,label,suffix,scope,refs,repeats,description in specs:
        targets=[dict(ref=scope+'/'+ref,repeat_selectors=copy.deepcopy(repeats)) for ref in refs]
        group=dict(execution_group_id=gid,label=label,kind='backend_op',implementation=description,precision_path_id=pid,repeat_selectors=repeats,dependency_group_ids=[],kernel_signature_ids=[observations[suffix]['kernel_signature_id']],kernel_resolution='resolved',unmapped_reason_code=None,evidence_ids=proof)
        mapping=dict(mapping_id='map-'+gid,logical_targets=targets,execution_group_ids=[gid],relation='fused' if len(refs)>1 else 'preserved',path='primary',certainty='exact',method='source_audit',confidence='high',reason_code=None,evidence_ids=proof)
        record['execution_groups']=[g for g in record['execution_groups'] if g['execution_group_id']!=gid]+[group]
        record['mappings']=[m for m in record['mappings'] if m['mapping_id']!=mapping['mapping_id']]+[mapping]
        mappings.append((suffix,mapping))
    links=[]
    for suffix,obs in observations.items():
        ms=[m for s,m in mappings if s==suffix]
        links.append(dict(link_id='operator-kernel-link-'+obs['observation_id'].removeprefix('kernel-observation-')+'_001',
            observation_id=obs['observation_id'],kernel_signature_id=obs['kernel_signature_id'],run_id=obs['run_id'],model_graph_id=record['model_graph_id'],
            logical_targets=[t for m in ms for t in m['logical_targets']],realization_id=record['realization_id'],execution_group_ids=[g for m in ms for g in m['execution_group_ids']],
            mapping_method='combined',status='resolved',confidence='high',coverage=dict(mapped_launches=obs['calls'],population_launches=obs['calls'],unit='launch'),evidence_ids=[CAPTURE],reason_code=None))
    graph=next(g for g in data['model_graphs'] if g['model_graph_id']==record['model_graph_id'])
    problems=runtime_realization_problems(record,graph)
    if problems:raise ValueError(problems)
    return dict(bundle_version='1.0.0',source_label='flashrt-fixed-source-ordered-hotspot-links',datasets=dict(runtime_realizations=[record],operator_kernel_links=links))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();root=Path.cwd()
    if not a.output.resolve().is_relative_to(root/'.local/staging'):p.error('Local staging output required')
    for path in SOURCE_FILES:
        if (a.source/path).read_bytes()!=subprocess.check_output(['git','show',f'{REVISION}:{path}'],cwd=a.source):p.error('Source differs from reviewed revision')
    bundle=hotspot_bundle(load_validated_datasets(root/'data',root),json.loads(a.manifest.read_text()))
    plan_promotion(bundle,root);write_json_atomic(a.output,bundle)
    print('Staged 3 launch-class links and 4 DAG groups; profiler measurements unchanged')

if __name__=='__main__':main()
