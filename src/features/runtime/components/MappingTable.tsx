import type { LogicalDag } from "../../model-graph/domain/types";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { RuntimeOverlayModel, RuntimeRealizationRecord } from "../domain/types";
import { humanizeRuntime, shortLogicalRef, targetRepeatLabel } from "./runtimePresentation";

interface MappingTableProps {
  dag: LogicalDag;
  realization: RuntimeRealizationRecord;
  overlay: RuntimeOverlayModel;
  onSelectGroup: (groupId: string) => void;
}

export function MappingTable({ dag, realization, overlay, onSelectGroup }: MappingTableProps) {
  const index = indexRuntimeRealization(realization);
  const rows = realization.mappings.flatMap((mapping) =>
    (mapping.executionGroupIds.length ? mapping.executionGroupIds : [null]).map((groupId) => ({ mapping, groupId })),
  );
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
                  key={`${mapping.mappingId}/${groupId ?? "eliminated"}`}
                  className={groupId && overlay.highlightedGroupIds.has(groupId) ? "is-selected" : undefined}
                >
                  <td>
                    {group ? (
                      <button type="button" onClick={() => onSelectGroup(group.executionGroupId)}>
                        {group.label}
                      </button>
                    ) : <strong>Eliminated</strong>}
                    <code>{group?.executionGroupId ?? mapping.mappingId}</code>
                  </td>
                  <td>
                    {mapping.logicalTargets.map((target) => (
                      <span key={target.ref} title={target.ref}>
                        <code>{shortLogicalRef(target.ref)}</code>
                        {targetRepeatLabel(target, dag) ? <small>{targetRepeatLabel(target, dag)}</small> : null}
                      </span>
                    ))}
                  </td>
                  <td>
                    <strong>{humanizeRuntime(mapping.relation)}</strong>
                    <small>{humanizeRuntime(mapping.method)} · {mapping.confidence}</small>
                  </td>
                  <td>
                    <strong>{mapping.path} / {mapping.certainty}</strong>
                    {mapping.reasonCode ? <small>{humanizeRuntime(mapping.reasonCode)}</small> : null}
                  </td>
                  <td>{precision ? <><strong>{precision.label}</strong><code>{precision.precisionPathId}</code></> : "—"}</td>
                  <td>{group?.dependencyGroupIds.length ? group.dependencyGroupIds.map((id) => <code key={id}>{id}</code>) : "—"}</td>
                  <td>
                    {group?.kernelSignatureIds.length
                      ? group.kernelSignatureIds.map((id) => <code key={id}>{id}</code>)
                      : <span>Not collected</span>}
                  </td>
                  <td>{[...new Set([...mapping.evidenceIds, ...(group?.evidenceIds ?? [])])].map((id) => <code key={id}>{id}</code>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
