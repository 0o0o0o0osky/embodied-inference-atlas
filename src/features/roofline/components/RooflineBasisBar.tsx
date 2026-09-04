import type { RoutePatch, RouteState } from "../../../app/routes";
import type { InteractiveWorkload, InteractiveWorkloadBounds } from "../data/materialize";
import type { RooflineViewModel } from "../presentation/viewModel";
import { formatNumber, humanize, provenanceLabel } from "../presentation/viewModel";

function deviceLabel(deviceId: string) {
  return deviceId === "nvidia-jetson-agx-thor" ? "Jetson AGX Thor T5000" : deviceId;
}

export function RooflineBasisBar({
  route,
  model,
  workload,
  workloadBounds,
  navigate,
  onWorkload,
}: {
  route: RouteState;
  model: RooflineViewModel;
  workload: InteractiveWorkload | null;
  workloadBounds: InteractiveWorkloadBounds;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  onWorkload: (value: InteractiveWorkload) => void;
}) {
  const basis = model.activeBasis;
  const scenario = model.activeScenario;
  if (!basis || !scenario) return null;
  const precisionOptions = [...new Map(model.availableBases.map((item) => [item.precisionPathId, item])).values()];
  const update = (field: keyof InteractiveWorkload, value: string) => {
    if (!workload) return;
    const parsed = Number(value);
    const minimum = field === "executedPromptTokens" ? workloadBounds.promptMinimum : 1;
    const maximum = field === "executedPromptTokens" ? workloadBounds.promptMaximum : null;
    if (Number.isSafeInteger(parsed) && parsed >= minimum && (maximum === null || parsed <= maximum)) {
      onWorkload({ ...workload, [field]: parsed });
    }
  };
  const runtimeState = basis.realization_id
    ? `Exact realization · ${basis.realization_id}`
    : route.runtime
      ? "Analytical tuple remains independent of the runtime hardware filter"
      : "Analytical tuple · no runtime evidence selected";
  const bandwidth = model.curves[0];
  return (
    <section className="roofline-basis-bar" aria-labelledby="roofline-basis-title">
      <header>
        <div>
          <p>One indivisible accounting tuple</p>
          <h2 id="roofline-basis-title">{basis.label}</h2>
          <code>{basis.basis_id}</code>
        </div>
        <label>
          <span>Canonical basis</span>
          <select value={basis.basis_id} onChange={(event) => navigate({ basis: event.target.value, precision: model.availableBases.find((item) => item.basisId === event.target.value)?.precisionPathId ?? null, workload: null, entity: null })}>
            {model.availableBases.map((item) => <option key={item.basisId} value={item.basisId}>{item.label}</option>)}
          </select>
        </label>
      </header>
      <div className="roofline-basis-controls">
        <section className="roofline-control-group" aria-labelledby="roofline-what-if-title">
          <h3 id="roofline-what-if-title">Analytical what-if</h3>
          <label>
            <span>Precision scenario</span>
            <select value={scenario.precision_path.precision_path_id} onChange={(event) => {
              const selected = precisionOptions.find((item) => item.precisionPathId === event.target.value);
              navigate({ precision: event.target.value, basis: selected?.basisId ?? null, workload: null, entity: null });
            }}>
              {precisionOptions.map((item) => <option key={item.precisionPathId} value={item.precisionPathId}>{humanize(item.precisionPathId)}</option>)}
            </select>
          </label>
          {workload ? (
            <div className="roofline-workload-controls">
              <label><span>Views</span><input aria-label="Executed camera views" type="number" min="1" value={workload.executedCameraViews} onChange={(event) => update("executedCameraViews", event.target.value)} /></label>
              <label><span>Prompt</span><input aria-label="Executed prompt tokens" type="number" min={workloadBounds.promptMinimum} max={workloadBounds.promptMaximum ?? undefined} value={workload.executedPromptTokens} onChange={(event) => update("executedPromptTokens", event.target.value)} /></label>
              <label><span>Action</span><input aria-label="Action horizon" type="number" min="1" value={workload.actionHorizon} onChange={(event) => update("actionHorizon", event.target.value)} /></label>
              <label><span>Denoise</span><input aria-label="Denoise steps" type="number" min="1" value={workload.denoiseSteps} onChange={(event) => update("denoiseSteps", event.target.value)} /></label>
            </div>
          ) : <p className="roofline-control-note">{scenario.origin === "legacy_import" ? "Legacy inventory is a published migration snapshot; interactive rematerialization is intentionally disabled." : "Runtime-mixed allocation stays bound to its exact default realization."}</p>}
          <span className="roofline-origin">{humanize(scenario.origin)}</span>
        </section>
        <div className="roofline-match-state" role="status">{runtimeState}</div>
        <section className="roofline-control-group roofline-runtime-controls" aria-labelledby="roofline-runtime-title">
          <h3 id="roofline-runtime-title">Runtime evidence</h3>
          <dl>
            <div><dt>Runtime</dt><dd>{route.runtime ?? "Not selected"}</dd></div>
            <div><dt>Actual precision</dt><dd>{route.runtimePrecision ?? "Not established"}</dd></div>
            <div><dt>Capture</dt><dd>{basis.capture_id ?? "No canonical capture"}</dd></div>
          </dl>
          <button type="button" disabled>Use matching observed basis</button>
        </section>
      </div>
      <dl className="roofline-basis-fingerprint">
        <div><dt>Level</dt><dd>{humanize(basis.level)}</dd></div>
        <div><dt>Time</dt><dd>{humanize(basis.time_basis)}</dd></div>
        <div><dt>Traffic</dt><dd>{humanize(basis.traffic_basis)}</dd></div>
        <div><dt>Precision</dt><dd>{humanize(basis.precision_path_id)}</dd></div>
        <div><dt>Work unit</dt><dd>{humanize(basis.work_unit)}</dd></div>
        <div><dt>Device</dt><dd>{deviceLabel(basis.device_id)}</dd></div>
        <div><dt>Operating point</dt><dd>{basis.operating_point_id}</dd></div>
        <div><dt>Coverage</dt><dd>{humanize(basis.comparison_mode)}</dd></div>
      </dl>
      <section className="roofline-basis-ceilings" aria-label="Active compute and bandwidth ceiling provenance">
        <article>
          <h3>Compute ceiling</h3>
          {model.curves.length ? model.curves.map((curve) => (
            <p key={curve.curveId}>
              <code>{curve.computeCeilingId}</code>
              <strong>{formatNumber(curve.computeFlopPerSecond / 1e12)} TFLOP/s · {provenanceLabel(curve.computeProvenance)}</strong>
              <span>{curve.computeProvenance.condition ?? "No additional compute condition declared."}</span>
            </p>
          )) : <p><strong>No active compute curve</strong><span>A required compute ceiling or matched sparsity observation is missing.</span></p>}
        </article>
        <article>
          <h3>Bandwidth ceiling</h3>
          {bandwidth ? <p>
            <code>{bandwidth.bandwidthCeilingId}</code>
            <strong>{formatNumber(bandwidth.bandwidthBytePerSecond / 1e9)} GB/s · {provenanceLabel(bandwidth.bandwidthProvenance)}</strong>
            <span>{bandwidth.bandwidthProvenance.condition ?? "No additional bandwidth condition declared."}</span>
          </p> : <p><strong>No active bandwidth curve</strong><span>The selected basis has no eligible bandwidth ceiling.</span></p>}
        </article>
      </section>
    </section>
  );
}
