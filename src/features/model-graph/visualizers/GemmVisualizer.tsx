import type { OperatorDetail } from "../domain/types";
import { AnimationControls } from "./AnimationControls";
import { useOperatorAnimation } from "./useOperatorAnimation";

function dimensions(operator: OperatorDetail) {
  const { M, N, K } = operator.bindings;
  if ([M, N, K].every((value) => typeof value === "number")) return { M, N, K };
  const input = operator.inputs[0]?.tensor?.shape;
  const output = operator.outputs[0]?.tensor?.shape;
  if (!input || !output || input.includes(null) || output.includes(null)) {
    return { M: null, N: null, K: null };
  }
  const concreteInput = input as number[];
  const concreteOutput = output as number[];
  return {
    M: concreteInput.slice(0, -1).reduce((total, value) => total * value, 1),
    N: concreteOutput.at(-1) ?? null,
    K: concreteInput.at(-1) ?? null,
  };
}

function Matrix({
  name,
  role,
  lane,
  focus,
  complete,
}: {
  name: string;
  role: string;
  lane: (row: number, column: number) => boolean;
  focus: (row: number, column: number) => boolean;
  complete?: (row: number, column: number) => boolean;
}) {
  return (
    <div className="gemm-matrix" data-matrix-role={role}>
      <strong>{name}</strong>
      <div className="gemm-grid">
        {Array.from({ length: 9 }, (_, index) => {
          const row = Math.floor(index / 3);
          const column = index % 3;
          return (
            <i
              key={index}
              className={[
                lane(row, column) ? "is-lane" : "",
                focus(row, column) ? "is-focus" : "",
                complete?.(row, column) ? "is-complete" : "",
              ].filter(Boolean).join(" ")}
            />
          );
        })}
      </div>
    </div>
  );
}

export function GemmVisualizer({ operator, resetKey }: { operator: OperatorDetail; resetKey: string }) {
  const animation = useOperatorAnimation(36, resetKey);
  const outputTile = Math.floor(animation.frame / 4);
  const phase = animation.frame % 4;
  const row = Math.floor(outputTile / 3);
  const column = outputTile % 3;
  const kTile = Math.min(phase, 2);
  const written = phase === 3;
  const dims = dimensions(operator);
  const status = written
    ? `Write D tile row ${row + 1}, column ${column + 1}.`
    : `D tile row ${row + 1}, column ${column + 1}: accumulate K tile ${kTile + 1} of 3.`;
  return (
    <section className="operator-visualizer gemm-visualizer">
      <header>
        <h3>GEMM tile microscope</h3>
        <code>D = A @ B + C</code>
      </header>
      <div className="visualizer-dimensions">
        <span>M {dims.M?.toLocaleString() ?? "?"}</span>
        <span>N {dims.N?.toLocaleString() ?? "?"}</span>
        <span>K {dims.K?.toLocaleString() ?? "?"}</span>
        <span>Schematic 3 × 3 output tiles</span>
      </div>
      <div className="gemm-diagram" aria-label="Three by three GEMM tile traversal">
        <Matrix name="A [M × K]" role="a-matrix" lane={(r) => r === row} focus={(r, c) => !written && r === row && c === kTile} />
        <b aria-hidden="true">@</b>
        <Matrix name="B [K × N]" role="b-matrix" lane={(_, c) => c === column} focus={(r, c) => !written && r === kTile && c === column} />
        <b aria-hidden="true">+</b>
        <span className="gemm-bias">C</span>
        <b aria-hidden="true">=</b>
        <Matrix
          name="D [M × N]"
          role="d-matrix"
          lane={(r, c) => r === row && c === column}
          focus={(r, c) => r === row && c === column}
          complete={(r, c) => r * 3 + c < outputTile || (written && r === row && c === column)}
        />
      </div>
      <div className="gemm-reduction">
        {[0, 1, 2].map((index) => (
          <span className={index < kTile || written ? "is-complete" : index === kTile ? "is-active" : ""} key={index}>
            K tile {index + 1}
          </span>
        ))}
      </div>
      <AnimationControls animation={animation} status={status} />
    </section>
  );
}
