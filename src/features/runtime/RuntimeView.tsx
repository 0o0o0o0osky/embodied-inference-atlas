import { useMemo } from "react";

import { type RoutePatch, type RouteState } from "../../app/routes";
import { RouteLink } from "../../components/RouteLink";
import type { AtlasData, CanonicalRecord, ModelRecord, RuntimeRecord } from "../../types/atlas";
import { LogicalDagSvg } from "../model-graph/components/LogicalDagSvg";
import { adaptLogicalDag } from "../model-graph/domain/adaptLogicalDag";
import { adaptV1ModelGraph, isV1ModelGraphRecord } from "../model-graph/domain/adaptV1ModelGraph";
import { layoutLogicalDag } from "../model-graph/layout/paperLayout";
import { resolveConnectorHints } from "../model-graph/layout/routeConnectors";
import { resolvePresentationProfile } from "../model-graph/presentation/registry";
import { ModelDisplayProvider } from "../model-graph/presentation/ModelDisplay";
import { ExecutionGroupInspector } from "./components/ExecutionGroupInspector";
import { MappingTable } from "./components/MappingTable";
import { RuntimeOverlay } from "./components/RuntimeOverlay";
import { humanizeRuntime } from "./components/runtimePresentation";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "./domain/adaptRuntimeRealization";
import { isInferenceRuntimeForModel } from "./domain/runtimeCatalog";
import { resolveRuntimeCandidates, type RuntimeCandidate } from "./domain/resolveRuntimeRealization";
import { buildRuntimeOverlay } from "./overlay/buildRuntimeOverlay";
import { logicalEntity, logicalRefFromEntity, runtimeGroupEntity } from "../workbench/entityKeys";
import { Pi0RuntimeWorkspace } from "./Pi0RuntimeWorkspace";

interface RuntimeViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

function findGraph(records: CanonicalRecord[], modelId: string) {
  return records.find((record) => isV1ModelGraphRecord(record, modelId)) ?? null;
}

function supportSummary(runtime: RuntimeRecord, modelId: string) {
  const supports = runtime.model_support.filter((support) => support.model_id === modelId);
  const statuses = new Set(supports.map((support) => support.status));
  if (!supports.length) return { label: "unmeasured", tone: "unmeasured", reasons: ["no_support_record"] };
  if (statuses.has("measured")) {
    return {
      label: statuses.has("not_supported") ? "measured + unsupported path" : "measured",
      tone: "measured",
      reasons: supports.map((support) => support.reason_code),
    };
  }
  if (statuses.has("analytical")) {
    return { label: "analytical only", tone: "analytical", reasons: supports.map((support) => support.reason_code) };
  }
  if (statuses.has("not_supported")) {
    return { label: "not supported", tone: "unsupported", reasons: supports.map((support) => support.reason_code) };
  }
  return {
    label: statuses.has("blocked") ? "unmeasured · blocked" : "unmeasured",
    tone: "unmeasured",
    reasons: supports.map((support) => support.reason_code),
  };
}

function value(value: number | null | undefined) {
  return value === null || value === undefined ? "unknown" : String(value);
}

export function RuntimeView({ data, model, route, navigate }: RuntimeViewProps) {
  const record = findGraph(data.datasets.model_graphs, model.model_id);
  if (!record) {
    return (
      <section className="logical-unavailable">
        <p>Runtime overlay unavailable</p>
        <h2>{model.display_name} has no canonical logical graph to anchor an overlay.</h2>
      </section>
    );
  }
  if (model.model_id === "pi0") {
    return (
      <ModelDisplayProvider modelId={model.model_id}>
        <Pi0RuntimeWorkspace
          data={data}
          model={model}
          record={record}
          route={route}
          navigate={navigate}
        />
      </ModelDisplayProvider>
    );
  }
  return <ResolvedRuntimeView data={data} model={model} record={record} route={route} navigate={navigate} />;
}

function ResolvedRuntimeView({ data, model, record, route, navigate }: RuntimeViewProps & { record: CanonicalRecord }) {
  const graph = useMemo(() => adaptV1ModelGraph(record), [record]);
  const dag = useMemo(() => adaptLogicalDag(graph), [graph]);
  const profile = useMemo(() => resolvePresentationProfile(graph, dag), [dag, graph]);
  // Deliberately independent of runtime, hardware, precision, workload, and entity state.
  const layout = useMemo(() => layoutLogicalDag(dag, profile.presentation), [dag, profile.presentation]);
  const connectors = useMemo(
    () => resolveConnectorHints(dag, profile.presentation, layout),
    [dag, layout, profile.presentation],
  );
  const realizations = useMemo(
    () => data.datasets.runtime_realizations
      .filter((item) => isRuntimeRealizationRecord(item, model.model_id))
      .map(adaptRuntimeRealization),
    [data.datasets.runtime_realizations, model.model_id],
  );
  const canonicalConfigurationIds = useMemo(() => new Set([
    ...data.datasets.runs.map((run) => run.configuration_id),
    ...data.datasets.runtime_realizations.flatMap((realization) =>
      Array.isArray(realization.configuration_ids)
        ? realization.configuration_ids.filter((value): value is string => typeof value === "string")
        : []),
  ]), [data.datasets.runs, data.datasets.runtime_realizations]);
  const candidates = useMemo(() => route.runtime ? resolveRuntimeCandidates(realizations, data.datasets.runs, {
    modelId: model.model_id,
    modelGraphId: graph.graphId,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    workload: route.workload,
    precisionId: null,
    canonicalConfigurationIds,
  }) : [], [canonicalConfigurationIds, data.datasets.runs, graph.graphId, model.model_id, realizations, route.hardware, route.runtime, route.workload]);
  const precisionMatches = route.runtimePrecision
    ? candidates.filter((candidate) => candidate.actualPrecisionId === route.runtimePrecision)
    : candidates;
  const activeCandidate = precisionMatches.length === 1 && (route.runtimePrecision !== null || candidates.length === 1)
    ? precisionMatches[0]!
    : null;
  const activeRealization = activeCandidate?.realization ?? null;
  const overlay = useMemo(
    () => activeRealization ? buildRuntimeOverlay(dag, layout, activeRealization, route.entity) : null,
    [activeRealization, dag, layout, route.entity],
  );
  const logicalSelection = logicalRefFromEntity(route.entity);
  const selectedRef = logicalSelection && dag.nodes.has(logicalSelection) ? logicalSelection : "";
  const relatedRefs = overlay?.highlightedLogicalRefs ?? new Set<string>();
  const selectedRuntime = data.datasets.runtimes.find((runtime) =>
    runtime.runtime_id === route.runtime && isInferenceRuntimeForModel(runtime, model.model_id),
  ) ?? null;
  const selectedSupport = selectedRuntime ? supportSummary(selectedRuntime, model.model_id) : null;
  const unsupportedReasons = realizations
    .filter((realization) => realization.runtimeId === route.runtime && realization.availability === "not_supported")
    .map((realization) => realization.availabilityReasonCode);
  const runtimes = data.datasets.runtimes.filter((runtime) =>
    isInferenceRuntimeForModel(runtime, model.model_id),
  );
  const selectGroup = (groupId: string) => {
    if (activeCandidate) navigate({ entity: runtimeGroupEntity(activeCandidate.realization.realizationId, groupId) }, true);
  };

  return (
    <section className="runtime-workspace" aria-labelledby="runtime-view-title">
      <header className="runtime-intro">
        <div>
          <p>{graph.graphId} / fixed authored layout</p>
          <h2 id="runtime-view-title">Runtime realization overlay</h2>
          <span>Execution annotations share the logical DAG. Runtime selection never rewrites its nodes, edges, coordinates, folds, zoom, or pan.</span>
        </div>
        <aside>
          <strong>{activeCandidate?.precisionLabel ?? "Logical geometry locked"}</strong>
          <span>{activeCandidate?.realization.realizationId ?? "Choose a realized precision path"}</span>
          <small>Actual runtime precision is separate from analytical roofline scenarios.</small>
        </aside>
      </header>

      <section className="runtime-availability" aria-labelledby="runtime-availability-title">
        <header>
          <div>
            <p>Core-stack availability</p>
            <h3 id="runtime-availability-title">Select an implementation plane</h3>
          </div>
          <button type="button" onClick={() => navigate({ runtime: null, runtimePrecision: null, entity: null })}>
            Runtime off
          </button>
        </header>
        <div className="runtime-options">
          {runtimes.map((runtime) => {
            const support = supportSummary(runtime, model.model_id);
            return (
              <button
                type="button"
                key={runtime.runtime_id}
                className={[`is-${support.tone}`, route.runtime === runtime.runtime_id ? "is-active" : ""].filter(Boolean).join(" ")}
                onClick={() => navigate({ runtime: runtime.runtime_id, runtimePrecision: null, entity: null })}
              >
                <strong>{runtime.display_name}</strong>
                <span>{support.label}</span>
                <small>{[...new Set(support.reasons)].map(humanizeRuntime).join(" · ")}</small>
              </button>
            );
          })}
        </div>
      </section>

      <RuntimeResolution
        route={route}
        selectedRuntime={selectedRuntime}
        selectedSupport={selectedSupport}
        candidates={candidates}
        activeCandidate={activeCandidate}
        unsupportedReasons={unsupportedReasons}
        navigate={navigate}
      />

      {activeRealization ? (
        <>
          <section className="runtime-evidence-note" aria-label="Runtime evidence boundary">
            <strong>Source-audited execution mapping</strong>
            <span>Canonical runs establish workload applicability. They do not correlate these groups to profiler kernels.</span>
          </section>
          <section className="runtime-launch" aria-label="Runtime launch semantics">
            <span className={`runtime-launch-chip is-${activeRealization.launch.cudaGraphState}`}>
              {humanizeRuntime(activeRealization.launch.submissionMode)}
            </span>
            <div>
              <strong>Launch scope: {humanizeRuntime(activeRealization.launch.captureScope)}</strong>
              <p>CUDA Graph state is {humanizeRuntime(activeRealization.launch.cudaGraphState)}. Capture/replay is submission metadata, not evidence of operator fusion.</p>
            </div>
          </section>
          <dl className="runtime-workload-ledger">
            <div>
              <dt>Logical default</dt>
              <dd>{value(graph.bindings.T_ACTION)} × {value(graph.bindings.D_LATENT_ACTION)}</dd>
            </div>
            <div>
              <dt>Runtime internal</dt>
              <dd>{value(activeRealization.workloadApplicability.runtimeActionHorizon)} × {value(activeRealization.workloadApplicability.runtimeInternalActionDimension)}</dd>
            </div>
            <div>
              <dt>Public action</dt>
              <dd>{value(activeRealization.workloadApplicability.publicActionHorizon)} × {value(activeRealization.workloadApplicability.publicActionDimension)}</dd>
            </div>
            <div>
              <dt>Denoise</dt>
              <dd>×{value(activeRealization.workloadApplicability.denoiseSteps)}</dd>
            </div>
          </dl>
        </>
      ) : null}

      {(layout.diagnostics.length || connectors.invalidHints.length || overlay?.diagnostics.length) ? (
        <div className="graph-diagnostics" role="status">
          {[...layout.diagnostics, ...connectors.invalidHints.map((hint) => `Invalid route hint: ${hint.id}`), ...(overlay?.diagnostics ?? [])].join(" ")}
        </div>
      ) : null}

      <div className="runtime-workspace-grid">
        <section className="logical-graph-panel" aria-label={`${profile.panelLabel}, runtime overlay`}>
          <LogicalDagSvg
            dag={dag}
            layout={layout}
            connectors={connectors}
            presentation={profile.presentation}
            selectedRef={selectedRef}
            relatedRefs={relatedRefs}
            onSelect={(ref) => navigate({ entity: logicalEntity(ref) }, true)}
            ariaLabel={`${profile.diagramLabel}; runtime annotations share the same coordinates`}
            overlay={activeRealization && overlay ? (
              <RuntimeOverlay
                layout={layout}
                realization={activeRealization}
                overlay={overlay}
                onSelectGroup={selectGroup}
              />
            ) : undefined}
          />
        </section>
        {activeRealization ? (
          <ExecutionGroupInspector dag={dag} realization={activeRealization} selectedEntity={route.entity} />
        ) : (
          <aside className="runtime-inspector runtime-inspector--inactive">
            <header><p>Runtime mapping</p><h3>Logical graph only</h3><code>{graph.graphId}</code></header>
            <p className="runtime-inspector-prompt">The unmodified logical layout remains visible while no measured realization is selected.</p>
          </aside>
        )}
      </div>

      {activeRealization && overlay ? (
        <MappingTable dag={dag} realization={activeRealization} overlay={overlay} onSelectGroup={selectGroup} />
      ) : null}
    </section>
  );
}

function RuntimeResolution({
  route,
  selectedRuntime,
  selectedSupport,
  candidates,
  activeCandidate,
  unsupportedReasons,
  navigate,
}: {
  route: RouteState;
  selectedRuntime: RuntimeRecord | null;
  selectedSupport: ReturnType<typeof supportSummary> | null;
  candidates: readonly RuntimeCandidate[];
  activeCandidate: RuntimeCandidate | null;
  unsupportedReasons: readonly string[];
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  if (!route.runtime) return <p className="runtime-resolution">Runtime off. The graph below is the canonical logical layout.</p>;
  if (!selectedRuntime) return <p className="runtime-resolution is-missing">Unknown runtime ID. No overlay was inferred.</p>;
  if (selectedSupport?.tone === "analytical") {
    return (
      <div className="runtime-resolution is-analytical">
        <p><strong>Analytical only.</strong> {selectedRuntime.display_name} has no executable runtime-realization record.</p>
        <RouteLink route={route} patch={{ tab: "roofline-kernels", entity: null }} navigate={navigate}>
          Open Roofline &amp; Kernels →
        </RouteLink>
      </div>
    );
  }
  if (selectedSupport?.tone === "unsupported") {
    return (
      <p className="runtime-resolution is-missing">
        <strong>Not supported.</strong> {selectedSupport.reasons.map(humanizeRuntime).join(" · ")}. No executable realization is synthesized.
      </p>
    );
  }
  if (selectedSupport?.tone === "unmeasured") {
    return (
      <p className="runtime-resolution is-missing">
        <strong>Unmeasured or blocked.</strong> {selectedSupport.reasons.map(humanizeRuntime).join(" · ")}. The logical graph stays visible without an execution overlay.
      </p>
    );
  }
  if (activeCandidate) {
    return (
      <>
        <p className="runtime-resolution is-active">
          <strong>{selectedRuntime.display_name} · {activeCandidate.precisionLabel}</strong> resolved from model, runtime, hardware, workload/configuration, and actual measured precision.
        </p>
        <UnsupportedResolution reasons={unsupportedReasons} />
      </>
    );
  }
  if (!route.runtimePrecision && candidates.length > 1) {
    return (
      <section className="runtime-resolution is-choice" aria-label="Actual runtime precision choices">
        <p><strong>Choose the actual runtime precision.</strong> Analytical precision scenarios are not used to select a realization.</p>
        <div>
          {candidates.map((candidate) => (
            <button
              type="button"
              key={candidate.realization.realizationId}
              onClick={() => navigate({ runtimePrecision: candidate.actualPrecisionId, entity: null })}
            >
              {candidate.precisionLabel}
              <small>{humanizeRuntime(candidate.realization.availability)}</small>
            </button>
          ))}
        </div>
      </section>
    );
  }
  const reasons = selectedSupport?.reasons.map(humanizeRuntime).join(" · ");
  return (
    <>
      <p className="runtime-resolution is-missing">
        <strong>No matching measured realization.</strong> The selected hardware, workload/configuration, or actual precision is not evidenced{reasons ? ` (${reasons})` : ""}.
      </p>
      <UnsupportedResolution reasons={unsupportedReasons} />
    </>
  );
}

function UnsupportedResolution({ reasons }: { reasons: readonly string[] }) {
  if (!reasons.length) return null;
  return (
    <p className="runtime-resolution is-missing">
      <strong>Unsupported path recorded separately.</strong> {[...new Set(reasons)].map(humanizeRuntime).join(" · ")}. It is not an actual candidate.
    </p>
  );
}
