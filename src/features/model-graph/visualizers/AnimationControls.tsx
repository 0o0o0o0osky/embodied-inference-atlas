import type { OperatorAnimation } from "./useOperatorAnimation";

export function AnimationControls({
  animation,
  status,
}: {
  animation: OperatorAnimation;
  status: string;
}) {
  return (
    <div className="operator-animation-controls">
      <button
        type="button"
        onClick={animation.toggle}
        disabled={animation.reducedMotion}
        aria-label={animation.playing ? "Pause computation animation" : "Play computation animation"}
      >
        {animation.playing ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={animation.step}>Step</button>
      <button type="button" onClick={animation.reset}>Reset</button>
      <label>
        <span>Speed</span>
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
        {animation.reducedMotion ? "Timed playback disabled by reduced-motion preference. " : ""}
        {status}
      </p>
    </div>
  );
}
