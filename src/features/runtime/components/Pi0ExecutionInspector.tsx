import { useEffect } from "react";
import "./Pi0ExecutionInspector.css";

import type { LogicalDag } from "../../model-graph/domain/types";
import { useModelText } from "../../model-graph/presentation/ModelDisplay";
import { logicalRefFromEntity, parseEntityKey } from "../../workbench/entityKeys";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { ExecutionGroup, RuntimeMapping, RuntimeRealizationRecord } from "../domain/types";
import type { RuntimeBoundPoint } from "../domain/runtimeBounds";
import { formatTime } from "../../roofline/presentation/viewModel";
import {
  pi0GroupLabel,
  pi0NoExecutionGroupPresentation,
  pi0PrecisionLabel,
  pi0RelationLabel,
  repeatSelectorLabel,
  targetRepeatLabel,
} from "./runtimePresentation";

interface Pi0ExecutionInspectorProps {
  dag: LogicalDag;
  realization: RuntimeRealizationRecord;
  selectedEntity: string;
  onClose: () => void;
  onOpenRoofline?: () => void;
  onOpenNcu?: () => void;
  groupBounds?: ReadonlyMap<string, RuntimeBoundPoint>;
}

function kernelState(group: ExecutionGroup) {
  if (group.kernelResolution === "resolved") return "已关联";
  if (group.kernelResolution === "partial") return "部分关联";
  return "未采集 / 未关联";
}

function chineseRepeat(label: string) {
  return label
    .replaceAll("denoise", "去噪")
    .replaceAll("layers", "层")
    .replaceAll("only", "仅")
    .replaceAll("all", "全部");
}

function mappingExplanation(mapping: RuntimeMapping) {
  if (mapping.reasonCode === "precomputed_outside_prediction") return "移到预测前预计算，数学运算仍保留。";
  if (mapping.reasonCode === "pointer_offset_view") return "通过偏移量建立数据视图，无独立算术运算。";
  return {
    fused: "多个原算子合并到同一执行组。",
    preserved: "保留原算子的执行边界。",
    split: "原算子拆为多个执行组。",
    eliminated: "预测内无独立执行，具体原因见证据。",
    opaque: "组内执行边界尚未明确。",
  }[mapping.relation];
}

function dtypeLabel(value: string | null) {
  if (!value) return "未建立";
  return ({ mixed_bf16_fp32: "BF16 / FP32", fp8_e4m3: "FP8 E4M3" } as Record<string, string>)[value]
    ?? value.toUpperCase();
}

function uniqueGroups(
  mappings: readonly RuntimeMapping[],
  index: ReturnType<typeof indexRuntimeRealization>,
) {
  return [...new Map(mappings.flatMap((mapping) => mapping.executionGroupIds)
    .map((id) => index.groupById.get(id))
    .filter((group): group is ExecutionGroup => Boolean(group))
    .map((group) => [group.executionGroupId, group])).values()];
}

export function Pi0ExecutionInspector({
  dag,
  realization,
  selectedEntity,
  onClose,
  onOpenRoofline,
  onOpenNcu,
  groupBounds,
}: Pi0ExecutionInspectorProps) {
  const t = useModelText();
  const index = indexRuntimeRealization(realization);
  const parsed = parseEntityKey(selectedEntity);
  const logicalRef = logicalRefFromEntity(selectedEntity);
  const group = parsed?.kind === "runtime-group" && parsed.realizationId === realization.realizationId
    ? index.groupById.get(parsed.executionGroupId)
    : undefined;
  const mappings = group
    ? index.mappingsByGroupId.get(group.executionGroupId) ?? []
    : logicalRef ? index.mappingsByLogicalRef.get(logicalRef) ?? [] : [];
  const groups = group ? [group] : uniqueGroups(mappings, index);
  const bound = groups.length === 1 ? groupBounds?.get(groups[0]!.executionGroupId) : null;
  const roof = bound?.point.derived.roof_second;
  const ordinaryTime = bound && ["wall_clock", "cuda_event"].includes(bound.basis.time_basis)
    ? bound.point.timing.observed_second : null;
  const logicalNode = logicalRef ? dag.nodes.get(logicalRef) : undefined;
  const precisionPaths = [...new Set(groups.map((item) => item.precisionPathId))]
    .flatMap((id) => { const path = index.precisionById.get(id); return path ? [path] : []; });
  const precisionLabels = [...new Set(groups.map((item) => {
    const precision = index.precisionById.get(item.precisionPathId);
    return precision
      ? pi0PrecisionLabel(precision.precisionPathId, precision.label)
      : item.precisionPathId;
  }))];
  const evidenceIds = new Set([
    ...mappings.flatMap((mapping) => mapping.evidenceIds),
    ...groups.flatMap((item) => item.evidenceIds),
  ]);
  const evidence = realization.evidence.filter((item) => evidenceIds.has(item.evidenceId));
  const logicalCoverage = mappings.flatMap((mapping) => mapping.logicalTargets).map((target) => {
    const label = t(dag.nodes.get(target.ref)?.label ?? target.ref);
    return label;
  });
  const noGroupPresentation = groups.length
    ? null
    : pi0NoExecutionGroupPresentation(mappings.map((mapping) => mapping.relation));
  const noGroupReason = mappings.some((mapping) => mapping.reasonCode === "precomputed_outside_prediction")
    ? "预测前预计算，无预测内执行组"
    : mappings.some((mapping) => mapping.reasonCode === "pointer_offset_view")
      ? "数据视图，无独立执行组"
      : null;
  const mappingSummary = group
    ? logicalCoverage.length ? [...new Set(logicalCoverage)].join("、") : "运行时额外工作，无逻辑目标"
    : groups.length ? groups.map((item) => pi0GroupLabel(item.label)).join("、") : noGroupReason ?? noGroupPresentation!.mappingSummary;
  const implementation = groups.length
    ? groups.map((item) => item.implementation ?? "实现未建立").join("；")
    : noGroupReason ?? noGroupPresentation!.implementation;
  const repeatAndKernel = groups.length
    ? groups.map((item) => {
        const repeat = chineseRepeat(repeatSelectorLabel(item.repeatSelectors, dag));
        return `${repeat || "无额外重复选择"}；Kernel ${kernelState(item)}`;
      }).join("；")
    : noGroupPresentation!.repeatAndKernel;
  const relations = [...new Set(mappings.map((mapping) => mapping.relation))];
  const executionSummary = mappings.length
    ? [...new Set(mappings.map(mappingExplanation))].join("")
    : "尚未建立执行映射。";
  const performanceGroupLabel = relations.includes("fused") ? "融合组" : "执行组";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <aside className="pi0-runtime-drawer pi0-execution-inspector" aria-labelledby="pi0-runtime-drawer-title">
      <button type="button" className="pi0-runtime-drawer-close" onClick={onClose}>
        返回完整实现图
      </button>
      <header>
        <p>{group ? "所选执行组" : "所选原算子"}</p>
        <h2 id="pi0-runtime-drawer-title">
          {group ? pi0GroupLabel(group.label) : t(logicalNode?.label ?? "模型算子")}
        </h2>
      </header>

      <dl className="pi0-runtime-drawer-summary">
        <div><dt>{group ? "涵盖原算子" : "对应执行组"}</dt><dd>{mappingSummary}</dd></div>
        <div><dt>执行方式</dt><dd>{executionSummary}</dd></div>
        <div><dt>执行精度</dt><dd>
          {precisionLabels.length ? precisionLabels.join("、") : noGroupPresentation?.precision ?? "未建立"}
          {precisionPaths.map((path) => <span className="pi0-execution-dtypes" key={path.precisionPathId}>
            权重 W：{dtypeLabel(path.weightDtype)}；激活 A：{dtypeLabel(path.activationDtype)}；累加：{dtypeLabel(path.accumulationDtype)}
            {path.quantScheme === "q8_0_weight_only" ? "。仅权重量化。" : null}
          </span>)}
        </dd></div>
      </dl>

      <section className="pi0-execution-performance" aria-labelledby="pi0-execution-performance-title">
        <h3 id="pi0-execution-performance-title">局部下界与实测</h3>
        {groups.length ? <>
        <dl>
          <div><dt>{performanceGroupLabel}理论下界</dt><dd>{roof != null ? formatTime(roof) : "未建立"}</dd></div>
          <div><dt>同组普通执行计时</dt><dd>{ordinaryTime != null ? formatTime(ordinaryTime) : "未关联"}</dd></div>
        </dl>
        <p>{bound ? `覆盖本次推理内 ${bound.point.calls} 次调用；${bound.point.coverage.status === "complete" ? "完整覆盖" : "部分项下界"}。` : "按融合边界与实际精度建模，不相加融合前算子的估计。"}</p>
        <details className="pi0-execution-bound-rules"><summary>局部如何汇总到整体？</summary><p>串行路径的局部下界可相加；存在并行时，还要结合关键路径和共享资源。缺少完整执行映射时，不推算端到端下界。</p></details>
        {onOpenRoofline ? <button type="button" onClick={onOpenRoofline}>查看理论与计时</button> : null}
        <div className="pi0-execution-ncu">
          <h4>NCU 诊断</h4>
          <p>本组诊断指标未关联。NCU 采集耗时不作为普通执行计时。</p>
          {onOpenNcu ? <button type="button" onClick={onOpenNcu}>查看 NCU 诊断</button> : null}
        </div>
        </> : <p>无独立执行组，组级性能分析不适用。</p>}
      </section>

      <details className="pi0-runtime-raw-evidence">
        <summary>源码实现与详细证据</summary>
        <dl>
          <div><dt>源码实现</dt><dd>{implementation}</dd></div>
          <div><dt>重复与内核</dt><dd>{repeatAndKernel.replaceAll("Kernel", "内核")}</dd></div>
          <div><dt>实现记录</dt><dd><code>{realization.realizationId}</code></dd></div>
          <div><dt>运行时修订</dt><dd><code>{realization.runtimeRevision}</code></dd></div>
          <div><dt>配置</dt><dd>{realization.configurationIds.map((id) => <code key={id}>{id}</code>)}</dd></div>
          {groups.map((item) => (
            <div key={item.executionGroupId}>
              <dt>执行组</dt>
              <dd>
                <code>{item.executionGroupId}</code>
                {item.dependencyGroupIds.map((id) => <code key={id}>依赖：{id}</code>)}
                {item.kernelSignatureIds.map((id) => <code key={id}>内核：{id}</code>)}
                {item.unmappedReasonCode ? <code>原因：{item.unmappedReasonCode}</code> : null}
              </dd>
            </div>
          ))}
          {mappings.map((mapping) => (
            <div key={mapping.mappingId}>
              <dt>映射</dt>
              <dd>
                <code>{mapping.mappingId}</code>
                <span>{pi0RelationLabel(mapping.relation)}；{mapping.method === "source_audit" ? "源码审计" : "运行或编译证据"}；{mapping.certainty === "exact" ? "明确映射" : "映射有歧义"}</span>
                {mapping.logicalTargets.map((target) => <code key={target.ref}>{target.ref} {chineseRepeat(targetRepeatLabel(target, dag))}</code>)}
                {mapping.reasonCode ? <code>原因：{mapping.reasonCode}</code> : null}
              </dd>
            </div>
          ))}
          {evidence.map((item) => (
            <div key={item.evidenceId}>
              <dt>证据</dt>
              <dd>
                <code>{item.evidenceId}</code>
                {item.sourceId ? <code>来源：{item.sourceId}</code> : null}
                {item.locator ? <code>定位：{item.locator}</code> : null}
                {item.revision ? <code>修订：{item.revision}</code> : null}
                {item.runIds.map((id) => <code key={id}>运行：{id}</code>)}
                {item.observationIds.map((id) => <code key={id}>观察：{id}</code>)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </aside>
  );
}
