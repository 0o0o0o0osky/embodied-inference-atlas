import { adaptLogicalDag } from "../../model-graph/domain/adaptLogicalDag";
import { adaptV1ModelGraph } from "../../model-graph/domain/adaptV1ModelGraph";
import type { LogicalDag, MaterializedGraph, MaterializedTensor, OperatorDetail } from "../../model-graph/domain/types";
import { adaptRuntimeRealization } from "../../runtime/domain/adaptRuntimeRealization";
import type { CanonicalRecord } from "../../../types/atlas";
import { attentionMetrics, type AttentionShape } from "../domain/attention";
import { stageLowerBound } from "../domain/criticalPath";
import { deriveRoofline } from "../domain/formulas";
import { rawBytes } from "../domain/storage";
import type {
  ComputeClass,
  PrecisionSegment,
  Provenance,
  RooflineBasisRecord,
  RooflineCeilingRecord,
  RooflinePointRecord,
  RooflineScenarioRecord,
  RooflineWorkload,
  TensorEncoding,
  TrafficComponent,
  WorkComponent,
} from "../domain/types";

export interface InteractiveWorkload {
  executedCameraViews: number;
  executedPromptTokens: number;
  actionHorizon: number;
  denoiseSteps: number;
}

export interface InteractiveWorkloadBounds {
  promptMinimum: number;
  promptMaximum: number | null;
}

export interface InteractiveMaterialization {
  scenario: RooflineScenarioRecord;
  bases: readonly RooflineBasisRecord[];
  points: readonly RooflinePointRecord[];
  materializationId: string;
}

function safePositive(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function safeIntegerInRange(value: number, minimum: number, maximum: number | null, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || (maximum !== null && value > maximum)) {
    throw new Error(`${label} must be a safe integer in its model-graph range`);
  }
  return value;
}

function encodingTraffic(
  values: number,
  encoding: TensorEncoding,
  baseKind: string,
  tensorRef: string,
  prefix: string,
  provenance: Provenance,
  calls: number,
): TrafficComponent[] {
  if (encoding.padding === "none") {
    const components = [traffic(`${prefix}-data`, baseKind, rawBytes(values, encoding.bits_per_value) * calls, tensorRef, provenance)];
    if (encoding.tensor_scale_bytes) {
      components.push(traffic(`${prefix}-tensor-scale`, "scale_read", encoding.tensor_scale_bytes * calls, tensorRef, provenance));
    }
    return components;
  }
  const blocks = Math.ceil(values / encoding.block_values!);
  const validData = rawBytes(values, encoding.bits_per_value);
  const packedData = blocks * encoding.packed_data_bytes_per_block!;
  const components = [traffic(`${prefix}-packed-data`, baseKind, validData * calls, tensorRef, provenance)];
  if (packedData > validData) {
    components.push(traffic(`${prefix}-padding`, "padding_overfetch", (packedData - validData) * calls, tensorRef, provenance));
  }
  const scale = (blocks * encoding.scale_bytes_per_block + encoding.tensor_scale_bytes) * calls;
  if (scale) components.push(traffic(`${prefix}-scales`, "scale_read", scale, tensorRef, provenance));
  const zeroPoint = blocks * encoding.zero_point_bytes_per_block * calls;
  if (zeroPoint) components.push(traffic(`${prefix}-zero-points`, "zero_point_read", zeroPoint, tensorRef, provenance));
  return components;
}

function tensorValues(shape: readonly (number | null)[]) {
  if (shape.some((value) => value === null || !Number.isSafeInteger(value) || value! <= 0)) {
    throw new Error("roofline tensor shape must resolve to positive safe integers");
  }
  return shape.reduce<number>((total, value) => total * value!, 1);
}

function computeRates(ceiling: RooflineCeilingRecord) {
  return new Map(ceiling.compute.flatMap((item) => item.flop_per_second === null
    ? []
    : [[item.compute_class, item.flop_per_second] as const]));
}

function work(
  id: string,
  kind: string,
  computeClass: ComputeClass | null,
  flop: number,
  provenance: Provenance,
  integerOps = 0,
  comparisonOps = 0,
  transcendentalOps = 0,
): WorkComponent {
  return { component_id: id, kind, compute_class: computeClass, flop, integer_ops: integerOps, comparison_ops: comparisonOps, transcendental_ops: transcendentalOps, provenance };
}

function traffic(
  id: string,
  kind: string,
  byte: number,
  tensorRef: string,
  provenance: Provenance,
): TrafficComponent {
  return { component_id: id, kind, byte, tensor_ref: tensorRef, provenance };
}

function derived(
  workComponents: readonly WorkComponent[],
  trafficComponents: readonly TrafficComponent[],
  rates: ReadonlyMap<ComputeClass, number>,
  bandwidth: number,
  requestedStatus: "complete" | "partial_lower_bound",
): RooflinePointRecord["derived"] {
  const totalFlop = workComponents.reduce((sum, item) => sum + item.flop, 0);
  const totalByte = trafficComponents.reduce((sum, item) => sum + item.byte, 0);
  const byClass = new Map<ComputeClass, number>();
  let missingCompute = false;
  workComponents.forEach((item) => {
    if (!item.flop) return;
    if (!item.compute_class || !rates.has(item.compute_class)) missingCompute = true;
    else byClass.set(item.compute_class, (byClass.get(item.compute_class) ?? 0) + item.flop);
  });
  const memorySecond = totalByte / bandwidth;
  if (missingCompute) {
    return { status: "unavailable", arithmetic_intensity_flop_per_byte: totalFlop / totalByte, compute_second: null, memory_second: memorySecond, roof_second: null, roof_flop_per_second: null, achieved_flop_per_second: null, efficiency: null, gap: null, limiter: "unknown" };
  }
  const result = deriveRoofline(
    [...byClass].map(([computeClass, flop]) => ({ flop, ceilingFlopPerSecond: rates.get(computeClass)! })),
    totalByte,
    bandwidth,
  );
  return { status: requestedStatus, arithmetic_intensity_flop_per_byte: result.arithmeticIntensity, compute_second: result.computeSecond, memory_second: result.memorySecond, roof_second: result.roofSecond, roof_flop_per_second: result.roofFlopPerSecond, achieved_flop_per_second: null, efficiency: null, gap: null, limiter: result.limiter };
}

function basePoint(
  id: string,
  basisId: string,
  detail: OperatorDetail,
  entityId: string,
  label: string,
  shape: string,
  coverageKey: string,
  workComponents: readonly WorkComponent[],
  trafficComponents: readonly TrafficComponent[],
  status: "complete" | "partial_lower_bound",
  provenance: Provenance,
  rates: ReadonlyMap<ComputeClass, number>,
  bandwidth: number,
  omission: string | null = null,
): RooflinePointRecord {
  const pointDerived = derived(workComponents, trafficComponents, rates, bandwidth, status);
  const missing = [{ field: "timing.observed_second", reason: "not_applicable", detail: "Interactive analytical envelope has no observed duration." }];
  if (pointDerived.compute_second === null) {
    missing.push({ field: "derived.compute_second", reason: "missing_compute_ceiling", detail: "A nonzero work class has no defensible compute ceiling." });
  }
  return {
    schema_version: "2.0.0", point_id: id, basis_id: basisId,
    entity: { kind: "atomic_operator", entity_id: entityId, label, shape_or_coverage: shape, logical_refs: [detail.ref], coverage_key: coverageKey },
    calls: detail.effectiveRepeat!, values_scope: "all_calls",
    work: { components: workComponents, total_flop: workComponents.reduce((sum, item) => sum + item.flop, 0) },
    traffic: { memory_domain: "system_memory", value_kind: "modeled", components: trafficComponents, excluded_internal: [], total_byte: trafficComponents.reduce((sum, item) => sum + item.byte, 0) },
    timing: { observed_second: null, statistic: "analytical", sample_count: 0, timing_boundary_id: "interactive-analytical-envelope-all-calls" },
    aggregation: { member_point_ids: [], dependency_edges: [], dependency_lower_bound_second: null, resource_compute_lower_bound_second: null, resource_memory_lower_bound_second: null },
    coverage: { status: status === "complete" ? "complete" : "partial", included_refs: [entityId], omitted: omission ? [{ ref: `${detail.ref}#unresolved-work`, reason: omission }] : [] },
    derived: pointDerived, legacy_record_refs: [], provenance, missing,
  };
}

function linearPoint(
  detail: OperatorDetail,
  segment: PrecisionSegment,
  modelId: string,
  pathId: string,
  basisId: string,
  provenance: Provenance,
  rates: ReadonlyMap<ComputeClass, number>,
  bandwidth: number,
) {
  const m = safePositive(detail.bindings.M!, "M");
  const k = safePositive(detail.bindings.K!, "K");
  const n = safePositive(detail.bindings.N!, "N");
  const calls = safePositive(detail.effectiveRepeat!, "calls");
  const components = [work(`${detail.ref}:gemm`, "gemm", segment.compute_class, 2 * m * k * n * calls, provenance)];
  const weights = k * n;
  const dequant = segment.dequantization;
  if (dequant.floating_flop_per_weight || dequant.integer_op_per_weight) {
    components.push(work(`${detail.ref}:dequant`, "dequant", "tensor_bf16_dense", weights * calls * dequant.floating_flop_per_weight, provenance, weights * calls * dequant.integer_op_per_weight));
  }
  const prefix = safeId(detail.ref);
  const trafficComponents = [
    ...encodingTraffic(m * k, segment.activation, "input_read", `${detail.ref}:input`, `${prefix}-input`, provenance, calls),
    ...encodingTraffic(weights, segment.weight, "weight_read", `${detail.ref}:weight`, `${prefix}-weight`, provenance, calls),
    ...encodingTraffic(m * n, segment.output, "boundary_output_write", `${detail.ref}:output`, `${prefix}-output`, provenance, calls),
  ];
  const partial = dequant.integer_op_per_weight > 0;
  return basePoint(
    `point-${modelId}-${pathId}-atomic-interactive-${safeId(detail.ref)}`,
    basisId, detail, detail.ref, detail.label, `[${m},${k}] @ [${k},${n}] × ${calls} calls`,
    `logical:${detail.ref}|shape:${m}x${k}x${n}|calls:${calls}`,
    components, trafficComponents, partial ? "partial_lower_bound" : "complete", provenance, rates, bandwidth,
    partial ? "Packed-weight integer unpack operations are counted but have no separate execution-rate ceiling." : null,
  );
}

function axis(tensor: MaterializedTensor, names: readonly string[]): number {
  const index = tensor.axes.findIndex((item) => names.includes(item.axis));
  if (index < 0) throw new Error(`tensor axis is missing: ${names.join("/")}`);
  return safePositive(tensor.shape[index]!, names[0]!);
}

function attentionShape(detail: OperatorDetail): AttentionShape {
  const query = detail.inputs.find((item) => item.port === "query")?.tensor;
  const key = detail.inputs.find((item) => item.port === "key")?.tensor;
  if (!query || !key) throw new Error(`attention ports do not resolve: ${detail.ref}`);
  const queryHeads = axis(query, ["query_heads", "query_head", "head"]);
  const kvHeads = axis(key, ["kv_heads", "kv_head", "head"]);
  const queryLength = axis(query, ["query_tokens", "query_sequence", "sequence"]);
  const keyLength = axis(key, ["key_value_tokens", "key_sequence", "sequence"]);
  const headWidth = axis(query, ["head_width", "head_dim"]);
  const batch = tensorValues(query.shape) / (queryHeads * queryLength * headWidth);
  return { batch: safePositive(batch, "attention batch"), queryHeads, kvHeads, queryLength, keyLength, headWidth };
}

function attentionPoints(
  detail: OperatorDetail,
  segment: PrecisionSegment,
  modelId: string,
  pathId: string,
  basisId: string,
  provenance: Provenance,
  rates: ReadonlyMap<ComputeClass, number>,
  bandwidth: number,
  partSegments: readonly PrecisionSegment[] | null = null,
) {
  const shape = attentionShape(detail);
  const calls = safePositive(detail.effectiveRepeat!, "attention calls");
  const metrics = attentionMetrics(shape, 2);
  const scores = shape.batch * shape.queryHeads * shape.queryLength * shape.keyLength;
  const q = shape.batch * shape.queryHeads * shape.queryLength * shape.headWidth;
  const kv = shape.batch * shape.kvHeads * shape.keyLength * shape.headWidth;
  const shapeLabel = `B${shape.batch} Hq${shape.queryHeads}/Hkv${shape.kvHeads} Lq${shape.queryLength} Lk${shape.keyLength} Dh${shape.headWidth} × ${calls}`;
  const scoreSegment = partSegments?.[0] ?? segment;
  const valueSegment = partSegments?.at(-1) ?? segment;
  const scoreWork = [work(`${detail.ref}:score`, "attention_score", scoreSegment.compute_class, metrics.scoreFlop * calls, provenance)];
  const prefix = safeId(detail.ref);
  const scoreTraffic = [
    ...encodingTraffic(q, scoreSegment.activation, "input_read", `${detail.ref}:Q`, `${prefix}-score-q`, provenance, calls),
    ...encodingTraffic(kv, scoreSegment.activation, "input_read", `${detail.ref}:K`, `${prefix}-score-k`, provenance, calls),
    ...encodingTraffic(scores, scoreSegment.output, "boundary_output_write", `${detail.ref}:logits`, `${prefix}-score-logits`, provenance, calls),
  ];
  const softWork = [
    work(`${detail.ref}:scale`, "attention_scale_mask", null, metrics.scaleScalarFlop * calls, provenance),
    work(`${detail.ref}:softmax`, "attention_softmax", null, metrics.softmaxScalarFlop * calls, provenance, 0, metrics.comparisonOps * calls, metrics.transcendentalOps * calls),
  ];
  const softTraffic = [
    ...encodingTraffic(scores, scoreSegment.activation, "input_read", `${detail.ref}:logits`, `${prefix}-softmax-logits`, provenance, calls),
    ...encodingTraffic(scores, scoreSegment.output, "boundary_output_write", `${detail.ref}:probabilities`, `${prefix}-softmax-prob`, provenance, calls),
  ];
  const valueWork = [work(`${detail.ref}:value`, "attention_value", valueSegment.compute_class, metrics.valueFlop * calls, provenance)];
  const valueTraffic = [
    ...encodingTraffic(scores, valueSegment.activation, "input_read", `${detail.ref}:probabilities`, `${prefix}-value-prob`, provenance, calls),
    ...encodingTraffic(kv, valueSegment.activation, "input_read", `${detail.ref}:V`, `${prefix}-value-v`, provenance, calls),
    ...encodingTraffic(q, valueSegment.output, "boundary_output_write", `${detail.ref}:O`, `${prefix}-value-o`, provenance, calls),
  ];
  const make = (suffix: string, label: string, components: WorkComponent[], bytes: TrafficComponent[], partial = false) => basePoint(
    `point-${modelId}-${pathId}-atomic-interactive-${safeId(detail.ref)}-${suffix}`,
    basisId, detail, `${detail.ref}#${suffix}`, `${detail.label} · ${label}`, shapeLabel,
    `logical:${detail.ref}|part:${suffix}|shape:${shapeLabel}`,
    components, bytes, partial ? "partial_lower_bound" : "complete", provenance, rates, bandwidth,
    partial ? "Scalar comparison and SFU ceilings are unavailable." : null,
  );
  return [
    make("score", "Q @ Kᵀ score", scoreWork, scoreTraffic),
    make("softmax", "Scale / mask / softmax", softWork, softTraffic, true),
    make("value", "P @ V value", valueWork, valueTraffic),
    make("composite", "Partial envelope", [...scoreWork, ...softWork, ...valueWork], [...scoreTraffic, ...softTraffic, ...valueTraffic], true),
  ];
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "--");
}

function projectedEdges(dag: LogicalDag, refs: ReadonlySet<string>) {
  const adjacency = new Map<string, string[]>();
  dag.edges.filter((edge) => edge.kind === "tensor").forEach((edge) => {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  });
  const edges: { source: string; target: string }[] = [];
  refs.forEach((source) => {
    const pending = [...(adjacency.get(source) ?? [])];
    const seen = new Set<string>();
    while (pending.length) {
      const target = pending.pop()!;
      if (seen.has(target)) continue;
      seen.add(target);
      if (refs.has(target)) edges.push({ source, target });
      else pending.push(...(adjacency.get(target) ?? []));
    }
  });
  return edges;
}

function aggregatePoint(
  graph: MaterializedGraph,
  dag: LogicalDag,
  stageId: string,
  basisId: string,
  atomic: readonly RooflinePointRecord[],
  provenance: Provenance,
): RooflinePointRecord | null {
  const eligible = atomic.filter((point) => point.derived.roof_second !== null
    && !point.entity.entity_id.endsWith("#composite")
    && !point.entity.entity_id.endsWith("#softmax")
    && (stageId === "model_total" || point.entity.logical_refs[0]?.startsWith(`${stageId}/`)));
  if (!eligible.length) return null;
  const byRef = new Map<string, RooflinePointRecord[]>();
  eligible.forEach((point) => {
    const ref = point.entity.logical_refs[0]!;
    byRef.set(ref, [...(byRef.get(ref) ?? []), point]);
  });
  const dependencies: { source: string; target: string }[] = [];
  byRef.forEach((points) => {
    const ordered = [...points].sort((a, b) => a.entity.entity_id.endsWith("#score") ? -1 : b.entity.entity_id.endsWith("#score") ? 1 : a.point_id.localeCompare(b.point_id));
    for (let index = 0; index < ordered.length - 1; index += 1) dependencies.push({ source: ordered[index]!.point_id, target: ordered[index + 1]!.point_id });
  });
  projectedEdges(dag, new Set(byRef.keys())).forEach((edge) => {
    const source = byRef.get(edge.source)!.at(-1)!;
    const target = byRef.get(edge.target)![0]!;
    dependencies.push({ source: source.point_id, target: target.point_id });
  });
  const terms = stageLowerBound(eligible.map((point) => ({ id: point.point_id, roofSecond: point.derived.roof_second!, computeSecond: point.derived.compute_second!, memorySecond: point.derived.memory_second! })), dependencies);
  const workComponents = eligible.flatMap((point) => point.work.components.map((item) => ({ ...item, component_id: `${point.point_id}--member--${item.component_id}` })));
  const trafficComponents = eligible.flatMap((point) => point.traffic.components.map((item) => ({ ...item, component_id: `${point.point_id}--member--${item.component_id}` })));
  const totalFlop = workComponents.reduce((sum, item) => sum + item.flop, 0);
  const totalByte = trafficComponents.reduce((sum, item) => sum + item.byte, 0);
  const graphRef = `${graph.graphId}/${stageId}`;
  return {
    schema_version: "2.0.0", point_id: `point-${graph.modelId}-interactive-stage-${safeId(stageId)}`, basis_id: basisId,
    entity: { kind: stageId === "model_total" ? "model_total" : "stage", entity_id: graphRef, label: stageId === "model_total" ? "Model total" : graph.stages.find((stage) => stage.stageId === stageId)?.label ?? stageId, shape_or_coverage: `${eligible.length} formula-backed atomic components; partial lower bound`, logical_refs: [graphRef], coverage_key: `stage:${graphRef}|members:${[...byRef.keys()].sort().join("|")}` },
    calls: 1, values_scope: "all_calls", work: { components: workComponents, total_flop: totalFlop },
    traffic: { memory_domain: "system_memory", value_kind: "modeled", components: trafficComponents, excluded_internal: [], total_byte: totalByte },
    timing: { observed_second: null, statistic: "analytical", sample_count: 0, timing_boundary_id: "interactive-analytical-envelope-all-calls" },
    aggregation: { member_point_ids: eligible.map((point) => point.point_id).sort(), dependency_edges: dependencies, dependency_lower_bound_second: terms.dependencySecond, resource_compute_lower_bound_second: terms.resourceComputeSecond, resource_memory_lower_bound_second: terms.resourceMemorySecond },
    coverage: { status: "partial", included_refs: [...byRef.keys()].sort(), omitted: [{ ref: `${graphRef}#formula-less`, reason: "Formula-less and scalar/SFU operations remain outside this lower bound." }] },
    derived: { status: "partial_lower_bound", arithmetic_intensity_flop_per_byte: totalFlop / totalByte, compute_second: terms.resourceComputeSecond, memory_second: terms.resourceMemorySecond, roof_second: terms.roofSecond, roof_flop_per_second: totalFlop / terms.roofSecond, achieved_flop_per_second: null, efficiency: null, gap: null, limiter: terms.limiter },
    legacy_record_refs: [], provenance,
    missing: [{ field: "timing.observed_second", reason: "not_applicable", detail: "Interactive analytical envelope has no observed duration." }, { field: "coverage", reason: "missing_work", detail: "Formula-less logical operations and scalar/SFU timing remain omitted." }],
  };
}

export function materializeInteractiveRoofline(
  graphRecord: CanonicalRecord,
  sourceScenario: RooflineScenarioRecord,
  ceiling: RooflineCeilingRecord,
  workloadInput: InteractiveWorkload,
  realizationRecord: CanonicalRecord | null = null,
): InteractiveMaterialization {
  const graphContract = adaptV1ModelGraph(graphRecord);
  const promptContract = graphContract.editableSymbols.find((symbol) => symbol.symbol === "L_PROMPT");
  const runtimeMixed = sourceScenario.precision_path.precision_path_id === "runtime_mixed";
  const realization = runtimeMixed && realizationRecord ? adaptRuntimeRealization(realizationRecord) : null;
  const expectedRealizationId = sourceScenario.precision_path.realization_ids[0] ?? null;
  if (runtimeMixed && (!realization || realization.realizationId !== expectedRealizationId)) {
    throw new Error("Runtime-mixed materialization requires its exact Task 4 realization.");
  }
  const workload: RooflineWorkload = {
    ...sourceScenario.workload,
    active_camera_views: safePositive(workloadInput.executedCameraViews, "camera views"),
    executed_camera_views: workloadInput.executedCameraViews,
    executed_prompt_tokens: safeIntegerInRange(
      workloadInput.executedPromptTokens,
      promptContract?.minimum ?? 1,
      promptContract?.maximum ?? null,
      "prompt tokens",
    ),
    action_horizon: safePositive(workloadInput.actionHorizon, "action horizon"),
    denoise_steps: safePositive(workloadInput.denoiseSteps, "denoise steps"),
  };
  const materializationId = `v${workload.executed_camera_views}-p${workload.executed_prompt_tokens}-a${workload.action_horizon}-n${workload.denoise_steps}`;
  const scenarioId = `${sourceScenario.scenario_id}-interactive-${materializationId}`;
  const retainsRuntimeProof = !runtimeMixed || (
    workload.executed_camera_views === sourceScenario.workload.executed_camera_views
    && workload.executed_prompt_tokens === sourceScenario.workload.executed_prompt_tokens
    && workload.action_horizon === sourceScenario.workload.action_horizon
    && workload.denoise_steps === sourceScenario.workload.denoise_steps
  );
  const provenance: Provenance = { evidence: "analytical", class: "analytical_model", source_ids: sourceScenario.provenance.source_ids, derivation: { kind: "formula", expression: "client materialization of canonical logical formulas with FMA=2", input_refs: [sourceScenario.scenario_id, materializationId] }, condition: "Interactive state is not promoted to canonical data." };
  const scenario: RooflineScenarioRecord = {
    ...sourceScenario,
    scenario_id: scenarioId,
    label: `${sourceScenario.model_id} interactive ${materializationId} · ${sourceScenario.precision_path.precision_path_id}`,
    origin: "interactive_analytical",
    workload,
    precision_path: retainsRuntimeProof
      ? sourceScenario.precision_path
      : { ...sourceScenario.precision_path, runtime_support: "unproven" },
    provenance,
  };
  const bases = (["stage", "atomic"] as const).map((level): RooflineBasisRecord => ({
    schema_version: "2.0.0", basis_id: `basis-${sourceScenario.model_id}-${sourceScenario.precision_path.precision_path_id}-${level}-interactive-${materializationId}`, label: `${scenario.label} · ${level === "stage" ? "Stage" : "Atomic"}`, level, scenario_id: scenarioId, precision_path_id: sourceScenario.precision_path.precision_path_id, ceiling_id: ceiling.ceiling_id, bandwidth_ceiling_id: ceiling.bandwidth[0]!.bandwidth_ceiling_id, device_id: ceiling.device_id, operating_point_id: ceiling.operating_point.operating_point_id, work_unit: level === "stage" ? "action_chunk" : "operator_invocation", time_basis: "analytical_roof", traffic_basis: "atomic_materialized", work_basis: runtimeMixed ? "runtime_executed_formula" : "logical_formula", aggregation: level === "stage" ? "dag_resource_and_critical_path" : "entity", runtime_overhead: "excluded", runtime_id: realization?.runtimeId ?? null, realization_id: realization?.realizationId ?? null, run_id: null, capture_id: null, comparison_mode: "same_coverage_only", provenance, missing: [{ field: "run_id", reason: "not_applicable", detail: "Interactive analytical basis has no observed run." }, { field: "capture_id", reason: "not_collected", detail: "No capture is bound to this interactive basis." }, ...(runtimeMixed ? [] : [{ field: "runtime_id", reason: "not_applicable" as const, detail: "Analytical what-if is runtime-independent." }, { field: "realization_id", reason: "not_applicable" as const, detail: "Analytical what-if has no realization." }])],
  }));
  const graph = adaptV1ModelGraph(graphRecord, { V: workload.executed_camera_views, L_PROMPT: workload.executed_prompt_tokens, T_ACTION: workload.action_horizon, N_DENOISE: workload.denoise_steps });
  if (graph.diagnostics.length) throw new Error(graph.diagnostics.join(" "));
  const dag = adaptLogicalDag(graph);
  const uniformSegment = sourceScenario.precision_path.segments[0]!;
  const mappedSegments = new Map<string, PrecisionSegment[]>();
  if (realization) {
    const segmentByGroup = new Map(sourceScenario.precision_path.segments.flatMap((segment) =>
      segment.selector.refs.map((groupId) => [groupId, segment] as const)));
    realization.mappings
      .filter((mapping) => mapping.certainty === "exact" && mapping.path === "primary")
      .forEach((mapping) => mapping.logicalTargets.forEach((target) => {
        const segments = mapping.executionGroupIds.flatMap((groupId) => {
          const segment = segmentByGroup.get(groupId);
          return segment ? [segment] : [];
        });
        if (segments.length) mappedSegments.set(target.ref, [...(mappedSegments.get(target.ref) ?? []), ...segments]);
      }));
  }
  const rates = computeRates(ceiling);
  const bandwidth = ceiling.bandwidth[0]?.byte_per_second;
  if (!bandwidth) throw new Error("interactive ceiling has no positive bandwidth");
  const atomic = [...graph.operatorsByRef.values()].flatMap((detail) => {
    if (detail.effectiveRepeat === null || detail.effectiveRepeat <= 0) return [];
    const segments = realization ? mappedSegments.get(detail.ref) ?? [] : [uniformSegment];
    if (!segments.length) return [];
    if (detail.definitionId === "linear") {
      if (segments.length !== 1) return [];
      return [linearPoint(detail, segments[0]!, graph.modelId, sourceScenario.precision_path.precision_path_id, bases[1]!.basis_id, provenance, rates, bandwidth)];
    }
    if (detail.definitionId === "attention-core") return attentionPoints(detail, segments[0]!, graph.modelId, sourceScenario.precision_path.precision_path_id, bases[1]!.basis_id, provenance, rates, bandwidth, segments);
    return [];
  });
  const stages = [...graph.stages.map((stage) => stage.stageId), "model_total"].flatMap((stageId) => {
    const point = aggregatePoint(graph, dag, stageId, bases[0]!.basis_id, atomic, provenance);
    return point ? [point] : [];
  });
  return { scenario, bases, points: [...atomic, ...stages], materializationId };
}

export function parseInteractiveWorkload(
  value: string | null,
  fallback: RooflineWorkload,
  bounds: InteractiveWorkloadBounds = { promptMinimum: 1, promptMaximum: null },
): InteractiveWorkload {
  const defaults = { executedCameraViews: fallback.executed_camera_views, executedPromptTokens: fallback.executed_prompt_tokens, actionHorizon: fallback.action_horizon, denoiseSteps: fallback.denoise_steps };
  if (!value) return defaults;
  const values = Object.fromEntries(value.split(",").map((part) => part.split("=", 2)));
  const read = (keys: readonly string[], current: number, minimum = 1, maximum: number | null = null) => {
    const raw = keys.map((key) => values[key]).find((candidate) => candidate !== undefined);
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= minimum && (maximum === null || parsed <= maximum)
      ? parsed
      : current;
  };
  return {
    executedCameraViews: read(["v", "V"], defaults.executedCameraViews),
    executedPromptTokens: read(["p", "L_PROMPT"], defaults.executedPromptTokens, bounds.promptMinimum, bounds.promptMaximum),
    actionHorizon: read(["a", "T_ACTION"], defaults.actionHorizon),
    denoiseSteps: read(["n", "N_DENOISE"], defaults.denoiseSteps),
  };
}

export function serializeInteractiveWorkload(value: InteractiveWorkload) {
  return `v=${value.executedCameraViews},p=${value.executedPromptTokens},a=${value.actionHorizon},n=${value.denoiseSteps}`;
}

export function runtimeResolutionWorkload(encoded: string | null, value: InteractiveWorkload) {
  if (encoded?.startsWith("cfg-")) return encoded;
  return `V=${value.executedCameraViews},L_PROMPT=${value.executedPromptTokens},T_ACTION=${value.actionHorizon},N_DENOISE=${value.denoiseSteps}`;
}
