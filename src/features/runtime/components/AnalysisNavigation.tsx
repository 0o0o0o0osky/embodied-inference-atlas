import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import { isModelTheory, performanceNavigationPatch, theoryNavigationPatch } from "../domain/analysisNavigation";
import { logicalRefFromEntity } from "../../workbench/entityKeys";

interface AnalysisNavigationProps {
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const ROOFLINE_LEVEL_LABELS: Record<RouteState["rooflineLevel"], string> = {
  overview: "总览",
  stage: "模型阶段",
  atomic: "模型算子",
  fused: "融合算子",
  kernel: "实测 Kernel",
};

export function AnalysisNavigation({ route, navigate }: AnalysisNavigationProps) {
  if (isModelTheory(route)) return (
    <nav className="pi0-performance-navigation" aria-label="模型理论导航">
      <ol className="pi0-performance-breadcrumb">
        <li><span aria-current="page">Roofline · {ROOFLINE_LEVEL_LABELS[route.rooflineLevel]}</span></li>
      </ol>
      <div className="pi0-performance-navigation-actions">
        <RouteLink route={route} navigate={navigate} patch={theoryNavigationPatch(route, "logical")}>返回 DAG{logicalRefFromEntity(route.entity) ? " 与当前算子" : ""}</RouteLink>
      </div>
    </nav>
  );
  const comparison = performanceNavigationPatch("comparison");
  if (!route.runtime) return null;
  return <nav className="pi0-performance-navigation" aria-label="模型性能工作台导航">
    <ol className="pi0-performance-breadcrumb"><li><span aria-current="page">推理栈分析</span></li></ol>
    <div className="pi0-performance-navigation-actions">
      <RouteLink route={route} navigate={navigate} patch={comparison}>← 返回性能对比</RouteLink>
    </div>
  </nav>;
}
