import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { isInferenceRuntimeForModel } from "../runtime/domain/runtimeCatalog";
import { isPi0ModelTheory } from "../runtime/domain/pi0PerformanceNavigation";

interface ContextBarProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  compact?: boolean;
}

export function ContextBar({ data, model, route, navigate, compact = false }: ContextBarProps) {
  const runtimeById = new Map(data.datasets.runtimes.map((runtime) => [runtime.runtime_id, runtime]));
  const isInferenceRuntimeId = (runtimeId: string) => {
    const runtime = runtimeById.get(runtimeId);
    return !runtime || isInferenceRuntimeForModel(runtime, model.model_id);
  };
  const scopedRunIds = scopedEvidenceRunIds(data, route.tab);
  const scopedRuns = data.datasets.runs.filter((run) =>
    run.model_id === model.model_id
    && (!scopedRunIds || scopedRunIds.has(run.run_id)),
  );
  const runtimeIds = new Set(scopedRuns
    .filter((run) => isInferenceRuntimeId(run.runtime_id))
    .map((run) => run.runtime_id));
  const deviceIds = new Set(scopedRuns
    .filter((run) => isInferenceRuntimeId(run.runtime_id) && (!route.runtime || run.runtime_id === route.runtime))
    .map((run) => run.device_id));
  const evidenceFiltered = route.tab === "end-to-end" || route.tab === "timeline";
  const runtimes = data.datasets.runtimes.filter((runtime) =>
    isInferenceRuntimeForModel(runtime, model.model_id)
    && (evidenceFiltered ? runtimeIds.has(runtime.runtime_id) : true));
  const devices = data.datasets.devices.filter((device) => evidenceFiltered ? deviceIds.has(device.device_id) : true);
  const runtimeKnown = runtimes.some(
    (runtime) => runtime.runtime_id === route.runtime,
  );
  const hardwareKnown = devices.some(
    (device) => device.device_id === route.hardware,
  );
  const showWorkload = route.tab !== "end-to-end" && route.tab !== "timeline";
  const showRuntimePrecision = route.tab === "runtime";
  const showRooflinePrecision = route.tab === "roofline-kernels";
  const modelTheory = isPi0ModelTheory(route);
  const compactActualPrecision = compact && model.model_id === "pi0" && !modelTheory && (
    (route.tab === "runtime" && route.runtime !== null)
    || route.tab === "timeline"
    || route.tab === "roofline-kernels"
  );
  const precisionIds = [...new Set(scopedRuns
    .filter((run) => (
      isInferenceRuntimeId(run.runtime_id)
      && (!(showRuntimePrecision || compactActualPrecision) || model.model_id !== "pi0" || run.evidence === "measured_local")
      && (!route.runtime || run.runtime_id === route.runtime)
      && (!route.hardware || run.device_id === route.hardware)
    ))
    .map((run) => run.precision.precision_id))].sort();
  const rooflinePrecisionIds = rooflinePrecisions(data, model.model_id);
  const fieldCount = 2 + Number(showWorkload) + Number(showRuntimePrecision || showRooflinePrecision);

  if (compact) {
    const runtimeOverview = route.tab === "runtime" && route.runtime === null;
    const compactRooflinePrecision = route.tab === "logical" || route.tab === "roofline-kernels";
    const displayedRuntimePrecision = runtimeKnown
      ? route.runtimePrecision ?? (precisionIds.length === 1 ? precisionIds[0]! : "")
      : "";
    return (
      <div className="atlas-context" aria-label={runtimeOverview ? "推理性能场景" : "模型分析场景"}>
        <label>
          <span>硬件</span>
          <select value={route.hardware ?? ""} onChange={(event) => navigate({
            hardware: event.target.value || null,
            runtimePrecision: null,
            runtimeFacet: null,
            timelineCapture: null,
            entity: modelTheory ? route.entity : null,
            workload: modelTheory ? route.workload : null,
            basis: null,
          })}>
            <option value="">未选择</option>
            {route.hardware && !hardwareKnown ? <option value={route.hardware}>{route.hardware}</option> : null}
            {devices.map((device) => <option key={device.device_id} value={device.device_id}>{device.display_name}</option>)}
          </select>
        </label>
        {compactActualPrecision ? (
          <label>
            <span>实际精度</span>
            <select
              value={displayedRuntimePrecision}
              disabled={!runtimeKnown}
              onChange={(event) => navigate({
                runtimePrecision: event.target.value || null,
                runtimeFacet: null,
                timelineCapture: null,
                entity: null,
                workload: null,
              }, true)}
            >
              <option value="">
                {runtimeKnown ? "请选择实测配置" : route.runtime ? "不是可选推理栈" : "请先选择推理栈"}
              </option>
              {route.runtimePrecision && !precisionIds.includes(route.runtimePrecision) ? (
                <option value={route.runtimePrecision}>{runtimePrecisionLabel(route.runtimePrecision)}（当前范围外）</option>
              ) : null}
              {precisionIds.map((precisionId) => (
                <option key={precisionId} value={precisionId}>{runtimePrecisionLabel(precisionId)}</option>
              ))}
            </select>
          </label>
        ) : null}
        {compactRooflinePrecision ? (
          <label>
            <span>理论精度</span>
            <select value={route.precision ?? ""} onChange={(event) => navigate({
              precision: event.target.value || null,
              basis: null,
              entity: modelTheory ? route.entity : route.tab === "roofline-kernels" ? null : route.entity,
            }, true)}>
              <option value="">场景默认</option>
              {route.precision && !rooflinePrecisionIds.includes(route.precision) ? <option value={route.precision}>{precisionLabel(route.precision)}</option> : null}
              {rooflinePrecisionIds.map((precisionId) => <option key={precisionId} value={precisionId}>{precisionLabel(precisionId)}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    );
  }

  return (
    <section className={`context-bar context-bar--${fieldCount}`} aria-label="Workbench context">
      <label>
        <span>{route.tab === "logical" || route.tab === "runtime" ? "Runtime overlay" : "Runtime filter"}</span>
        <select
          value={route.runtime ?? ""}
          onChange={(event) =>
            navigate({ runtime: event.target.value || null, runtimePrecision: null, runtimeFacet: null, timelineCapture: null, entity: null })
          }
        >
          <option value="">{route.tab === "logical" || route.tab === "runtime" ? "Logical model only" : "All evidence runtimes"}</option>
          {route.runtime && !runtimeKnown && !runtimeById.has(route.runtime) ? (
            <option value={route.runtime}>{route.runtime} (not in snapshot)</option>
          ) : null}
          {runtimes.map((runtime) => {
            const supports = runtime.model_support.filter((record) => record.model_id === model.model_id);
            const supportLabel = [...new Set(supports.map((support) => support.status))].join(" + ") || "no support record";
            return (
              <option key={runtime.runtime_id} value={runtime.runtime_id}>
                {runtime.display_name} ({supportLabel})
              </option>
            );
          })}
        </select>
      </label>

      <label>
        <span>{route.tab === "roofline-kernels" ? "Runtime hardware filter" : "Hardware"}</span>
        <select
          value={route.hardware ?? ""}
          onChange={(event) =>
            navigate({ hardware: event.target.value || null, runtimeFacet: null, timelineCapture: null, entity: null })
          }
        >
          <option value="">{route.tab === "roofline-kernels" ? "No runtime hardware filter" : "No hardware selected"}</option>
          {route.hardware && !hardwareKnown ? (
            <option value={route.hardware}>{route.hardware} (not in snapshot)</option>
          ) : null}
          {devices.map((device) => (
            <option key={device.device_id} value={device.device_id}>
              {device.display_name}
            </option>
          ))}
        </select>
      </label>

      {showWorkload ? (
        <label>
          <span>Workload binding</span>
          <input
            type="text"
            value={route.workload ?? ""}
            placeholder="canonical-default"
            onChange={(event) =>
              navigate({ workload: event.target.value || null, runtimeFacet: null }, true)
            }
          />
        </label>
      ) : null}

      {showRuntimePrecision ? (
        <label>
          <span>Actual runtime precision</span>
          <select
            value={route.runtimePrecision ?? ""}
            disabled={!runtimeKnown}
            onChange={(event) => navigate({ runtimePrecision: event.target.value || null, runtimeFacet: null, entity: null }, true)}
          >
            <option value="">{runtimeKnown ? "Choose realized precision" : route.runtime ? "Runtime is not selectable" : "Choose a runtime first"}</option>
            {route.runtimePrecision && !precisionIds.includes(route.runtimePrecision) ? <option value={route.runtimePrecision}>{route.runtimePrecision} (outside active scope)</option> : null}
            {precisionIds.map((precisionId) => <option key={precisionId} value={precisionId}>{precisionId}</option>)}
          </select>
        </label>
      ) : null}

      {showRooflinePrecision ? (
        <label>
          <span>Analytical roofline precision</span>
          <select value={route.precision ?? ""} onChange={(event) => navigate({ precision: event.target.value || null, basis: null, entity: null }, true)}>
            <option value="">Basis default</option>
            {route.precision && !rooflinePrecisionIds.includes(route.precision) ? <option value={route.precision}>{route.precision} (outside model scenarios)</option> : null}
            {rooflinePrecisionIds.map((precisionId) => <option key={precisionId} value={precisionId}>{precisionId}</option>)}
          </select>
        </label>
      ) : null}
    </section>
  );
}

function precisionLabel(precisionId: string): string {
  return precisionId.endsWith("_dense") ? precisionId.slice(0, -6).toUpperCase() : precisionId;
}

function runtimePrecisionLabel(precisionId: string): string {
  return ({
    "mixed-fp8-e4m3-fp16": "选择性 FP8 E4M3 / FP16",
    "mixed-bf16-fp32": "BF16 / FP32 混合执行",
    "q8_0-weight-only": "Q8_0 仅权重量化 / FP16 执行（非 INT8 计算）",
  } as Readonly<Record<string, string>>)[precisionId] ?? precisionId;
}

function scopedEvidenceRunIds(data: AtlasData, tab: RouteState["tab"]): Set<string> | null {
  if (tab === "end-to-end") {
    return new Set(data.datasets.end_to_end.flatMap((record) => typeof record.run_id === "string" ? [record.run_id] : []));
  }
  if (tab === "timeline") {
    return new Set(data.datasets.profiler_captures.flatMap((record) =>
      record.tool === "nsys" && typeof record.run_id === "string" ? [record.run_id] : [],
    ));
  }
  return null;
}

function rooflinePrecisions(data: AtlasData, modelId: string): string[] {
  return [...new Set(data.datasets.roofline_scenarios.flatMap((record) => {
    if (record.model_id !== modelId || typeof record.precision_path !== "object" || record.precision_path === null || Array.isArray(record.precision_path)) return [];
    const precisionId = (record.precision_path as Record<string, unknown>).precision_path_id;
    return typeof precisionId === "string" ? [precisionId] : [];
  }))].sort();
}
