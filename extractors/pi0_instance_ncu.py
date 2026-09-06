"""Import three independent native Pi0 representative replays, not Nsys timing."""
import argparse,copy,csv,io,json,re,sqlite3,subprocess
from pathlib import Path
from extractors.ncu import import_ncu_report, _IDENTITY_COLUMNS
from extractors.profiler_common import ProfilerImportContext
from tools.lib.site import load_validated_datasets
from tools.lib.jsonio import write_json_atomic
from tools.lib.promotion import plan_promotion

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path);p.add_argument('--labels',nargs='+',choices=['gemm-action','gemm-prefix','conversion','conversion-055'],default=['gemm-action','gemm-prefix','conversion']);p.add_argument('--output',type=Path,default=Path('.local/staging/pi0-instance-ncu.json'));a=p.parse_args();root=Path.cwd()
    if not a.output.resolve().is_relative_to(root/'.local/staging'):p.error('staging output required')
    datasets=load_validated_datasets(root/'data',root)
    cpu=json.loads((root/'.local/staging/pi0-full-cpu-trace.json').read_text())['datasets'];signatures={s['kernel_signature_id']:s for s in cpu['kernel_signatures']}
    template=next(r for r in datasets['runs'] if r['run_id']=='run-pi0-vlacpp-w5-r10-001')
    c=sqlite3.connect('file:'+str(root/'.local/pi0-instance-batch-001/capture.sqlite')+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
    start,end=c.execute("SELECT start,end FROM NVTX_EVENTS WHERE text='pi0_steady_00'").fetchone()
    timeline=cpu['timelines'][0];output={'bundle_version':'1.0.0','source_label':'pi0-instance-representatives','datasets':{}}
    for label in a.labels:
        report=a.directory/(label+'.ncu-rep');log=(a.directory/(label+'.log')).read_text()
        details=subprocess.run(['ncu','--config-file','off','--import',str(report),'--csv','--print-kernel-base','function','--print-units','base','--print-fp','--page','details'],capture_output=True,text=True,check=True).stdout
        row=next(csv.DictReader(io.StringIO(details)));identity={k:row[k] for k in _IDENTITY_COLUMNS}
        # The selected first symbol match must map to an actual launch in the fixed
        # steady window of the identical unchanged executable/input recipe.
        symbol=identity['Kernel Name']
        if label.startswith('conversion'):
            demangled=next(csv.DictReader(io.StringIO(subprocess.run(['ncu','--import',str(report),'--page','details','--csv','--print-kernel-base','demangled'],capture_output=True,text=True,check=True).stdout)))['Kernel Name']
            if not demangled.startswith('void convert_unary<float, __nv_bfloat16>'):raise ValueError('Conversion template mismatch')
            symbol=demangled
        rr=c.execute('SELECT k.* FROM CUPTI_ACTIVITY_KIND_KERNEL k JOIN StringIds s ON s.id=k.demangledName WHERE k.start>=? AND k.end<=? AND s.value LIKE ? ORDER BY k.start',(start,end,symbol+'%')).fetchall()
        if not rr:raise ValueError('No same-input native trace symbol population')
        command=json.loads((a.directory/(label+'.command.json')).read_text())
        skip=int(command[command.index('--launch-skip')+1]) if '--launch-skip' in command else 0
        if skip>=len(rr):raise ValueError('Selected launch outside fixed-window population')
        first=rr[skip];event=next(e for e in timeline['events'] if e['event_kind']=='kernel' and e['start_ns']==first['start']-start and e['duration_ns']==first['end']-first['start'])
        signature=copy.deepcopy(signatures[event['kernel_signature_id']]);signature.pop('runtime_id');signature.pop('model_id')
        if label.startswith('gemm'):
            ids={e['kernel_signature_id'] for e in timeline['events'] if e['event_kind']=='kernel' and any(e['start_ns']==r['start']-start for r in rr)}
            if len(ids)!=1 or 'gemm-' not in signature['kernel_signature_id']:raise ValueError('Symbol does not prove one exact GEMM shape population')
        suffix=signature['kernel_signature_id'].removeprefix('kernel-signature-pi0-');controlled='pi0-vla-cpp-ncu-'+suffix
        run=copy.deepcopy(template);run.pop('analysis_batch',None);run.update(run_id='run-'+controlled+'-001',configuration_id='config-'+controlled+'-001',capture_method='ncu')
        run['operating_point']={'operating_point_id':'unknown','power_mode':None,'clock_policy':None,'throttle_status':None};run['comparison_context']['platform']['operating_point_id']='unknown';run['missing']={f'operating_point.{k}':'not_collected' for k in ['power_mode','clock_policy','throttle_status']}
        context=ProfilerImportContext(source_label=controlled,source_id=run['source_id'],system_id=run['system_id'],run=run,capture_label=controlled,signature_policy_id='pi0-instance-representatives-v1',window_policy_id='not-applicable')
        origins={k:'session_command' for k in ['selection_policy','replay_mode','cache_control_request','clock_control_request']};origins.update(replay_passes='collection_log_manual_audit',warmup_count='harness_source_audit',backing_store_bytes='unavailable',gpu_frequency_not_fixed='collection_log_manual_audit')
        policy=dict(policy_id=context.signature_policy_id,section_mode='section_set',replay_mode='kernel',replay_passes=int(re.search(r'- (\d+) passes',log).group(1)),cache_control_request='none',clock_control_request='none',warmup_count=5,backing_store_bytes=None,warnings=['gpu_frequency_not_fixed'],origins=origins,expected_result_identity=identity,expected_geometry={k:event['launch'][k] for k in ['grid','block']},signature=signature)
        bundle=import_ncu_report(report,context,policy)
        for key,values in bundle['datasets'].items():output['datasets'].setdefault(key,[]).extend(values)
    write_json_atomic(a.output,output)
    try:plan_promotion(output,root)
    except Exception as e:print(type(e).__name__,str(e),getattr(e,'issues',None));return 1
    print(f'Staged {len(a.labels)} independent NCU replay(s)');return 0
if __name__=='__main__':raise SystemExit(main())
