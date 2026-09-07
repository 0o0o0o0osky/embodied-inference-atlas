"""Stage a single source-audited FlashRT GEMM roofline pairing; never collect."""
from __future__ import annotations
import argparse
import copy
from pathlib import Path
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.site import load_validated_datasets
from tools.lib.promotion import plan_promotion

SIGNATURE='kernel-signature-pi0-flashrt-large-gemm-027'
CAPTURE='capture-pi0-flashrt-nsys-node-002'
REALIZATION='rr-flashrt-pi0-thor-fp8-v1'
SCENARIO='scenario-pi0-flashrt-prefix-gate-up-fp8'
BASIS='basis-pi0-flashrt-prefix-gate-up-node-002'
POINT='point-pi0-flashrt-prefix-gate-up-node-002'
CONDITION=('GEMM core multiply-add work only; FP32 alpha epilogue, output conversion and scheduling instructions are not modeled. '
           'FP8 activation/weight read once, FP16 output written once; beta=0. Kernel-boundary modeled bytes, not measured DRAM. '
           'Timing is the complete selected Nsys Kernel intervals in one prediction, not NCU replay or unprofiled timing. '
           'Conditional Thor 120W/1.386GHz/273GB/s reference, without matching observed GPU/EMC clocks; no efficiency or attainment gap.')


def provenance(expression, measured=False):
    return dict(evidence='measured_local' if measured else 'analytical',
        **{'class':'measured_empirical' if measured else 'analytical_model'},source_ids=['source-local-thor','source-flashrt'],
        derivation=dict(kind='formula',expression=expression,input_refs=['flash_rt/hardware/thor/shared_primitives.py#encoder_forward','csrc/gemm/gemm_types_sm100.h#sm100_t1']),condition=CONDITION)


def build_bundle(datasets,audit):
    if audit['revision']!='054bea4d02ebc63f6a0c45991c6061b1e1caa46c' or audit['signature_id']!=SIGNATURE or audit['capture_id']!=CAPTURE:
        raise ValueError('Expected the retained source-audited FlashRT case')
    if tuple(audit['shape'][k] for k in ('M','N','K'))!=(304,32768,2048):raise ValueError('Unexpected audited workload')
    observations=[o for o in datasets['kernel_observations'] if o['capture_id']==CAPTURE and o['kernel_signature_id']==SIGNATURE]
    if len(observations)!=1:raise ValueError('Expected one Nsys observation')
    o=observations[0];t=next(t for t in datasets['timelines']if t['capture_id']==CAPTURE)
    events=sorted([e for e in t['events']if e.get('kernel_signature_id')==SIGNATURE],key=lambda e:e['start_ns'])
    if len(events)!=17 or o['calls']!=17 or any(e['count']!=1 for e in events):raise ValueError('Expected 17 actual calls in one prediction')
    if [e['event_id'] for e in events]!=[e['event_id']for e in audit['event_sequence']]:raise ValueError('Audit event sequence differs')
    duration=sum(e['duration_ns'] for e in events)
    if duration!=o['duration']['value_ns'] or duration!=audit['duration_sum_ns']:raise ValueError('Nsys duration differs from the audit')
    for field in ('grid','block','registers_per_thread','static_shared_memory_bytes','dynamic_shared_memory_bytes'):
        if o['launch'][field]!=audit['launch'][field] or any(e['launch'][field]!=audit['launch'][field] for e in events):raise ValueError('Launch resources differ')
    run=next(r for r in datasets['runs'] if r['run_id']==o['run_id'])
    if run['capture_method']!='nsys' or tuple(run['workload']['vla'][k]for k in ('camera_views','executed_prompt_tokens','action_chunk','denoise_steps'))!=(1,48,10,10):raise ValueError('Wrong runtime shape or timing acquisition')
    ceiling=next(c for c in datasets['roofline_ceilings']if c['ceiling_id']=='thor-t5000-120w-1386mhz')
    peak=next(c['flop_per_second'] for c in ceiling['compute']if c['compute_class']=='tensor_fp8_e4m3_dense');bw=ceiling['bandwidth'][0]
    scenario=copy.deepcopy(next(s for s in datasets['roofline_scenarios']if s['scenario_id']=='scenario-pi0-fp8_w8a8-default'))
    scenario.update(scenario_id=SCENARIO,label='FlashRT prefix Gate/Up FP8 GEMM boundary',origin='captured_kernel',modeling_scope='implementation_modeled',model_artifact_id=run['model_artifact_id'],provenance=provenance('Unique T1 template callsite: M=Se=304, N=2H=32768, K=D=2048'),missing=[])
    realization=next(r for r in datasets['runtime_realizations']if r['realization_id']==REALIZATION)
    applicability=realization['workload_applicability'];vla=run['workload']['vla']
    if applicability['runtime_internal_action_dimension']!=32 or applicability['public_action_dimension']!=7 or applicability['runtime_action_horizon']!=vla['action_chunk']:
        raise ValueError('Implementation action dimensions differ from the audited case')
    scenario['workload']=dict(batch_size=run['workload']['common']['batch_size'],active_camera_views=vla['camera_views'],executed_camera_views=vla['camera_views'],
        raw_image_height=vla['image_height'],raw_image_width=vla['image_width'],executed_image_height=vla['image_height'],executed_image_width=vla['image_width'],
        semantic_prompt_tokens=vla['semantic_prompt_tokens'],executed_prompt_tokens=vla['executed_prompt_tokens'],action_horizon=vla['action_chunk'],denoise_steps=vla['denoise_steps'],
        internal_action_dimension=applicability['runtime_internal_action_dimension'],public_action_dimension=applicability['public_action_dimension'],work_unit='action_chunk')
    scenario['precision_path'].update(kind='uniform',runtime_support='proven',realization_ids=[REALIZATION])
    segment=scenario['precision_path']['segments'][0];segment['selector']=dict(kind='execution_groups',refs=['prefix-merged-gate-up']);segment['output'].update(format='fp16',bits_per_value=16)
    for encoding in ('weight','activation','output'):
        segment[encoding].update(tensor_scale_bytes=0,scale_format='none',provenance=provenance('FP8 E4M3 A/B; FP16 output; calibrated descale is a by-value alpha kernel parameter, not another tensor'))
    basis=copy.deepcopy(next(b for b in datasets['roofline_bases']if b.get('traffic_basis')=='kernel_boundary_modeled'))
    basis.update(basis_id=BASIS,label='FlashRT Gate/Up: one Nsys prediction, modeled boundary traffic',scenario_id=SCENARIO,precision_path_id='fp8_w8a8',ceiling_id=ceiling['ceiling_id'],bandwidth_ceiling_id=bw['bandwidth_ceiling_id'],device_id=run['device_id'],operating_point_id=ceiling['operating_point']['operating_point_id'],runtime_id='flashrt',realization_id=REALIZATION,run_id=run['run_id'],capture_id=CAPTURE,provenance=provenance('Identical GEMM core work and modeled boundary bytes for theoretical reference and observed point'))
    p=copy.deepcopy(next(p for p in datasets['roofline_points']if p['basis_id']==next(b['basis_id']for b in datasets['roofline_bases']if b.get('traffic_basis')=='kernel_boundary_modeled')))
    m,n,k,calls=304,32768,2048,17;flop=2*m*n*k*calls;byte=(m*k+n*k+2*m*n)*calls
    compute,memory,observed=flop/peak,byte/bw['byte_per_second'],duration/1e9;roof=max(compute,memory)
    p.update(point_id=POINT,basis_id=BASIS,calls=calls,values_scope='all_calls',entity=dict(kind='kernel',entity_id=o['observation_id'],label='Prefix Gate/Up GEMM',logical_refs=[],coverage_key=o['observation_id']+':same-window-shape',shape_or_coverage='M=304, N=32768, K=2048; FP8 E4M3 A/B, FP32 accumulation, FP16 output; 17 same-shape launches; alpha epilogue work excluded'),provenance=provenance('Source template/callsite plus one-window exact Nsys launch sequence; no NCU timing substitution',True))
    p['work']=dict(total_flop=flop,components=[dict(component_id='gemm',kind='gemm',compute_class='tensor_fp8_e4m3_dense',flop=flop,comparison_ops=0,transcendental_ops=0,integer_ops=0,provenance=provenance('2*304*32768*2048*17; FMA=2; alpha epilogue arithmetic excluded'))])
    p['traffic']=dict(memory_domain='system_memory',value_kind='modeled',components=[dict(component_id=name,kind=kind,byte=value*calls,tensor_ref=name,provenance=provenance('One compulsory tensor read/write at Kernel boundary; no measured DRAM or cache-hit claim'))for name,kind,value in [('activation','input_read',m*k),('weight','weight_read',n*k),('output','boundary_output_write',2*m*n)]],excluded_internal=[],total_byte=byte)
    p['timing']=dict(observed_second=observed,statistic='sum',sample_count=calls,timing_boundary_id='nsys_selected_kernel_intervals_one_prediction')
    p['coverage']=dict(status='partial',included_refs=[SIGNATURE],omitted=[dict(ref='alpha_epilogue_and_cast',reason='FP32 alpha multiplication and output conversion execute inside the timed Kernel but are outside modeled GEMM core work.'),dict(ref='outside_selected_kernel_boundary',reason='Separate GEGLU/FP8 conversion, other kernels, CPU and transfers excluded.')])
    p['derived']=dict(status='partial_lower_bound',arithmetic_intensity_flop_per_byte=flop/byte,compute_second=compute,memory_second=memory,roof_second=roof,roof_flop_per_second=flop/roof,achieved_flop_per_second=flop/observed,efficiency=None,gap=None,limiter='compute' if compute>memory else 'memory')
    p['missing']=[dict(field='efficiency',reason='incompatible_basis',detail='GPU/EMC clocks not matched; conditional reference only.'),dict(field='gap',reason='incompatible_basis',detail='No matched attainment or achievable acceleration claim.')]
    return dict(bundle_version='1.0.0',source_label='pi0-flashrt-gate-up-roofline',datasets=dict(roofline_scenarios=[scenario],roofline_bases=[basis],roofline_points=[p]))


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--audit',type=Path,default=Path('.local/runtime-records-20260907/flashrt-gate-up-audit.json'));parser.add_argument('--output',type=Path,default=Path('.local/staging/flashrt-gate-up-roofline.json'));args=parser.parse_args()
    if not args.output.resolve().is_relative_to(Path.cwd()/'.local/staging'):parser.error('Output must be under .local/staging; promote separately')
    datasets=load_validated_datasets(Path.cwd()/'data',Path.cwd());bundle=build_bundle(datasets,load_json(args.audit));plan_promotion(bundle,Path.cwd());write_json_atomic(args.output,bundle)
    print(args.output)

if __name__=='__main__':main()
