import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import type { Pi0AnalyticalResult } from "../../roofline/presentation/buildOperatorRooflineSummary";
import { formatTime } from "../../roofline/presentation/viewModel";
import { serializeInteractiveWorkload } from "../../roofline/data/materialize";
import { pi0TheoryNavigationPatch } from "../../runtime/domain/pi0PerformanceNavigation";

export function ModelTheorySummary({ result, route, navigate }: {
  result: Pi0AnalyticalResult;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  const total = result.status === "available" ? result.value.modelTotal : null;
  const scenario = result.status === "available" ? result.value.scenario : null;
  const expansion = {
    ...pi0TheoryNavigationPatch(route, "expanded"),
    ...(scenario ? {
      workload: serializeInteractiveWorkload({
        executedCameraViews: scenario.workload.executed_camera_views,
        executedPromptTokens: scenario.workload.executed_prompt_tokens,
        actionHorizon: scenario.workload.action_horizon,
        denoiseSteps: scenario.workload.denoise_steps,
      }),
      precision: scenario.precision_path.precision_path_id,
      hardware: result.status === "available" ? result.value.atomicBasis.device_id : route.hardware,
    } : {}),
  };
  return <div className="model-theory-summary">
    <span>模型理论下界 <strong>{total?.derived.roof_second != null ? formatTime(total.derived.roof_second) : "暂不可估计"}</strong>
      <small>{result.status === "unavailable" ? result.reason : total?.coverage.status === "complete" ? "完整解析覆盖" : "部分解析覆盖"}</small>
    </span>
    <RouteLink route={route} navigate={navigate} patch={expansion}>展开 Roofline</RouteLink>
  </div>;
}
