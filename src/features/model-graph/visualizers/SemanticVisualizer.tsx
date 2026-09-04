import type { OperatorDetail } from "../domain/types";
import { AnimationControls } from "./AnimationControls";
import { useOperatorAnimation } from "./useOperatorAnimation";

function semanticPhases(operator: OperatorDetail): string[] {
  if (operator.definitionId === "euler-update") {
    return ["Read xₖ", "Read velocity vₖ", "Scale by Δt", "Write xₖ₊₁"];
  }
  if (operator.category === "normalization") {
    return ["Read one feature row", "Reduce row statistics", "Normalize and scale", "Write normalized row"];
  }
  if (operator.category === "activation") {
    return ["Read input lane", `Apply ${operator.definitionLabel}`, "Write activated lane"];
  }
  if (operator.category === "shape") {
    return ["Read source axes", "Remap logical indices", "Expose destination view"];
  }
  if (operator.category === "embedding" || operator.category === "position") {
    return ["Read declared input", "Construct embedding coordinates", "Write embedding"];
  }
  return ["Read declared inputs", "Apply operator semantics", "Write declared outputs"];
}

export function SemanticVisualizer({ operator, resetKey }: { operator: OperatorDetail; resetKey: string }) {
  const phases = semanticPhases(operator);
  const animation = useOperatorAnimation(phases.length, resetKey);
  return (
    <section className={`operator-visualizer semantic-visualizer semantic-visualizer--${operator.category}`}>
      <header>
        <h3>{operator.definitionId === "euler-update" ? "Flow update microscope" : `${operator.definitionLabel} explainer`}</h3>
        <code>{operator.formula}</code>
      </header>
      <div className="semantic-diagram" aria-label={`${operator.definitionLabel} logical phases`}>
        {phases.map((phase, index) => (
          <span className={index < animation.frame ? "is-complete" : index === animation.frame ? "is-active" : ""} key={phase}>
            <i>{index + 1}</i>{phase}
          </span>
        ))}
      </div>
      <AnimationControls animation={animation} status={`${phases[animation.frame]}.`} />
    </section>
  );
}
