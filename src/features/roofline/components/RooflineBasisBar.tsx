import type { RoutePatch, RouteState } from "../../../app/routes";
import type { InteractiveWorkload } from "../data/materialize";
import type { RooflineViewModel } from "../presentation/viewModel";
import { humanize } from "../presentation/viewModel";

export function RooflineBasisBar({
  route,
  model,
  workload,
  navigate,
  onWorkload,
}: {
  route: RouteState;
  model: RooflineViewModel;
  workload: InteractiveWorkload | null;
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
    if (Number.isSafeInteger(parsed) && parsed > 0) onWorkload({ ...workload, [field]: parsed });
  };
  const runtimeState = route.runtime
    ? route.runtimePrecision ? "Different basis — no matching capture" : "No capture · actual precision unresolved"
    : "No capture · runtime not selected";
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
        <fieldset>
          <legend>Analytical what-if</legend>
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
              <label><span>Prompt</span><input aria-label="Executed prompt tokens" type="number" min="1" value={workload.executedPromptTokens} onChange={(event) => update("executedPromptTokens", event.target.value)} /></label>
              <label><span>Action</span><input aria-label="Action horizon" type="number" min="1" value={workload.actionHorizon} onChange={(event) => update("actionHorizon", event.target.value)} /></label>
              <label><span>Denoise</span><input aria-label="Denoise steps" type="number" min="1" value={workload.denoiseSteps} onChange={(event) => update("denoiseSteps", event.target.value)} /></label>
            </div>
          ) : <p className="roofline-control-note">Runtime-mixed allocation stays bound to its exact default realization.</p>}
          <span className="roofline-origin">{humanize(scenario.origin)}</span>
        </fieldset>
        <div className="roofline-match-state" role="status">{runtimeState}</div>
        <fieldset className="roofline-runtime-controls">
          <legend>Runtime evidence</legend>
          <dl>
            <div><dt>Runtime</dt><dd>{route.runtime ?? "Not selected"}</dd></div>
            <div><dt>Actual precision</dt><dd>{route.runtimePrecision ?? "Not established"}</dd></div>
            <div><dt>Capture</dt><dd>{basis.capture_id ?? "No canonical capture"}</dd></div>
          </dl>
          <button type="button" disabled>Use matching observed basis</button>
        </fieldset>
      </div>
      <dl className="roofline-basis-fingerprint">
        <div><dt>Level</dt><dd>{humanize(basis.level)}</dd></div>
        <div><dt>Time</dt><dd>{humanize(basis.time_basis)}</dd></div>
        <div><dt>Traffic</dt><dd>{humanize(basis.traffic_basis)}</dd></div>
        <div><dt>Precision</dt><dd>{humanize(basis.precision_path_id)}</dd></div>
        <div><dt>Work unit</dt><dd>{humanize(basis.work_unit)}</dd></div>
        <div><dt>Operating point</dt><dd>{basis.operating_point_id}</dd></div>
        <div><dt>Coverage</dt><dd>{humanize(basis.comparison_mode)}</dd></div>
      </dl>
    </section>
  );
}
