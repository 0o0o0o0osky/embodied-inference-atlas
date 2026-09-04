import { logicalRefFromEntity } from "../../../app/routes";
import type { LogicalDag } from "../../model-graph/domain/types";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { RuntimeRealizationRecord } from "../domain/types";
import { humanizeRuntime, repeatSelectorLabel, targetRepeatLabel } from "./runtimePresentation";

interface ExecutionGroupInspectorProps {
  dag: LogicalDag;
  realization: RuntimeRealizationRecord;
  selectedEntity: string | null;
}

function selectedGroupId(realization: RuntimeRealizationRecord, entity: string | null) {
  const prefix = `runtime-group:${realization.realizationId}/`;
  return entity?.startsWith(prefix) ? entity.slice(prefix.length) : null;
}

export function ExecutionGroupInspector({ dag, realization, selectedEntity }: ExecutionGroupInspectorProps) {
  const index = indexRuntimeRealization(realization);
  const logicalRef = logicalRefFromEntity(selectedEntity);
  const groupId = selectedGroupId(realization, selectedEntity);
  const group = groupId ? index.groupById.get(groupId) : undefined;
  const mappings = group
    ? index.mappingsByGroupId.get(group.executionGroupId) ?? []
    : logicalRef ? index.mappingsByLogicalRef.get(logicalRef) ?? [] : [];
  const mappedGroups = group ? [group] : mappings.flatMap((mapping) =>
    mapping.executionGroupIds.map((id) => index.groupById.get(id)).filter((item) => item !== undefined),
  );
  const evidenceIds = new Set([
    ...mappings.flatMap((mapping) => mapping.evidenceIds),
    ...mappedGroups.flatMap((item) => item.evidenceIds),
  ]);
  const evidence = realization.evidence.filter((item) => evidenceIds.has(item.evidenceId));
  const precision = group ? index.precisionById.get(group.precisionPathId) : undefined;

  return (
    <aside className="runtime-inspector" aria-labelledby="runtime-inspector-title">
      <header>
        <p>{group ? "Execution group" : logicalRef ? "Logical selection" : "Runtime mapping"}</p>
        <h3 id="runtime-inspector-title">{group?.label ?? dag.nodes.get(logicalRef ?? "")?.label ?? "Select a node or group"}</h3>
        <code>{group?.executionGroupId ?? logicalRef ?? realization.realizationId}</code>
      </header>

      {!group && !logicalRef ? (
        <p className="runtime-inspector-prompt">
          Select a logical operator, fusion boundary, badge, or table group. The fixed logical graph remains the navigation surface.
        </p>
      ) : null}

      {group ? (
        <dl className="runtime-inspector-ledger">
          <div><dt>Implementation</dt><dd>{group.implementation ?? "Not established"}</dd></div>
          <div><dt>Group kind</dt><dd>{humanizeRuntime(group.kind)}</dd></div>
          <div><dt>Precision path</dt><dd>{precision?.label ?? group.precisionPathId}</dd></div>
          <div><dt>Dependencies</dt><dd>{group.dependencyGroupIds.length ? group.dependencyGroupIds.join(", ") : "None declared"}</dd></div>
          <div><dt>Repeat selector</dt><dd>{repeatSelectorLabel(group.repeatSelectors, dag) || "None"}</dd></div>
          <div><dt>Kernel resolution</dt><dd>{humanizeRuntime(group.kernelResolution)}</dd></div>
          <div><dt>Kernel IDs</dt><dd>{group.kernelSignatureIds.length ? group.kernelSignatureIds.join(", ") : "Not collected"}</dd></div>
          {group.unmappedReasonCode ? (
            <><div><dt>Logical mapping</dt><dd>None — runtime-only work; no logical highlight is expected.</dd></div>
            <div><dt>Unmapped reason</dt><dd>{group.unmappedReasonCode}</dd></div></>
          ) : null}
        </dl>
      ) : null}

      {mappings.length ? (
        <section className="runtime-inspector-section">
          <h4>{group ? "Logical coverage" : "Mapped execution groups"}</h4>
          {mappings.map((mapping) => (
            <article key={mapping.mappingId}>
              <strong>{humanizeRuntime(mapping.relation)} · {mapping.path} / {mapping.certainty}</strong>
              <code>{mapping.mappingId}</code>
              <p>{humanizeRuntime(mapping.method)} evidence · {mapping.confidence} confidence</p>
              {mapping.logicalTargets.map((target) => (
                <p key={target.ref}>
                  <code>{target.ref}</code>
                  {targetRepeatLabel(target, dag) ? <span>{targetRepeatLabel(target, dag)}</span> : null}
                </p>
              ))}
              {mapping.reasonCode ? <p>Reason: {humanizeRuntime(mapping.reasonCode)}</p> : null}
            </article>
          ))}
        </section>
      ) : group ? (
        <p className="runtime-inspector-prompt">This independently selectable execution group has no logical target by design.</p>
      ) : logicalRef ? <p className="runtime-inspector-prompt">No audited execution group maps to this logical node.</p> : null}

      {evidence.length ? (
        <section className="runtime-inspector-section">
          <h4>Provenance</h4>
          {evidence.map((item) => (
            <article key={item.evidenceId}>
              <strong>{humanizeRuntime(item.kind)}</strong>
              <code>{item.evidenceId}</code>
              {item.locator ? <p>{item.locator}</p> : null}
              {item.revision ? <p>Revision {item.revision}</p> : null}
              {item.runIds.length ? <p>{item.runIds.length} canonical run{item.runIds.length === 1 ? "" : "s"}</p> : null}
            </article>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
