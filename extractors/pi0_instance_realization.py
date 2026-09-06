"""Stage the two source-audited Pi0 MLP Down classes on the retained instance.

The source establishes operator semantics; labeled cuBLAS arguments establish
Nsys class shape. Independent NCU name/order selection is only a partial link.
Existing Gate/Up, reuse and system-flow records are preserved verbatim.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from pathlib import Path
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.runtime_realization import runtime_realization_problems
from tools.lib.site import load_validated_datasets

REALIZATION='rr-vla-cpp-pi0-thor-bf16-f32-v1'
CAPTURE='capture-pi0-vla-cpp-nsys-node-021'
CLASSES=(
    ('prefix-mlp-down','Prefix Down 投影','prefix-encoder/prefix-blocks',(2048,304,16384),17),
    ('action-mlp-down','动作专家 Down 投影','action-flow-decoder/action-expert-blocks',(1024,51,4096),180),
)


def verify_shapes(groups):
    for _,_,_,shape,calls in CLASSES:
        matching=[g for g in groups if tuple(g['shape'][k] for k in ('m','n','k'))==shape]
        if len(matching)!=1:
            raise ValueError('Exact labeled cuBLAS shape is missing or ambiguous')
        group=matching[0];actual=group['shape']
        if tuple(actual[k] for k in ('at','bt','ct','compute'))!=(14,14,0,68):
            raise ValueError('Expected BF16 inputs and FP32 output/accumulation')
        counts=group['per_iteration_counts']
        if len(counts)!=10 or set(counts.values())!={calls} or group['calls_node_counts']!=[1]:
            raise ValueError('Labeled shape population must match ten separate native windows')


def extend_down_projections(record, observations):
    record=deepcopy(record)
    if record['realization_id']!=REALIZATION:
        raise ValueError('Only the audited BF16 realization is supported')
    selected=[o for o in observations if o['capture_id']==CAPTURE]
    evidence_id='vlacpp-pi0-down-source'
    new_evidence=dict(evidence_id=evidence_id,kind='source_code',source_id='source-vla-cpp',
        revision=record['runtime_revision'],locator='src/models/pi0.cpp#build_gemma_layer',run_ids=[],observation_ids=[])
    if not any(e['evidence_id']==evidence_id for e in record['evidence']): record['evidence'].append(new_evidence)
    links=[]
    for gid,label,scope,shape,calls in CLASSES:
        sid='kernel-signature-pi0-vlacpp-bf16-gemm-'+'x'.join(map(str,shape))
        native=[o for o in selected if o['kernel_signature_id']==sid]
        if len(native)!=1 or native[0]['calls']!=calls:
            raise ValueError('Retained Nsys population differs from audited Down class')
        selectors=[dict(scope_ref=scope,selection='indices' if gid.startswith('prefix') else 'all',
                        indices=list(range(17)) if gid.startswith('prefix') else [])]
        if gid.startswith('action'):
            selectors.insert(0,dict(scope_ref='action-flow-decoder/action-flow-loop',selection='all',indices=[]))
        targets=[dict(ref=scope+'/feed-forward/down-projection',repeat_selectors=selectors)]
        proof=[evidence_id,'vlacpp-pi0-predict-source','vlacpp-fixed-instance-capture']
        implementation=('Wdown × (GELU(Wgate × x) ⊙ Wup × x)；cuBLAS 实参确认 '+
            'x'.join(map(str,shape))+'，BF16 输入、FP32 输出/累加。'+
            ('仅前缀层 0–16；最后层仅 K/V 被消费，隐藏输出分支不可达。'
             if gid.startswith('prefix') else '动作专家 18 层 × 10 步，共 180 次。')+
            'NCU 为同输入下符号/启动次序关联，不能独立证明形状或对应某次 Nsys 调用。')
        group=dict(execution_group_id=gid,label=label,kind='backend_op',implementation=implementation,
            precision_path_id='bf16-gemm-fp32-output',repeat_selectors=selectors,dependency_group_ids=[],
            kernel_signature_ids=[sid],kernel_resolution='resolved',unmapped_reason_code=None,evidence_ids=proof)
        mapping=dict(mapping_id='map-'+gid,logical_targets=targets,execution_group_ids=[gid],relation='preserved',
            path='primary',certainty='exact',method='source_audit',confidence='high',reason_code=None,evidence_ids=proof)
        for key,pk,item in [('execution_groups','execution_group_id',group),('mappings','mapping_id',mapping)]:
            record[key]=[old for old in record[key] if old[pk]!=item[pk]]+[item]
        replay_id='capture-pi0-vla-cpp-ncu-vlacpp-bf16-gemm-'+'x'.join(map(str,shape))+'-001'
        replays=[o for o in observations if o['capture_id']==replay_id and o['kernel_signature_id']==sid and o['observation_kind']=='ncu_replayed_launch']
        for replay in replays:
            if not {'same_input_order_association', 'work_id_unavailable'}.issubset(replay.get('quality', [])):
                raise ValueError('NCU order association requires explicit independent-replay quality evidence')
            if replay['calls']!=1 or any(replay['launch'].get(k)!=native[0]['launch'].get(k) for k in ('grid','block','registers_per_thread','static_shared_memory_bytes','dynamic_shared_memory_bytes')):
                raise ValueError('NCU launch differs from the audited native class')
        matches=native+replays
        for obs in matches:
            replay=obs['observation_kind']=='ncu_replayed_launch'
            suffix=obs['observation_id'].removeprefix('kernel-observation-')
            links.append(dict(link_id='operator-kernel-link-'+suffix+('_001' if '_r' in suffix else '-001'),
                observation_id=obs['observation_id'],kernel_signature_id=sid,run_id=obs['run_id'],
                model_graph_id=record['model_graph_id'],logical_targets=targets,realization_id=REALIZATION,
                execution_group_ids=[gid],mapping_method='geometry_and_order' if replay else 'combined',
                status='partial' if replay else 'resolved',confidence='medium' if replay else 'high',
                coverage=dict(mapped_launches=obs['calls'],population_launches=obs['calls'],unit='launch'),
                evidence_ids=[CAPTURE,obs['capture_id']] if replay else [CAPTURE],
                reason_code='ambiguous_attribution' if replay else None))
    return record,links


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path('.local/staging/pi0-instance-realization.json'))
    args=parser.parse_args(argv);root=Path.cwd()
    if not args.output.resolve().is_relative_to((root/'.local/staging').resolve()):raise ValueError('Staging output required')
    verify_shapes(load_json(root/'.local/pi0-kernel-pairs/all-matched-gemms.json')['groups'])
    data=load_validated_datasets(root/'data',root)
    record,links=extend_down_projections(next(r for r in data['runtime_realizations'] if r['realization_id']==REALIZATION),data['kernel_observations'])
    graph=next(g for g in data['model_graphs'] if g['model_graph_id']==record['model_graph_id'])
    problems=runtime_realization_problems(record,graph)
    if problems:raise ValueError(problems)
    write_json_atomic(args.output,dict(bundle_version='1.0.0',source_label='pi0-down-projection-links',
        datasets={'runtime_realizations':[record],'operator_kernel_links':links}))
    print(f'Staged 2 Down groups and {len(links)} independent observation links')
    return 0

if __name__=='__main__':raise SystemExit(main())
