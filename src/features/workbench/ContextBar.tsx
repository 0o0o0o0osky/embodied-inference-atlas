import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";

interface ContextBarProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function ContextBar({ data, model, route, navigate }: ContextBarProps) {
  const runtimeKnown = data.datasets.runtimes.some(
    (runtime) => runtime.runtime_id === route.runtime,
  );
  const hardwareKnown = data.datasets.devices.some(
    (device) => device.device_id === route.hardware,
  );

  return (
    <section className="context-bar" aria-label="Workbench context">
      <label>
        <span>Runtime overlay</span>
        <select
          value={route.runtime ?? ""}
          onChange={(event) =>
            navigate({ runtime: event.target.value || null })
          }
        >
          <option value="">Logical model only</option>
          {route.runtime && !runtimeKnown ? (
            <option value={route.runtime}>{route.runtime} (not in snapshot)</option>
          ) : null}
          {data.datasets.runtimes.map((runtime) => {
            const support = runtime.model_support.find(
              (record) => record.model_id === model.model_id,
            );
            return (
              <option key={runtime.runtime_id} value={runtime.runtime_id}>
                {runtime.display_name} ({support?.status ?? "no support record"})
              </option>
            );
          })}
        </select>
      </label>

      <label>
        <span>Hardware</span>
        <select
          value={route.hardware ?? ""}
          onChange={(event) =>
            navigate({ hardware: event.target.value || null })
          }
        >
          <option value="">No hardware selected</option>
          {route.hardware && !hardwareKnown ? (
            <option value={route.hardware}>{route.hardware} (not in snapshot)</option>
          ) : null}
          {data.datasets.devices.map((device) => (
            <option key={device.device_id} value={device.device_id}>
              {device.display_name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Workload binding</span>
        <input
          type="text"
          value={route.workload ?? ""}
          placeholder="canonical-default"
          onChange={(event) =>
            navigate({ workload: event.target.value || null }, true)
          }
        />
      </label>

      <label>
        <span>Precision scenario</span>
        <input
          type="text"
          value={route.precision ?? ""}
          placeholder="dense-bf16"
          onChange={(event) =>
            navigate({ precision: event.target.value || null }, true)
          }
        />
      </label>
    </section>
  );
}
