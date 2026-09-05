import type { OperatorDetail } from "../domain/types";
import { AnimationControls } from "./AnimationControls";
import { useOperatorAnimation } from "./useOperatorAnimation";
import { useModelText } from "../presentation/ModelDisplay";

const phases = [
  "Q @ Kᵀ score tile 1 of 3",
  "Q @ Kᵀ score tile 2 of 3",
  "Q @ Kᵀ score tile 3 of 3",
  "Scale scores and apply the declared mask",
  "Normalize each score row with softmax",
  "P @ V output tile 1 of 3",
  "P @ V output tile 2 of 3",
  "P @ V output tile 3 of 3",
];

export function AttentionVisualizer({ operator, resetKey }: { operator: OperatorDetail; resetKey: string }) {
  const t = useModelText();
  const animation = useOperatorAnimation(phases.length, resetKey);
  const bindings = operator.scopeBindings;
  const queryLength = bindings.SQ ?? bindings.S ?? bindings.T;
  const keyLength = bindings.SKV ?? bindings.S ?? bindings.T;
  const active = animation.frame < 3 ? 0 : animation.frame === 3 ? 1 : animation.frame === 4 ? 2 : 3;
  return (
    <section className="operator-visualizer attention-visualizer">
      <header>
        <h3>{t("Attention tile microscope")}</h3>
        <code>Q @ Kᵀ → softmax → P @ V</code>
      </header>
      <div className="visualizer-dimensions">
        <span>{t("Query")} {queryLength?.toLocaleString() ?? "?"}</span>
        <span>{t("Key/value")} {keyLength?.toLocaleString() ?? "?"}</span>
        <span>{t("Heads")} {bindings.H?.toLocaleString() ?? "?"}</span>
        <span>{t("Head width")} {bindings.HD?.toLocaleString() ?? "?"}</span>
      </div>
      <div className="attention-diagram" aria-label={t("Attention dependency sequence")}>
        {["Q @ Kᵀ", "scale / mask", "softmax → P", "P @ V → O"].map((label, index) => (
          <span className={index < active ? "is-complete" : index === active ? "is-active" : ""} key={label}>
            {t(label)}
          </span>
        ))}
      </div>
      <AnimationControls animation={animation} status={t(phases[animation.frame]!)} />
    </section>
  );
}
