import { useMemo } from "react";
import type { RoutePatch, RouteState } from "../../../app/routes";
import type { AtlasData, ModelRecord } from "../../../types/atlas";
import { AnalysisPlaceholder } from "../../../components/AnalysisPlaceholder";
import { OperatorTheoryRowsPanel } from "../../model-graph/components/OperatorRooflinePanel";
import { OperatorExecutionEstimate, supportsExecutionEstimate } from "../../model-graph/components/OperatorExecutionEstimate";
import { adaptV1ModelGraph } from "../../model-graph/domain/adaptV1ModelGraph";
import { logicalEntity, logicalRefFromEntity, parseEntityKey, stageEntity } from "../../workbench/entityKeys";
import { createRooflineIndex } from "../data/indexRoofline";
import { serializeInteractiveWorkload } from "../data/materialize";
import { buildOperatorRooflineSummary, materializeCurrentModelRoofline, type Pi0AnalyticalResult } from "../presentation/buildOperatorRooflineSummary";
import { buildRooflineView } from "../presentation/viewModel";
import { RooflineAnalysis } from "./RooflineAnalysis";
import { RooflineBasisBar } from "./RooflineBasisBar";
import { Pi0RooflineOverview } from "./Pi0RooflineOverview";

/** Model theory consumes the same materialized result as the DAG summary and operator drawer. */
export function RooflineView({data, model, route, navigate, result: suppliedResult}: {
  data: AtlasData; model: ModelRecord; route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  result?: Pi0AnalyticalResult;
}) {
  const result = useMemo(() => suppliedResult ?? materializeCurrentModelRoofline({
    data, modelId: model.model_id, workloadBinding: route.workload,
    precisionPathId: route.precision, hardwareId: route.hardware,
  }), [suppliedResult, data, model.model_id, route.workload, route.precision, route.hardware]);
  if (result.status === 'unavailable') return <AnalysisPlaceholder title="当前场景的理论 Roofline 暂不可用" state="not_recorded" detail={result.reason} />;
  if (route.rooflineLevel === 'overview') return <Pi0RooflineOverview data={data} result={result} navigate={navigate} />;

  const slice = result.value;
  const level = route.rooflineLevel === 'stage' ? 'stage' : 'atomic';
  const basis = level === 'stage' ? slice.stageBasis : slice.atomicBasis;
  const points = [...slice.atomicPoints, ...slice.stages, ...(slice.modelTotal ? [slice.modelTotal] : [])];
  const index = createRooflineIndex([slice.ceiling], [slice.scenario], [slice.stageBasis, slice.atomicBasis], points);
  const ref = logicalRefFromEntity(route.entity);
  const entity = parseEntityKey(route.entity);
  const selectedKey = ref ? logicalEntity(ref) : entity?.kind === 'stage' ? stageEntity(entity.modelGraphId, entity.stageId) : null;
  const view = buildRooflineView({modelId:model.model_id, mode:level, basisId:basis.basis_id,
    precisionPathId:slice.scenario.precision_path.precision_path_id,
    runtimeId:null, realizationId:null, captureId:null, compatibilityIssue:null, sparseObservedRunIds:[],
    selectedEntityIds:selectedKey ? [selectedKey] : []}, index);
  const w = slice.scenario.workload;
  const workload = {executedCameraViews:w.executed_camera_views, executedPromptTokens:w.executed_prompt_tokens,
    actionHorizon:w.action_horizon, denoiseSteps:w.denoise_steps};
  const record = data.datasets.model_graphs.find(record => record.model_graph_id === slice.scenario.model_graph_id);
  const graph = record ? adaptV1ModelGraph(record, {V:w.executed_camera_views,L_PROMPT:w.executed_prompt_tokens,T_ACTION:w.action_horizon,N_DENOISE:w.denoise_steps}) : null;
  const prompt = graph?.editableSymbols.find(symbol => symbol.symbol === 'L_PROMPT');
  const detail = level === 'atomic' && ref ? graph?.operatorsByRef.get(ref) ?? null : null;
  const summary = detail ? buildOperatorRooflineSummary(slice, detail.ref) : null;
  const estimate = detail
    ? supportsExecutionEstimate(detail)
      ? <OperatorExecutionEstimate detail={detail} scenario={slice.scenario} ceiling={slice.ceiling} bandwidth={slice.bandwidthCeiling.byte_per_second} />
      : summary ? <OperatorTheoryRowsPanel summary={summary} /> : null
    : null;
  return <section className="roofline-workspace" aria-label="模型理论图表">
    <details className="theory-analysis-settings">
      <summary>输入形状与分析依据 · V{w.executed_camera_views} / P{w.executed_prompt_tokens} / A{w.action_horizon} / N{w.denoise_steps}</summary>
      <RooflineBasisBar model={view} workload={workload}
        workloadBounds={{promptMinimum:prompt?.minimum ?? 1,promptMaximum:prompt?.maximum ?? null}}
        onWorkload={next => navigate({workload:serializeInteractiveWorkload(next),basis:null},true)} />
    </details>
    {estimate ? <div className="theory-operation-expanded">{estimate}</div>
      : <RooflineAnalysis model={view} selectedEntityKey={selectedKey} onSelect={entity => navigate({entity},true)} modelTheory />}
  </section>;
}
