import type { RooflineBasisRecord, RooflineCeilingRecord, RooflinePointRecord, RooflineScenarioRecord } from "../domain/types";
import { formatNumber, formatQuantity, formatTime, humanize, provenanceLabel, type RooflineCurveVM } from "../presentation/viewModel";

function missingLedger(point: RooflinePointRecord) {
  const blockers = point.missing.filter((item) => item.field !== "timing.observed_second");
  return blockers.map((item) => `${item.field} (${humanize(item.reason)})`).join("; ");
}

export function RooflineInspector({
  point,
  basis,
  scenario,
  ceiling,
  curves,
}: {
  point: RooflinePointRecord | null;
  basis: RooflineBasisRecord;
  scenario: RooflineScenarioRecord;
  ceiling: RooflineCeilingRecord;
  curves: readonly RooflineCurveVM[];
}) {
  if (!point) {
    return <aside className="roofline-inspector"><header><p>Entity inspector</p><h3>No canonical entity</h3></header><p>This exact basis emits no point record; work, traffic, and time are not inferred from another basis.</p></aside>;
  }
  const partial = point.derived.status !== "complete" || point.coverage.status !== "complete";
  return (
    <aside className="roofline-inspector" aria-labelledby="roofline-inspector-title">
      <header>
        <p>{humanize(point.entity.kind)} · {humanize(point.coverage.status)}</p>
        <h3 id="roofline-inspector-title">{point.entity.label}</h3>
      </header>
      <p className="roofline-inspector-shape">{point.entity.shape_or_coverage} · {point.calls} calls · {humanize(point.derived.status)}</p>
      {partial ? <p className="roofline-partial-note"><strong>Partial or unplottable envelope.</strong> {missingLedger(point) || "Coverage is incomplete; see the declared omissions below."}</p> : null}
      <dl className="roofline-inspector-ledger">
        <div><dt>Work</dt><dd>{formatQuantity(point.work.total_flop, "FLOP")}</dd></div>
        <div><dt>Traffic</dt><dd>{formatQuantity(point.traffic.total_byte, "B")} · {humanize(point.traffic.value_kind)}</dd></div>
        <div><dt>AI</dt><dd>{point.derived.arithmetic_intensity_flop_per_byte === null ? "Unavailable" : `${formatNumber(point.derived.arithmetic_intensity_flop_per_byte)} FLOP/B`}</dd></div>
        <div><dt>Roof time</dt><dd>{point.derived.roof_second === null ? "Unavailable" : formatTime(point.derived.roof_second)}</dd></div>
        <div><dt>Actual time</dt><dd>{point.timing.observed_second === null ? "Not observed" : formatTime(point.timing.observed_second)}</dd></div>
        <div><dt>Limiter</dt><dd>{humanize(point.derived.limiter)}</dd></div>
        <div className="roofline-inspector-wide"><dt>Efficiency / gap</dt><dd>{point.derived.efficiency === null || point.derived.gap === null ? "Unavailable on this exact evidence basis" : `${formatNumber(point.derived.efficiency * 100)}% / ${formatNumber(point.derived.gap)}×`}</dd></div>
      </dl>
      <details>
        <summary>Precision, ratio key, and ceiling provenance</summary>
        <dl>
          <div><dt>Point entity ID</dt><dd><code>{point.entity.entity_id}</code></dd></div>
          <div><dt>Ratio coverage key</dt><dd><code>{point.entity.coverage_key}</code></dd></div>
          <div><dt>Precision path</dt><dd>{humanize(scenario.precision_path.precision_path_id)}</dd></div>
          <div><dt>Scenario origin</dt><dd>{humanize(scenario.origin)}</dd></div>
          <div><dt>Ceiling set</dt><dd>{ceiling.ceiling_id}</dd></div>
        </dl>
        <h4>Compute ceiling{curves.length === 1 ? "" : "s"}</h4>
        {curves.length ? <ul>{curves.map((curve) => <li key={curve.curveId}>
          <code>{curve.computeCeilingId}</code>
          <span>{formatNumber(curve.computeFlopPerSecond / 1e12)} TFLOP/s · {provenanceLabel(curve.computeProvenance)}</span>
          <span>Sources: {curve.computeProvenance.source_ids.join(", ") || "none"}</span>
          <span>Condition: {curve.computeProvenance.condition ?? "none declared"}</span>
        </li>)}</ul> : <p>No compute ceiling is active for every required work class on this basis.</p>}
        <h4>Bandwidth ceiling</h4>
        {curves[0] ? <ul><li>
          <code>{curves[0].bandwidthCeilingId}</code>
          <span>{formatNumber(curves[0].bandwidthBytePerSecond / 1e9)} GB/s · {provenanceLabel(curves[0].bandwidthProvenance)}</span>
          <span>Sources: {curves[0].bandwidthProvenance.source_ids.join(", ") || "none"}</span>
          <span>Condition: {curves[0].bandwidthProvenance.condition ?? "none declared"}</span>
        </li></ul> : <p>No eligible bandwidth ceiling is active.</p>}
      </details>
      <details>
        <summary>Basis and mappings</summary>
        <dl>
          <div><dt>Time / traffic</dt><dd>{humanize(basis.time_basis)} / {humanize(basis.traffic_basis)}</dd></div>
          <div><dt>Work / aggregation</dt><dd>{humanize(basis.work_basis)} / {humanize(basis.aggregation)}</dd></div>
          <div><dt>Operating point</dt><dd>{basis.operating_point_id}</dd></div>
          <div><dt>Basis provenance</dt><dd>{provenanceLabel(basis.provenance)} · {basis.provenance.condition ?? "none declared"}</dd></div>
        </dl>
        <p>{point.entity.logical_refs.length ? `Logical: ${point.entity.logical_refs.join(", ")}` : "No logical mapping is claimed."}</p>
        <p>{basis.realization_id ? `Realization: ${basis.realization_id}` : "No runtime realization belongs to this basis."}</p>
        <p>{basis.capture_id ? `Capture: ${basis.capture_id}` : "No capture belongs to this basis."}</p>
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
        <ul>{point.missing.length ? point.missing.map((item) => <li key={`${item.field}:${item.reason}`}><strong>{item.field} · {humanize(item.reason)}</strong><span>{item.detail}</span></li>) : <li>None declared.</li>}</ul>
      </details>
    </aside>
  );
}
