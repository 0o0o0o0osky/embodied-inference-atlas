import {
  legacyComponentEntity,
  kernelEntity,
  logicalEntity,
  runtimeGroupEntity,
  stageEntity,
  type CrossViewEntityKey,
} from "../../workbench/entityKeys";
import type {
  ComputeCeiling,
  Provenance,
  RooflineBasisRecord,
  RooflineCeilingRecord,
  RooflineLevel,
  RooflinePointRecord,
  RooflineScenarioRecord,
} from "../domain/types";
import type { RooflineIndex } from "../data/indexRoofline";

export interface RooflineQuery {
  modelId: "pi0" | "pi05" | "smolvla";
  mode: "overview" | RooflineLevel;
  basisId: string | null;
  precisionPathId: string | null;
  runtimeId: string | null;
  realizationId: string | null;
  captureId: string | null;
  selectedEntityIds: readonly CrossViewEntityKey[];
  compatibilityIssue: string | null;
  sparseObservedRunIds: readonly string[];
}

export interface RooflineCurveVM {
  curveId: string;
  kind: "uniform_roof" | "reference_only";
  label: string;
  computeClass: string;
  computeCeilingId: string;
  computeFlopPerSecond: number;
  computeProvenance: Provenance;
  bandwidthCeilingId: string;
  bandwidthBytePerSecond: number;
  bandwidthProvenance: Provenance;
  ridgeFlopPerByte: number;
}

export interface RooflinePointVM {
  pointId: string;
  entityKey: CrossViewEntityKey;
  label: string;
  xFlopPerByte: number;
  yFlopPerSecond: number;
  marker: "hollow" | "half" | "filled";
  markerAreaPx2: number;
  coverageKey: string;
  selected: boolean;
  warningIds: readonly string[];
}

export interface RooflineRowVM {
  entity: string;
  shapeOrCoverage: string;
  calls: string;
  work: string;
  traffic: string;
  arithmeticIntensity: string;
  roofTime: string;
  actualTime: string;
  efficiencyGap: string;
  limiter: string;
  pointId: string;
  entityKey: CrossViewEntityKey;
  selected: boolean;
  partial: boolean;
  missingSummary: string;
}

export interface RooflineOverviewItem {
  level: RooflineLevel;
  basisId: string | null;
  basisLabel: string;
  pointIds: readonly string[];
  plottable: number;
  partial: number;
  missing: number;
  availability: "available" | "empty" | "unavailable";
}

export interface RooflineLegacyInventory {
  basisCount: number;
  pointCount: number;
  modelBasisCount: number;
  modelPointCount: number;
  firstModelBasisId: string | null;
}

export interface RooflineViewModel {
  activeBasis: RooflineBasisRecord | null;
  activeScenario: RooflineScenarioRecord | null;
  activeCeiling: RooflineCeilingRecord | null;
  availableBases: readonly { basisId: string; label: string; precisionPathId: string }[];
  curves: readonly RooflineCurveVM[];
  points: readonly RooflinePointVM[];
  rows: readonly RooflineRowVM[];
  records: readonly RooflinePointRecord[];
  inspectorPoint: RooflinePointRecord | null;
  overview: readonly RooflineOverviewItem[] | null;
  legacyInventory: RooflineLegacyInventory;
  warnings: readonly { id: string; message: string }[];
}

function scenarioForBasis(index: RooflineIndex, basis: RooflineBasisRecord) {
  return index.scenarioById.get(basis.scenario_id) ?? null;
}

function modelBases(index: RooflineIndex, modelId: string, level: RooflineLevel, legacy: boolean) {
  return index.bases.filter((basis) => {
    const scenario = scenarioForBasis(index, basis);
    return scenario?.model_id === modelId
      && basis.level === level
      && (scenario.origin === "legacy_import") === legacy;
  });
}

function isLegacyRequest(query: RooflineQuery, index: RooflineIndex) {
  const requested = query.basisId ? index.basisById.get(query.basisId) : null;
  return requested ? scenarioForBasis(index, requested)?.origin === "legacy_import" : false;
}

function compatibleBases(query: RooflineQuery, index: RooflineIndex) {
  if (query.mode === "overview") return [];
  const legacy = isLegacyRequest(query, index);
  const bases = modelBases(index, query.modelId, query.mode, legacy);
  if (legacy) return bases;
  if (query.mode !== "fused" && query.mode !== "kernel") return bases;
  if (!query.runtimeId || !query.realizationId) return [];
  return bases.filter((basis) => {
    if (basis.runtime_id !== query.runtimeId || basis.realization_id !== query.realizationId) return false;
    if (basis.capture_id !== query.captureId) return false;
    return query.mode !== "kernel" || query.captureId !== null;
  });
}

function preferredBasis(query: RooflineQuery, bases: readonly RooflineBasisRecord[]) {
  const requested = query.basisId ? bases.find((basis) => basis.basis_id === query.basisId) : null;
  if (requested) return requested;
  const precision = query.precisionPathId
    ? bases.find((basis) => basis.precision_path_id === query.precisionPathId)
    : null;
  return precision ?? bases.find((basis) => basis.precision_path_id === "bf16_dense") ?? bases[0] ?? null;
}

function entityKey(point: RooflinePointRecord, basis: RooflineBasisRecord, scenario: RooflineScenarioRecord) {
  if (point.entity.kind === "legacy_component") return legacyComponentEntity(point.point_id);
  if (point.entity.kind === "execution_group" && basis.realization_id) {
    return runtimeGroupEntity(basis.realization_id, point.entity.entity_id);
  }
  if (point.entity.kind === "kernel" && basis.capture_id) {
    return kernelEntity(basis.capture_id, point.entity.entity_id);
  }
  if (point.entity.kind === "stage" || point.entity.kind === "model_total") {
    const stageId = point.entity.kind === "model_total"
      ? "model_total"
      : point.entity.entity_id.slice(point.entity.entity_id.lastIndexOf("/") + 1);
    return stageEntity(scenario.model_graph_id ?? "unmapped", stageId);
  }
  // Attention sub-points retain #score/#value locally, but their shared route
  // key is the canonical Task 2 logical reference.
  return logicalEntity(point.entity.logical_refs[0] ?? point.entity.entity_id);
}

function marker(point: RooflinePointRecord): "hollow" | "half" | "filled" {
  if (point.timing.observed_second === null) return "hollow";
  return point.traffic.value_kind === "measured" ? "filled" : "half";
}

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

const COMMON_PLOT_FIELDS = new Set([
  "work.total_flop",
  "traffic.total_byte",
  "derived.arithmetic_intensity_flop_per_byte",
]);
const ANALYTICAL_PLOT_FIELDS = new Set([
  "derived.compute_second",
  "derived.memory_second",
  "derived.roof_second",
  "derived.roof_flop_per_second",
]);
const OBSERVED_PLOT_FIELDS = new Set([
  "timing.observed_second",
  "derived.achieved_flop_per_second",
]);

function usesAnalyticalRoof(point: Pick<RooflinePointRecord, "timing">) {
  return point.timing.observed_second === null;
}

export function isRooflinePlotBlocker(point: Pick<RooflinePointRecord, "timing">, field: string) {
  return COMMON_PLOT_FIELDS.has(field)
    || (usesAnalyticalRoof(point) ? ANALYTICAL_PLOT_FIELDS : OBSERVED_PLOT_FIELDS).has(field);
}

function sparseObservationMatches(
  basis: RooflineBasisRecord,
  compute: ComputeCeiling,
  sparseObservedRunIds: ReadonlySet<string>,
) {
  return !compute.requires_sparsity_on
    || (basis.run_id !== null && sparseObservedRunIds.has(basis.run_id));
}

function buildCurves(
  basis: RooflineBasisRecord,
  scenario: RooflineScenarioRecord,
  index: RooflineIndex,
  sparseObservedRunIds: ReadonlySet<string>,
): RooflineCurveVM[] {
  const ceiling = index.ceilingById.get(basis.ceiling_id);
  const bandwidth = ceiling?.bandwidth.find((item) => item.bandwidth_ceiling_id === basis.bandwidth_ceiling_id);
  if (!ceiling || !bandwidth || !positive(bandwidth.byte_per_second)) return [];
  const bandwidthRate = bandwidth.byte_per_second;
  const classes = [...new Set(scenario.precision_path.segments.map((segment) => segment.compute_class))];
  return classes.flatMap((computeClass) => {
    const compute = ceiling.compute.find((item) => item.compute_class === computeClass);
    if (!compute || !positive(compute.flop_per_second)
      || !sparseObservationMatches(basis, compute, sparseObservedRunIds)) return [];
    return [{
      curveId: `${basis.basis_id}:${computeClass}`,
      kind: scenario.precision_path.precision_path_id === "runtime_mixed" ? "reference_only" as const : "uniform_roof" as const,
      label: `${humanize(computeClass)} · ${formatRate(compute.flop_per_second)}`,
      computeClass,
      computeCeilingId: compute.compute_ceiling_id,
      computeFlopPerSecond: compute.flop_per_second,
      computeProvenance: compute.provenance,
      bandwidthCeilingId: bandwidth.bandwidth_ceiling_id,
      bandwidthBytePerSecond: bandwidthRate,
      bandwidthProvenance: bandwidth.provenance,
      ridgeFlopPerByte: compute.flop_per_second / bandwidthRate,
    }];
  });
}

function missingSummary(point: RooflinePointRecord) {
  return point.missing.length
    ? point.missing.map((item) => `${item.field}: ${humanize(item.reason)} — ${item.detail}`).join(" ")
    : "No declared missing values.";
}

function buildRows(
  records: readonly RooflinePointRecord[],
  basis: RooflineBasisRecord,
  scenario: RooflineScenarioRecord,
  selected: ReadonlySet<CrossViewEntityKey>,
): RooflineRowVM[] {
  return records.map((point) => {
    const key = entityKey(point, basis, scenario);
    return {
      entity: point.entity.label,
      shapeOrCoverage: point.entity.shape_or_coverage,
      calls: String(point.calls),
      work: formatQuantity(point.work.total_flop, "FLOP"),
      traffic: formatQuantity(point.traffic.total_byte, "B"),
      arithmeticIntensity: formatNullable(point.derived.arithmetic_intensity_flop_per_byte, (value) => `${formatNumber(value)} FLOP/B`),
      roofTime: formatNullable(point.derived.roof_second, formatTime),
      actualTime: formatNullable(point.timing.observed_second, formatTime),
      efficiencyGap: point.derived.efficiency === null || point.derived.gap === null
        ? "—"
        : `${formatNumber(point.derived.efficiency * 100)}% / ${formatNumber(point.derived.gap)}×`,
      limiter: humanize(point.derived.limiter),
      pointId: point.point_id,
      entityKey: key,
      selected: selected.has(key),
      partial: point.derived.status !== "complete" || point.coverage.status !== "complete",
      missingSummary: missingSummary(point),
    };
  });
}

function overview(query: RooflineQuery, index: RooflineIndex): RooflineOverviewItem[] {
  return (["stage", "atomic", "fused", "kernel"] as const).map((level) => {
    const bases = modelBases(index, query.modelId, level, false);
    const basis = preferredBasis({ ...query, mode: level }, bases);
    const records = basis ? index.pointsByBasisId.get(basis.basis_id) ?? [] : [];
    const plottable = records.filter((point) => positive(point.derived.arithmetic_intensity_flop_per_byte)
      && positive(point.timing.observed_second === null ? point.derived.roof_flop_per_second : point.derived.achieved_flop_per_second)).length;
    const partial = records.filter((point) => point.derived.status === "partial_lower_bound").length;
    return {
      level,
      basisId: basis?.basis_id ?? null,
      basisLabel: basis?.label ?? "No canonical basis",
      pointIds: records.map((point) => point.point_id),
      plottable,
      partial,
      missing: records.length - plottable,
      availability: basis ? (records.length ? "available" : "empty") : "unavailable",
    };
  });
}

function legacyInventory(query: RooflineQuery, index: RooflineIndex): RooflineLegacyInventory {
  const legacyScenarioIds = new Set(index.scenarios
    .filter((scenario) => scenario.origin === "legacy_import")
    .map((scenario) => scenario.scenario_id));
  const bases = index.bases.filter((basis) => legacyScenarioIds.has(basis.scenario_id));
  const selectedModelBases = bases.filter((basis) => scenarioForBasis(index, basis)?.model_id === query.modelId);
  const basisIds = new Set(bases.map((basis) => basis.basis_id));
  const modelBasisIds = new Set(selectedModelBases.map((basis) => basis.basis_id));
  return {
    basisCount: bases.length,
    pointCount: index.points.filter((point) => basisIds.has(point.basis_id)).length,
    modelBasisCount: selectedModelBases.length,
    modelPointCount: index.points.filter((point) => modelBasisIds.has(point.basis_id)).length,
    firstModelBasisId: selectedModelBases[0]?.basis_id ?? null,
  };
}

function emptyView(
  query: RooflineQuery,
  index: RooflineIndex,
  warning: { id: string; message: string } | null,
): RooflineViewModel {
  return {
    activeBasis: null,
    activeScenario: null,
    activeCeiling: null,
    availableBases: [],
    curves: [],
    points: [],
    rows: [],
    records: [],
    inspectorPoint: null,
    overview: query.mode === "overview" ? overview(query, index) : null,
    legacyInventory: legacyInventory(query, index),
    warnings: warning ? [warning] : [],
  };
}

export function buildRooflineView(query: RooflineQuery, index: RooflineIndex): RooflineViewModel {
  if (query.mode === "overview") return emptyView(query, index, null);
  const bases = compatibleBases(query, index);
  const basis = preferredBasis(query, bases);
  if (!basis) {
    const message = query.compatibilityIssue ?? (query.mode === "kernel"
      ? "No kernel basis is canonical yet: an exact realization and capture with work, time, and system-memory traffic are required. Duration or L2 counters alone do not form a kernel roofline point."
      : query.mode === "fused"
        ? "No exact Task 4 realization-matched fused basis is available for this runtime and actual-precision selection."
        : "No compatible canonical basis is available.");
    return emptyView(query, index, { id: "basis-unavailable", message });
  }
  const scenario = index.scenarioById.get(basis.scenario_id) ?? null;
  const ceiling = index.ceilingById.get(basis.ceiling_id) ?? null;
  if (!scenario) throw new Error(`Roofline basis has no scenario: ${basis.basis_id}`);
  if (!ceiling) throw new Error(`Roofline basis has no ceiling: ${basis.basis_id}`);
  const selected = new Set(query.selectedEntityIds);
  const sparseObservedRunIds = new Set(query.sparseObservedRunIds);
  const sparseClasses = new Set(ceiling.compute
    .filter((compute) => compute.requires_sparsity_on && !sparseObservationMatches(basis, compute, sparseObservedRunIds))
    .map((compute) => compute.compute_class));
  const records = [...(index.pointsByBasisId.get(basis.basis_id) ?? [])]
    .sort((a, b) => a.entity.label.localeCompare(b.entity.label));
  const rows = buildRows(records, basis, scenario, selected);
  const timeByPoint = new Map(records.map((point) => [
    point.point_id,
    point.timing.observed_second ?? point.derived.roof_second,
  ]));
  const compatibleTotal = records.reduce((total, point) => {
    const value = timeByPoint.get(point.point_id);
    return total + (positive(value ?? null) ? value! : 0);
  }, 0);
  const points = records.flatMap((point): RooflinePointVM[] => {
    const rejectedSparse = point.work.components.some((item) => item.flop > 0
      && item.compute_class !== null && sparseClasses.has(item.compute_class));
    const x = point.derived.arithmetic_intensity_flop_per_byte;
    const y = usesAnalyticalRoof(point)
      ? point.derived.roof_flop_per_second
      : point.derived.achieved_flop_per_second;
    if (rejectedSparse || !positive(x) || !positive(y)) return [];
    const key = entityKey(point, basis, scenario);
    const pointTime = timeByPoint.get(point.point_id);
    const share = compatibleTotal > 0 && positive(pointTime ?? null) ? pointTime! / compatibleTotal : 0;
    return [{
      pointId: point.point_id,
      entityKey: key,
      label: point.entity.label,
      xFlopPerByte: x,
      yFlopPerSecond: y,
      marker: marker(point),
      markerAreaPx2: 36 + 160 * share,
      coverageKey: point.entity.coverage_key,
      selected: selected.has(key),
      warningIds: point.derived.status === "complete" ? [] : ["partial-envelope"],
    }];
  });
  const inspectorIndex = rows.findIndex((row) => row.selected);
  const warnings: { id: string; message: string }[] = [];
  if (query.basisId && query.basisId !== basis.basis_id) {
    warnings.push({ id: "basis-fallback", message: "The requested basis is incompatible with this model and level; no dimensions were spliced from it." });
  }
  if (scenario.precision_path.precision_path_id === "nvfp4_w4a4") {
    warnings.push({ id: "nvfp4-mapping", message: "NVFP4 uses an explicit mapping inference from NVIDIA's generic FP4 peak; the source does not publish that peak under the NVFP4 name." });
  }
  if (basis.bandwidth_ceiling_id.includes("conditional-273gbps")) {
    warnings.push({ id: "conditional-bandwidth", message: "273 GB/s is a conditional analytical ceiling at the stated EMC assumption, not observed DRAM telemetry; measured efficiency and gap remain unavailable without matched EMC evidence." });
  }
  if (sparseClasses.size) {
    warnings.push({ id: "sparse-observation-required", message: "Sparse compute roofs are inactive because this exact basis has no matched execution observation with sparsity_on=true." });
  }
  if (!records.length) warnings.push({ id: "empty-basis", message: query.mode === "fused" ? "The exact realization basis exists, but no fusion boundary has sufficient work and traffic evidence to emit a point." : "This basis has no valid points." });
  return {
    activeBasis: basis,
    activeScenario: scenario,
    activeCeiling: ceiling,
    availableBases: bases.map((item) => ({ basisId: item.basis_id, label: item.label, precisionPathId: item.precision_path_id })),
    curves: buildCurves(basis, scenario, index, sparseObservedRunIds),
    points,
    rows,
    records,
    inspectorPoint: inspectorIndex >= 0 ? records[inspectorIndex] ?? null : records[0] ?? null,
    overview: null,
    legacyInventory: legacyInventory(query, index),
    warnings,
  };
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { maximumSignificantDigits: 4 }).format(value);
}

export function formatTime(seconds: number): string {
  if (seconds < 1e-6) return `${formatNumber(seconds * 1e9)} ns`;
  if (seconds < 1e-3) return `${formatNumber(seconds * 1e6)} µs`;
  if (seconds < 1) return `${formatNumber(seconds * 1e3)} ms`;
  return `${formatNumber(seconds)} s`;
}

export function formatQuantity(value: number, unit: "FLOP" | "B"): string {
  const scales = unit === "FLOP"
    ? [[1e12, "TFLOP"], [1e9, "GFLOP"], [1e6, "MFLOP"], [1e3, "kFLOP"]] as const
    : [[1e9, "GB"], [1e6, "MB"], [1e3, "kB"]] as const;
  const scale = scales.find(([factor]) => value >= factor);
  return scale ? `${formatNumber(value / scale[0])} ${scale[1]}` : `${formatNumber(value)} ${unit}`;
}

function formatRate(value: number) {
  return value >= 1e12 ? `${formatNumber(value / 1e12)} TFLOP/s` : `${formatNumber(value / 1e9)} GFLOP/s`;
}

function formatNullable(value: number | null, formatter: (value: number) => string) {
  return value === null ? "—" : formatter(value);
}

export function provenanceLabel(provenance: Provenance) {
  return humanize(provenance.class);
}

export function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}
