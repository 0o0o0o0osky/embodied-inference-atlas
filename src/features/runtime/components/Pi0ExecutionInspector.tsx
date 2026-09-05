import { useEffect } from "react";

import type { LogicalDag } from "../../model-graph/domain/types";
import { useModelText } from "../../model-graph/presentation/ModelDisplay";
import { logicalRefFromEntity, parseEntityKey } from "../../workbench/entityKeys";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { ExecutionGroup, RuntimeMapping, RuntimeRealizationRecord } from "../domain/types";
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
  const logicalNode = logicalRef ? dag.nodes.get(logicalRef) : undefined;
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
    const repeat = chineseRepeat(targetRepeatLabel(target, dag));
    return repeat ? `${label}（${repeat}）` : label;
  });
  const noGroupPresentation = groups.length
    ? null
    : pi0NoExecutionGroupPresentation(mappings.map((mapping) => mapping.relation));
  const mappingSummary = group
    ? logicalCoverage.length ? [...new Set(logicalCoverage)].join("、") : "运行时额外工作，无逻辑目标"
    : groups.length ? groups.map((item) => pi0GroupLabel(item.label)).join("、") : noGroupPresentation!.mappingSummary;
  const implementation = groups.length
    ? groups.map((item) => item.implementation ?? "实现未建立").join("；")
    : noGroupPresentation!.implementation;
  const repeatAndKernel = groups.length
    ? groups.map((item) => {
        const repeat = chineseRepeat(repeatSelectorLabel(item.repeatSelectors, dag));
        return `${repeat || "无额外重复选择"}；Kernel ${kernelState(item)}`;
      }).join("；")
    : noGroupPresentation!.repeatAndKernel;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <aside className="pi0-runtime-drawer" aria-labelledby="pi0-runtime-drawer-title">
      <button type="button" className="pi0-runtime-drawer-close" onClick={onClose}>
        返回完整实现图
      </button>
      <header>
        <p>{group ? "执行组映射" : "逻辑算子映射"}</p>
        <h2 id="pi0-runtime-drawer-title">
          {group ? pi0GroupLabel(group.label) : t(logicalNode?.label ?? "逻辑算子")}
        </h2>
      </header>

      <dl className="pi0-runtime-drawer-summary">
        <div><dt>{group ? "逻辑范围" : "实现组"}</dt><dd>{mappingSummary}</dd></div>
        <div><dt>实现</dt><dd>{implementation}</dd></div>
        <div><dt>实际执行精度</dt><dd>{precisionLabels.length ? precisionLabels.join("、") : noGroupPresentation?.precision ?? "未建立"}</dd></div>
        <div><dt>重复 / Kernel</dt><dd>{repeatAndKernel}</dd></div>
      </dl>

      {mappings.length ? (
        <section className="pi0-runtime-drawer-mappings" aria-label="映射摘要">
          {mappings.map((mapping) => (
            <p key={mapping.mappingId}>
              <strong>{pi0RelationLabel(mapping.relation)}</strong>
              <span>{mapping.method === "source_audit" ? "源码审计" : "非源码审计"} · {mapping.certainty === "exact" ? "明确映射" : "映射有歧义"}</span>
            </p>
          ))}
        </section>
      ) : null}

      <details className="pi0-runtime-raw-evidence">
        <summary>详细证据</summary>
        <dl>
          <div><dt>实现记录</dt><dd><code>{realization.realizationId}</code></dd></div>
          <div><dt>运行时修订</dt><dd><code>{realization.runtimeRevision}</code></dd></div>
          <div><dt>配置</dt><dd>{realization.configurationIds.map((id) => <code key={id}>{id}</code>)}</dd></div>
          {groups.map((item) => (
            <div key={item.executionGroupId}>
              <dt>执行组</dt>
              <dd>
                <code>{item.executionGroupId}</code>
                {item.dependencyGroupIds.map((id) => <code key={id}>依赖：{id}</code>)}
                {item.kernelSignatureIds.map((id) => <code key={id}>Kernel：{id}</code>)}
                {item.unmappedReasonCode ? <code>原因：{item.unmappedReasonCode}</code> : null}
              </dd>
            </div>
          ))}
          {mappings.map((mapping) => (
            <div key={mapping.mappingId}>
              <dt>映射</dt>
              <dd>
                <code>{mapping.mappingId}</code>
                {mapping.logicalTargets.map((target) => <code key={target.ref}>{target.ref}</code>)}
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
