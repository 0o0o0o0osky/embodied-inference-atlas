import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";

interface ContextBarProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function ContextBar({ data, model, route, navigate }: ContextBarProps) {
  const scopedRunIds = scopedEvidenceRunIds(data, route.tab);
  const scopedRuns = data.datasets.runs.filter((run) =>
    run.model_id === model.model_id
    && (!scopedRunIds || scopedRunIds.has(run.run_id)),
  );
  const runtimeIds = new Set(scopedRuns.map((run) => run.runtime_id));
  const deviceIds = new Set(scopedRuns
    .filter((run) => !route.runtime || run.runtime_id === route.runtime)
    .map((run) => run.device_id));
  const evidenceFiltered = route.tab === "end-to-end" || route.tab === "timeline";
  const runtimes = data.datasets.runtimes.filter((runtime) => evidenceFiltered
    ? runtimeIds.has(runtime.runtime_id)
    : runtime.model_support.some((support) => support.model_id === model.model_id));
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
  const precisionIds = [...new Set(scopedRuns
    .filter((run) => (!route.runtime || run.runtime_id === route.runtime) && (!route.hardware || run.device_id === route.hardware))
    .map((run) => run.precision.precision_id))].sort();
  const rooflinePrecisionIds = rooflinePrecisions(data, model.model_id);
  const fieldCount = 2 + Number(showWorkload) + Number(showRuntimePrecision || showRooflinePrecision);

  return (
    <section className={`context-bar context-bar--${fieldCount}`} aria-label="Workbench context">
      <label>
        <span>{route.tab === "logical" || route.tab === "runtime" ? "Runtime overlay" : "Runtime filter"}</span>
        <select
          value={route.runtime ?? ""}
          onChange={(event) =>
            navigate({ runtime: event.target.value || null, runtimePrecision: null, timelineCapture: null, entity: null })
          }
        >
          <option value="">{route.tab === "logical" || route.tab === "runtime" ? "Logical model only" : "All evidence runtimes"}</option>
          {route.runtime && !runtimeKnown ? (
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
            navigate({ hardware: event.target.value || null, timelineCapture: null, entity: null })
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
              navigate({ workload: event.target.value || null }, true)
            }
          />
        </label>
      ) : null}

      {showRuntimePrecision ? (
        <label>
          <span>Actual runtime precision</span>
          <select
            value={route.runtimePrecision ?? ""}
            disabled={!route.runtime}
            onChange={(event) => navigate({ runtimePrecision: event.target.value || null, entity: null }, true)}
          >
            <option value="">{route.runtime ? "Choose realized precision" : "Choose a runtime first"}</option>
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
