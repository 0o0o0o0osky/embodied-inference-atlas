"""Sanitize complete Pi0 prediction windows, preserving independent captures.

Uses audited cublas API metadata linked by graph-node ancestry. Unmatched
symbols have unknown precision; a runtime BF16 label is not kernel evidence.
Raw tables and symbol names remain local. Writes staging only.
"""
from __future__ import annotations
import argparse, collections, copy, json, sqlite3, re
from pathlib import Path
from extractors.pi0_kernel_pairs import build_kernel_pair_bundle, SHAPES, _child, _union
from tools.lib.site import load_validated_datasets
from tools.lib.jsonio import write_json_atomic
from tools.lib.contracts import load_manifest, validate_document
from tools.lib.privacy import scan_json
from tools.lib.profiler_privacy import scan_profiler_bundle
from tools.lib.promotion import plan_promotion
from tools.lib.roofline import roofline_problems

API_NAMES=['cudaGraphLaunch', 'cudaStreamSynchronize', 'cudaDeviceSynchronize', 'cudaEventSynchronize', 'cudaMemcpyAsync', 'cudaMemcpy', 'cudaMalloc', 'cudaFree', 'cudaLaunchKernel', 'cudaLaunchKernelExC', 'cuLaunchKernel', 'cuLaunchKernelEx', 'pthread_cond_wait', 'pthread_cond_timedwait', 'pthread_mutex_lock', 'pthread_mutex_trylock', 'pthread_cond_broadcast', 'sem_timedwait', 'poll', 'read', 'write', 'ioctl']

LAUNCH_KEYS=('gridX','gridY','gridZ','blockX','blockY','blockZ','registersPerThread','staticSharedMemory','dynamicSharedMemory')

def group_launches(rows, exact_shapes):
    groups=collections.defaultdict(list)
    for r in rows:
        groups[(exact_shapes.get((r['start'],r['end'])),r['demangledName'],*(r.get(k) for k in LAUNCH_KEYS))].append(r)
    return groups

def unknown_signature(identity,label):
    return dict(kernel_signature_id=identity,runtime_id='vla-cpp',model_id='pi0',label_sanitized=label,
        function_family='other',implementation_family='other',precision_path=dict(input_dtype_class=None,
        accumulator_dtype_class=None,output_dtype_class=None,sparsity='unknown',missing={k:'not_collected' for k in
        ['input_dtype_class','accumulator_dtype_class','output_dtype_class','sparsity']}),
        classification_method='allowlisted_symbol_rule',classification_confidence='unknown',missing={})

def audited_signature(ordinal, symbol):
    """Source-audited families only; template tiles are never tensor shapes.

    ggml/src/ggml-cuda/cpy.cu#cpy_scalar and cpy-utils.cuh#cpy_1_scalar,
    llama revision 458681e1d5d4a29a1463c4732e03226cf384b997.
    """
    if symbol.startswith('void cpy_scalar<&cpy_1_scalar<float, float>>('):
        label = f'vlacpp FP32 stride copy {ordinal}'
        result = unknown_signature(f'kernel-signature-pi0-vlacpp-fp32-stride-copy-{ordinal}', label)
        result.update(function_family='copy', classification_method='combined', classification_confidence='high')
        result['precision_path'].update(input_dtype_class='fp32', output_dtype_class='fp32')
        for field in ['input_dtype_class', 'output_dtype_class']:
            result['precision_path']['missing'].pop(field)
        return result
    if symbol == 'void cutlass::Kernel2<cutlass_80_tensorop_s1688gemm_64x64_32x6_tn_align1>(T1::Params)':
        result = unknown_signature(f'kernel-signature-pi0-vlacpp-cutlass-gemm-{ordinal}', f'vlacpp CUTLASS GEMM {ordinal}')
        result.update(function_family='gemm', implementation_family='cutlass-tensor-core',
            classification_method='allowlisted_symbol_rule', classification_confidence='high')
        return result
    raise ValueError('Unverified native signature')

def launch_config(row):
    return dict(grid=[row[k] for k in ('gridX','gridY','gridZ')],block=[row[k] for k in ('blockX','blockY','blockZ')],
        registers_per_thread=row['registersPerThread'],static_shared_memory_bytes=row['staticSharedMemory'],
        dynamic_shared_memory_bytes=row['dynamicSharedMemory'],waves_per_sm=None)

def build_full_bundle(connection, all_groups, datasets):
    connection.row_factory=sqlite3.Row
    windows=[tuple(r) for r in connection.execute("SELECT text,start,end FROM NVTX_EVENTS WHERE text LIKE 'pi0_steady_%' ORDER BY start")]
    bf16=[g for g in all_groups['groups'] if (g['shape']['at'],g['shape']['bt'],g['shape']['ct'],g['shape']['compute'])==(14,14,0,68)]
    bf16.sort(key=lambda g:(list(SHAPES).index(tuple(g['shape'][k] for k in ('m','n','k'))) if tuple(g['shape'][k] for k in ('m','n','k')) in SHAPES else 3,tuple(g['shape'][k] for k in ('m','n','k'))))
    payload={'workload':dict(views=1,prompt_tokens=48,action_chunk=50,denoising_steps=10,warmup_predictions=5,measured_predictions=10),'groups':copy.deepcopy(bf16)}
    for g in payload['groups']:
        m,n,k=(g['shape'][x] for x in ('m','n','k'));g['work_flop_per_launch']=2*m*n*k;g['modeled_compulsory_bytes_per_launch']=2*m*k+2*k*n+4*m*n
    version=connection.execute("SELECT value FROM META_DATA_EXPORT WHERE name='EXPORT_PRODUCT_VERSION'").fetchone()[0]
    cpus=int(connection.execute("SELECT value FROM TARGET_INFO_SYSTEM_ENV WHERE name='CpuCores'").fetchone()[0])
    bundle=build_kernel_pair_bundle(payload,windows,datasets,tool_version=version,logical_cpu_count=cpus,all_bf16_shapes=True)
    records=bundle['datasets'];bundle['source_label']='pi0-vlacpp-full-node-windows'
    exact={}
    for g in all_groups['groups']:
        q=g['shape'];dtype='bf16' if q['at']==14 else 'fp16'
        sid=f"kernel-signature-pi0-vlacpp-{dtype}-gemm-{q['m']}x{q['n']}x{q['k']}"
        for r in g['launches']:
            if r['nodes_in_cublas_call']!=1: raise ValueError('GEMM graph mapping must have exact node ancestry')
            exact[(r['start'],r['end'])]=sid
        if dtype=='fp16':
            if (q['at'],q['bt'],q['ct'],q['compute'])!=(2,2,2,64):raise ValueError('Unexpected FP16 API path')
            s=unknown_signature(sid,f"vlacpp FP16 GEMM {q['m']}x{q['n']}x{q['k']}")
            s.update(function_family='gemm',classification_method='combined',classification_confidence='high')
            s['precision_path']=dict(input_dtype_class='fp16',accumulator_dtype_class='fp16',output_dtype_class='fp16',sparsity='off',missing={})
            records['kernel_signatures'].append(s)
    unknown={};symbols={r['id']:r['value'] for r in connection.execute('SELECT id,value FROM StringIds')}
    for ordinal,((name,start,end),timeline,capture) in enumerate(zip(windows,records['timelines'],records['profiler_captures']),1):
        capture['analysis_sample']=dict(batch_id='batch-pi0-vlacpp-node-001',input_case_id='input-pi0-synthetic-v1-p48-c50-d10',
            input_recipe='synthetic-rgb-pattern-sequential-tokens-padded-state-external-fixed-noise-v1',sample_index=ordinal-1,
            warmup_iterations=5,measured_iterations=10,window_start_ns=start,window_end_ns=end,output_finite=True,output_shape=[50,32])
        capture['coverage']['is_complete_for_population']=True
        capture['warnings']=[w for w in capture['warnings'] if w!='partial_kernel_signature_coverage']
        timeline['events']=[];timeline['lanes']=[];lanes={}
        def add(row,kind,label,stream,signature=None):
            lane_key=(kind,stream)
            if lane_key not in lanes:
                lanes[lane_key]=f'lane-{len(lanes)+1:03d}'
                lane_kind={'kernel':'gpu_kernel','memcpy':'gpu_memcpy'}.get(kind,kind)
                role={'kernel':'kernel-stream','memcpy':'copy-stream','cuda_api':'target-main','cuda_sync':'kernel-stream'}[kind]
                timeline['lanes'].append(dict(lane_id=lanes[lane_key],kind=lane_kind,role=role,ordinal=len(lanes)-1,coverage='complete'))
            event=dict(event_id=f'event-{len(timeline["events"])+1:05d}',lane_id=lanes[lane_key],event_kind=kind,label=label,
                start_ns=max(start,row['start'])-start,duration_ns=min(end,row['end'])-max(start,row['start']),count=1,
                kernel_signature_id=signature,bytes=row.get('bytes'),copy_direction={1:'h2d',2:'d2h',8:'d2d'}.get(row.get('copyKind'),'unknown') if kind=='memcpy' else None,evidence_semantics='exact_interval')
            if kind=='kernel':event['launch']=launch_config(row)
            if kind=='cuda_api':
                api=re.sub(r'_v[0-9]+$','',symbols[row['nameId']]);event['api_name']=api if api in API_NAMES else 'unknown'
            timeline['events'].append(event)
        rows=[dict(r) for r in connection.execute('SELECT * FROM CUPTI_ACTIVITY_KIND_KERNEL WHERE start>=? AND end<=? ORDER BY start,end',(start,end))]
        grouped=group_launches(rows,exact)
        for key,rr in grouped.items():
            sid=key[0]
            if sid is None:
                # Scope unknown classes by exact symbol AND launch config, never by runtime dtype.
                ukey=key[1:]
                if ukey not in unknown:
                    index=len(unknown)+1;sid=f'kernel-signature-pi0-vlacpp-recorded-kernel-{index:03d}'
                    signature=unknown_signature(sid,f'vlacpp recorded kernel {index:03d}')
                    if symbols[key[1]].startswith('void convert_unary<float, __nv_bfloat16>'):
                        sid=f'kernel-signature-pi0-vlacpp-fp32-to-bf16-conversion-{index:03d}'
                        signature.update(kernel_signature_id=sid,label_sanitized=f'vlacpp FP32 to BF16 conversion {index:03d}',function_family='copy',classification_method='combined',classification_confidence='high')
                        signature['precision_path'].update(input_dtype_class='fp32',output_dtype_class='bf16')
                        for field in ['input_dtype_class','output_dtype_class']:signature['precision_path']['missing'].pop(field)
                    unknown[ukey]=sid
                    records['kernel_signatures'].append(signature)
                sid=unknown[ukey]
            for r in rr:add(r,'kernel','kernel',r['streamId'],sid)
        # Recompute one-window signature aggregates from the complete actual population.
        previous={o['kernel_signature_id']:o for o in records['kernel_observations'] if o['capture_id']==capture['capture_id']}
        signature_rows=collections.defaultdict(list)
        for key,rr in grouped.items():signature_rows[key[0] or unknown[key[1:]]]+=rr
        total=sum(r['end']-r['start'] for r in rows)
        for i,(sid,rr) in enumerate(signature_rows.items(),len(bf16)+1):
            o=previous.get(sid)
            if o is None:
                o=dict(observation_id=_child('kernel-observation',ordinal,len(previous)+1),capture_id=capture['capture_id'],run_id=capture['run_id'],source_id=capture['source_id'],kernel_signature_id=sid,observation_kind='nsys_window_aggregate',population='all_matching_launches_in_one_predict_window',quality=['intrusive_node_trace','gpu_frequency_not_fixed'],missing={})
                records['kernel_observations'].append(o)
                previous[sid]=o
            duration=sum(r['end']-r['start'] for r in rr)
            configs=[launch_config(r) for r in rr];config=copy.deepcopy(configs[0])
            o['missing']={}
            for field in config:
                if any(c[field]!=config[field] for c in configs):config[field]=None;o['missing'][f'launch.{field}']='varies_across_population'
                elif config[field] is None:o['missing'][f'launch.{field}']='not_collected'
            o.update(calls=len(rr),duration=dict(statistic='sum',value_ns=duration,sample_count=len(rr)),launch=config,
                     duration_share=dict(value=duration/total*100,unit='percent',denominator='kernel_duration_sum'))
        for table,kind in [('CUPTI_ACTIVITY_KIND_MEMCPY','memcpy'),('CUPTI_ACTIVITY_KIND_RUNTIME','cuda_api'),('CUPTI_ACTIVITY_KIND_SYNCHRONIZATION','cuda_sync')]:
            for raw in connection.execute(f'SELECT * FROM {table} WHERE start<? AND end>? ORDER BY start,end',(end,start)):
                r=dict(raw);label='memcpy' if kind=='memcpy' else 'cuda-sync' if kind=='cuda_sync' else 'cuda-api-call'
                if kind=='cuda_api':
                    api=re.sub(r'_v[0-9]+$','',symbols[r['nameId']])
                    label={'cudaStreamSynchronize':'cuda-stream-synchronize','cudaDeviceSynchronize':'cuda-device-synchronize','cudaGraphLaunch':'cuda-graph-launch'}.get(api,label)
                add(r,kind,label,r.get('streamId',r.get('globalTid')))
        gpu=[e for e in timeline['events'] if e['event_kind'] in ('kernel','memcpy')]
        copies=[e for e in gpu if e['event_kind']=='memcpy']
        timeline['summaries']=[dict(metric_name=metric,value=value,unit='ns',denominator='predict_window',derivation_version=method,input_refs=[]) for metric,value,method in [
            ('kernel_duration_sum',total,'interval-sum-v1'),('recorded_gpu_activity_union',_union(gpu),'interval-union-v1'),('recorded_copy_activity_union',_union(copies),'interval-union-v1')]]
        for summary in timeline['summaries']:
            kinds={'kernel_duration_sum':{'gpu_kernel'},'recorded_gpu_activity_union':{'gpu_kernel','gpu_memcpy'},'recorded_copy_activity_union':{'gpu_memcpy'}}[summary['metric_name']]
            summary['input_refs']=[lane['lane_id'] for lane in timeline['lanes'] if lane['kind'] in kinds]
        timeline['missing']={'cpu_idle_conclusion':'not_computable_from_scheduler_activity'}
    for p in records['roofline_points']:
        p['coverage']['omitted'][0]['reason']='Other execution classes, CPU and transfers are outside this exact GEMM boundary.'
    return bundle

def derive_exact_groups(c):
    """Retain one-to-one cublas creation labels through exact cloned-node ancestry."""
    c.row_factory=sqlite3.Row
    ranges=[dict(r) for r in c.execute("SELECT rowid,start,end,globalTid,text FROM NVTX_EVENTS WHERE text LIKE 'atlas_gemm %'")]
    labels={};ancestry={};call_nodes=collections.defaultdict(list)
    for raw in c.execute('SELECT * FROM CUDA_GRAPH_NODE_EVENTS'):
        node=dict(raw)
        if node['originalGraphNodeId'] is not None:ancestry[node['graphNodeId']]=node['originalGraphNodeId'];continue
        hits=[r for r in ranges if r['globalTid']==node['globalTid'] and r['start']<=node['start']<=r['end']]
        if hits:
            if len(hits)!=1:raise ValueError('Ambiguous cublas label')
            labels[node['graphNodeId']]=hits[0];call_nodes[hits[0]['rowid']].append(node['graphNodeId'])
    windows=[dict(r) for r in c.execute("SELECT start,end,text FROM NVTX_EVENTS WHERE text LIKE 'pi0_steady_%' ORDER BY start")]
    grouped=collections.defaultdict(list)
    for raw in c.execute('SELECT * FROM CUPTI_ACTIVITY_KIND_KERNEL'):
        r=dict(raw);node=r['graphNodeId'];seen=set()
        while node in ancestry:
            if node in seen:raise ValueError('Cyclic node ancestry')
            seen.add(node);node=ancestry[node]
        label=labels.get(node)
        if not label:continue
        window=next((w for w in windows if w['start']<=r['start'] and r['end']<=w['end']),None)
        if window:
            r.update(iteration=window['text'],duration_ns=r['end']-r['start'],nodes_in_cublas_call=len(call_nodes[label['rowid']]))
            grouped[label['text']].append(r)
    return {'groups':[{'shape':{k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',label)},'launches':rr} for label,rr in grouped.items()]}


def add_cpu_evidence(c,bundle):
    tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'SCHED_EVENTS' not in tables:return
    symbols={r['id']:r['value'] for r in c.execute('SELECT id,value FROM StringIds')}
    active={};intervals=[]
    for r in c.execute('SELECT * FROM SCHED_EVENTS ORDER BY start'):
        key=(r['cpu'],r['globalTid'])
        if r['isSchedIn']:active[key]=r['start']
        else:
            begin=active.pop(key,None)
            if begin is not None and r['start']>begin:intervals.append((begin,r['start'],r['globalTid']))
    all_samples=[dict(r) for r in c.execute('SELECT * FROM COMPOSITE_EVENTS ORDER BY start')] if 'COMPOSITE_EVENTS' in tables else []
    frames=collections.defaultdict(list)
    for r in c.execute('SELECT * FROM SAMPLING_CALLCHAINS ORDER BY id,stackDepth'):
        symbol=symbols.get(r['symbol'],'');label='unresolved' if r['unresolved'] else 'native-predict' if 'vla::predict' in symbol else 'thread-wait' if any(x in symbol for x in ['pthread_cond_wait','futex_wait','sem_timedwait']) else 'cuda-runtime' if symbol.startswith(('cuda','cuLaunch')) else 'other'
        frames[r['id']].append(dict(label_sanitized=label,depth=r['stackDepth']))
    for capture,t in zip(bundle['datasets']['profiler_captures'],bundle['datasets']['timelines']):
        a=capture['analysis_sample'];start,end=a['window_start_ns'],a['window_end_ns'];capture['nsys']['scheduler_trace_present']=True
        capture['cpu_capabilities']=dict(scheduler_running=True,thread_states=False,function_samples=bool(all_samples),task_markers=False,association_events=False)
        lanes={};target=c.execute("SELECT globalTid FROM NVTX_EVENTS WHERE text=?",(f"pi0_steady_{a['sample_index']:02d}",)).fetchone()[0]
        def lane(tid,kind='cpu_thread'):
            key=(tid,kind)
            if key not in lanes:
                identity=f'lane-{len(t["lanes"])+1:03d}';lanes[key]=identity
                t['lanes'].append(dict(lane_id=identity,kind=kind,role='target-main' if tid==target else 'target-worker',ordinal=len(t['lanes']),coverage='complete'))
            return lanes[key]
        core=0
        for begin,finish,tid in intervals:
            if begin>=end or finish<=start:continue
            # Nsight packed global IDs retain process in upper bits; no IDs are exported.
            if tid>>24 != target>>24:continue
            left,right=max(begin,start),min(finish,end);core+=right-left
            t['events'].append(dict(event_id=f'event-{len(t["events"])+1:05d}',lane_id=lane(tid),event_kind='scheduler',label='predict',start_ns=left-start,duration_ns=right-left,count=1,kernel_signature_id=None,bytes=None,copy_direction=None,evidence_semantics='scheduler_running_interval'))
        t['cpu_samples']=[]
        for r in all_samples:
            if start<=r['start']<end and r['globalTid']>>24==target>>24:
                t['cpu_samples'].append(dict(sample_id=f'sample-{len(t["cpu_samples"])+1:05d}',lane_id=lane(r['globalTid']),time_ns=r['start']-start,frames=frames.get(r['id'],[]),weight=1))
        for r in c.execute('SELECT * FROM OSRT_API WHERE start<? AND end>? ORDER BY start,end',(end,start)):
            if r['globalTid']>>24 != target>>24:continue
            name=symbols[r['nameId']];name=name if name in API_NAMES else 'unknown'
            t['events'].append(dict(event_id=f'event-{len(t["events"])+1:05d}',lane_id=lane(r['globalTid'],'osrt'),event_kind='osrt',label='osrt-call',api_name=name,start_ns=max(start,r['start'])-start,duration_ns=min(end,r['end'])-max(start,r['start']),count=1,kernel_signature_id=None,bytes=None,copy_direction=None,evidence_semantics='exact_interval'))
        t['summaries'].append(dict(metric_name='target_scheduled_core_time_over_full_window',value=core,unit='ns',denominator='predict_window',derivation_version='interval-sum-v1',input_refs=[v for (tid,kind),v in lanes.items() if kind=='cpu_thread']))


def offset_bundle(bundle, offset):
    identities={}
    records=bundle['datasets']
    for index in range(1,11):
        for prefix in ['run','config','capture']:
            identities[f'{prefix}-pi0-vla-cpp-nsys-node-{index:03d}']=f'{prefix}-pi0-vla-cpp-nsys-node-{index+offset:03d}'
        for dataset,key,prefix in [('timelines','timeline_id','timeline'),('kernel_observations','observation_id','kernel-observation')]:
            for record in records[dataset]:
                if record['run_id']==f'run-pi0-vla-cpp-nsys-node-{index:03d}':
                    tail=int(record[key].split('_')[-1] if '_r' in record[key] else record[key].split('-')[-1])
                    identities[record[key]]=f'{prefix}-pi0-vla-cpp-nsys-node_r{index+offset:03d}_{tail:03d}'
        for prefix in ['basis','point']:
            for record in records['roofline_bases' if prefix=='basis' else 'roofline_points']:
                key=prefix+'_id';old=record[key]
                if old.startswith(f'{prefix}-pi0-vlacpp-gemm-{index:03d}-'):
                    identities[old]=old.replace(f'gemm-{index:03d}-',f'gemm-{index+offset:03d}-')
    def transform(v):
        if isinstance(v,str):
            if v in identities:return identities[v]
            for old,new in identities.items():
                if v.startswith(old+':'):return new+v[len(old):]
            return v
        if isinstance(v,list):return [transform(x) for x in v]
        if isinstance(v,dict):return {k:transform(x) for k,x in v.items()}
        return v
    return transform(bundle)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--sqlite',type=Path,required=True);p.add_argument('--groups',type=Path);p.add_argument('--batch-id',default='batch-pi0-vlacpp-node-001');p.add_argument('--offset',type=int,default=10);p.add_argument('--output',type=Path,default=Path('.local/staging/pi0-full-trace.json'));a=p.parse_args();root=Path.cwd().resolve()
    if not a.output.resolve().is_relative_to(root/'.local/staging'):p.error('output must be staging')
    datasets=load_validated_datasets(root/'data',root)
    with sqlite3.connect(a.sqlite.resolve().as_uri()+'?mode=ro',uri=True) as c:
        groups=json.loads(a.groups.read_text()) if a.groups else derive_exact_groups(c)
        bundle=build_full_bundle(c,groups,datasets)
        add_cpu_evidence(c,bundle)
    for capture in bundle['datasets']['profiler_captures']:capture['analysis_sample']['batch_id']=a.batch_id
    bundle=offset_bundle(bundle,a.offset)
    issues=scan_json(bundle)+scan_profiler_bundle(bundle,allow_partial_run_sequence=True);combined=copy.deepcopy(datasets)
    for name,rr in bundle['datasets'].items():
        version='2.0.0' if name.startswith('roofline_') else '1.0.0';issues+=validate_document(name,dict(schema_version=version,dataset=name,records=rr),root)
        primary=load_manifest(root)['datasets'][name]['primary_key'];old={r[primary]:r for r in combined[name]};old.update({r[primary]:r for r in rr});combined[name]=list(old.values())
    issues+=roofline_problems(combined)
    if issues:
        for issue in issues[:35]:print(issue)
        return 1
    write_json_atomic(a.output,bundle)
    try: plan_promotion(bundle,root)
    except Exception as error:
        print(type(error).__name__,str(error));print(getattr(error,'issues',None));return 1
    print('Staged',len(bundle['datasets']['timelines']),'windows;',sum(len(t['events']) for t in bundle['datasets']['timelines']),'events')
    return 0
if __name__=='__main__':raise SystemExit(main())
