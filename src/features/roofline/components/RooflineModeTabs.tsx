import type { RoutePatch, RouteState } from "../../../app/routes";
import type { RooflineMode, RooflineLevel } from "../domain/types";
import type { RooflineOverviewItem } from "../presentation/viewModel";

const MODES: readonly { id: RooflineMode; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "stage", label: "Stage" },
  { id: "atomic", label: "Atomic" },
  { id: "fused", label: "Fused" },
  { id: "kernel", label: "Kernel" },
];

export function RooflineModeTabs({
  route,
  overview,
  navigate,
}: {
  route: RouteState;
  overview: readonly RooflineOverviewItem[];
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  const counts = new Map<RooflineLevel, number>(overview.map((item) => [item.level, item.pointIds.length]));
  return (
    <nav className="roofline-mode-tabs" aria-label="Roofline accounting level">
      {MODES.map((mode) => (
        <button
          type="button"
          key={mode.id}
          aria-current={route.rooflineLevel === mode.id ? "page" : undefined}
          onClick={() => navigate({ rooflineLevel: mode.id, basis: null, entity: null })}
        >
          <span>{mode.label}</span>
          {mode.id !== "overview" ? <small>{counts.get(mode.id) ?? 0} points</small> : <small>4 levels</small>}
        </button>
      ))}
    </nav>
  );
}
