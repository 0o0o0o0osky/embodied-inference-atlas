import { useEffect, type ReactNode } from "react";
import "./Pi0ExecutionInspector.css";

import type { CanonicalRecord } from "../../../types/atlas";
import { RuntimeSourceReferences } from "./RuntimeSourceReferences";
import type { LogicalDag } from "../../model-graph/domain/types";
import { useModelText } from "../../model-graph/presentation/ModelDisplay";
import { operatorTitle } from "../../model-graph/presentation/operatorTitle";
import { logicalRefFromEntity, parseEntityKey } from "../../workbench/entityKeys";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { ExecutionGroup, RuntimeMapping, RuntimeRealizationRecord } from "../domain/types";
import type { RuntimeBoundPoint } from "../domain/runtimeBounds";
import { formatTime } from "../../roofline/presentation/viewModel";
import {
  pi0GroupLabel,
  pi0NoExecutionGroupPresentation,
  pi0PrecisionLabel,
  repeatSelectorLabel,
} from "./runtimePresentation";

interface Pi0ExecutionInspectorProps {
  sources?: readonly CanonicalRecord[] | undefined;
  dag: LogicalDag;
  realization: RuntimeRealizationRecord;
  selectedEntity: string;
  onClose: () => void;
  onOpenRoofline?: () => void;
  onOpenNcu?: () => void;
  groupBounds?: ReadonlyMap<string, RuntimeBoundPoint>;
  renderKernelDetails?: (groupIds: readonly string[]) => ReactNode;
}

function kernelState(group: ExecutionGroup) {
  if (group.kernelResolution === "resolved") return "已关联";
  if (group.kernelResolution === "partial") return "部分关联";
  return "未采集 / 未关联";
}

function chineseRepeat(label: string) {
  return label
    .replace(/layers (\d+)–(\d+)/g, (_, first, last) => `第 ${Number(first) + 1}–${Number(last) + 1} 层`)
    .replaceAll("denoise", "去噪")
    .replaceAll("layers", "层")
    .replaceAll("only", "仅")
    .replaceAll("all", "全部");
}

function mappingExplanation(mapping: RuntimeMapping) {
  if (mapping.reasonCode === 'shared_gate_up_signature_not_split') return 'Gate 与 Up 各自执行 GEMM；形状相同，共用类别计时，尚未区分两者的调用归属。';
  if (mapping.reasonCode === "precomputed_outside_prediction") return "移到预测前预计算，数学运算仍保留。";
  if (mapping.reasonCode === "pointer_offset_view") return "引用已有数据中的动作行，不复制数据，也不启动独立的计算 Kernel。";
  return {
    fused: "多个原算子合并执行。",
    preserved: "保留原算子的执行边界。",
    split: "原算子拆为多个计算步骤。",
    eliminated: "预测内无独立执行。",
    opaque: "具体执行边界尚未明确。",
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
  sources,
  dag,
  realization,
  selectedEntity,
  onClose,
  onOpenRoofline,
  onOpenNcu,
  groupBounds,
  renderKernelDetails,
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
  const ordinaryTime = bound && ["wall_clock", "cuda_event", "nsys_interval"].includes(bound.basis.time_basis)
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
    const node = dag.nodes.get(target.ref);
    const label = node?.detail ? operatorTitle(node.detail, t) : t(node?.label ?? target.ref);
    return label;
  });
  const noGroupPresentation = groups.length
    ? null
    : pi0NoExecutionGroupPresentation(mappings.map((mapping) => mapping.relation));
  const noGroupReason = mappings.some((mapping) => mapping.reasonCode === "precomputed_outside_prediction")
    ? "预测前预计算，预测内无需重复执行"
    : mappings.some((mapping) => mapping.reasonCode === "pointer_offset_view")
      ? "共享数据切片，无独立计算 Kernel"
      : null;
  const mappingSummary = group
    ? logicalCoverage.length ? [...new Set(logicalCoverage)].join("、") : "运行时额外工作，无逻辑目标"
    : groups.length ? groups.map((item) => pi0GroupLabel(item.label)).join("、") : noGroupReason ?? noGroupPresentation!.mappingSummary;
  const repeatAndKernel = groups.length
    ? groups.map((item) => {
        const repeat = chineseRepeat(repeatSelectorLabel(item.repeatSelectors, dag));
        return `${repeat || "重复范围未标注"}；Kernel ${kernelState(item)}`;
      }).join("；")
    : noGroupPresentation!.repeatAndKernel;
  const relations = [...new Set(mappings.map((mapping) => mapping.relation))];
  const executionSummary = mappings.length
    ? [...new Set(mappings.map(mappingExplanation))].join("")
    : "尚未建立执行映射。";
  const performanceGroupLabel = relations.includes("fused") ? "融合计算" : "当前计算";

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
        <p>{group ? "所选计算" : "所选原算子"}</p>
        <h2 id="pi0-runtime-drawer-title">
          {group ? pi0GroupLabel(group.label) : logicalNode?.detail ? operatorTitle(logicalNode.detail, t) : t(logicalNode?.label ?? "模型算子")}
        </h2>
      </header>

      <dl className="pi0-runtime-drawer-summary">
        <div><dt>{group ? "涵盖原算子" : "实际计算"}</dt><dd>{mappingSummary}</dd></div>
        <div><dt>执行方式</dt><dd>{executionSummary}</dd></div>
        <div><dt>执行精度</dt><dd>
          {precisionLabels.length ? precisionLabels.join("、") : noGroupPresentation?.precision ?? "未建立"}
          {precisionPaths.map((path) => <span className="pi0-execution-dtypes" key={path.precisionPathId}>
            权重 W：{dtypeLabel(path.weightDtype)}；激活 A：{dtypeLabel(path.activationDtype)}；累加：{dtypeLabel(path.accumulationDtype)}
            {path.quantScheme === "q8_0_weight_only" ? "。仅权重量化。" : null}
          </span>)}
        </dd></div>
        <div><dt>重复范围与 Kernel</dt><dd>{repeatAndKernel}</dd></div>
      </dl>

      {renderKernelDetails ? renderKernelDetails(groups.map(item=>item.executionGroupId)) : <section className="pi0-execution-performance" aria-labelledby="pi0-execution-performance-title">
        <h3 id="pi0-execution-performance-title">局部下界与实测</h3>
        {groups.length && bound ? <>
        <dl>
          <div><dt>{performanceGroupLabel}理论下界</dt><dd>{roof != null ? formatTime(roof) : "未建立"}</dd></div>
          <div><dt>对应实测耗时</dt><dd>{ordinaryTime != null ? formatTime(ordinaryTime) : "未关联"}</dd></div>
        </dl>
        <p>{bound ? `覆盖本次推理内 ${bound.point.calls} 次调用；${bound.point.coverage.status === "complete" ? "完整覆盖" : "部分项下界"}。` : "按融合边界与实际精度建模，不相加融合前算子的估计。"}</p>
        <details className="pi0-execution-bound-rules"><summary>局部如何汇总到整体？</summary><p>串行路径的局部下界可相加；存在并行时，还要结合关键路径和共享资源。缺少完整执行映射时，不推算端到端下界。</p></details>
        {onOpenRoofline ? <button type="button" onClick={onOpenRoofline}>查看理论与计时</button> : null}
        </> : <p>{groups.length ? "此计算尚未关联性能测量。" : "无独立计算，局部性能分析不适用。"}</p>}
        {onOpenNcu ? <button type="button" onClick={onOpenNcu}>查看 NCU 诊断</button> : null}
      </section>}

      {evidence.length ? <p className="pi0-execution-sources">
        参考来源：<RuntimeSourceReferences sources={sources} sourceIds={evidence.map(item => item.sourceId)} />
      </p> : null}
    </aside>
  );
}
