"""Import a bounded fixed-input batch; keep raw symbols and ten traces local.

The caller supplies an audited run and exact-symbol classification rules. Launch
geometry partitions signatures, never establishes tensor shape or DAG identity.
"""
from __future__ import annotations
import collections
import copy
import json
import math
import re
import statistics

from extractors.nsys import parse_nsys_sqlite
from extractors.profiler_common import ProfilerImportContext, profiler_record_id
from extractors.pi0_full_trace import API_NAMES, LAUNCH_KEYS, launch_config
from tools.lib.representative_data import _batch_summary


def validate_results(results, profiled):
    values = results['samples_ms']
    if results['warmup'] != 5 or len(values) != 10 or results['profiled'] != profiled:
        raise ValueError('Expected one independent five-warmup ten-sample batch')
    if not results['finite'] or any(not math.isfinite(x) or x <= 0 for x in values):
        raise ValueError('Invalid measured output or duration')
    return values


def build_e2e_bundle(results, run):
    values = validate_results(results, False)
    if statistics.stdev(values) / statistics.mean(values) > .05:
        raise ValueError('E2E batch exceeds five-percent CV')
    run = copy.deepcopy(run)
    run['analysis_batch'] = dict(batch_id=results['batch_id'], input_case_id=results['input_case_id'],
        input_recipe=results['input_recipe'], warmup_iterations=5,
        samples=[dict(sample_index=i,wall_time_ns=round(v*1e6)) for i,v in enumerate(values)],
        output_finite=True,output_shape=results['output_shape'])
    measurement = dict(measurement_id=run['run_id'].replace('run-','e2e-',1),run_id=run['run_id'],
        source_id=run['source_id'],evidence='measured_local',measurement_method='wall_clock',metric='latency',
        missing_reason=None,percentile_method='linear_interpolation',sample_count=10,
        statistics=[dict(statistic=name,unit='ms',value=value) for name,value in
            [('min',min(values)),('mean',statistics.mean(values)),('p50',statistics.median(values)),('max',max(values))]],
        timing_boundary_id=run['timing']['timing_boundary_id'],work_unit='action_chunk')
    return dict(bundle_version='1.0.0',source_label='pi0-fixed-e2e',datasets=dict(runs=[run],end_to_end=[measurement]))


def _signature(identity, runtime, rule):
    precision = dict(input_dtype_class=None,accumulator_dtype_class=None,output_dtype_class=None,sparsity='unknown',
        missing={k:'not_collected' for k in ['input_dtype_class','accumulator_dtype_class','output_dtype_class','sparsity']})
    if rule.get('precision_path'):precision=copy.deepcopy(rule['precision_path'])
    return dict(kernel_signature_id=identity,runtime_id=runtime,model_id='pi0',
        label_sanitized=identity.removeprefix('kernel-signature-pi0-').replace('-', ' '),function_family=rule.get('function_family','other'),
        implementation_family=rule.get('implementation_family','other'),precision_path=precision,
        classification_method='allowlisted_symbol_rule',classification_confidence=rule.get('confidence','unknown'),missing={})


def _supplement_cpu(c, capture, timeline, symbols, target, start, end):
    """Preserve samples separately from scheduler intervals already parsed above."""
    tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    samples = 'COMPOSITE_EVENTS' in tables and 'SAMPLING_CALLCHAINS' in tables
    capture['cpu_capabilities']=dict(scheduler_running=bool(c.execute('SELECT 1 FROM SCHED_EVENTS LIMIT 1').fetchone()),
        thread_states=False,function_samples=samples,task_markers=False,association_events=False)
    lanes={}
    def lane(tid,kind):
        if (tid,kind) not in lanes:
            identity=f'lane-{max([int(l["lane_id"].split("-")[-1]) for l in timeline["lanes"]]+[0])+1:03d}';lanes[tid,kind]=identity
            timeline['lanes'].append(dict(lane_id=identity,kind=kind,role='target-main' if tid==target else 'target-worker',ordinal=len(timeline['lanes']),coverage='complete'))
        return lanes[tid,kind]
    if samples:
        frames=collections.defaultdict(list)
        for r in c.execute('SELECT * FROM SAMPLING_CALLCHAINS ORDER BY id,stackDepth'):
            symbol=symbols.get(r['symbol'],'')
            label='unresolved' if r['unresolved'] else 'thread-wait' if any(s in symbol for s in ('pthread_cond_wait','futex_wait','sem_timedwait')) else 'cuda-runtime' if symbol.startswith(('cuda','cuLaunch')) else 'other'
            frames[r['id']].append(dict(label_sanitized=label,depth=r['stackDepth']))
        timeline['cpu_samples']=[]
        for r in c.execute('SELECT * FROM COMPOSITE_EVENTS WHERE start>=? AND start<? ORDER BY start',(start,end)):
            if r['globalTid']>>24!=target>>24:continue
            timeline['cpu_samples'].append(dict(sample_id=f'sample-{len(timeline["cpu_samples"])+1:05d}',lane_id=lane(r['globalTid'],'cpu_thread'),time_ns=r['start']-start,frames=frames.get(r['id'],[]),weight=1))
    for r in c.execute('SELECT * FROM OSRT_API WHERE start<? AND end>? ORDER BY start,end',(end,start)):
        if r['globalTid']>>24!=target>>24:continue
        name=symbols[r['nameId']]
        timeline['events'].append(dict(event_id=f'event-{len(timeline["events"])+1:05d}',lane_id=lane(r['globalTid'],'osrt'),event_kind='osrt',label='osrt-call',api_name=name if name in API_NAMES else 'unknown',start_ns=max(start,r['start'])-start,duration_ns=min(end,r['end'])-max(start,r['start']),count=1,kernel_signature_id=None,bytes=None,copy_direction=None,evidence_semantics='exact_interval'))


def build_fixed_case_bundle(connection, results, run_template, signature_rules, *, ordinal_start=1, retained_ordinal=None):
    """Return representative staging, local signature manifest, complete local bundle.

    Each signature rule is keyed by an exact raw symbol and contains only reviewed
    family/precision labels. Unknown symbols still retain all their measured time.
    """
    import sqlite3
    validate_results(results, True)
    connection.row_factory=sqlite3.Row
    windows=[dict(r) for r in connection.execute("SELECT text,start,end,globalTid FROM NVTX_EVENTS WHERE text LIKE 'pi0_steady_%' ORDER BY start")]
    if [w['text'] for w in windows]!=[f'pi0_steady_{i:02d}' for i in range(10)]:
        raise ValueError('Ten unique ordered prediction windows required')
    symbols={r['id']:r['value'] for r in connection.execute('SELECT id,value FROM StringIds')}
    runtime=results['runtime'];prefix=f'pi0-{runtime}-nsys-node'
    records=collections.defaultdict(list);signature_keys={};manifest=[]
    for index,w in enumerate(windows):
        run=copy.deepcopy(run_template);run['run_id']=f'run-{prefix}-{index+ordinal_start:03d}';run['configuration_id']=f'config-{prefix}-{index+ordinal_start:03d}';run['capture_method']='nsys';run.pop('analysis_batch',None)
        # Parser IDs use the source label, so one unique child namespace per window.
        label=f'{prefix}-{index+1:03d}'
        ctx=ProfilerImportContext(prefix,run['source_id'],run['system_id'],run,'fixed-predict','fixed-signature-v1','fixed-window-v1')
        policy=dict(policy_id='fixed-signature-v1',window_policy_id='fixed-window-v1',sqlite_schema_version='3.20.3',report_mode='node',scheduler_scope='process_tree',target_window_text=w['text'],graph_stage_labels=[],cuda_api_labels={'cudaDeviceSynchronize':'cuda-device-synchronize','cudaStreamSynchronize':'cuda-stream-synchronize','cudaGraphLaunch':'cuda-graph-launch'},profiler_process_names=['nsys','nsys-service'],cuda_event_handler_names=['cuda-EvtHandlr'],signature_rules=[])
        data=parse_nsys_sqlite(connection,ctx,policy)['datasets']
        capture=data['profiler_captures'][0];timeline=data['timelines'][0]
        identities = {}
        for name,key,kind in [('profiler_captures','capture_id','capture'),('timelines','timeline_id','timeline'),('telemetry','telemetry_id','telemetry')]:
            for pos,item in enumerate(data[name],1):
                if key in item:identities[item[key]]=profiler_record_id(kind,ctx,pos)
        def remap(value):
            if isinstance(value,dict):return {k:remap(v) for k,v in value.items()}
            if isinstance(value,list):return [remap(v) for v in value]
            return identities.get(value,value) if isinstance(value,str) else value
        data=remap(data);capture=data['profiler_captures'][0];timeline=data['timelines'][0]
        new=capture['capture_id']
        capture['analysis_sample']=dict(batch_id=results['batch_id'],input_case_id=results['input_case_id'],input_recipe=results['input_recipe'],sample_index=index,warmup_iterations=5,measured_iterations=10,window_start_ns=w['start'],window_end_ns=w['end'],output_finite=True,output_shape=results['output_shape'])
        # Rebuild GPU and API lanes with exact streams/full launches; scheduler stays.
        removed={l['lane_id'] for l in timeline['lanes'] if l['kind'] in ('gpu_kernel','gpu_memcpy','cuda_api')}
        timeline['lanes']=[l for l in timeline['lanes'] if l['lane_id'] not in removed]
        timeline['events']=[e for e in timeline['events'] if e['lane_id'] not in removed]
        lanes={};next_lane=max([int(l['lane_id'].split('-')[-1]) for l in timeline['lanes']]+[0])
        def add(row,kind,signature=None):
            nonlocal next_lane
            key=(kind,row.get('streamId',row.get('globalTid')))
            if key not in lanes:
                next_lane+=1;lid=f'lane-{next_lane:03d}';lanes[key]=lid
                timeline['lanes'].append(dict(lane_id=lid,kind={'kernel':'gpu_kernel','memcpy':'gpu_memcpy'}.get(kind,kind),role='target-main' if kind=='cuda_api' else 'copy-stream' if kind=='memcpy' else 'kernel-stream',ordinal=len(timeline['lanes']),coverage='complete'))
            event=dict(event_id='',lane_id=lanes[key],event_kind=kind,label={'kernel':'kernel','memcpy':'memcpy','cuda_api':'cuda-api-call','cuda_sync':'cuda-sync'}[kind],start_ns=max(w['start'],row['start'])-w['start'],duration_ns=min(w['end'],row['end'])-max(w['start'],row['start']),count=1,kernel_signature_id=signature,bytes=row.get('bytes'),copy_direction={1:'h2d',2:'d2h',8:'d2d',9:'h2h'}.get(row.get('copyKind'),'unknown') if kind=='memcpy' else None,evidence_semantics='exact_interval')
            if kind=='kernel':event['launch']=launch_config(row)
            if kind=='cuda_api':
                name=re.sub(r'_v[0-9]+$','',symbols[row['nameId']]);event['api_name']=name if name in API_NAMES else 'unknown'
                event['label']={'cudaGraphLaunch':'cuda-graph-launch','cudaStreamSynchronize':'cuda-stream-synchronize','cudaDeviceSynchronize':'cuda-device-synchronize'}.get(name,'cuda-api-call')
            timeline['events'].append(event)
        grouped=collections.defaultdict(list);ordinal=collections.Counter()
        for raw in connection.execute('SELECT * FROM CUPTI_ACTIVITY_KIND_KERNEL WHERE start>=? AND end<=? ORDER BY start,end',(w['start'],w['end'])):
            row=dict(raw);symbol=symbols[row['demangledName']];key=(symbol,*(row[k] for k in LAUNCH_KEYS));ordinal[symbol]+=1
            if key not in signature_keys:
                title=signature_rules.get(symbol,{}).get('label','recorded kernel')
                title=re.sub(r'^Realtime ', '',title, flags=re.I)
                slug=re.sub(r'[^a-z0-9]+','-',title.lower()).strip('-')
                sid=f'kernel-signature-pi0-{runtime}-{slug}-{len(signature_keys)+1:03d}';signature_keys[key]=sid
                sig=_signature(sid,runtime,signature_rules.get(symbol,{}));records['kernel_signatures'].append(sig)
                manifest.append(dict(kernel_signature_id=sid,symbol=symbol,launch=launch_config(row),first_sample_index=index,same_symbol_ordinal=ordinal[symbol]-1,source=signature_rules.get(symbol,{}).get('source')))
            sid=signature_keys[key];grouped[sid].append(row);add(row,'kernel',sid)
        total=sum(r['end']-r['start'] for rows in grouped.values() for r in rows)
        for sid,rows in grouped.items():
            duration=sum(r['end']-r['start'] for r in rows)
            data['kernel_observations'].append(dict(observation_id=profiler_record_id('kernel-observation',ctx,len(data['kernel_observations'])+1),capture_id=new,run_id=run['run_id'],source_id=run['source_id'],kernel_signature_id=sid,observation_kind='nsys_window_aggregate',population='all_matching_launches_in_one_predict_window',calls=len(rows),duration=dict(statistic='sum',value_ns=duration,sample_count=len(rows)),launch=launch_config(rows[0]),duration_share=dict(value=duration/total*100,unit='percent',denominator='kernel_duration_sum'),quality=['intrusive_node_trace'],missing={'launch.waves_per_sm':'not_collected'}))
        for table,kind in [('CUPTI_ACTIVITY_KIND_MEMCPY','memcpy'),('CUPTI_ACTIVITY_KIND_RUNTIME','cuda_api'),('CUPTI_ACTIVITY_KIND_SYNCHRONIZATION','cuda_sync')]:
            for raw in connection.execute(f'SELECT * FROM {table} WHERE start<? AND end>? ORDER BY start,end',(w['end'],w['start'])):add(dict(raw),kind)
        # Replace references to removed lanes in existing mathematically valid summaries.
        for summary in timeline['summaries']:
            if any(ref in removed for ref in summary['input_refs']):
                kinds={'kernel_duration_sum':['kernel'],'recorded_gpu_activity_union':['kernel','memcpy'],'recorded_copy_activity_union':['memcpy']}.get(summary['metric_name'],['cuda_api'])
                summary['input_refs']=[lid for (kind,_),lid in lanes.items() if kind in kinds]
        capture['warnings']=[v for v in capture['warnings'] if v!='partial_kernel_signature_coverage']
        timeline['missing'].pop('kernel_signature_coverage',None)
        _supplement_cpu(connection,capture,timeline,symbols,w['globalTid'],w['start'],w['end'])
        for summary in timeline['summaries']:
            if summary['metric_name'] in ('target_scheduled_core_time_overlapping_recorded_gpu_activity','target_wall_overlap_with_recorded_gpu_activity'):
                summary['input_refs']=[l['lane_id'] for l in timeline['lanes'] if l['kind'] in ('gpu_kernel','gpu_memcpy','cpu_thread') and l['role']!='profiler-excluded']
        for i,event in enumerate(timeline['events']):event['event_id']=f'event-{i+1:05d}'
        for name,items in data.items():records[name].extend(items)
    summary=_batch_summary(records['profiler_captures'],{t['capture_id']:t for t in records['timelines']},{s['kernel_signature_id']:s for s in records['kernel_signatures']})
    full=dict(bundle_version='1.0.0',source_label=f'pi0-{runtime}-fixed',datasets=dict(records))
    if summary is None:return None,manifest,full
    cid=summary['representative_capture_id'];selected=copy.deepcopy(full)
    for name,items in selected['datasets'].items():
        if name not in ('runs','kernel_signatures'):selected['datasets'][name]=[r for r in items if r.get('capture_id')==cid]
    capture=selected['datasets']['profiler_captures'][0];capture['analysis_summary']=summary
    selected['datasets']['runs']=[r for r in records['runs'] if r['run_id']==capture['run_id']]
    if retained_ordinal is not None:
        # A retained record ordinal is not the original sample index. Preserve
        # analysis_sample and raw-window identity while avoiding archive gaps.
        old_run=capture['run_id'];old_ordinal=old_run.rsplit('-',1)[1]
        new_ordinal=f'{retained_ordinal:03d}'
        def retained_ids(value):
            if isinstance(value,dict):return {k:retained_ids(v) for k,v in value.items()}
            if isinstance(value,list):return [retained_ids(v) for v in value]
            if isinstance(value,str):
                for kind in ('run','capture','config'):
                    if value==f'{kind}-{prefix}-{old_ordinal}':return f'{kind}-{prefix}-{new_ordinal}'
                return value.replace(f'{prefix}_r{old_ordinal}_',f'{prefix}_r{new_ordinal}_')
            return value
        selected=retained_ids(selected)
    return selected,manifest,full


def main():
    import argparse
    import sqlite3
    from pathlib import Path
    from tools.lib.jsonio import write_json_atomic
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results',type=Path,required=True)
    parser.add_argument('--run-template',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--sqlite',type=Path)
    parser.add_argument('--signature-rules',type=Path)
    parser.add_argument('--local-evidence-dir',type=Path)
    parser.add_argument('--ordinal-start',type=int,default=1)
    parser.add_argument('--retained-ordinal',type=int)
    args=parser.parse_args()
    results=json.loads(args.results.read_text());run=json.loads(args.run_template.read_text())
    if results['profiled']:
        if not all((args.sqlite,args.signature_rules,args.local_evidence_dir)):
            parser.error('Nsys requires sqlite, signature-rules and local-evidence-dir')
        connection=sqlite3.connect(f'file:{args.sqlite.resolve()}?mode=ro&immutable=1',uri=True)
        try:
            bundle,manifest,full=build_fixed_case_bundle(connection,results,run,json.loads(args.signature_rules.read_text()),ordinal_start=args.ordinal_start,retained_ordinal=args.retained_ordinal)
        finally:connection.close()
        args.local_evidence_dir.mkdir(parents=True,exist_ok=True)
        write_json_atomic(args.local_evidence_dir/'signature-manifest.json',manifest)
        write_json_atomic(args.local_evidence_dir/'full-local-bundle.json',full)
        if bundle is None:raise ValueError('Batch is not a stable representative; raw evidence retained locally')
    else:bundle=build_e2e_bundle(results,run)
    write_json_atomic(args.output,bundle)


if __name__=='__main__':main()
