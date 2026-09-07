import { useState } from "react";

import type { LogicalDag } from "../../model-graph/domain/types";
import { useModelText } from "../../model-graph/presentation/ModelDisplay";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { RuntimeMapping, RuntimeRealizationRecord } from "../domain/types";
import {
  pi0GroupLabel,
  pi0MappingCoverageLabel,
  pi0MappingLevelLabel,
  pi0PrecisionLabel,
  pi0RelationLabel,
  targetRepeatLabel,
} from "./runtimePresentation";

interface Pi0RuntimeMappingDisclosureProps {
  dag: LogicalDag;
  realization: RuntimeRealizationRecord;
  onSelectGroup: (groupId: string) => void;
}

export function Pi0RuntimeMappingDisclosure({
  dag,
  realization,
  onSelectGroup,
}: Pi0RuntimeMappingDisclosureProps) {
  const [open, setOpen] = useState(false);
  const t = useModelText();
  const index = indexRuntimeRealization(realization);
  const mappedGroupIds = new Set(realization.mappings.flatMap((mapping) => mapping.executionGroupIds));
  const rows: Array<{ mapping: RuntimeMapping | null; groupId: string | null }> = [
    ...realization.mappings.flatMap((mapping) =>
      (mapping.executionGroupIds.length ? mapping.executionGroupIds : [null])
        .map((groupId) => ({ mapping, groupId })),
    ),
    ...realization.executionGroups
      .filter((group) => !mappedGroupIds.has(group.executionGroupId))
      .map((group) => ({ mapping: null, groupId: group.executionGroupId })),
  ];

  return (
    <details
      className="pi0-runtime-mapping-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        算子与实际计算对照（{rows.length} 项） · {pi0MappingCoverageLabel(realization.mappingCoverage)} / {pi0MappingLevelLabel(realization.mappingLevel)}
      </summary>
      {open ? (
        <div className="pi0-runtime-table-wrap">
          <table>
            <thead>
              <tr>
                <th>实际计算</th>
                <th>模型算子</th>
                <th>关系</th>
                <th>实际精度</th>
                <th>证据状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ mapping, groupId }) => {
                const group = groupId ? index.groupById.get(groupId) : undefined;
                const precision = group ? index.precisionById.get(group.precisionPathId) : undefined;
                const logicalTargets = mapping?.logicalTargets.map((target) => {
                  const label = t(dag.nodes.get(target.ref)?.label ?? target.ref);
                  const repeat = targetRepeatLabel(target, dag)
                    .replace(/layers (\d+)–(\d+)/g, (_, first, last) => `第 ${Number(first) + 1}–${Number(last) + 1} 层`)
                    .replaceAll("denoise", "去噪")
                    .replaceAll("layers", "层")
                    .replaceAll("all", "全部");
                  return repeat ? `${label}（${repeat}）` : label;
                }) ?? [];
                const evidenceState = !group ? "无独立计算"
                  : group.kernelResolution === "resolved" ? "已关联 Kernel"
                  : group.kernelResolution === "partial" ? "部分关联 Kernel" : "Kernel 未关联";
                return (
                  <tr key={`${mapping?.mappingId ?? "unmapped"}/${groupId ?? "eliminated"}`}>
                    <td>
                      {group ? (
                        <button type="button" onClick={() => onSelectGroup(group.executionGroupId)}>
                          {pi0GroupLabel(group.label)}
                        </button>
                      ) : <strong>无独立计算</strong>}

                    </td>
                    <td>{logicalTargets.length ? logicalTargets.join("、") : "无逻辑目标"}</td>
                    <td>
                      {mapping ? pi0RelationLabel(mapping.relation) : "运行时额外工作"}
                      {mapping?.certainty === "ambiguous" ? <small>映射有歧义，不自动聚焦</small> : null}
                    </td>
                    <td>{precision ? pi0PrecisionLabel(precision.precisionPathId, precision.label) : "—"}</td>
                    <td>{evidenceState}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}
