import type { RoutePatch } from "../../../app/routes";
import type { RooflineOverviewItem } from "../presentation/viewModel";
import { humanize } from "../presentation/viewModel";

const QUESTIONS = {
  stage: "What is the dependency and single-resource lower bound for the model and each stage?",
  atomic: "Which logical formulas and materialized tensors set the analytical envelope?",
  fused: "What changed at one exact runtime execution-group boundary?",
  kernel: "What did one captured kernel launch actually do?",
} as const;

export function RooflineOverview({
  items,
  navigate,
}: {
  items: readonly RooflineOverviewItem[];
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  return (
    <section className="roofline-overview" aria-labelledby="roofline-overview-title">
      <header>
        <p>Four accounting levels · never combined</p>
        <h2 id="roofline-overview-title">Choose one evidence plane</h2>
      </header>
      <div className="roofline-overview-ledger">
        {items.map((item) => (
          <article key={item.level}>
            <div className="roofline-overview-level">
              <span>{humanize(item.availability)}</span>
              <h3>{humanize(item.level)}</h3>
            </div>
            <p>{QUESTIONS[item.level]}</p>
            <div className="roofline-overview-basis">
              <strong>{item.basisLabel}</strong>
              <code>{item.basisId ?? "No basis"}</code>
            </div>
            <dl>
              <div><dt>Plottable</dt><dd>{item.plottable}</dd></div>
              <div><dt>Partial</dt><dd>{item.partial}</dd></div>
              <div><dt>Missing</dt><dd>{item.missing}</dd></div>
            </dl>
            <button type="button" onClick={() => navigate({ rooflineLevel: item.level, basis: item.basisId, entity: null })}>
              Open {humanize(item.level)} →
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
