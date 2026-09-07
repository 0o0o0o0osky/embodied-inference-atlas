import type { OperatorDetail } from "../domain/types";
import { AttentionVisualizer } from "./AttentionVisualizer";
import { GemmVisualizer } from "./GemmVisualizer";
import { PatchVisualizer } from "./PatchVisualizer";
import {AnalysisPlaceholder} from '../../../components/AnalysisPlaceholder';
import {NormalizationVisualizer} from './NormalizationVisualizer';
import {ElementwiseVisualizer} from './ElementwiseVisualizer';
import {PositionVisualizer} from './PositionVisualizer';
import {LayoutVisualizer} from './LayoutVisualizer';
import {EmbeddingLookupVisualizer} from './EmbeddingLookupVisualizer';
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
  if (operator.definitionId === 'layer-norm') return <NormalizationVisualizer key={resetKey} operator={operator} resetKey={resetKey}/>;
  if (['gelu','silu','residual-add','elementwise-multiply','euler-update','scalar-scale'].includes(operator.definitionId)) return <ElementwiseVisualizer key={resetKey} operator={operator} resetKey={resetKey}/>;
  if (['rope','sinusoidal-time-embedding'].includes(operator.definitionId)) return <PositionVisualizer key={resetKey} operator={operator} resetKey={resetKey}/>;
  if (['concat','reshape','slice','permute-rearrange'].includes(operator.definitionId)) return <LayoutVisualizer key={resetKey} operator={operator} resetKey={resetKey}/>;
  if (operator.definitionId==='token-embedding') return <EmbeddingLookupVisualizer key={resetKey} operator={operator} resetKey={resetKey}/>;
  if (operator.visualizer === "gemm") {
    return <GemmVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
  }
  if (operator.visualizer === "attention") {
    return <AttentionVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
  }
  if (operator.visualizer === "conv") {
    return <PatchVisualizer key={resetKey} operator={operator} resetKey={resetKey} />;
  }
  return <AnalysisPlaceholder title="计算过程" state="not_recorded" detail="此算子的计算步骤尚未填写。"/>;
}
