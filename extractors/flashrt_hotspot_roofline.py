"""Stage the two audited homogeneous FlashRT GEMM classes; no new acquisition."""
import argparse
import copy
import json
from pathlib import Path
from extractors.flashrt_fixed_hotspot_links import hotspot_bundle, CAPTURE, PREFIX, SOURCE_FILES
from extractors.flashrt_gate_up_roofline import REALIZATION, SCENARIO, BASIS, POINT, provenance
from tools.lib.jsonio import write_json_atomic
from tools.lib.promotion import plan_promotion
from tools.lib.site import load_validated_datasets

# Exact callsites were checked by flashrt_fixed_hotspot_links, including symbol,
# full launch configuration, stream, neighboring operations and source revision.
PAIRS=[('second-gemm-029','prefix-down-projection','prefix-down','Prefix Down GEMM',(304,2048,16384),17),
       ('nvjet-512x16-043','action-merged-gate-up','action-gate-up','Action Gate/Up GEMM',(11,8192,1024),180)]

def build_bundle(data,manifest):
    hotspot_bundle(data,manifest)  # Revalidate the original strict order/geometry audit.
    realization=next(r for r in data['runtime_realizations'] if r['realization_id']==REALIZATION)
    timeline=next(t for t in data['timelines'] if t['capture_id']==CAPTURE)
    result={key:[] for key in ('roofline_scenarios','roofline_bases','roofline_points')}
    templates={key:next(r for r in data[key] if r[field]==identifier) for key,field,identifier in [
        ('roofline_scenarios','scenario_id',SCENARIO),('roofline_bases','basis_id',BASIS),('roofline_points','point_id',POINT)]}
    ceiling=next(c for c in data['roofline_ceilings'] if c['ceiling_id']==templates['roofline_bases']['ceiling_id'])
    peak=next(c['flop_per_second'] for c in ceiling['compute'] if c['compute_class']=='tensor_fp8_e4m3_dense')
    bw=next(c['byte_per_second'] for c in ceiling['bandwidth'] if c['bandwidth_ceiling_id']==templates['roofline_bases']['bandwidth_ceiling_id'])
    for name,group_id,slug,label,(m,n,k),calls in PAIRS:
        sid=PREFIX+name
        group=next(g for g in realization['execution_groups'] if g['execution_group_id']==group_id)
        precision=next(p for p in realization['precision_paths'] if p['precision_path_id']==group['precision_path_id'])
        if tuple(precision[x] for x in ('activation_dtype','weight_dtype','accumulation_dtype','output_dtype'))!=('fp8_e4m3','fp8_e4m3','fp32','fp16'):
            raise ValueError('Audited precision changed')
        if group['kernel_signature_ids']!=[sid]:raise ValueError('Audited execution group changed')
        o=next(o for o in data['kernel_observations'] if o['capture_id']==CAPTURE and o['kernel_signature_id']==sid)
        events=[e for e in timeline['events'] if e.get('kernel_signature_id')==sid]
        duration=sum(e['duration_ns'] for e in events)
        if len(events)!=calls or o['calls']!=calls or any(e['count']!=1 or e['evidence_semantics']!='exact_interval' for e in events) or duration!=o['duration']['value_ns']:
            raise ValueError('Nsys single-shape population changed')
        if o['run_id']!=templates['roofline_bases']['run_id']:raise ValueError('Unexpected independent run')
        scenario,basis,point=(copy.deepcopy(templates[key]) for key in result)
        scenario['scenario_id']=f'scenario-pi0-flashrt-{slug}-fp8';scenario['label']=label+' boundary'
        scenario['precision_path']['segments'][0]['selector']={'kind':'execution_groups','refs':[group_id]}
        basis.update(basis_id=f'basis-pi0-flashrt-{slug}-node-002',scenario_id=scenario['scenario_id'],label=label+': Nsys intervals and modeled boundary')
        flop=2*m*n*k*calls;byte=(m*k+n*k+2*m*n)*calls
        compute,memory,observed=flop/peak,byte/bw,duration/1e9;roof=max(compute,memory)
        point.update(point_id=f'point-pi0-flashrt-{slug}-node-002',basis_id=basis['basis_id'],calls=calls)
        point['entity'].update(entity_id=o['observation_id'],label=label,coverage_key=o['observation_id']+':same-window-shape',
            shape_or_coverage=f'M={m}, N={n}, K={k}; FP8 E4M3 A/B, FP32 accumulation, FP16 output; {calls} same-shape launches; scaling epilogue work excluded')
        point['work']['total_flop']=flop;point['work']['components'][0]['flop']=flop
        point['traffic']['total_byte']=byte
        for component,value in zip(point['traffic']['components'],[m*k,n*k,2*m*n]):component['byte']=value*calls
        point['timing'].update(observed_second=observed,sample_count=calls)
        point['coverage']['included_refs']=[sid]
        point['derived'].update(arithmetic_intensity_flop_per_byte=flop/byte,compute_second=compute,memory_second=memory,roof_second=roof,
            roof_flop_per_second=flop/roof,achieved_flop_per_second=flop/observed,efficiency=None,gap=None,limiter='compute' if compute>memory else 'memory')
        # Replace template-specific provenance at every level, while retaining
        # its partial-core-work and modeled-boundary contract.
        def rewrite(value):
            if isinstance(value,dict):
                if 'provenance' in value:
                    measured=value['provenance']['evidence']=='measured_local'
                    p=provenance(f'GEMM 2*{m}*{n}*{k} per call; boundary A={m}*{k}, B={n}*{k}, C=2*{m}*{n} bytes; {calls} calls; source-ordered Nsys observation {o["observation_id"]}',measured)
                    p['derivation']['input_refs']=SOURCE_FILES
                    p['condition']=p['condition'].replace('FP32 alpha epilogue','FP32 scaling epilogue')
                    value['provenance']=p
                for key,child in value.items():
                    if key!='provenance':rewrite(child)
            elif isinstance(value,list):
                for child in value:rewrite(child)
        for key,value in zip(result,[scenario,basis,point]):rewrite(value);result[key].append(value)
    return dict(bundle_version='1.0.0',source_label='flashrt-two-homogeneous-gemm-roofline',datasets=result)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,default=Path('.local/flashrt-fixed-001/signature-manifest.json'))
    p.add_argument('--output',type=Path,default=Path('.local/staging/flashrt-hotspot-roofline.json'))
    a=p.parse_args();root=Path.cwd()
    if not a.output.resolve().is_relative_to(root/'.local/staging'):p.error('Output must be under .local/staging')
    bundle=build_bundle(load_validated_datasets(root/'data',root),json.loads(a.manifest.read_text()))
    plan_promotion(bundle,root);write_json_atomic(a.output,bundle);print(a.output)
if __name__=='__main__':main()
