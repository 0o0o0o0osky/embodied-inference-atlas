import type { OperatorDetail } from "../domain/types";
import { AttentionVisualizer } from "./AttentionVisualizer";
import { GemmVisualizer } from "./GemmVisualizer";
import { PatchVisualizer } from "./PatchVisualizer";
import { SemanticVisualizer } from "./SemanticVisualizer";
import { RmsNormVisualizer } from "./RmsNormVisualizer";

export function OperatorVisualizer({
  operator,
  resetKey,
}: {
  operator: OperatorDetail;
  resetKey: string;
}) {
  if (operator.definitionId === "rms-norm") {
    return <RmsNormVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
  }
  if (operator.visualizer === "gemm") {
    return <GemmVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
  }
  if (operator.visualizer === "attention") {
    return <AttentionVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
  }
  if (operator.visualizer === "conv") {
    return <PatchVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
  }
  return <SemanticVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
}
