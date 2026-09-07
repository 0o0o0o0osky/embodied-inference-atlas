import type { ReactNode } from "react";
import type { OperatorAnimation } from "./useOperatorAnimation";
import "./computationStepper.css";

export interface ComputationStep {
  label: string;
  description: ReactNode;
}

/** Shared mathematical walkthrough. Operator-specific shapes and explanations live in each diagram. */
export function ComputationStepper({
  title, formula, dimensions = [], steps, animation, children, className = "", footnote,
}: {
  title: string;
  formula?: string;
  dimensions?: readonly { label: string; value: ReactNode }[];
  steps: readonly ComputationStep[];
  animation: OperatorAnimation;
  children: ReactNode;
  className?: string;
  footnote?: ReactNode;
}) {
  const current = steps[animation.frame];
  return (
    <section className={`computation-stepper ${className}`}>
      <header className="computation-heading">
        <h3>{title}</h3>
        {formula ? <span className="math-expression">{formula}</span> : null}
      </header>
      {dimensions.length ? <dl className="computation-dimensions">
        {dimensions.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl> : null}
      <ol className="computation-steps" aria-label="计算步骤">
        {steps.map((step, index) => <li key={step.label}>
          <button type="button" aria-current={animation.frame === index ? "step" : undefined}
            onClick={() => animation.seek(index)}>
            <span>{index + 1}</span>{step.label}
          </button>
        </li>)}
      </ol>
      <div className="computation-picture">{children}</div>
      <div className="computation-explanation" aria-live="polite">
        <strong>{current?.label}</strong>
        <div>{current?.description}</div>
      </div>
      <div className="computation-playback" aria-label="计算过程播放控制">
        <button type="button" onClick={animation.toggle} disabled={animation.reducedMotion}
          aria-label={animation.playing ? "暂停计算动画" : "播放计算动画"}>
          {animation.playing ? "暂停" : "播放步骤"}
        </button>
        <button type="button" onClick={animation.step}>下一步</button>
        <button type="button" onClick={animation.reset}>从头看</button>
        <span>{animation.frame + 1} / {steps.length}</span>
      </div>
      {footnote ? <details className="computation-reference"><summary>示例说明</summary>{footnote}</details> : null}
    </section>
  );
}
