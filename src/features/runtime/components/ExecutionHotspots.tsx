import { KernelComputation, KernelResources, isVerifiedConversion } from './KernelComputation';
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
  data: AtlasData; record: CanonicalRecord; route: RouteState; view: TimelineViewModel; kernels: KernelRowsModel;
  realization: RuntimeRealizationRecord | null; workload: string;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  const [detailView, setDetailView] = useState<'timing'|'resources'|'dag'|'roofline'>('timing');
  const [showAll, setShowAll] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
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
  const graphEntity = selectedEntity?.kind === 'runtime-group' || selectedEntity?.kind === 'logical'
    ? route.entity : (rememberedRelevant ? rememberedGraphEntity : null) ?? linkedGroupEntity;
  useEffect(()=>{
    if (selected && !graphEntity) detailRef.current?.scrollIntoView({block:'start'});
  },[selected?.id,graphEntity]);
  const sharedConversions = rows.filter(row=>kernels.rows.some(item=>item.capture.captureId===row.captureId && item.signature.kernelSignatureId===row.kernelSignatureId && isVerifiedConversion(item)));
  const detail = selected ? <aside ref={detailRef} className="execution-hotspot-detail">
        <header><h4>{labelFor(selected)}</h4><button type="button" onClick={()=>navigate({entity:rememberedGraphEntity},true)} aria-label="关闭热点详情">×</button></header>
        <p>{selected.timeMeaning} · 当前类别 {selected.count} 次</p>{selected.category === 'GPU Kernel' ? <p>{selected.events[0]?.launch ? '按当前 trace 的签名与 launch 配置分组。' : '当前类别未记录 launch 配置，同签名内部形状与执行组织是否一致尚未验证。'}</p> : null}
        <nav aria-label="当前热点分析">{([['timing','计算与数据'],['resources','执行与资源'],['roofline','Roofline']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={detailView === id} onClick={()=>setDetailView(id)}>{label}</button>)}</nav>
        {detailView === 'timing' ? <>
          <dl><div><dt>累计时长</dt><dd>{(selected.durationNs/1e6).toFixed(3)} ms</dd></div><div><dt>证据来源</dt><dd>当前 Nsys 采集</dd></div>{kernel?.signature.implementationFamily ? <div><dt>计算路径</dt><dd>{kernel.signature.implementationFamily}</dd></div> : null}</dl>
          <p>{selected.category === 'CPU 调度执行' ? '调度记录证明线程执行，尚不能归因到准备、图构建或后处理函数。函数采样比例也不是精确函数耗时。' : ''} </p>
          {signatureClasses.length>1?<label className="kernel-invocation-selector">同签名启动配置类别<select aria-label="选择启动配置类别" value={selected.id} onChange={event=>{const row=signatureClasses.find(item=>item.id===event.target.value)!;navigate({entity:entityFor(row)},true);}}>{signatureClasses.map((row,i)=><option key={row.id} value={row.id}>类别 {i+1} · Grid {row.events[0]?.launch?.grid?.join('×') ?? '未知'} / Block {row.events[0]?.launch?.block?.join('×') ?? '未知'} · {row.count} 次 · {(row.durationNs/1e6).toFixed(3)} ms</option>)}</select></label>:null}
          {invocation.selected ? <>
            <label className="kernel-invocation-selector">当前 trace 的真实调用
              <select aria-label="选择真实调用" value={invocation.selected.eventId} onChange={event=>navigate({entity:timelineEventEntity(view.active!.timeline.timelineId,event.target.value)},true)}>
                {invocation.events.map((event,i)=><option key={event.eventId} value={event.eventId}>第 {i+1} 次 · {(event.startNs/1e6).toFixed(3)} ms 开始 · {(event.durationNs/1e3).toFixed(2)} μs</option>)}
              </select>
            </label>
            <svg className="kernel-duration-distribution" viewBox="0 0 400 48" role="img" aria-label="当前类别各次调用耗时分布，实心点为所选调用">
              <line x1="12" y1="24" x2="388" y2="24" stroke="#a4b4c0" />
              {[...invocation.events].sort((a,b)=>Number(a.eventId===invocation.selected!.eventId)-Number(b.eventId===invocation.selected!.eventId)).map(event=><circle key={event.eventId} cx={12+376*(event.durationNs-invocation.minNs!)/Math.max(1,invocation.maxNs!-invocation.minNs!)} cy={24} r={event.eventId===invocation.selected!.eventId?6:3} fill={event.eventId===invocation.selected!.eventId?'#17679b':'#9db5c5'}><title>{event.eventId} · {(event.durationNs/1e3).toFixed(2)} μs</title></circle>)}
            </svg>
            <p>默认选择最接近类内中位数的真实调用；当前窗口最短 {(invocation.minNs!/1e3).toFixed(2)} / 中位数 {(invocation.medianNs!/1e3).toFixed(2)} / 最长 {(invocation.maxNs!/1e3).toFixed(2)} μs。</p>
            <dl><div><dt>所选单次执行</dt><dd>{(invocation.selected.durationNs/1e3).toFixed(2)} μs</dd></div></dl>
            <details><summary>调用身份</summary><p>{invocation.selected.eventId}</p></details>
          </> : <p>此记录未提供可独立选择的精确单次区间。</p>}
          {kernel ? <KernelComputation row={kernel} point={singlePairs[0]?.point} /> : null}
          {singlePairs.map(({point})=><div key={point.point_id} className="kernel-measured-summary"><dl>
            <div><dt>计算吞吐</dt><dd>{(point.work.total_flop / point.timing.observed_second! / 1e12).toFixed(2)} TFLOP/s</dd></div>
            <div><dt>单次计算量</dt><dd>{(point.work.total_flop/1e9).toFixed(2)} GFLOP</dd></div>
            <div><dt>单次边界建模流量</dt><dd>{(point.traffic.total_byte/1e6).toFixed(2)} MB</dd></div></dl><p>Nsys 追踪下的所选调用计时。</p></div>)}
          <button type="button" onClick={()=>navigate({analysisView:'system',timelineCapture:selected.captureId,entity:timelineEventEntity(view.active!.timeline.timelineId,(invocation.selected ?? selected.events[0]!).eventId)})}>在系统时间线定位</button>
        </> : detailView === 'resources' ? <>
          {invocation.selected ? <p>当前 Nsys 调用 {(invocation.selected.durationNs/1e3).toFixed(2)} μs；资源配置来自此调用。</p>:null}
          {invocation.selected?.launch ? <KernelResources launch={invocation.selected.launch} label="当前调用的执行资源" /> : kernel ? <KernelResources launch={kernel.observation.launch} /> : <p>此对象没有 GPU launch 资源记录。</p>}
          {kernel ? replay.length ? <KernelNcuMetrics rows={replay} /> : <p>当前 Kernel 尚无配置匹配的 NCU 硬件计数器。</p> : null}
        </> : detailView === 'dag' ? groups.length && realization ? <div>{groups.map(id=><button key={id} type="button" onClick={()=>graphNavigate({entity:runtimeGroupEntity(realization.realizationId,id)},true)}>在图中选择对应执行组</button>)}</div> : <p>当前热点尚无已确认的算子或融合组关联，不能凭 Kernel 名称推断 DAG 位置。</p>
          : singlePairs.length ? singlePairs.map(pair=><RooflinePairChart key={pair.point.point_id} {...pair} />) : <p>{selected.category === 'GPU Kernel' ? '当前对象尚缺同口径的工作量或边界流量，保留其实际耗时。' : '此对象没有已确认的 FLOPs，按耗时分析，不强行绘制 Roofline。'}</p>}
        <button type="button" onClick={()=>setDetailView('dag')}>DAG 定位</button>
      </aside> : null;
  const renderKernelDetails = (groupIds: readonly string[]) => {
    const associated = realization ? groupKernelRows(kernels.rows,realization,groupIds) : [];
    const measured = associated.filter(item=>item.observation.observationKind !== 'ncu_replayed_launch');
    const replaysOnly = associated.filter(item=>item.observation.observationKind === 'ncu_replayed_launch');
    const selectedHere = kernel && associated.some(item=>item.observation.observationId === kernel.observation.observationId);
    return <section className="dag-kernel-selection" aria-label="执行组 Kernel">
      <h3>对应 Kernel</h3>
      {measured.length ? <ul>{measured.map(item=><li key={item.observation.observationId}>
        <button type="button" aria-pressed={item.observation.observationId === kernel?.observation.observationId}
          onClick={()=>{setGraphEntity(graphEntity);navigate({timelineCapture:item.capture.captureId,entity:kernelEntity(item.capture.captureId,item.observation.observationId)},true);}}>
          {item.signature.labelSanitized}<span>{(item.observation.duration.valueNs/1e6).toFixed(3)} ms · {item.observation.calls} 次</span>
        </button></li>)}</ul> : replaysOnly.length ? <KernelNcuMetrics rows={replaysOnly} /> : <p>当前采集尚无此执行组的 Kernel 关联。</p>}
      {associated.some(item=>item.links.some(link=>link.realizationId === realization?.realizationId && link.executionGroupIds.some(id=>groupIds.includes(id)) && (link.status === 'partial' || link.executionGroupIds.length > 1))) ? <p>跨执行组共享 Kernel：显示当前窗口的整份签名累计，不能归为所选组的专属耗时。NCU 回放也未区分具体调用位置。</p> : null}
      {selectedHere ? detail : null}
    </section>;
  };
  return <section className="execution-hotspots" aria-label="执行热点">
    <header className="pi0-funnel-heading"><h3>执行热点</h3></header>
    <p className="pi0-funnel-note">点击图中的融合组或精度标注，查看对应 Kernel 与性能；完整列表在底部展开。</p>
    {sharedConversions.length?<details className="dag-shared-conversions"><summary>共享数据转换 · {sharedConversions.length} 个启动配置类别 · {(sharedConversions.reduce((sum,row)=>sum+row.durationNs,0)/1e6).toFixed(3)} ms</summary>
      <p>FP32 → BF16，多个位置使用，具体算子归属未区分。以下为当前 trace 的真实执行类别，不绘制未经确认的算子依赖箭头。</p>
      <ul>{sharedConversions.map(row=><li key={row.id}><button type="button" aria-pressed={selected?.id===row.id} onClick={()=>{setGraphEntity(null);navigate({entity:entityFor(row)},true);}}>{labelFor(row)} · Grid {row.events[0]?.launch?.grid?.join('×') ?? '未知'} · {row.count} 次 · {(row.durationNs/1e6).toFixed(3)} ms</button></li>)}</ul>
    </details>:null}
    {realization ? <div className="hotspot-primary-dag"><Pi0ImplementationDagSection initialShowPrecision record={record}
      route={{...route,workload,entity:graphEntity}} activeRealization={realization} selectedRuntimeName={route.runtime}
      navigate={graphNavigate} renderKernelDetails={renderKernelDetails} /></div> : <p>当前栈尚无执行图映射，可从底部列表查看已记录的性能。</p>}
    {selected && !graphEntity ? <div className="hotspot-unmapped-detail">{detail}</div> : null}
    <details className="hotspot-kernel-inventory"><summary>Kernel 与 CPU 热点列表（{rows.length} 项）</summary>
      <p className="pi0-funnel-note">按当前采集累计时长排序。CPU、API、同步与 GPU 执行可重叠，不能相加为请求总延时。</p>
      {view.active?.capture.nsys?.reportMode === 'node' && !view.active.capture.coverage.isCompleteForPopulation ? <p className="pi0-funnel-note">仅收录部分 Kernel，不代表全部 GPU 活动。</p> : null}
      {rows.length ? <><ol className="execution-hotspot-list">{(showAll ? rows : rows.slice(0,6)).map(row=><li key={row.id}>
        <button type="button" aria-pressed={selected?.id === row.id} onClick={()=>{setGraphEntity(null);navigate({timelineCapture:row.captureId,entity:entityFor(row)},true);}}>
          <span className="hotspot-kind">{row.category}</span><strong>{labelFor(row)}{row.events[0]?.launch?.block ? <small> · Block {row.events[0].launch.block.join('×')}</small> : null}</strong><span className="hotspot-duration">{(row.durationNs/1e6).toFixed(3)} ms</span>
          <span className="hotspot-duration-bar" aria-hidden="true" style={{width:`${row.durationNs/rows[0]!.durationNs*100}%`}} />
        </button>
      </li>)}</ol>{rows.length > 6 ? <button type="button" className="pi0-funnel-detail" onClick={()=>setShowAll(!showAll)}>{showAll ? '收起列表' : `查看全部 ${rows.length} 项`}</button> : null}</> : <p>当前采集没有逐 Kernel 区间。</p>}
    </details>
  </section>;
}
