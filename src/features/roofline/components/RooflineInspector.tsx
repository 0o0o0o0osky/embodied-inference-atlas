import type { RooflineBasisRecord, RooflinePointRecord, RooflineScenarioRecord } from "../domain/types";
import { formatNumber, formatQuantity, formatTime, humanize } from "../presentation/viewModel";

export function RooflineInspector({
  point,
  basis,
  scenario,
}: {
  point: RooflinePointRecord | null;
  basis: RooflineBasisRecord;
  scenario: RooflineScenarioRecord;
}) {
  if (!point) {
    return <aside className="roofline-inspector"><header><p>Entity inspector</p><h3>No valid point</h3></header><p>This exact basis has no entity with compatible work, traffic, and time.</p></aside>;
  }
  return (
    <aside className="roofline-inspector" aria-labelledby="roofline-inspector-title">
      <header>
        <p>{humanize(point.entity.kind)} · {humanize(point.coverage.status)}</p>
        <h3 id="roofline-inspector-title">{point.entity.label}</h3>
        <code>{point.entity.entity_id}</code>
      </header>
      <p className="roofline-inspector-shape">{point.entity.shape_or_coverage}</p>
      {point.derived.status !== "complete" ? <p className="roofline-partial-note"><strong>Partial envelope.</strong> Missing work or a compute ceiling remains explicit; no complete efficiency or gap is claimed.</p> : null}
      <dl className="roofline-inspector-ledger">
        <div><dt>Calls</dt><dd>{point.calls}</dd></div>
        <div><dt>Work</dt><dd>{formatQuantity(point.work.total_flop, "FLOP")}</dd></div>
        <div><dt>Traffic</dt><dd>{formatQuantity(point.traffic.total_byte, "B")} · {humanize(point.traffic.value_kind)}</dd></div>
        <div><dt>AI</dt><dd>{point.derived.arithmetic_intensity_flop_per_byte === null ? "Unavailable" : `${formatNumber(point.derived.arithmetic_intensity_flop_per_byte)} FLOP/B`}</dd></div>
        <div><dt>Roof time</dt><dd>{point.derived.roof_second === null ? "Unavailable" : formatTime(point.derived.roof_second)}</dd></div>
        <div><dt>Actual time</dt><dd>{point.timing.observed_second === null ? "Not observed" : formatTime(point.timing.observed_second)}</dd></div>
        <div><dt>Limiter</dt><dd>{humanize(point.derived.limiter)}</dd></div>
        <div><dt>Efficiency / gap</dt><dd>{point.derived.efficiency === null || point.derived.gap === null ? "Unavailable on this evidence basis" : `${formatNumber(point.derived.efficiency * 100)}% / ${formatNumber(point.derived.gap)}×`}</dd></div>
      </dl>
      <p className="roofline-coverage-key"><strong>Ratio coverage key</strong><code>{point.entity.coverage_key}</code></p>
      <details>
        <summary>Precision and ceiling provenance</summary>
        <dl>
          <div><dt>Precision path</dt><dd>{humanize(scenario.precision_path.precision_path_id)}</dd></div>
          <div><dt>Scenario origin</dt><dd>{humanize(scenario.origin)}</dd></div>
          <div><dt>Ceiling</dt><dd>{basis.ceiling_id}</dd></div>
          <div><dt>Provenance</dt><dd>{humanize(basis.provenance.class)}</dd></div>
          <div><dt>Condition</dt><dd>{basis.provenance.condition ?? "None declared"}</dd></div>
        </dl>
      </details>
      <details>
        <summary>Mappings and aggregation</summary>
        <p>{point.entity.logical_refs.length ? `Logical: ${point.entity.logical_refs.join(", ")}` : "No logical mapping is claimed."}</p>
        <p>{basis.realization_id ? `Realization: ${basis.realization_id}` : "No runtime realization belongs to this basis."}</p>
        {point.aggregation.dependency_lower_bound_second !== null ? (
          <dl>
            <div><dt>Dependency</dt><dd>{formatTime(point.aggregation.dependency_lower_bound_second)}</dd></div>
            <div><dt>Compute resource</dt><dd>{formatTime(point.aggregation.resource_compute_lower_bound_second!)}</dd></div>
            <div><dt>Memory resource</dt><dd>{formatTime(point.aggregation.resource_memory_lower_bound_second!)}</dd></div>
          </dl>
        ) : null}
      </details>
      <details>
        <summary>Components, exclusions, and missing values</summary>
        <h4>Work components</h4>
        <ul>{point.work.components.map((item) => <li key={item.component_id}><code>{item.component_id}</code><span>{formatQuantity(item.flop, "FLOP")} · {item.compute_class ? humanize(item.compute_class) : "no compute ceiling"}</span></li>)}</ul>
        <h4>Traffic components</h4>
        <ul>{point.traffic.components.map((item) => <li key={item.component_id}><code>{item.component_id}</code><span>{formatQuantity(item.byte, "B")} · {humanize(item.kind)}</span></li>)}</ul>
        {point.traffic.excluded_internal.length ? <><h4>Evidence-backed exclusions</h4><ul>{point.traffic.excluded_internal.map((item) => <li key={`${item.tensor_ref}:${item.evidence_ref}`}>{item.tensor_ref}: {formatQuantity(item.byte_avoided, "B")} via {item.evidence_ref}</li>)}</ul></> : null}
        <h4>Missing</h4>
        <ul>{point.missing.length ? point.missing.map((item) => <li key={`${item.field}:${item.reason}`}><strong>{humanize(item.reason)}</strong> · {item.detail}</li>) : <li>None declared.</li>}</ul>
      </details>
    </aside>
  );
}
