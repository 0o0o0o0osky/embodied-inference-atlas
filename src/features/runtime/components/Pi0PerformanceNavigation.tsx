import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import { isPi0ModelTheory, pi0PerformanceNavigationPatch, pi0TheoryNavigationPatch } from "../domain/pi0PerformanceNavigation";
import { logicalRefFromEntity } from "../../workbench/entityKeys";

interface Pi0PerformanceNavigationProps {
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  surface: "runtime" | "timeline" | "roofline" | "kernel";
}

const ROOFLINE_LEVEL_LABELS: Record<RouteState["rooflineLevel"], string> = {
  overview: "总览",
  stage: "模型阶段",
  atomic: "模型算子",
  fused: "融合算子",
  kernel: "实测 Kernel",
};

export function Pi0PerformanceNavigation({ route, navigate, surface }: Pi0PerformanceNavigationProps) {
  if (isPi0ModelTheory(route)) return (
    <nav className="pi0-performance-navigation" aria-label="模型理论导航">
      <ol className="pi0-performance-breadcrumb">
        <li><RouteLink route={route} navigate={navigate} patch={pi0TheoryNavigationPatch(route, "logical")}>模型理论 / DAG</RouteLink></li>
        <li><span aria-hidden="true">/</span><span aria-current="page">Roofline · {ROOFLINE_LEVEL_LABELS[route.rooflineLevel]}</span></li>
      </ol>
      <div className="pi0-performance-navigation-actions">
        <RouteLink route={route} navigate={navigate} patch={pi0TheoryNavigationPatch(route, "logical")}>返回 DAG{logicalRefFromEntity(route.entity) ? " 与当前算子" : ""}</RouteLink>
      </div>
    </nav>
  );
  const comparison = pi0PerformanceNavigationPatch("comparison");
  const isDetail = surface !== "runtime";
  return (
    <nav className="pi0-performance-navigation" aria-label="模型性能工作台导航">
      <ol className="pi0-performance-breadcrumb">
        <li><RouteLink route={route} navigate={navigate} patch={pi0PerformanceNavigationPatch("logical")}>模型理论</RouteLink></li>
        <li><span aria-hidden="true">/</span>{isDetail || route.runtime ? (
          <RouteLink route={route} navigate={navigate} patch={comparison}>性能对比</RouteLink>
        ) : <span aria-current="page">性能对比</span>}</li>
        {surface === "roofline" ? (
          <>
            <li><span aria-hidden="true">/</span><span>理论 Roofline</span></li>
            <li><span aria-hidden="true">/</span><span aria-current="page">{ROOFLINE_LEVEL_LABELS[route.rooflineLevel]}</span></li>
          </>
        ) : isDetail ? <li><span aria-hidden="true">/</span><span aria-current="page">{surface === "timeline" ? "Nsys 详情" : "Kernel 详情"}</span></li> : null}
      </ol>
      {isDetail || route.runtime ? <div className="pi0-performance-navigation-actions">
        {isDetail && route.runtime ? <RouteLink route={route} navigate={navigate} patch={pi0PerformanceNavigationPatch("stack")}>← 返回当前推理栈</RouteLink> : null}
        <RouteLink route={route} navigate={navigate} patch={comparison}>← 返回性能对比</RouteLink>
      </div> : null}
    </nav>
  );
}
