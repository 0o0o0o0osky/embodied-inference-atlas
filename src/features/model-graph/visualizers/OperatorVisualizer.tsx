import type { OperatorDetail } from "../domain/types";
import { AttentionVisualizer } from "./AttentionVisualizer";
import { GemmVisualizer } from "./GemmVisualizer";
import { PatchVisualizer } from "./PatchVisualizer";
import { SemanticVisualizer } from "./SemanticVisualizer";

export function OperatorVisualizer({
  operator,
  resetKey,
}: {
  operator: OperatorDetail;
  resetKey: string;
}) {
  if (operator.visualizer === "gemm") {
    return <GemmVisualizer operator={operator} resetKey={resetKey} />;
  }
  if (operator.visualizer === "attention") {
    return <AttentionVisualizer operator={operator} resetKey={resetKey} />;
  }
  if (operator.visualizer === "conv") {
    return <PatchVisualizer operator={operator} resetKey={resetKey} />;
  }
  return <SemanticVisualizer operator={operator} resetKey={resetKey} />;
}
