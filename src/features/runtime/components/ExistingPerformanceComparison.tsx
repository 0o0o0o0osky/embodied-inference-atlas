import { AnalysisPlaceholder } from '../../../components/AnalysisPlaceholder';
import {useState} from 'react';
import type {AtlasData,ModelRecord} from '../../../types/atlas';
import type {RoutePatch,RouteState} from '../../../app/routes';
import {existingComparisons,existingComparisonKey,existingShapeLabel} from '../domain/modelAnalysisDescriptor';
import {isInferenceRuntimeForModel} from '../domain/runtimeCatalog';
import './existingPerformanceComparison.css';
export function ExistingPerformanceComparison({data,model,route,navigate}:{data:AtlasData;model:ModelRecord;route:RouteState;navigate:(patch:RoutePatch,replace?:boolean)=>void}) {
 const [includeLegacy,setIncludeLegacy]=useState(false);
 const [batchIds,setBatchIds]=useState<Record<string,string>>({});
 const rows=existingComparisons(data,model.model_id,route.hardware,includeLegacy);
 const inputKnown=data.datasets.model_graphs.some(record=>record.model_id === model.model_id) || data.datasets.runs.some(run=>run.model_id === model.model_id);
 const cohorts=[...new Map(rows.map(row=>[existingComparisonKey(row),row])).entries()];
 const selected=rows.find(row=>row.run.configuration_id===route.workload) ?? cohorts[0]?.[1];
 const cohort=selected?rows.filter(row=>existingComparisonKey(row)===existingComparisonKey(selected)):[];
 const groups=[...new Set(cohort.map(row=>`${row.run.runtime_id}|${row.run.precision.precision_id}`))].map(key=>{
  const batches=cohort.filter(row=>`${row.run.runtime_id}|${row.run.precision.precision_id}`===key).sort((a,b)=>a.run.run_id.localeCompare(b.run.run_id));
  const row=batches.find(item=>item.run.run_id===batchIds[key]) ?? batches[0]!;
  const latency=row.measurement.statistics.find(item=>item.statistic==='p50' && item.value!=null);
  return {key,batches,row,latency};
 });
 const max=Math.max(...groups.map(group=>group.latency?.unit==='ms'?group.latency.value ?? 0:0),1);
 const open=(run:typeof rows[number]['run'])=>navigate({runtime:run.runtime_id,runtimePrecision:run.precision.precision_id,workload:run.configuration_id,selectedRun:run.run_id,analysisView:'system',timelineCapture:null,entity:null,runtimeFacet:null});
 return <section className="existing-performance-comparison" aria-label="已有输入形状的性能比较"><h3>固定输入下的性能比较</h3>
  <p>默认口径：预热 5 次、正式测量 10 次。每个柱保留一个明确批次。</p>
  <label><input type="checkbox" checked={includeLegacy} onChange={event=>setIncludeLegacy(event.target.checked)}/> 查看已有其他采样口径</label>
  {cohorts.length?<label className="existing-shape-selector">已有输入与测量配置<select aria-label="已有输入与测量配置" value={selected?existingComparisonKey(selected):''} onChange={event=>{const row=cohorts.find(([key])=>key===event.target.value)![1];navigate({workload:row.run.configuration_id,selectedRun:null},true);}}>{cohorts.map(([key,row])=><option key={key} value={key}>{existingShapeLabel(row)} · 预热{row.run.timing.warmup_iterations ?? '未知'} / 测量{row.measurement.sampleCount}</option>)}</select></label>:<AnalysisPlaceholder title={inputKnown ? "当前采样口径暂无测量" : "输入形状尚未填写"} state={inputKnown ? "no_match" : "not_recorded"} detail={inputKnown ? "当前模型与硬件没有符合所选口径的测量。可查看已有其他采样口径，或进入推理栈查看分析状态。" : "补充当前模型的输入维度与默认值后，可选择输入并比较性能。"} />}
  {selected?<p>{existingShapeLabel(selected)}。采样：预热 {selected.run.timing.warmup_iterations ?? '未记录'} 次，测量 {selected.measurement.sampleCount} 次；{selected.measurement.timingBoundaryId}。</p>:null}
  {groups.length?<div className="existing-performance-bars" aria-label="延时从零起算">{groups.map(({key,row,batches,latency})=><div key={key}>
    {batches.length>1?<label>独立批次<select value={row.run.run_id} onChange={event=>setBatchIds({...batchIds,[key]:event.target.value})}>{batches.map(item=><option key={item.run.run_id} value={item.run.run_id}>{item.run.run_id}</option>)}</select></label>:null}
    <button type="button" onClick={()=>open(row.run)}><strong>{row.runtimeLabel} · {row.run.precision.precision_id}</strong><span>{latency?.value==null?'延时未记录':`${latency.value.toFixed(2)} ${latency.unit} · ${latency.statistic==='p50'?'中位数':'均值'}`}</span>{latency?.value!=null && latency.unit==='ms'?<i aria-hidden="true" style={{width:`${latency.value/max*100}%`}}/>:null}</button>
  </div>)}<small>0 ms</small></div>:null}
  <div className="existing-runtime-status">{data.datasets.runtimes.filter(runtime=>isInferenceRuntimeForModel(runtime,model.model_id) && !groups.some(group=>group.row.run.runtime_id===runtime.runtime_id)).map(runtime=><button type="button" key={runtime.runtime_id} onClick={()=>navigate({runtime:runtime.runtime_id,runtimePrecision:null,selectedRun:null,analysisView:'system',timelineCapture:null,entity:null})}>{runtime.display_name} · {runtime.model_support.filter(item=>item.model_id === model.model_id).every(item=>item.status === "not_supported") ? "当前模型不支持" : selected ? "当前输入无匹配测量" : "进入推理栈"}</button>)}</div>
 </section>;
}
