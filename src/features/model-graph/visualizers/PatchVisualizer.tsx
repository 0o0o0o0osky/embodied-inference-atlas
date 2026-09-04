import type { OperatorDetail } from "../domain/types";
import { AnimationControls } from "./AnimationControls";
import { useOperatorAnimation } from "./useOperatorAnimation";

export function PatchVisualizer({ operator, resetKey }: { operator: OperatorDetail; resetKey: string }) {
  const bindings = operator.scopeBindings;
  const height = bindings.H ?? 0;
  const width = bindings.W ?? 0;
  const patch = bindings.P ?? 0;
  const rows = patch > 0 ? height / patch : 0;
  const columns = patch > 0 ? width / patch : 0;
  const valid = Number.isSafeInteger(rows) && Number.isSafeInteger(columns) && rows > 0 && columns > 0;
  const count = valid ? rows * columns : 1;
  const animation = useOperatorAnimation(count, resetKey);
  const row = Math.floor(animation.frame / columns);
  const column = animation.frame % columns;
  const status = valid
    ? `Patch ${animation.frame + 1}/${count}: row ${row + 1}, column ${column + 1}; pixels y ${row * patch}–${(row + 1) * patch - 1}, x ${column * patch}–${(column + 1) * patch - 1}.`
    : "The declared image and patch dimensions do not form an exact lattice.";
  return (
    <section className="operator-visualizer patch-visualizer">
      <header>
        <h3>Patch projection microscope</h3>
        <code>patch · weight → token</code>
      </header>
      <div className="visualizer-dimensions">
        <span>Image {height} × {width}</span>
        <span>Patch / stride {patch} × {patch}</span>
        <span>Channels {bindings.C ?? "?"}</span>
        <span>Tokens / view {bindings.T ?? "?"}</span>
      </div>
      {valid ? (
        <div className="patch-diagram">
          <div>
            <strong>Input patch lattice</strong>
            <span className="patch-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
              {Array.from({ length: count }, (_, index) => (
                <i className={index === animation.frame ? "is-active" : ""} key={index} />
              ))}
            </span>
          </div>
          <b aria-hidden="true">·</b>
          <span className="patch-weight">P²C × D</span>
          <b aria-hidden="true">→</b>
          <div>
            <strong>Output tokens</strong>
            <span className="patch-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
              {Array.from({ length: count }, (_, index) => (
                <i className={index < animation.frame ? "is-complete" : index === animation.frame ? "is-active" : ""} key={index} />
              ))}
            </span>
          </div>
        </div>
      ) : <p className="visualizer-empty">Patch animation is unavailable for inconsistent dimensions.</p>}
      <p className="visualizer-note">Illustrative mathematical traversal, not a runtime tile schedule.</p>
      <AnimationControls animation={animation} status={status} />
    </section>
  );
}
