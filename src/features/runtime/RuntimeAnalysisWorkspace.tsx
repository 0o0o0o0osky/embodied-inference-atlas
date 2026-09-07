import { AnalysisPlaceholder, type AnalysisPlaceholderProps } from '../../components/AnalysisPlaceholder';
import { runtimeEvidenceSelectionPatch } from './domain/analysisNavigation';
import { modelAnalysisDescriptor } from './domain/modelAnalysisDescriptor';
import { ExistingPerformanceComparison } from './components/ExistingPerformanceComparison';
import { useMemo } from 'react';
import type { RoutePatch, RouteState } from '../../app/routes';
import type { AtlasData, CanonicalRecord, ModelRecord } from '../../types/atlas';
import { adaptV1ModelGraph } from '../model-graph/domain/adaptV1ModelGraph';
import { adaptLogicalDag } from '../model-graph/domain/adaptLogicalDag';
import { timelineEventEntity } from '../workbench/entityKeys';
import { AnalysisNavigation } from './components/AnalysisNavigation';
import { Pi0PerformanceOverviewChart, type Pi0RoutablePerformanceSelection } from './components/Pi0PerformanceOverviewChart';
import { Pi0SelectedRuntimeSummary } from './components/Pi0SelectedRuntimeSummary';
import { Pi0NsysSection } from './components/Pi0NsysSection';
import { RuntimeReuseDiagram } from './components/RuntimeReuseDiagram';
import { ExecutionHotspots } from './components/ExecutionHotspots';
import { buildPi0PerformanceOverview, PI0_PERFORMANCE_TARGET } from './domain/buildPi0PerformanceOverview';
import { resolveAnalysisContext } from './domain/resolveAnalysisContext';
import { pi0PrecisionLabel } from './components/runtimePresentation';
import { OfflinePerfettoViewer } from '../timeline/perfetto/OfflinePerfettoViewer';
import { InferenceSampleSummary } from './components/InferenceSampleSummary';
import { RuntimeSystemFlow } from './components/RuntimeSystemFlow';
import './components/runtimeImplementation.css';
import './components/systemWorkbench.css';

interface Props {
  data: AtlasData; model: ModelRecord; record: CanonicalRecord | null; route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}


/** Shared runtime shell; model descriptors choose workload/comparison policy. */
export function RuntimeAnalysisWorkspace({data, model, record, route, navigate}: Props) {
  const descriptor = useMemo(()=>modelAnalysisDescriptor(data,model.model_id),[data,model.model_id]);
  const isPi0 = descriptor.comparisonKind === 'pi0-target';
  const overview = useMemo(()=>isPi0 ? buildPi0PerformanceOverview({data,hardwareId:route.hardware}) : null,[data,route.hardware,isPi0]);
  const facet = overview?.facets.find(item=>item.id === route.runtimeFacet) ?? null;
  const context = useMemo(()=>resolveAnalysisContext({data,model,record,route: {...route,workload:route.workload ?? (route.timelineCapture ? null : (isPi0 ? route.inputShape ?? descriptor.defaultWorkload : descriptor.defaultWorkload))},facetContext:facet?.comparisonContext ?? null}),[data,model,record,route,facet,descriptor,isPi0]);
  const {nsys,kernels,actualPrecision,selectedRun,selectedEvidence,implementationRealization,normalizedWorkload,runtimeBounds,overrides} = context;
  const coordinateBindings = Object.fromEntries((isPi0 ? route.inputShape ?? descriptor.defaultWorkload ?? '' : '').split(',').map(binding=>binding.split('=')));
  const coordinate = {cameraViews: Number(coordinateBindings.v) || 1,actionChunk: Number(coordinateBindings.a) || 50};
  const analysisView = route.analysisView ?? 'system';
  const runtimeLabel = context.summaries.find(item=>item.runtimeId === route.runtime)?.displayName ?? data.datasets.runtimes.find(item=>item.runtime_id === route.runtime)?.display_name ?? route.runtime ?? '';
  const precisionLabel = pi0PrecisionLabel(actualPrecision ?? 'unknown',actualPrecision ?? '未记录');
  const selectedWorkload = selectedRun?.workload.vla ?? {camera_views:overrides.V ?? null,executed_prompt_tokens:overrides.L_PROMPT ?? null,action_chunk:overrides.T_ACTION ?? null,denoise_steps:overrides.N_DENOISE ?? null};
  const hasLatency = selectedRun?.evidence === 'measured_local' && selectedEvidence?.measurement.evidence === 'measured_local' && selectedEvidence.selected?.value != null;
  const currentProtocol = selectedRun?.timing.warmup_iterations === PI0_PERFORMANCE_TARGET.warmupIterations && selectedEvidence?.measurement.sampleCount === PI0_PERFORMANCE_TARGET.sampleCount
    && (!isPi0 || selectedWorkload.executed_prompt_tokens === 48 && selectedWorkload.denoise_steps === 10 && (overview?.availableActionChunks ?? [20,50]).includes(selectedWorkload.action_chunk ?? 0));
  const group = overview?.groups.find(item=>item.runtimeId === route.runtime && item.precisionId === actualPrecision);
  const supportCells = group?.facets.length ? group.facets.map(item=>item.series.find(series=>series.actionChunk === selectedWorkload.action_chunk)?.cells.find(cell=>cell.cameraViews === selectedWorkload.camera_views))
    : group?.unmeasuredSeries?.find(series=>series.actionChunk === selectedWorkload.action_chunk)?.cells.filter(cell=>cell.cameraViews === selectedWorkload.camera_views) ?? [];
  const support = data.datasets.runtimes.find(item=>item.runtime_id === route.runtime)?.model_support.filter(item=>item.model_id === model.model_id) ?? [];
  const unsupported = supportCells.length > 0 && supportCells.every(cell=>cell?.state === 'unsupported')
    || support.length > 0 && support.every(item=>item.status === 'not_supported');
  const hasOtherTimeline = data.datasets.runs.some(run=>run.model_id === model.model_id && run.runtime_id === route.runtime
    && (!route.hardware || run.device_id === route.hardware) && data.datasets.profiler_captures.some(capture=>capture.run_id === run.run_id && capture.tool === 'nsys'));
  const timelineAbsence: AnalysisPlaceholderProps = unsupported
    ? {title:'当前实现不支持此输入',state:'unsupported',detail:'可返回性能对比，选择当前实现支持的输入。'}
    : context.captureIdentities.nsys.length
      ? {title:'系统时间线待关联',state:'unlinked',detail:'已有当前范围的采集记录，尚未关联可显示的时间线。'}
      : hasOtherTimeline
        ? {title:'当前输入暂无系统时间线',state:'no_match',detail:'已有其他配置的采集；当前模型、硬件、精度与输入尚无匹配记录。'}
        : {title:'系统时间线尚未采集',state:'not_collected',detail:'补充当前输入的 trace 并核验稳定性后，可查看 CPU/GPU 执行和热点。'};
  const dag = useMemo(()=>record ? adaptLogicalDag(adaptV1ModelGraph(record,overrides)) : null,[record,overrides]);
  const selectEvidence = (selection: Pi0RoutablePerformanceSelection) => navigate({
    runtime:selection.runtimeId,runtimePrecision:selection.precisionId,runtimeFacet:selection.facetId,
    hardware:selection.hardwareId,workload:selection.configurationId,selectedRun:selection.runId,
    inputShape: Object.values(selection.workload).every(value=>value!==null)
      ? `v=${selection.workload.cameraViews},p=${selection.workload.promptTokens},a=${selection.workload.actionChunk},n=${selection.workload.denoiseSteps}` : route.inputShape ?? null,
    ...runtimeEvidenceSelectionPatch(route, selection.runId), basis:null,rooflineLevel:'overview',
  });
  return <section className="model-graph-workspace model-workspace pi0-runtime-workspace runtime-analysis-workspace" aria-labelledby="runtime-analysis-title">
    <h2 id="runtime-analysis-title" className="visually-hidden">{model.display_name} 运行表现</h2>
    <AnalysisNavigation route={route} navigate={navigate} />
    <div hidden={Boolean(route.runtime)}>
      {isPi0 ? <Pi0PerformanceOverviewChart model={overview!} selectedRunId={route.selectedRun ?? null} coordinate={coordinate}
        onCoordinateChange={next=>navigate({inputShape:`v=${next.cameraViews},p=48,a=${next.actionChunk},n=10`},true)}
        onSelectEvidence={selectEvidence}
        onInspectRuntime={(runtime,runtimePrecision,next)=>navigate({runtime,runtimePrecision,runtimeFacet:null,selectedRun:null,analysisView:'system',workload:`v=${next.cameraViews},p=48,a=${next.actionChunk},n=10`,entity:null,timelineCapture:null})} /> : <ExistingPerformanceComparison data={data} model={model} route={route} navigate={navigate} />}
    </div>
    {route.runtime ? <>
      <Pi0SelectedRuntimeSummary runtimeLabel={runtimeLabel} precisionLabel={precisionLabel}
        latency={hasLatency ? selectedEvidence!.selected : null} workload={selectedWorkload}
        workloadStatus={Object.values(selectedWorkload).some(value=>value === null) ? 'partial' : 'complete'}
        selectionKind={hasLatency ? currentProtocol ? 'target_measurement' : 'native_evidence' : selectedRun && ['nsys','ncu'].includes(selectedRun.capture_method) ? 'profiler_capture' : unsupported ? 'unsupported' : Object.values(selectedWorkload).every(value=>value == null) ? 'incomplete_input' : 'symbolic_target'} />
      {runtimeBounds.endToEnd ? <div className="system-bound-status"><span>理论最短耗时：<strong>{(runtimeBounds.endToEnd.point.derived.roof_second! * 1e3).toFixed(3)} ms</strong></span>
        <details><summary>计算依据</summary><p>{runtimeBounds.reason}</p></details>
      </div> : null}
      <InferenceSampleSummary context={context} />
      <nav className="pi0-runtime-analysis-tabs" aria-label="推理栈分析视图">
        {([['system','系统耗时'],['hotspots','执行 DAG'],['reuse','执行优化']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={analysisView === id || id === 'system' && analysisView === 'perfetto'} onClick={()=>navigate({analysisView:id,timelineCapture:nsys.active?.capture.captureId??route.timelineCapture})}>{label}</button>)}
      </nav>
      <div hidden={analysisView !== 'system'}>
        {implementationRealization?.systemFlow ? <RuntimeSystemFlow key={implementationRealization.realizationId} flow={implementationRealization.systemFlow} runtimeLabel={runtimeLabel} /> : <AnalysisPlaceholder title="系统流程" state="not_recorded" detail="补充 CPU/GPU 模块、执行顺序与数据传递后显示。" />}
        <Pi0NsysSection view={nsys} absence={timelineAbsence}
          onSelectEvent={event=>nsys.active && navigate({entity:timelineEventEntity(nsys.active.timeline.timelineId,event.eventId)},true)}
          onOpenDetails={()=>navigate({analysisView:'perfetto'})} />
      </div>
      <div hidden={analysisView !== 'hotspots'}>
        <ExecutionHotspots key={`${route.runtime}|${actualPrecision}|${route.workload}`} data={context.scopedData} record={record} route={route} view={nsys} kernels={kernels} realization={implementationRealization} workload={normalizedWorkload} navigate={navigate} />
      </div>
      <div hidden={analysisView !== 'reuse'}>{implementationRealization ? <RuntimeReuseDiagram dag={dag} realization={implementationRealization} sources={data.datasets.sources} /> : <AnalysisPlaceholder title="执行优化" state="not_recorded" detail="补充当前实现的优化机制、节省的工作与适用条件后显示。" />}</div>
      {analysisView === 'perfetto' ? <section className="system-perfetto-detail">
        <div className="pi0-funnel-heading"><button type="button" onClick={()=>navigate({analysisView:'system'})}>返回系统概览</button>

        </div>
        {nsys.active ? <OfflinePerfettoViewer timeline={nsys.active.timeline} {...(nsys.selectedEvent ? {selectedWindow:{startNs:nsys.selectedEvent.startNs,endNs:nsys.selectedEvent.startNs+nsys.selectedEvent.durationNs}} : {})} /> : <AnalysisPlaceholder {...timelineAbsence} />}
      </section> : null}
    </> : null}
  </section>;
}
