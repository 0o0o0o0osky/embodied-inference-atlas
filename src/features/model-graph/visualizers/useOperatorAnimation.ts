import { useCallback, useEffect, useState } from "react";

export interface OperatorAnimation {
  frame: number;
  frameCount: number;
  playing: boolean;
  reducedMotion: boolean;
  speed: number;
  toggle: () => void;
  step: () => void;
  reset: () => void;
  seek: (frame: number) => void;
  setSpeed: (speed: number) => void;
}

export function useOperatorAnimation(
  frameCount: number,
  resetKey: string,
): OperatorAnimation {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setPlaying(false);
    setFrame(0);
  }, [resetKey, frameCount]);

  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setTimeout(
      () => setFrame((current) => (current + 1) % frameCount),
      900 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [frame, frameCount, playing, reducedMotion, speed]);

  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  const reset = useCallback(() => {
    setPlaying(false);
    setFrame(0);
  }, []);
  const step = useCallback(() => {
    setPlaying(false);
    setFrame((current) => (current + 1) % frameCount);
  }, [frameCount]);
  const toggle = useCallback(() => {
    if (!reducedMotion) setPlaying((current) => !current);
  }, [reducedMotion]);
  const seek = useCallback((next: number) => {
    setPlaying(false);
    setFrame(Math.max(0, Math.min(frameCount - 1, Math.trunc(next))));
  }, [frameCount]);

  return {
    frame,
    frameCount,
    playing,
    reducedMotion,
    speed,
    toggle,
    step,
    reset,
    seek,
    setSpeed,
  };
}
