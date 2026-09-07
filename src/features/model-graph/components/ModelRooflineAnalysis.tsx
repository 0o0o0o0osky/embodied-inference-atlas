import { useEffect } from "react";
import type { RoutePatch, RouteState } from "../../../app/routes";
import type { AtlasData, ModelRecord } from "../../../types/atlas";
import { RooflineView } from "../../roofline/components/RooflineView";
import { materializeCurrentModelRoofline } from "../../roofline/presentation/buildOperatorRooflineSummary";
import { AnalysisNavigation } from "../../runtime/components/AnalysisNavigation";

/** Expanded theory remains a subview of the same model workspace and selection. */
export function ModelRooflineAnalysis({data, model, route, navigate}: {
  data: AtlasData; model: ModelRecord; route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  useEffect(() => { window.scrollTo({top: 0, left: 0, behavior: 'instant'}); }, []);
  const result = materializeCurrentModelRoofline({data, modelId: model.model_id,
    workloadBinding: route.workload, precisionPathId: route.precision, hardwareId: route.hardware});
  return <div className="performance-workspace">
    <AnalysisNavigation route={route} navigate={navigate} />
    <section className="pi0-funnel-section pi0-roofline-summary">
      <header className="pi0-funnel-heading"><h3>模型理论 · Roofline</h3></header>
      <nav className="pi0-roofline-levels" aria-label="理论分析层级">
        {([['overview','总览'],['stage','模型阶段'],['atomic','模型算子']] as const).map(([id,label]) =>
          <button key={id} aria-current={route.rooflineLevel === id ? 'page' : undefined}
            onClick={() => navigate({rooflineLevel:id,basis:null})}>{label}</button>)}
      </nav>
      <RooflineView data={data} model={model} route={route} navigate={navigate} result={result} />
    </section>
  </div>;
}
