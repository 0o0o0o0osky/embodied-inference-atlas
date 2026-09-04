import type { CrossViewEntityKey } from "../../workbench/entityKeys";
import type { RooflineViewModel } from "../presentation/viewModel";
import { RooflineChart } from "./RooflineChart";
import { RooflineInspector } from "./RooflineInspector";
import { RooflineTable } from "./RooflineTable";

export function RooflineAnalysis({
  model,
  selectedEntityKey,
  onSelect,
}: {
  model: RooflineViewModel;
  selectedEntityKey: CrossViewEntityKey | null;
  onSelect: (key: CrossViewEntityKey) => void;
}) {
  if (!model.activeBasis || !model.activeScenario) {
    return <section className="roofline-empty"><p>Evidence boundary</p><h2>No valid point set</h2><span>{model.warnings[0]?.message ?? "This level has no compatible canonical basis."}</span></section>;
  }
  if (!model.records.length) {
    return <section className="roofline-empty"><p>{model.activeBasis.level} / honest empty state</p><h2>{model.activeBasis.label}</h2><span>{model.warnings.find((warning) => warning.id === "empty-basis")?.message ?? "No points are emitted for this basis."}</span><code>{model.activeBasis.basis_id}</code></section>;
  }
  return (
    <div className="roofline-analysis-grid">
      <RooflineChart
        title={model.activeBasis.label}
        curves={model.curves}
        points={model.points}
        reveal={{ key: `${model.activeBasis.basis_id}:${model.activeScenario.scenario_id}`, durationMs: 400 }}
        selectedEntityKey={selectedEntityKey}
        onSelect={onSelect}
      />
      <RooflineInspector point={model.inspectorPoint} basis={model.activeBasis} scenario={model.activeScenario} />
      <RooflineTable rows={model.rows} onSelect={onSelect} />
    </div>
  );
}
