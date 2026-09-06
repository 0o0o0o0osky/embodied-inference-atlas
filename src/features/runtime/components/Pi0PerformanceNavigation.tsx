import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import { pi0PerformanceNavigationPatch } from "../domain/pi0PerformanceNavigation";

interface Pi0PerformanceNavigationProps {
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  surface: "runtime" | "timeline" | "roofline" | "kernel";
}

export function Pi0PerformanceNavigation({ route, navigate, surface }: Pi0PerformanceNavigationProps) {
  const comparison = pi0PerformanceNavigationPatch("comparison");
  const isDetail = surface !== "runtime";
  return (
    <nav className="pi0-performance-navigation" aria-label="Pi0 性能工作台导航">
      <ol className="pi0-performance-breadcrumb">
        <li><RouteLink route={route} navigate={navigate} patch={pi0PerformanceNavigationPatch("logical")}>理论 DAG</RouteLink></li>
        <li><span aria-hidden="true">/</span>{isDetail || route.runtime ? (
          <RouteLink route={route} navigate={navigate} patch={comparison}>性能对比</RouteLink>
        ) : <span aria-current="page">性能对比</span>}</li>
        {surface === "roofline" ? (
          <>
            <li><span aria-hidden="true">/</span><span>理论 Roofline</span></li>
            <li><span aria-hidden="true">/</span><span aria-current="page">总览</span></li>
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
