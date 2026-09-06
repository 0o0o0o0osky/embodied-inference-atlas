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
  const selected = data.datasets.runs.find((item) => item.model_id === "pi0" && item.runtime_id === "flashrt" && item.capture_method !== "ncu")!;
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
  expect(markup).toContain('本采集批次的总体指标：10 次中位数');
  expect(markup).toContain('<dt>Nsys 请求墙钟</dt><dd>168.813 ms</dd>');
  expect(markup).toContain('预测窗口 170.194 ms');
});
