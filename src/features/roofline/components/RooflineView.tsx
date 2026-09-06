import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../../app/routes";
import type { AtlasData, CanonicalRecord, ModelRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../../model-graph/domain/adaptV1ModelGraph";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "../../runtime/domain/adaptRuntimeRealization";
import { indexRuntimeRealization } from "../../runtime/domain/indexRuntimeRealization";
import { resolveRuntimeCandidates, type RuntimeCandidate } from "../../runtime/domain/resolveRuntimeRealization";
import type { RuntimeRealizationRecord } from "../../runtime/domain/types";
import { createModelCapabilityRegistry } from "../../workbench/modelCapabilities";
import {
  kernelEntity,
  legacyComponentEntity,
  logicalEntity,
  logicalRefFromEntity,
  parseEntityKey,
  runtimeGroupEntity,
  stageEntity,
  type CrossViewEntityKey,
} from "../../workbench/entityKeys";
import { createRooflineIndex, indexRoofline } from "../data/indexRoofline";
import { rooflineBasisContract } from "../domain/basisContract";
import {
  materializeInteractiveRoofline,
  interactiveSourceBasisIsLossless,
  parseInteractiveWorkload,
  runtimeResolutionWorkload,
  serializeInteractiveWorkload,
  type InteractiveWorkloadBounds,
} from "../data/materialize";
import { buildRooflineView, type RooflineQuery } from "../presentation/viewModel";
import { RooflineAnalysis } from "./RooflineAnalysis";
import { RooflineBasisBar } from "./RooflineBasisBar";
import { RooflineModeTabs } from "./RooflineModeTabs";
import { RooflineOverview } from "./RooflineOverview";
import { isPi0ModelTheory } from "../../runtime/domain/pi0PerformanceNavigation";

export interface RooflineViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

function isAnalyticalWorkload(encoded: string | null, configurationIds: ReadonlySet<string>) {
  if (!encoded || configurationIds.has(encoded)) return false;
  return encoded.split(",").every((part) =>
    /^(?:v|p|a|n|V|L_PROMPT|T_ACTION|N_DENOISE)=-?\d+$/.test(part.trim()),
  );
}

function exactRuntimeCandidate(candidates: readonly RuntimeCandidate[]) {
  return candidates.length === 1 && candidates[0]!.realization.availability !== "not_supported"
    ? candidates[0]!
    : null;
}

function canonicalEntityKey(entity: string | null): CrossViewEntityKey | null {
  const parsed = parseEntityKey(entity);
  if (!parsed) return null;
  if (parsed.kind === "logical") return logicalEntity(logicalRefFromEntity(entity)!);
  if (parsed.kind === "stage") return stageEntity(parsed.modelGraphId, parsed.stageId);
  if (parsed.kind === "runtime-group") return runtimeGroupEntity(parsed.realizationId, parsed.executionGroupId);
  if (parsed.kind === "kernel") return kernelEntity(parsed.captureId, parsed.kernelObservationId);
  if (parsed.kind === "legacy-component") return legacyComponentEntity(parsed.pointId);
  return null;
}

function selectionKeys(
  entity: string | null,
  realizations: readonly RuntimeRealizationRecord[],
  activeRealization: RuntimeRealizationRecord | null,
) {
  const parsed = parseEntityKey(entity);
  const canonical = canonicalEntityKey(entity);
  if (!parsed || !canonical) return [];
  const keys = new Set<CrossViewEntityKey>([canonical]);
  const logicalRef = logicalRefFromEntity(entity);
  if (logicalRef && activeRealization) {
    indexRuntimeRealization(activeRealization).mappingsByLogicalRef.get(logicalRef)
      ?.filter((mapping) => mapping.path === "primary" && mapping.certainty === "exact")
      .forEach((mapping) => mapping.executionGroupIds.forEach((groupId) => {
        keys.add(runtimeGroupEntity(activeRealization.realizationId, groupId));
      }));
  }
  if (parsed.kind === "runtime-group") {
    const realization = realizations.find((item) => item.realizationId === parsed.realizationId);
    if (realization) {
      indexRuntimeRealization(realization).mappingsByGroupId.get(parsed.executionGroupId)
        ?.filter((mapping) => mapping.path === "primary" && mapping.certainty === "exact")
        .forEach((mapping) => mapping.logicalTargets.forEach((target) => keys.add(logicalEntity(target.ref))));
    }
  }
  return [...keys];
}

function compatibilityIssue(
  mode: RouteState["rooflineLevel"],
  route: RouteState,
  candidates: readonly RuntimeCandidate[],
  active: RuntimeCandidate | null,
  captureId: string | null,
) {
  if (mode !== "fused" && mode !== "kernel") return null;
  if (!route.runtime) return `${mode === "fused" ? "Fused" : "Kernel"} analysis requires one Task 4 runtime realization selection.`;
  if (!active) {
    return candidates.length
      ? `Runtime ${route.runtime} resolves to ${candidates.length} realizations; select one actual runtime precision before opening ${mode}.`
      : `No Task 4 realization exactly matches runtime ${route.runtime}, hardware, workload, and actual precision ${route.runtimePrecision ?? "(unresolved)"}.`;
  }
  if (mode === "kernel" && !captureId) {
    return `Realization ${active.realization.realizationId} is exact, but no non-null canonical capture is selected; kernel work, observed time, and system-memory traffic cannot be joined.`;
  }
  return `Exact realization ${active.realization.realizationId} (${active.actualPrecisionId}) has no ${mode} basis with the same capture semantics.`;
}

function promptBounds(graphRecord: CanonicalRecord | null): InteractiveWorkloadBounds {
  if (!graphRecord) return { promptMinimum: 1, promptMaximum: null };
  const prompt = adaptV1ModelGraph(graphRecord).editableSymbols.find((symbol) => symbol.symbol === "L_PROMPT");
  return { promptMinimum: prompt?.minimum ?? 1, promptMaximum: prompt?.maximum ?? null };
}

function sparseObservedRunIds(data: AtlasData) {
  return data.datasets.runs.flatMap((run) => {
    const operating = (run as unknown as { operating_point?: { sparsity_on?: boolean } }).operating_point;
    return operating?.sparsity_on === true ? [run.run_id] : [];
  });
}

export function RooflineView(props: RooflineViewProps) {
  const capabilities = useMemo(() => createModelCapabilityRegistry(props.data), [props.data]);
  const modelCapabilities = capabilities.get(props.model.model_id);
  if (!modelCapabilities?.roofline.available || !modelCapabilities.roofline.defaultScenarioId) {
    return <section className="roofline-empty"><p>Roofline unavailable</p><h2>No canonical model materializer</h2><span>{modelCapabilities?.roofline.reason ?? `No capability record was derived for ${props.model.model_id}.`}</span></section>;
  }
  return <CoreRooflineView
    {...props}
    defaultScenarioId={modelCapabilities.roofline.defaultScenarioId}
    canonicalConfigurationIds={modelCapabilities.canonicalConfigurationIds}
  />;
}

function CoreRooflineView({
  data,
  model,
  route,
  navigate,
  defaultScenarioId,
  canonicalConfigurationIds,
}: RooflineViewProps & { defaultScenarioId: string; canonicalConfigurationIds: ReadonlySet<string> }) {
  const canonical = useMemo(() => indexRoofline(data), [data]);
  const modelId = model.model_id;
  const requestedBasis = route.basis ? canonical.basisById.get(route.basis) : null;
  const requestedScenario = requestedBasis ? canonical.scenarioById.get(requestedBasis.scenario_id) : null;
  const precisionPath = route.precision ?? requestedScenario?.precision_path.precision_path_id ?? "bf16_dense";
  const sourceScenario = canonical.scenarios.find((scenario) => scenario.model_id === modelId
    && scenario.origin === "default_precomputed"
    && scenario.precision_path.precision_path_id === precisionPath)
    ?? canonical.scenarioById.get(defaultScenarioId)!;
  const graphRecord = data.datasets.model_graphs.find((record) => record.model_graph_id === sourceScenario.model_graph_id) ?? null;
  const workloadBounds = useMemo(() => promptBounds(graphRecord), [graphRecord]);
  const workload = parseInteractiveWorkload(route.workload, sourceScenario.workload, workloadBounds);
  const interactive = useMemo(() => {
    // Default scenarios are formula inputs; their point snapshots are optional.
    if (requestedScenario?.origin === "legacy_import") return null;
    if (route.workload && !isAnalyticalWorkload(route.workload, canonicalConfigurationIds)) return null;
    const realizationId = sourceScenario.precision_path.realization_ids.length === 1
      ? sourceScenario.precision_path.realization_ids[0]!
      : null;
    const realizationRecord = realizationId
      ? data.datasets.runtime_realizations.find((record) => record.realization_id === realizationId) ?? null
      : null;
    const realization = realizationRecord && isRuntimeRealizationRecord(realizationRecord)
      ? adaptRuntimeRealization(realizationRecord)
      : null;
    const scenarioBases = canonical.bases.filter((basis) =>
      basis.scenario_id === sourceScenario.scenario_id
      && (!route.hardware || basis.device_id === route.hardware),
    ).filter((basis) => interactiveSourceBasisIsLossless(basis, sourceScenario, realization));
    const requestedSourceBasis = requestedBasis
      && scenarioBases.some((basis) => basis.basis_id === requestedBasis.basis_id)
      ? requestedBasis
      : null;
    const contracts = new Set(scenarioBases.map(rooflineBasisContract));
    if (!requestedSourceBasis && contracts.size !== 1) return null;
    const sourceContract = requestedSourceBasis
      ? rooflineBasisContract(requestedSourceBasis)
      : [...contracts][0];
    const stageBasis = scenarioBases.find((basis) =>
      basis.level === "stage" && rooflineBasisContract(basis) === sourceContract,
    );
    const atomicBasis = scenarioBases.find((basis) =>
      basis.level === "atomic" && rooflineBasisContract(basis) === sourceContract,
    );
    if (!stageBasis || !atomicBasis) return null;
    const ceiling = canonical.ceilingById.get(atomicBasis.ceiling_id);
    if (!ceiling?.bandwidth.some((candidate) =>
      candidate.bandwidth_ceiling_id === atomicBasis.bandwidth_ceiling_id,
    )) return null;
    if (!graphRecord || !ceiling) return null;
    try {
      return materializeInteractiveRoofline(
        graphRecord,
        sourceScenario,
        ceiling,
        workload,
        realizationRecord,
        atomicBasis.bandwidth_ceiling_id,
      );
    } catch {
      return null;
    }
  }, [canonical, canonicalConfigurationIds, data.datasets.runtime_realizations, graphRecord, requestedBasis, requestedScenario, route.hardware, route.workload, sourceScenario, workload]);
  const index = useMemo(() => interactive
    ? createRooflineIndex(
      canonical.ceilings,
      [...canonical.scenarios, interactive.scenario],
      // Prefer this selected precision/workload in overview as well as detail.
      [...interactive.bases, ...canonical.bases],
      [...canonical.points, ...interactive.points],
    )
    : canonical, [canonical, interactive]);
  const realizations = useMemo(() => data.datasets.runtime_realizations
    .filter((record) => isRuntimeRealizationRecord(record, modelId))
    .map(adaptRuntimeRealization), [data.datasets.runtime_realizations, modelId]);
  const runtimeCandidates = useMemo(() => route.runtime ? resolveRuntimeCandidates(realizations, data.datasets.runs, {
    modelId,
    modelGraphId: sourceScenario.model_graph_id!,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    workload: runtimeResolutionWorkload(route.workload, workload, [...canonicalConfigurationIds]),
    precisionId: route.runtimePrecision,
    canonicalConfigurationIds,
  }) : [], [canonicalConfigurationIds, data.datasets.runs, modelId, realizations, route.hardware, route.runtime, route.runtimePrecision, route.workload, sourceScenario.model_graph_id, workload]);
  const activeCandidate = exactRuntimeCandidate(runtimeCandidates);
  const activeRealization = activeCandidate?.realization ?? null;
  // Task 4 resolves realizations but does not yet expose a canonical capture
  // selection. Null is therefore meaningful: analytical fused bases with a
  // null capture may match; observed fused/kernel captures may not.
  const captureId = null;
  const interactiveBasis = interactive && route.rooflineLevel !== "overview" && route.rooflineLevel !== "fused" && route.rooflineLevel !== "kernel"
    ? interactive.bases.find((basis) => basis.level === route.rooflineLevel)?.basis_id ?? null
    : null;
  const selectedKey = canonicalEntityKey(route.entity);
  const queryBase: Omit<RooflineQuery, "mode" | "basisId"> = {
    modelId,
    precisionPathId: sourceScenario.precision_path.precision_path_id,
    runtimeId: route.runtime,
    realizationId: activeRealization?.realizationId ?? null,
    captureId,
    selectedEntityIds: selectionKeys(route.entity, realizations, activeRealization),
    compatibilityIssue: compatibilityIssue(route.rooflineLevel, route, runtimeCandidates, activeCandidate, captureId),
    sparseObservedRunIds: sparseObservedRunIds(data),
  };
  const view = buildRooflineView({
    ...queryBase,
    mode: route.rooflineLevel,
    basisId: interactiveBasis ?? route.basis,
  }, index);
  const overview = buildRooflineView({ ...queryBase, mode: "overview", basisId: null }, index).overview!;
  const modelTheory = isPi0ModelTheory(route);
  const basisControls = <RooflineBasisBar
    route={route}
    model={view}
    workload={view.activeScenario?.origin === "legacy_import" ? null : workload}
    workloadBounds={workloadBounds}
    navigate={navigate}
    onWorkload={(next) => navigate({ workload: serializeInteractiveWorkload(next), basis: null, entity: modelTheory ? route.entity : null }, true)}
  />;
  return (
    <section className="roofline-workspace" aria-labelledby="roofline-title">
      <header className="roofline-intro">
        <div><p>Basis-safe analytical workbench</p><h2 id="roofline-title">Roofline &amp; kernels</h2></div>
        <p>Every chart and table resolves exactly one level, workload, precision, time, traffic, work, device, operating point, runtime, and coverage basis.</p>
      </header>
      <RooflineModeTabs route={route} overview={overview} navigate={navigate} />
      {route.rooflineLevel === "overview" ? (
        <RooflineOverview items={overview} legacy={view.legacyInventory} navigate={navigate} />
      ) : (
        <>
          {modelTheory ? <details className="theory-analysis-settings">
            <summary>输入形状与分析依据 · V{workload.executedCameraViews} / P{workload.executedPromptTokens} / A{workload.actionHorizon} / N{workload.denoiseSteps}</summary>
            {basisControls}
            {view.warnings.map((warning) => <p key={warning.id}>{warning.message}</p>)}
          </details> : <>{basisControls}
            {view.warnings.length ? <div className="roofline-warnings" role="status">{view.warnings.map((warning) => <p key={warning.id}><strong>{warning.id.replaceAll("-", " ")}.</strong> {warning.message}</p>)}</div> : null}
          </>}
          <RooflineAnalysis model={view} selectedEntityKey={selectedKey} onSelect={(entity) => navigate({ entity }, true)} modelTheory={modelTheory} />
        </>
      )}
    </section>
  );
}
