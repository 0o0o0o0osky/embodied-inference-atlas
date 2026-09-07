import { AnalysisPlaceholder } from '../../../components/AnalysisPlaceholder';
import { pi0GroupLabel } from './runtimePresentation';
import { KernelComputation, KernelResources, isVerifiedConversion, isVerifiedStrideCopy } from './KernelComputation';
import { invocationSelection, invocationPoint } from './kernelInvocation';
import { KernelNcuMetrics } from './KernelNcuMetrics';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoutePatch, RouteState } from '../../../app/routes';
import type { AtlasData, CanonicalRecord } from '../../../types/atlas';
import type { TimelineViewModel } from '../../timeline/domain/buildTimelineView';
import type { KernelRowsModel } from '../../performance/domain/buildKernelRows';
import { kernelEntity, timelineEventEntity, runtimeGroupEntity, parseEntityKey } from '../../workbench/entityKeys';
import { buildExecutionHotspots } from '../domain/buildExecutionHotspots';
import type { RuntimeRealizationRecord } from '../domain/types';
import { Pi0ImplementationDagSection } from './Pi0ImplementationDagSection';
import { groupKernelRows } from '../domain/groupKernelRows';
import { indexRoofline } from '../../roofline/data/indexRoofline';
import { RooflinePairChart } from '../../roofline/components/RooflinePairChart';

export function ExecutionHotspots({data, record, route, view, kernels, realization, workload, navigate}: {
  data: AtlasData; record: CanonicalRecord | null; route: RouteState; view: TimelineViewModel; kernels: KernelRowsModel;
  realization: RuntimeRealizationRecord | null; workload: string;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  const [detailView, setDetailView] = useState<'timing'|'resources'|'dag'|'roofline'>('timing');
  const [showAll, setShowAll] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const dagRef = useRef<HTMLDivElement>(null);
  const [rememberedGraphEntity, setGraphEntity] = useState<string | null>(null);
  const graphNavigate = (patch: RoutePatch, replace?: boolean) => {
    if ('entity' in patch) setGraphEntity(patch.entity ?? null);
    navigate(patch,replace);
  };
  const rows = useMemo(()=>buildExecutionHotspots(view.active?.timeline ?? null),[view.active]);
  const labelFor = (row: typeof rows[number]) => row.kernelSignatureId
    ? kernels.rows.find(item=>item.signature.kernelSignatureId === row.kernelSignatureId)?.signature.labelSanitized ?? row.label : row.label;
  const entityFor = (row: typeof rows[number]) => timelineEventEntity(view.active!.timeline.timelineId,
    (invocationSelection(row.events).selected ?? row.events[0]!).eventId);
  const selectedEntity = parseEntityKey(route.entity);
  const legacyKernel = selectedEntity?.kind === 'kernel' ? kernels.rows.find(item=>item.capture.captureId === selectedEntity.captureId && item.observation.observationId === selectedEntity.kernelObservationId) : null;
  const selected = rows.find(row=>entityFor(row) === route.entity
    || selectedEntity?.kind === 'timeline-event' && selectedEntity.timelineId === view.active?.timeline.timelineId
      && row.events.some(event=>event.eventId === selectedEntity.eventId)
    || legacyKernel && row.captureId === legacyKernel.capture.captureId && row.kernelSignatureId === legacyKernel.signature.kernelSignatureId) ?? null;
  const kernel = selected?.kernelSignatureId ? kernels.rows.find(item=>item.capture.captureId === selected.captureId && item.signature.kernelSignatureId === selected.kernelSignatureId && item.observation.observationKind !== 'ncu_replayed_launch') : null;
  const links = kernel?.links.filter(link=>(link.status === 'resolved' || link.status === 'partial' && link.reasonCode === 'ambiguous_attribution') && link.realizationId === realization?.realizationId) ?? [];
  const groups = [...new Set(links.flatMap(link=>link.executionGroupIds))];
  const locationFor = (id: string) => {
    const group = realization?.executionGroups.find(item=>item.executionGroupId===id);
    const refs = links.filter(link=>link.executionGroupIds.includes(id)).flatMap(link=>link.logicalTargets.map(target=>target.ref));
    const stages = [...new Set(refs.map(ref=>ref.startsWith('prefix-encoder/') ? '前缀编码' : ref.startsWith('action-flow-decoder/') ? '动作专家' : ref.startsWith('vision-encoder/') ? '视觉编码' : null).filter(Boolean))];
    const ranges = group?.repeatSelectors.filter(item=>item.scopeRef.endsWith('-blocks') && item.selection==='indices' && item.indices.length>0 && item.indices.every((value,i)=>i===0 || value===item.indices[i-1]!+1)) ?? [];
    const range = ranges.length===1 ? `第${ranges[0]!.indices[0]!+1}–${ranges[0]!.indices.at(-1)!+1}层` : null;
    return [...stages,pi0GroupLabel(group?.label ?? id),range].filter(Boolean).join(' / ');
  };
  const locateGroup = (id: string) => {
    if (!realization) return;
    setGraphEntity(runtimeGroupEntity(realization.realizationId,id));
    setDetailView('timing');
    // Keep the selected Kernel invocation in the URL and retain the DAG camera.
    dagRef.current?.scrollIntoView({block:'start'});
  };
  const index = useMemo(()=>indexRoofline(data),[data]);
  const rooflinePairs = kernel ? index.bases.filter(basis=>basis.run_id === kernel.run.run_id && basis.level === 'kernel' && basis.time_basis !== 'ncu_kernel')
    .flatMap(basis=>(index.pointsByBasisId.get(basis.basis_id) ?? []).filter(point=>point.entity.kind === 'kernel' && point.entity.entity_id === kernel.observation.observationId).map(point=>({point,basis}))) : [];
  const invocation = invocationSelection(selected?.events ?? [],selectedEntity?.kind === 'timeline-event' ? selectedEntity.eventId : undefined);
  const signatureClasses = selected?.kernelSignatureId ? rows.filter(row=>row.kernelSignatureId === selected.kernelSignatureId && row.captureId === selected.captureId) : [];
  const signaturePopulation = signatureClasses.reduce((sum,row)=>sum+row.count,0);
  const singlePairs = invocation.selected ? rooflinePairs.filter(pair=>pair.basis.capture_id === selected?.captureId && pair.basis.time_basis === 'nsys_interval').flatMap(pair=>{const point=invocationPoint(pair.point,invocation.selected!,signaturePopulation);return point?[{...pair,point}]:[];}) : [];
  const replay = kernel ? kernels.rows.filter(item=>item.signature.kernelSignatureId === kernel.signature.kernelSignatureId && item.observation.observationKind === 'ncu_replayed_launch'
    && (!invocation.selected?.launch || (['grid','block','registersPerThread','staticSharedMemoryBytes','dynamicSharedMemoryBytes'] as const).every(key=>{
      const actual=invocation.selected!.launch![key],replayed=item.observation.launch[key];
      return actual==null || replayed==null || JSON.stringify(actual)===JSON.stringify(replayed);
    }))) : [];
  const linkedGroupEntity = groups.length === 1 && realization ? runtimeGroupEntity(realization.realizationId,groups[0]!) : null;
  const rememberedKey = parseEntityKey(rememberedGraphEntity);
  const rememberedRelevant = !selected || (rememberedKey?.kind === 'runtime-group' && groups.includes(rememberedKey.executionGroupId))
    || (rememberedKey?.kind === 'logical' && realization?.mappings.some(mapping=>mapping.logicalTargets.some(target=>target.ref===rememberedKey.logicalRef) && mapping.executionGroupIds.some(id=>groups.includes(id))));
  const graphEntity = !record || !realization ? null : selectedEntity?.kind === 'runtime-group' || selectedEntity?.kind === 'logical'
    ? route.entity : (rememberedRelevant ? rememberedGraphEntity : null) ?? linkedGroupEntity;
  useEffect(()=>{
    if (selected) (graphEntity ? dagRef.current : detailRef.current)?.scrollIntoView({block:'start'});
  },[selected?.id,graphEntity]);
  const sharedConversions = rows.filter(row=>kernels.rows.some(item=>item.capture.captureId===row.captureId && item.signature.kernelSignatureId===row.kernelSignatureId && (isVerifiedConversion(item)||isVerifiedStrideCopy(item))));
  const detail = selected ? <aside ref={detailRef} className="execution-hotspot-detail">
        <header><h4>{labelFor(selected)}</h4><button type="button" onClick={()=>navigate({entity:rememberedGraphEntity},true)} aria-label="关闭热点详情">×</button></header>
        <p>{selected.category === 'GPU Kernel' ? `本次推理 · 1 个 trace · 此类 Kernel 调用 ${selected.count} 次` : `当前类别 ${selected.count} 次`}</p>
        {groups.length ? <p aria-label="当前 Kernel 的 DAG 位置">{groups.map(locationFor).join('；')}</p> : null}
        <nav aria-label="当前热点分析">{([['timing','计算与数据'],['resources','执行与资源'],['roofline','Roofline']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={detailView === id} onClick={()=>setDetailView(id)}>{label}</button>)}</nav>
        {detailView === 'timing' ? <>
          <dl><div><dt>当前类别累计时长</dt><dd>{(selected.durationNs/1e6).toFixed(3)} ms</dd></div><div><dt>证据来源</dt><dd>当前 Nsys 采集</dd></div>{kernel?.signature.implementationFamily ? <div><dt>计算路径</dt><dd>{kernel.signature.implementationFamily}</dd></div> : null}</dl>
          {selected.category === 'CPU 调度执行' ? <p>CPU 多线程累计运行时间；具体任务归属待关联。</p> : null}
          {signatureClasses.length>1?<label className="kernel-invocation-selector">同签名启动配置类别<select aria-label="选择启动配置类别" value={selected.id} onChange={event=>{const row=signatureClasses.find(item=>item.id===event.target.value)!;navigate({entity:entityFor(row)},true);}}>{signatureClasses.map((row,i)=><option key={row.id} value={row.id}>类别 {i+1} · Grid {row.events[0]?.launch?.grid?.join('×') ?? '未知'} / Block {row.events[0]?.launch?.block?.join('×') ?? '未知'} · {row.count} 次 · {(row.durationNs/1e6).toFixed(3)} ms</option>)}</select></label>:null}
          {invocation.selected ? <>
            <label className="kernel-invocation-selector">查看同一 trace 内的单次调用（共 {invocation.events.length} 次）
              <select aria-label="选择真实调用" value={invocation.selected.eventId} onChange={event=>navigate({entity:timelineEventEntity(view.active!.timeline.timelineId,event.target.value)},true)}>
                {invocation.events.map((event,i)=><option key={event.eventId} value={event.eventId}>第 {i+1} 次调用 · {(event.startNs/1e6).toFixed(3)} ms 开始 · {(event.durationNs/1e3).toFixed(2)} μs</option>)}
              </select>
            </label>
            <svg className="kernel-duration-distribution" viewBox="0 0 400 48" role="img" aria-label="当前类别各次调用耗时分布，实心点为所选调用">
              <line x1="12" y1="24" x2="388" y2="24" stroke="#a4b4c0" />
              {[...invocation.events].sort((a,b)=>Number(a.eventId===invocation.selected!.eventId)-Number(b.eventId===invocation.selected!.eventId)).map(event=><circle key={event.eventId} cx={12+376*(event.durationNs-invocation.minNs!)/Math.max(1,invocation.maxNs!-invocation.minNs!)} cy={24} r={event.eventId===invocation.selected!.eventId?6:3} fill={event.eventId===invocation.selected!.eventId?'#17679b':'#9db5c5'}><title>{`第 ${invocation.events.indexOf(event) + 1} 次调用 · ${(event.durationNs/1e3).toFixed(2)} μs`}</title></circle>)}
            </svg>
            <p>默认选择最接近类内中位数的真实调用；当前窗口最短 {(invocation.minNs!/1e3).toFixed(2)} / 中位数 {(invocation.medianNs!/1e3).toFixed(2)} / 最长 {(invocation.maxNs!/1e3).toFixed(2)} μs。</p>
            <dl><div><dt>所选单次执行</dt><dd>{(invocation.selected.durationNs/1e3).toFixed(2)} μs</dd></div></dl>
          </> : <p>此记录未提供可独立选择的精确单次区间。</p>}
          {kernel ? <KernelComputation sources={data.datasets.sources} realization={realization} row={kernel} point={singlePairs[0]?.point} /> : null}
          {singlePairs.map(({point})=><div key={point.point_id} className="kernel-measured-summary"><dl>
            <div><dt>计算吞吐</dt><dd>{(point.work.total_flop / point.timing.observed_second! / 1e12).toFixed(2)} TFLOP/s</dd></div>
            <div><dt>单次计算量</dt><dd>{(point.work.total_flop/1e9).toFixed(2)} GFLOP</dd></div>
            <div><dt>单次读写量（{point.traffic.value_kind === 'measured' ? '实测' : '估算'}）</dt><dd>{(point.traffic.total_byte/1e6).toFixed(2)} MB</dd></div></dl><p>Nsys 追踪下的所选调用计时。</p></div>)}
          <button type="button" onClick={()=>navigate({analysisView:'system',timelineCapture:selected.captureId,entity:timelineEventEntity(view.active!.timeline.timelineId,(invocation.selected ?? selected.events[0]!).eventId)})}>在系统时间线定位</button>
        </> : detailView === 'resources' ? <>
          {invocation.selected ? <p>当前 Nsys 调用 {(invocation.selected.durationNs/1e3).toFixed(2)} μs；资源配置来自此调用。</p>:null}
          {invocation.selected?.launch ? <KernelResources launch={invocation.selected.launch} label="当前调用的执行资源" /> : kernel ? <KernelResources launch={kernel.observation.launch} /> : <p>此对象没有 GPU launch 资源记录。</p>}
          {kernel ? replay.length ? <KernelNcuMetrics sources={data.datasets.sources} rows={replay} /> : <p>当前 Kernel 尚无配置匹配的 NCU 硬件计数器。</p> : null}
        </> : detailView === 'dag' ? groups.length && realization ? <div>{groups.map(id=><button key={id} type="button" onClick={()=>locateGroup(id)}>{locationFor(id)}</button>)}</div> : <p>当前热点的 DAG 位置待关联。</p>
          : singlePairs.length ? singlePairs.map(pair=><RooflinePairChart key={pair.point.point_id} {...pair} />) : <p>{selected.category === 'GPU Kernel' ? '绘制 Roofline 所需的计算量或边界流量待补。' : '当前对象可按耗时分析。'}</p>}
        {groups.length && record && realization ? <button type="button" aria-label={groups.length === 1 ? "定位当前 Kernel 对应的 DAG 计算位置" : "查看当前 Kernel 的 DAG 关联"} onClick={()=>groups.length === 1 ? locateGroup(groups[0]!) : setDetailView('dag')}>{groups.length > 1 ? '选择 DAG 位置' : 'DAG 定位'}</button> : null}
      </aside> : null;
  const renderKernelDetails = (groupIds: readonly string[]) => {
    const associated = realization ? groupKernelRows(kernels.rows,realization,groupIds) : [];
    const measured = associated.filter(item=>item.observation.observationKind !== 'ncu_replayed_launch');
    const replaysOnly = associated.filter(item=>item.observation.observationKind === 'ncu_replayed_launch');
    const selectedHere = kernel && associated.some(item=>item.observation.observationId === kernel.observation.observationId);
    return <section className="dag-kernel-selection" aria-label="当前计算对应的 Kernel">
      <h3>对应 Kernel</h3>
      {measured.length ? <ul>{measured.map(item=><li key={item.observation.observationId}>
        <button type="button" aria-pressed={item.observation.observationId === kernel?.observation.observationId}
          onClick={()=>{setGraphEntity(graphEntity);navigate({timelineCapture:item.capture.captureId,entity:kernelEntity(item.capture.captureId,item.observation.observationId)},true);}}>
          {item.signature.labelSanitized}<span>{(item.observation.duration.valueNs/1e6).toFixed(3)} ms · {item.observation.calls} 次</span>
        </button></li>)}</ul> : replaysOnly.length ? <KernelNcuMetrics sources={data.datasets.sources} rows={replaysOnly} /> : <p>当前采集尚无此计算对应的 Kernel。</p>}
      {associated.some(item=>item.links.some(link=>link.realizationId === realization?.realizationId && link.executionGroupIds.some(id=>groupIds.includes(id)) && (link.status === 'partial' || link.executionGroupIds.length > 1))) ? <p>此 Kernel 用于多个计算步骤；当前显示它在 trace 中的累计耗时。</p> : null}
      {selectedHere ? detail : null}
    </section>;
  };
  return <section className="execution-hotspots" aria-label="执行热点">
    <header className="pi0-funnel-heading"><h3>执行热点</h3></header>
    {realization && record ? <p className="pi0-funnel-note">点击图中的融合计算或精度标注，查看对应 Kernel 与性能；完整列表在底部展开。</p> : null}
    {sharedConversions.length?<details className="dag-shared-conversions"><summary>数据转换与拷贝 · {sharedConversions.length} 个启动配置类别 · {(sharedConversions.reduce((sum,row)=>sum+row.durationNs,0)/1e6).toFixed(3)} ms</summary>
      <p>这些类型转换和步幅拷贝用于多个计算位置，按当前 trace 的调用类别汇总。</p>
      <ul>{sharedConversions.map(row=><li key={row.id}><button type="button" aria-pressed={selected?.id===row.id} onClick={()=>{setGraphEntity(null);navigate({entity:entityFor(row)},true);}}>{labelFor(row)} · Grid {row.events[0]?.launch?.grid?.join('×') ?? '未知'} · {row.count} 次 · {(row.durationNs/1e6).toFixed(3)} ms</button></li>)}</ul>
    </details>:null}
    {realization && record ? <div ref={dagRef} className="hotspot-primary-dag"><Pi0ImplementationDagSection sources={data.datasets.sources} initialShowPrecision record={record}
      route={{...route,workload,entity:graphEntity}} activeRealization={realization} selectedRuntimeName={route.runtime}
      navigate={graphNavigate} renderKernelDetails={renderKernelDetails} /></div> : <AnalysisPlaceholder title="执行 DAG" state="not_recorded" detail={rows.length ? "执行结构与算子映射尚未填写；底部列表可查看已记录的耗时。" : "补充模型计算结构与当前推理栈的算子映射后显示。"} />}
    {selected && !graphEntity ? <div className="hotspot-unmapped-detail">{detail}</div> : null}
    <details className="hotspot-kernel-inventory"><summary>Kernel 与 CPU 热点列表{rows.length ? `（${rows.length} 项）` : view.active ? " · 暂无区间" : " · 未采集"}</summary>
      <p className="pi0-funnel-note">按当前 trace 中各类工作的累计时长排序；CPU 与 GPU 可重叠执行。</p>
      {view.active?.capture.nsys?.reportMode === 'node' && !view.active.capture.coverage.isCompleteForPopulation ? <p className="pi0-funnel-note">当前记录覆盖部分 Kernel。</p> : null}
      {rows.length ? <><ol className="execution-hotspot-list">{(showAll ? rows : rows.slice(0,6)).map(row=><li key={row.id}>
        <button type="button" aria-pressed={selected?.id === row.id} onClick={()=>{setGraphEntity(null);navigate({timelineCapture:row.captureId,entity:entityFor(row)},true);}}>
          <span className="hotspot-kind">{row.category}</span><strong>{labelFor(row)}{row.events[0]?.launch?.block ? <small> · Block {row.events[0].launch.block.join('×')}</small> : null}</strong><span className="hotspot-duration">{(row.durationNs/1e6).toFixed(3)} ms</span>
          <span className="hotspot-duration-bar" aria-hidden="true" style={{width:`${row.durationNs/rows[0]!.durationNs*100}%`}} />
        </button>
      </li>)}</ol>{rows.length > 6 ? <button type="button" className="pi0-funnel-detail" onClick={()=>setShowAll(!showAll)}>{showAll ? '收起列表' : `查看全部 ${rows.length} 项`}</button> : null}</> : <AnalysisPlaceholder title="Kernel 与 CPU 热点" state={view.active ? "not_recorded" : "not_collected"} detail={view.active ? "当前时间线未包含逐 Kernel 或 CPU 工作区间。" : "补充当前输入的系统时间线后，按各类工作的累计时长排序。"} />}
    </details>
  </section>;
}
