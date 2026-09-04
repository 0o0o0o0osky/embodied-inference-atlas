import type { AtlasData } from "../types/atlas";
import type { RoutePatch, RouteState } from "../app/routes";
import { RouteLink } from "./RouteLink";

interface AtlasHeaderProps {
  data: AtlasData;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const EMPTY_ROUTE: RoutePatch = {
  model: null,
  tab: "logical",
  runtime: null,
  hardware: null,
  workload: null,
  precision: null,
  entity: null,
};

export function AtlasHeader({ data, route, navigate }: AtlasHeaderProps) {
  const { models, runtimes, devices } = data.datasets;

  return (
    <header className="atlas-header">
      <RouteLink
        className="atlas-mark"
        route={route}
        patch={EMPTY_ROUTE}
        navigate={navigate}
        aria-label="Open the model register"
      >
        <span>Embodied inference</span>
        <strong>Atlas</strong>
      </RouteLink>
      <div className="snapshot-status" aria-label="Snapshot inventory">
        <span className="status-lamp" aria-hidden="true" />
        <span className="snapshot-label">Validated offline snapshot</span>
        <dl>
          <div>
            <dt>Models</dt>
            <dd>{models.length}</dd>
          </div>
          <div>
            <dt>Runtimes</dt>
            <dd>{runtimes.length}</dd>
          </div>
          <div>
            <dt>Devices</dt>
            <dd>{devices.length}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
