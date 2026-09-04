import type { LogicalDag } from "../../model-graph/domain/types";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { RuntimeMapping, RuntimeOverlayModel, RuntimeRealizationRecord } from "../domain/types";
import { humanizeRuntime, repeatSelectorLabel, shortLogicalRef, targetRepeatLabel } from "./runtimePresentation";

interface MappingTableProps {
  dag: LogicalDag;
  realization: RuntimeRealizationRecord;
  overlay: RuntimeOverlayModel;
  onSelectGroup: (groupId: string) => void;
}

export function MappingTable({ dag, realization, overlay, onSelectGroup }: MappingTableProps) {
  const index = indexRuntimeRealization(realization);
  const mappedGroupIds = new Set(realization.mappings.flatMap((mapping) => mapping.executionGroupIds));
  const rows: Array<{ mapping: RuntimeMapping | null; groupId: string | null }> = [
    ...realization.mappings.flatMap((mapping) =>
      (mapping.executionGroupIds.length ? mapping.executionGroupIds : [null]).map((groupId) => ({ mapping, groupId })),
    ),
    ...realization.executionGroups
      .filter((group) => !mappedGroupIds.has(group.executionGroupId))
      .map((group) => ({ mapping: null, groupId: group.executionGroupId })),
  ];
  return (
    <section className="runtime-mapping-register" aria-labelledby="runtime-mapping-title">
      <header>
        <div>
          <p>Source-audited mapping register</p>
          <h3 id="runtime-mapping-title">Logical ↔ execution groups</h3>
        </div>
        <span>{realization.mappingCoverage.replaceAll("_", " ")} · {realization.mappingLevel.replaceAll("_", " ")}</span>
      </header>
      <div className="runtime-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Logical mapping</th>
              <th>Relation</th>
              <th>Path / certainty</th>
              <th>Precision</th>
              <th>Dependencies</th>
              <th>Kernels</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ mapping, groupId }) => {
              const group = groupId ? index.groupById.get(groupId) : undefined;
              const precision = group ? index.precisionById.get(group.precisionPathId) : undefined;
              return (
                <tr
                  key={`${mapping?.mappingId ?? "unmapped"}/${groupId ?? "eliminated"}`}
                  className={groupId && overlay.highlightedGroupIds.has(groupId) ? "is-selected" : undefined}
                >
                  <td>
                    {group ? (
                      <button type="button" onClick={() => onSelectGroup(group.executionGroupId)}>
                        {group.label}
                      </button>
                    ) : <strong>Eliminated</strong>}
                    <code>{group?.executionGroupId ?? mapping?.mappingId}</code>
                  </td>
                  <td>
                    {mapping ? mapping.logicalTargets.map((target) => (
                      <span key={target.ref} title={target.ref}>
                        <code>{shortLogicalRef(target.ref)}</code>
                        {targetRepeatLabel(target, dag) ? <small>{targetRepeatLabel(target, dag)}</small> : null}
                      </span>
                    )) : <span><strong>None</strong><small>Runtime-only group; no logical highlight.</small></span>}
                  </td>
                  <td>
                    <strong>{mapping ? humanizeRuntime(mapping.relation) : "Unmapped runtime work"}</strong>
                    <small>{mapping ? `${humanizeRuntime(mapping.method)} · ${mapping.confidence}` : group?.unmappedReasonCode ?? "reason unavailable"}</small>
                  </td>
                  <td>
                    <strong>{mapping ? `${mapping.path} / ${mapping.certainty}` : repeatSelectorLabel(group?.repeatSelectors ?? [], dag) || "No repeat selector"}</strong>
                    {mapping?.reasonCode ? <small>{humanizeRuntime(mapping.reasonCode)}</small> : null}
                  </td>
                  <td>{precision ? <><strong>{precision.label}</strong><code>{precision.precisionPathId}</code></> : "—"}</td>
                  <td>{group?.dependencyGroupIds.length ? group.dependencyGroupIds.map((id) => <code key={id}>{id}</code>) : "—"}</td>
                  <td>
                    {group?.kernelSignatureIds.length
                      ? group.kernelSignatureIds.map((id) => <code key={id}>{id}</code>)
                      : <span>Not collected</span>}
                  </td>
                  <td>{[...new Set([...(mapping?.evidenceIds ?? []), ...(group?.evidenceIds ?? [])])].map((id) => <code key={id}>{id}</code>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
