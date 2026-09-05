import type { OperatorAnimation } from "./useOperatorAnimation";
import { useModelText } from "../presentation/ModelDisplay";

export function AnimationControls({
  animation,
  status,
}: {
  animation: OperatorAnimation;
  status: string;
}) {
  const t = useModelText();
  return (
    <div className="operator-animation-controls">
      <button
        type="button"
        onClick={animation.toggle}
        disabled={animation.reducedMotion}
        aria-label={t(animation.playing ? "Pause computation animation" : "Play computation animation")}
      >
        {t(animation.playing ? "Pause" : "Play")}
      </button>
      <button type="button" onClick={animation.step}>{t("Step")}</button>
      <button type="button" onClick={animation.reset}>{t("Reset")}</button>
      <label>
        <span>{t("Speed")}</span>
        <select
          value={animation.speed}
          onChange={(event) => animation.setSpeed(Number(event.target.value))}
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>
      </label>
      <p aria-live="polite">
        {animation.reducedMotion ? t("Timed playback disabled by reduced-motion preference. ") : ""}
        {status}
      </p>
    </div>
  );
}
