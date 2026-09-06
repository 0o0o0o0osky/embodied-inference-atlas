"""Stage source-audited shared GEMM classes and native reuse; no layer attribution."""
import copy,json
from pathlib import Path
from tools.lib.site import load_validated_datasets
from tools.lib.jsonio import write_json_atomic
from tools.lib.promotion import plan_promotion
from tools.lib.runtime_realization import runtime_realization_problems

def main():
 root=Path.cwd();ds=load_validated_datasets(root/'data',root);r=copy.deepcopy(next(x for x in ds['runtime_realizations'] if x['realization_id']=='rr-vla-cpp-pi0-thor-bf16-f32-v1'));new=json.load(open(root/'.local/staging/pi0-full-cpu-trace.json'))['datasets']
 evidence_id='vlacpp-fixed-instance-shapes';r['evidence'].append(dict(evidence_id=evidence_id,kind='source_code',source_id='source-vla-cpp',revision=r['runtime_revision'],locator='src/models/pi0.cpp#build_gemma_layer',run_ids=[],observation_ids=[]))
 r['evidence'].append(dict(evidence_id='vlacpp-fixed-instance-capture',kind='runtime_trace',source_id='source-local-thor',revision=None,locator=None,run_ids=[x['run_id'] for x in new['runs']],observation_ids=[]))
 r['precision_paths'].append(dict(precision_path_id='bf16-gemm-fp32-output',label='BF16 GEMM / FP32 accumulation and output',weight_dtype='bf16',activation_dtype='bf16',accumulation_dtype='fp32',output_dtype='fp32',quant_scheme='none',missing_fields=[],missing_reason_code=None,evidence_ids=[evidence_id]))
 r['configuration_ids']+= [x['configuration_id'] for x in new['runs']]
 r['launch'].update(cuda_graph_state='present',evidence_ids=[evidence_id,'vlacpp-pi0-predict-source','vlacpp-fixed-instance-capture'])
 groups=[('action-mlp-expansion','动作专家 Gate/Up 投影','action-flow-decoder/action-expert-blocks','4096x51x1024'),('prefix-mlp-expansion','Prefix Gate/Up 投影','prefix-encoder/prefix-blocks','16384x304x2048')]
 links=[]
 for gid,label,scope,shape in groups:
  sid='kernel-signature-pi0-vlacpp-bf16-gemm-'+shape
  evidence=[evidence_id,'vlacpp-pi0-layer-source'];selectors=[dict(scope_ref=scope,selection='all',indices=[])]
  if gid.startswith('action'):selectors.insert(0,dict(scope_ref='action-flow-decoder/action-flow-loop',selection='all',indices=[]))
  targets=[dict(ref=scope+'/feed-forward/'+name,repeat_selectors=selectors) for name in ['gate-projection','up-projection']]
  r['execution_groups'].append(dict(execution_group_id=gid,label=label,kind='backend_op',implementation='Separate gate and up cublas GEMMs; shared exact-shape class, individual gate/up attribution unavailable',precision_path_id='bf16-gemm-fp32-output',repeat_selectors=selectors,dependency_group_ids=[],kernel_signature_ids=[sid],kernel_resolution='partial',unmapped_reason_code=None,evidence_ids=evidence))
  r['mappings'].append(dict(mapping_id='map-'+gid,logical_targets=targets,execution_group_ids=[gid],relation='preserved',path='primary',certainty='ambiguous',method='source_audit',confidence='medium',reason_code='shared_gate_up_signature_not_split',evidence_ids=evidence))
  for obs in new['kernel_observations']:
   if obs['kernel_signature_id']!=sid:continue
   suffix=obs['observation_id'].removeprefix('kernel-observation-')
   links.append(dict(link_id='operator-kernel-link-'+suffix+('_001' if '_r' in suffix else '-001'),observation_id=obs['observation_id'],kernel_signature_id=sid,run_id=obs['run_id'],model_graph_id=r['model_graph_id'],logical_targets=targets,realization_id=r['realization_id'],execution_group_ids=[gid],mapping_method='combined',status='partial',confidence='high',coverage=dict(mapped_launches=obs['calls'],population_launches=obs['calls'],unit='launch'),evidence_ids=[obs['capture_id']],reason_code='ambiguous_attribution'))
 r['reuse']=[dict(reuse_id='native-prefix-kv',label='单次观测 Prefix K/V',kind='computed_result',producer_refs=['prefix-encoder/prefix-blocks/self-attention/key-projection','prefix-encoder/prefix-blocks/self-attention/value-projection'],consumer_refs=['action-flow-decoder/action-expert-blocks/self-attention/attention'],lifetime='observation',repeat_scope='同一次观测的10个去噪步骤',value_dependencies=['image content','prompt tokens','positions','model weights'],invalidation_conditions=['new observation executes prefix graph again','prefix inputs or model weights change'],implementation_status='implemented',evidence_ids=['vlacpp-pi0-predict-source'],storage_bytes=None,preparation_ns=None,read_ns=None),dict(reuse_id='native-main-graph-plan',label='原生 CUDA Graph 与 GGML 执行计划',kind='execution_plan',producer_refs=[],consumer_refs=[],lifetime='across_observations',repeat_scope='同一模型对象、兼容输入形状下的后续预测；后端计划对象不对应单一逻辑算子',value_dependencies=['image token count','prompt token count','denoise step count','backend graph topology'],invalidation_conditions=['MainKey changes rebuild GGML graph','backend graph update or model lifecycle ends'],implementation_status='implemented',evidence_ids=[evidence_id,'vlacpp-pi0-predict-source'],storage_bytes=None,preparation_ns=None,read_ns=None)]
 r['reuse'].append(dict(reuse_id='native-time-embedding-observation',label='每次预测生成并上传时间嵌入',kind='computed_result',producer_refs=['action-flow-decoder/action-suffix-builder/time-embedding'],consumer_refs=['action-flow-decoder/action-suffix-builder/action-time-concat'],lifetime='observation',repeat_scope='本次预测的固定10步时间计划；每步嵌入广播至chunk输入，下一次预测重新计算与上传',value_dependencies=['timestep schedule','embedding width','chunk length','sinusoidal embedding parameters'],invalidation_conditions=['next predict recomputes and uploads all timestep embeddings','schedule or embedding shape changes'],implementation_status='implemented',evidence_ids=['vlacpp-pi0-predict-source'],storage_bytes=None,preparation_ns=None,read_ns=None))
 bundle=dict(bundle_version='1.0.0',source_label='pi0-instance-realization',datasets={'runtime_realizations':[r],'operator_kernel_links':links})
 issues=runtime_realization_problems(r,next(g for g in ds['model_graphs'] if g['model_graph_id']==r['model_graph_id']))
 if issues:raise ValueError(issues)
 write_json_atomic(root/'.local/staging/pi0-instance-realization.json',bundle)
 try:plan_promotion(bundle,root)
 except Exception as e:print(type(e).__name__,str(e),getattr(e,'issues',None));return 1
 print('Staged shared gate/up mappings and native reuse');return 0
if __name__=='__main__':raise SystemExit(main())
