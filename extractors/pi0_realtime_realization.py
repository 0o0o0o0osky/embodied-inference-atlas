"""Stage the fixed Pi0 realtime-vla source flow and prefix/decoder fusion mappings.

Only exact unique stage symbols observed in the selected capture are linked.
Generic matmul symbols, layer ownership, numeric work and whole-runtime
accumulation precision are deliberately not inferred.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.site import load_validated_datasets
from tools.lib.runtime_realization import runtime_realization_problems

REVISION = 'b86a942a073ea241f9bd6916a705f81906f4638b'
REALIZATION = 'rr-realtime-vla-pi0-thor-bf16-v1'
CONFIGURATION = 'cfg-pi0-realtime-vla-fixed-001'
ACTION = 'action-flow-decoder/action-expert-blocks'
PREFIX = 'prefix-encoder/prefix-blocks'
SUFFIX = 'action-flow-decoder/action-suffix-builder'


def build_realization(signatures, observations, *, capture_id=None):
    evidence = [dict(evidence_id='realtime-'+name, kind='source_code', source_id='source-realtime-vla',
        revision=REVISION, locator=locator, run_ids=[], observation_ids=[]) for name, locator in [
        ('model', 'pi0_infer.py#pi0_model'), ('graph', 'pi0_infer.py#Pi0Inference.record_infer_graph'),
        ('forward', 'pi0_infer.py#Pi0Inference.forward'), ('prefix', 'pi0_infer.py#transformer_encoder'),
        ('decoder', 'pi0_infer.py#transformer_decoder'), ('weights', 'convert_from_jax.py#time_dependent_biases'),
        ('qkv', 'pi0_infer.py#scaled_matmul_rope_qkv'), ('gate', 'pi0_infer.py#scaled_matmul_small_gate'),
        ('prefix-gate', 'pi0_infer.py#matmul_small_gate'), ('init', 'pi0_infer.py#Pi0Inference.__init__')]]
    # Harness is a local run artifact, not a fictitious upstream source file.
    evidence.append(dict(evidence_id='realtime-harness', kind='canonical_run', source_id='source-local-thor',
        revision=None, locator=None,
        run_ids=['run-pi0-realtime-vla-w5-r10-001'], observation_ids=[]))
    selectors = [dict(scope_ref=ref, selection='all', indices=[]) for ref in ['action-flow-decoder/action-flow-loop', ACTION]]
    groups, mappings, links = [], [], []
    specs = [
        ('prefix-gate-up', '前缀 Gate/Up 与 GELU 乘积', 'matmul_small_gate', 'prefix-gate',
         ['feed-forward/gate-projection', 'feed-forward/up-projection', 'feed-forward/gate-gelu', 'feed-forward/gate-product'],
         '独立 RMSNorm 之后，融合 Gate/Up 矩阵乘法、近似 GELU 与乘积；仅前缀层 0–16，最后一层仅生成 K/V。'),
        ('action-qkv-rope', '动作 QKV 与 RoPE', 'scaled_matmul_rope_qkv', 'qkv',
         ['self-attention/query-projection', 'self-attention/key-projection', 'self-attention/value-projection', 'self-attention/query-rope', 'self-attention/key-rope'],
         '读取独立 RMS 因子，完成比例缩放、Q/K/V 投影、Q/K RoPE 和 K/V 写入；RMS 因子由另一个 Kernel 生成。'),
        ('action-gate-up', '动作 Gate/Up 与 GELU 乘积', 'scaled_matmul_small_gate', 'gate',
         ['feed-forward/gate-projection', 'feed-forward/up-projection', 'feed-forward/gate-gelu', 'feed-forward/gate-product'],
         '读取独立 RMS 因子，对输入缩放，融合 Gate/Up 矩阵乘法、近似 GELU 与逐元素乘积；不包含 RMS 因子计算。')]
    for gid, label, symbol, proof, refs, implementation in specs:
        native = [o for o in observations if o['capture_id'] == capture_id]
        seen = {o['kernel_signature_id'] for o in native}
        ids = sorted(s['kernel_signature_id'] for s in signatures if s['symbol'] == symbol and s['kernel_signature_id'] in seen)
        prefix = gid.startswith('prefix')
        scope = PREFIX if prefix else ACTION
        selected_repeats = [dict(scope_ref=PREFIX, selection='indices', indices=list(range(17)))] if prefix else selectors
        evidence_ids = ['realtime-'+proof, 'realtime-prefix' if prefix else 'realtime-decoder']
        if ids:
            evidence_id = 'realtime-'+gid+'-trace'
            evidence.append(dict(evidence_id=evidence_id, kind='profiler_correlation', source_id='source-local-thor',
                revision=None, locator=None, run_ids=sorted({o['run_id'] for o in native if o['kernel_signature_id'] in ids}),
                observation_ids=[o['observation_id'] for o in native if o['kernel_signature_id'] in ids]))
            evidence_ids.append(evidence_id)
        targets = [dict(ref=scope+'/'+ref, repeat_selectors=selected_repeats) for ref in refs]
        groups.append(dict(execution_group_id=gid, label=label, kind='custom_op', implementation=implementation,
            precision_path_id='bf16-fused-fp32-accumulation', repeat_selectors=selected_repeats, dependency_group_ids=[],
            kernel_signature_ids=ids, kernel_resolution='resolved' if ids else 'not_collected',
            unmapped_reason_code=None, evidence_ids=evidence_ids))
        mappings.append(dict(mapping_id='map-'+gid, logical_targets=targets, execution_group_ids=[gid],
            relation='fused', path='primary', certainty='exact', method='source_audit', confidence='high',
            reason_code=None, evidence_ids=evidence_ids))
        for o in native:
            if o['kernel_signature_id'] not in ids: continue
            links.append(dict(link_id='operator-kernel-link-'+o['observation_id'].removeprefix('kernel-observation-')+'_001',
                observation_id=o['observation_id'], kernel_signature_id=o['kernel_signature_id'], run_id=o['run_id'],
                model_graph_id='pi0-logical-v1', logical_targets=targets, realization_id=REALIZATION,
                execution_group_ids=[gid], mapping_method='combined', status='resolved', confidence='high',
                coverage=dict(mapped_launches=o['calls'], population_launches=o['calls'], unit='launch'),
                evidence_ids=[capture_id], reason_code=None))
    def node(nid, label, lane, step, operation, reads, writes, proof, reuse=None):
        return dict(node_id=nid, label=label, lane=lane, step=step, operation=operation,
            reads=reads, writes=writes, reuse=reuse, evidence_ids=['realtime-'+p for p in proof])
    nodes = [
        node('prepare','输入归一化','cpu',0,'固定测量 harness 在 CPU 归一化图像及状态；噪声与提示来自预备输入。', ['图像','状态','噪声'],['归一化输入'],['harness']),
        node('upload','上传与固定缓冲区复制','gpu',1,'harness 转 CUDA BF16；forward 再 copy_ 至 Graph 固定输入地址。这些复制不在捕获图内。',['归一化输入'],['固定 GPU 输入'],['harness','forward']),
        node('submit','提交全模型图','cpu',2,'调用一次 infer_graph.replay；提交返回不表示 GPU 工作完成。',[],['图提交'],['forward'], '复用执行计划，不缓存当前观测计算结果'),
        node('prompt','复制语言 embedding','gpu',2,'record_run 将权重中预备好的语言 embedding 复制到 prefix 尾部。',['预备语言 embedding'],['语言 token'],['graph']),
        node('vision','视觉编码','gpu',3,'patch embedding 与 27 层视觉 Transformer；归一化和部分 GEMM 是独立 Kernel。',['固定 GPU 图像'],['GPU 视觉 token'],['model']),
        node('prefix','多模态前缀与 K/V','gpu',4,'视觉投影后运行 18 层前缀；最后层仅生成动作专家需要的 K/V，跳过不再消费的注意力输出和 MLP。',['视觉 token','语言 token'],['Prefix K/V'],['prefix'],'每观测重新生成，同观测 10 步复用'),
        node('action','状态投影与动作去噪','gpu',5,'状态投影一次；随后 10 步各运行 18 层动作专家，读取时间偏置、Prefix K/V，融合输出投影与 Euler 更新。',['Prefix K/V','状态','时间偏置','噪声'],['BF16 动作'],['decoder','weights'],'状态 token 与 Prefix K/V 在单次观测内复用'),
        node('download','转换与回读','gpu',6,'harness 将输出转 FP32，再执行完成请求所需的 CPU 回读；原 forward 只返回 GPU Tensor。',['BF16 动作'],['CPU FP32 动作'],['harness','forward']),
        node('output','动作反归一化','cpu',7,'前 7 维按统计量反归一化，其余维置零；外部计时包含此步骤。',['CPU FP32 动作'],['50×32 动作数组'],['harness'])]
    edges = [dict(from_=a,to=b,kind='data',label=label) for a,b,label in [
        ('prepare','upload','上传输入'),('upload','vision','固定 GPU 图像'),('prompt','prefix','语言 embedding'),
        ('vision','prefix','GPU 视觉结果'),('prefix','action','逐层 K/V'),('action','download','动作'),('download','output','下载完成')]]
    for e in edges: e['from'] = e.pop('from_')
    edges += [dict(**{'from':'submit'},to='prompt',kind='control',label='一次 Graph replay'),
              dict(**{'from':'prefix'},to='action',kind='reuse',label='同观测 K/V 复用')]
    def reuse(rid,label,kind,lifetime,producers,consumers,scope,deps,invalid,proof,storage=None):
        return dict(reuse_id=rid,label=label,kind=kind,lifetime=lifetime,producer_refs=producers,consumer_refs=consumers,
            repeat_scope=scope,value_dependencies=deps,invalidation_conditions=invalid,implementation_status='implemented',
            evidence_ids=['realtime-'+p for p in proof],storage_bytes=storage,preparation_ns=None,read_ns=None)
    record = dict(realization_id=REALIZATION,model_id='pi0',model_graph_id='pi0-logical-v1',runtime_id='realtime-vla',
        runtime_revision=REVISION,availability='measured' if links else 'source_audited',availability_reason_code='source_and_selected_trace' if links else 'source_audit_pending_kernel_correlation',
        mapping_level='custom_runtime',mapping_coverage='partial',model_artifact_ids=['pi0-realtime-vla-libero-v044-p48'],
        configuration_ids=[CONFIGURATION, 'config-pi0-realtime-vla-nsys-node-004'],device_ids=['nvidia-jetson-agx-thor'],
        launch=dict(submission_mode='cuda_graph_replay',cuda_graph_state='present',capture_scope='whole_prediction',evidence_ids=['realtime-graph']),
        workload_applicability=dict(denoise_steps=10,public_action_horizon=None,runtime_action_horizon=None,
            public_action_dimension=32,runtime_internal_action_dimension=32,evidence_ids=['realtime-init','realtime-harness'],missing_reason_code='chunk_size_is_constructor_parameter'),
        precision_paths=[dict(precision_path_id='bf16',label='BF16 权重、主激活及 K/V；累加依 Kernel',
            weight_dtype='bf16',activation_dtype='bf16',output_dtype='bf16',accumulation_dtype=None,quant_scheme='none',
            missing_fields=['accumulation_dtype'],missing_reason_code='not_established_by_source',evidence_ids=['realtime-init']),
            dict(precision_path_id='bf16-fused-fp32-accumulation',label='已审计融合核：BF16 输入/输出、FP32 累加',
                weight_dtype='bf16',activation_dtype='bf16',output_dtype='bf16',accumulation_dtype='fp32',quant_scheme='none',
                missing_fields=[],missing_reason_code=None,evidence_ids=['realtime-qkv','realtime-gate','realtime-prefix-gate'])],
        evidence=evidence,execution_groups=groups,mappings=mappings,
        system_flow=dict(semantics='qualitative_order',nodes=nodes,edges=edges,
            groups=[dict(kind='cuda_graph',label='一个全模型 CUDA Graph',node_ids=['prompt','vision','prefix','action']),
                    dict(kind='repeat',label='状态投影后执行 10 步',node_ids=['action'])],
            notes=['位置只表达源码执行顺序，不表示耗时。','Graph 外包含输入上传与固定缓冲区复制、输出转换及回读。',
                   '主存储为 BF16；split-K 临时缓冲区包含 FP32，不能据此断言全部 Kernel 的执行与累加精度。',
                   '固定提示 embedding 在测量前准备；10 步时间偏置在权重转换时预计算。']),
        reuse=[
            reuse('prefix-kv','单观测 Prefix K/V','computed_result','observation',
                [PREFIX+'/self-attention/key-projection',PREFIX+'/self-attention/value-projection'],[ACTION+'/self-attention/attention'],
                '当前观测的 10 步',['图像','提示 embedding','位置','权重'],['新观测重算前缀'],['prefix','decoder']),
            reuse('time-bias','离线预计算时间偏置','computed_result','across_observations',[SUFFIX+'/time-embedding'],[],
                '同一权重与固定 10 步计划',['时间计划','动作输入投影及 MLP 权重'],['权重或时间计划改变需重新转换'],['weights'],10*1024*2),
            reuse('state-token','单观测状态投影','computed_result','observation',[],[],
                '投影一次，每步复制到 token 0',['当前状态','状态投影权重'],['下一观测状态重新投影'],['decoder']),
            reuse('graph-plan','全模型 Graph 计划','execution_plan','across_observations',[],[],
                '同一推理对象与固定形状',['固定输入地址','view/prompt/chunk 形状','模型权重'],['重建模型对象或输入形状改变'],['graph','init'])])
    return record, links


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trace-bundle',type=Path,required=True)
    parser.add_argument('--capture-id',required=True)
    parser.add_argument('--signature-manifest',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('.local/staging/pi0-realtime-realization.json'))
    args=parser.parse_args(argv); root=Path.cwd()
    if not args.output.resolve().is_relative_to((root/'.local/staging').resolve()): raise ValueError('Staging output required')
    datasets=load_json(args.trace_bundle)['datasets']
    if args.capture_id not in {c['capture_id'] for c in datasets.get('profiler_captures',[])}: raise ValueError('Capture not present in staged trace')
    signatures=json.loads(args.signature_manifest.read_text())
    canonical_ids={s['kernel_signature_id'] for s in datasets.get('kernel_signatures',[])}
    if any(s['kernel_signature_id'] not in canonical_ids for s in signatures): raise ValueError('Manifest must match staged canonical signatures')
    observed=datasets.get('kernel_observations',[])
    for signature in signatures:
        symbol=signature['symbol']
        if symbol not in {'matmul_small_gate','scaled_matmul_small_gate','scaled_matmul_rope_qkv'}: continue
        expected=f'source-realtime-vla@{REVISION}:pi0_infer.py#{symbol}'
        if signature.get('source') != expected: raise ValueError('Fusion requires the audited upstream source revision')
        matches=[o for o in observed if o['capture_id']==args.capture_id and o['kernel_signature_id']==signature['kernel_signature_id']]
        if any(o['launch'] != signature['launch'] for o in matches): raise ValueError('Manifest launch does not match retained observation')
    record,links=build_realization(signatures,observed,capture_id=args.capture_id)
    data=load_validated_datasets(root/'data',root)
    graph=next(g for g in data['model_graphs'] if g['model_graph_id']==record['model_graph_id'])
    problems=runtime_realization_problems(record,graph)
    if problems: raise ValueError(problems)
    write_json_atomic(args.output,dict(bundle_version='1.0.0',source_label='pi0-realtime-source-mapping',
        datasets={'runtime_realizations':[record],'operator_kernel_links':links}))
    print(f'Staged realtime realization; {len(links)} observed fusion links')
    return 0

if __name__=='__main__': raise SystemExit(main())
