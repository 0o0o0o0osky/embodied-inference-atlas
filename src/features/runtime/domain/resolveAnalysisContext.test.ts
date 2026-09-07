import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pi0NsysSection } from '../components/Pi0NsysSection';
import { expect, it } from "vitest";
import { atlasSnapshot as atlasDocument } from '../../../testSupport/atlasSnapshot';
import type { AtlasData } from "../../../types/atlas";
import { readRoute } from "../../../app/routes";
import * as contextModule from "./resolveAnalysisContext";

const data = atlasDocument as unknown as AtlasData;
const resolve = contextModule.resolveAnalysisContext;
const model = data.datasets.models.find((item) => item.model_id === "pi0")!;
const record = data.datasets.model_graphs.find((item) => item.model_id === "pi0")!;
const run = data.datasets.runs.find((item) => item.run_id === "run-pi0-vlacpp-w5-r10-001")!;
const route = readRoute(`?model=pi0&tab=runtime&runtime=${run.runtime_id}&hardware=${run.device_id}&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}`);

it("retains measured latency without a theoretical or realization match", () => {
  const context = resolve({ data: { ...data, datasets: { ...data.datasets, runtime_realizations: [], roofline_points: [] } }, model, record, route });
  expect(context.selectedRun?.run_id).toBe(run.run_id);
  expect(context.selectedEvidence?.selected?.value).toBeGreaterThan(0);
  expect(context.runtimeBounds.endToEnd).toBeNull();
  expect(context.normalizedWorkload).toBe("V=1,L_PROMPT=48,T_ACTION=50,N_DENOISE=10");
  expect(context.captureIdentities.endToEnd?.runId).toBe(run.run_id);
});

it("does not borrow a configuration or precision from a different model or stack", () => {
  const context = resolve({ data, model, record, route: { ...route, runtime: "flashrt" } });
  expect(context.selectedRun).toBeNull();
  expect(context.nsys.active).toBeNull();
  expect(context.kernels.rows).toEqual([]);
  expect(context.reasons).toContain("configuration_unavailable");
});

it("keeps NCU replay identities separate from request and timeline timing", () => {
  const selected = data.datasets.runs.find((item) => item.run_id === "run-pi0-flashrt-nsys-node-001")!;
  const context = resolve({ data, model, record, route: { ...route, runtime: selected.runtime_id, runtimePrecision: selected.precision.precision_id, workload: selected.configuration_id } });
  expect(context.captureIdentities.endToEnd).toBeNull();
  expect(context.captureIdentities.ncu.length).toBeGreaterThan(0);
  expect(context.captureIdentities.ncu.every((item) => item.runId !== selected.run_id && item.timingBoundaryId !== selected.timing.timing_boundary_id)).toBe(true);
  expect(context.scopedProfiler.captures.every((item) => item.tool !== "ncu")).toBe(true);
});

it("reports unverified repeated batches as ambiguous instead of selecting or pooling one", () => {
  const { analysis_batch: omittedBatch, ...unverified } = run;
  void omittedBatch;
  const duplicate = { ...unverified, run_id: "independent-repeat" };
  const context = resolve({ data: { ...data, datasets: { ...data.datasets, runs: [...data.datasets.runs.map(item=>item.run_id===run.run_id?unverified:item), duplicate] } }, model, record, route });
  expect(context.selectedRun).toBeNull();
  expect(context.selectedEvidence).toBeNull();
  expect(context.reasons).toContain("ambiguous_run");
});

it("selects one explicit batch and fails closed for an unavailable run ID", () => {
  const duplicate = { ...run, run_id: "independent-repeat" };
  const batches = { ...data, datasets: { ...data.datasets, runs: [...data.datasets.runs, duplicate] } };
  const exact = resolve({ data: batches, model, record, route: { ...route, selectedRun: run.run_id } });
  expect(exact.selectedRun?.run_id).toBe(run.run_id);
  const unavailable = resolve({ data: batches, model, record, route: { ...route, selectedRun: "missing-run" } });
  expect(unavailable.selectedRun).toBeNull();
  expect(unavailable.reasons).toContain("requested_run_unavailable");
});

// Legacy graph URLs remain supported even though the published corpus keeps
// only the node view. Model this navigation case with three local records.
function withLegacyGraph(): AtlasData {
  const node = data.datasets.profiler_captures.find(c => c.capture_id === 'capture-pi0-flashrt-nsys-node-001')!;
  const nodeRun = data.datasets.runs.find(r => r.run_id === node.run_id)!;
  const nodeTimeline = data.datasets.timelines.find(t => t.capture_id === node.capture_id)!;
  const captureId = 'capture-pi0-flashrt-nsys-graph-001';
  const runId = 'run-pi0-flashrt-nsys-graph-001';
  return {...data, datasets: {...data.datasets,
    runs: [...data.datasets.runs, {...nodeRun, run_id: runId, configuration_id: 'config-pi0-flashrt-nsys-graph-001'}],
    profiler_captures: [...data.datasets.profiler_captures, {...node, capture_id: captureId, run_id: runId,
      nsys: {...node.nsys!, report_mode: 'graph'}}],
    timelines: [...data.datasets.timelines, {...nodeTimeline, timeline_id: 'timeline-local-legacy-graph-001', capture_id: captureId, run_id: runId}],
  }};
}

it('uses an explicitly selected legacy capture as context when its URL has no workload', () => {
  const data = withLegacyGraph();
  const legacy = readRoute('?model=pi0&tab=timeline&runtime=flashrt&runtimePrecision=mixed-fp8-e4m3-fp16&timelineCapture=capture-pi0-flashrt-nsys-graph-001');
  const context = resolve({data,model,record,route:legacy});
  expect(context.nsys.active?.capture.captureId).toBe('capture-pi0-flashrt-nsys-graph-001');
  expect(context.selectedRun?.configuration_id).toBe('config-pi0-flashrt-nsys-graph-001');
  expect(context.captureIdentities.endToEnd).toBeNull();
  expect(resolve({data,model,record,route:{...legacy,runtime:'vla-cpp'}}).nsys.active).toBeNull();
});

it('uses the same node capture across tabs and retains explicit legacy selections', () => {
  const data = withLegacyGraph();
  const legacy = readRoute('?model=pi0&tab=timeline&runtime=flashrt&runtimePrecision=mixed-fp8-e4m3-fp16&timelineCapture=capture-pi0-flashrt-nsys-graph-001');
  const initial = resolve({data,model,record,route:legacy});
  const base = {...legacy,workload:initial.selectedRun!.configuration_id,timelineCapture:null,entity:null};
  expect(resolve({data,model,record,route:{...base,analysisView:'system'}}).nsys.active?.capture.nsys?.reportMode).toBe('node');
  const hotspots = resolve({data,model,record,route:{...base,analysisView:'hotspots'}});
  expect(hotspots.nsys.active?.capture.nsys?.reportMode).toBe('node');
  expect(hotspots.kernels.rows.some(item=>item.observation.observationKind === 'nsys_window_aggregate')).toBe(true);
  expect(resolve({data,model,record,route:{...base,analysisView:'hotspots',timelineCapture:legacy.timelineCapture}}).nsys.active?.capture.captureId).toBe(legacy.timelineCapture);
});

it('retains the ten-sample summary while rendering only the real representative trace', () => {
  const context = resolve({data,model,record,route});
  expect(context.nsys.active?.capture.captureId).toBe('capture-pi0-vla-cpp-nsys-node-021');
  expect(context.traceSummary?.sampleCount).toBe(10);
  expect(context.traceSummary?.wall.medianNs).toBe(168812838);
  expect(context.scopedProfiler.timelines).toHaveLength(1);
  const markup = renderToStaticMarkup(createElement(Pi0NsysSection, {
    view: context.nsys, onSelectEvent: () => undefined, onOpenDetails: () => undefined,
  }));
  expect(markup).toContain('Nsys 采集统计 · 10 次中位数');
  expect(markup).toContain('<dt>Nsys 请求耗时</dt><dd>168.813 ms</dd>');
  expect(markup).toContain('窗口 170.194 ms');
});

it('keeps measured E2E and the selected real trace available without a model graph', () => {
  const withoutGraph={...data,datasets:{...data.datasets,model_graphs:[]}};
  const context=resolve({data:withoutGraph,model,record:null,route});
  expect(context.defaultGraph).toBeNull();
  expect(context.selectedRun?.run_id).toBe(run.run_id);
  expect(context.selectedEvidence?.selected?.value).toBeGreaterThan(0);
  expect(context.nsys.active?.capture.captureId).toBe('capture-pi0-vla-cpp-nsys-node-021');
  expect(context.nsys.active!.timeline.events.length).toBeGreaterThan(0);
  expect(context.candidates).toEqual([]);
  expect(context.reasons).toContain('model_graph_unavailable');
});
it('does not supply another model defaults or evidence to an unknown model without a graph', () => {
  const unknown={...model,model_id:'new-model',display_name:'New model'};
  const context=resolve({data,model:unknown,record:null,route:{...route,model:'new-model',workload:null,selectedRun:null,timelineCapture:null,runtimePrecision:null}});
  expect(context.normalizedWorkload).toBe('');
  expect(context.actualPrecision).toBeNull();
  expect(context.overrides).toEqual({});
  expect(context.selectedRun).toBeNull();
  expect(context.selectedEvidence).toBeNull();
  expect(context.nsys.active).toBeNull();
  expect(context.implementationRealization).toBeNull();
  expect(context.slice.cameraViews).toBeNull();
  expect(context.slice.promptTokens).toBeNull();
});

it('preserves explicitly selected input dimensions without a logical graph',()=>{
 const context=resolve({data,model,record:null,route:{...route,workload:'v=2,p=48,a=50,n=10',selectedRun:null,timelineCapture:null}});
 expect(context.slice.cameraViews).toBe(2);
 expect(context.slice.promptTokens).toBe(48);
 expect(context.overrides).toEqual({V:2,L_PROMPT:48,T_ACTION:50,N_DENOISE:10});
 expect(context.nsys.active).toBeNull();
});

it("uses the persisted representative while keeping an explicit unsummarized trace readable", () => {
  const selected = data.datasets.runs.find(item => item.run_id === 'run-pi0-flashrt-nsys-node-001')!;
  const historicRoute = {...route, runtime:selected.runtime_id, runtimePrecision:selected.precision.precision_id,
    workload:selected.configuration_id, timelineCapture:'capture-pi0-flashrt-nsys-node-001'};
  const historical = resolve({data,model,record,route:historicRoute});
  expect(historical.nsys.active?.capture.captureId).toBe('capture-pi0-flashrt-nsys-node-001');
  expect(historical.nsys.active?.timeline.window.durationNs).toBeGreaterThan(0);
  expect(historical.traceSummary).toBeNull();
  const current = resolve({data,model,record,route});
  expect(current.nsys.active?.capture.captureId).toBe(current.traceSummary?.representativeCaptureId);
  expect(current.traceSummary?.status).toBe('stable');
});
