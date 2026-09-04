import { useState } from "react";

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
  const [focus, setFocus] = useState<{ basisId: string; entityKey: CrossViewEntityKey; pointId: string } | null>(null);
  if (!model.activeBasis || !model.activeScenario || !model.activeCeiling) {
    return <section className="roofline-empty"><p>Evidence boundary</p><h2>No valid point set</h2><span>{model.warnings[0]?.message ?? "This level has no compatible canonical basis."}</span></section>;
  }
  if (!model.records.length) {
    return <section className="roofline-empty"><p>{model.activeBasis.level} / honest empty state</p><h2>{model.activeBasis.label}</h2><span>{model.warnings.find((warning) => warning.id === "empty-basis")?.message ?? "No points are emitted for this basis."}</span><code>{model.activeBasis.basis_id}</code></section>;
  }
  const focusedPointId = focus?.basisId === model.activeBasis.basis_id
    && focus.entityKey === selectedEntityKey ? focus.pointId : null;
  const selectedPoint = focusedPointId
    ? model.records.find((point) => point.point_id === focusedPointId) ?? model.inspectorPoint
    : model.inspectorPoint;
  const routeSelectsPoint = model.rows.some((row) => row.selected);
  const unplottedSelection = selectedPoint && (focusedPointId !== null || routeSelectsPoint)
    && !model.points.some((point) => point.pointId === selectedPoint.point_id)
    ? {
        label: selectedPoint.entity.label,
        reasons: selectedPoint.missing.length
          ? selectedPoint.missing.map((item) => `${item.field}: ${item.reason.replaceAll("_", " ")} — ${item.detail}`)
          : ["derived chart coordinates: no positive, basis-compatible AI and throughput pair is available."],
      }
    : null;
  const select = (entityKey: CrossViewEntityKey, pointId: string) => {
    setFocus({ basisId: model.activeBasis!.basis_id, entityKey, pointId });
    onSelect(entityKey);
  };
  return (
    <div className="roofline-analysis-grid">
      <RooflineChart
        title={model.activeBasis.label}
        curves={model.curves}
        points={model.points}
        reveal={{ key: `${model.activeBasis.basis_id}:${model.activeScenario.scenario_id}`, durationMs: 400 }}
        focusedPointId={focusedPointId}
        unplottedSelection={unplottedSelection}
        onSelect={select}
      />
      <RooflineInspector point={selectedPoint} basis={model.activeBasis} scenario={model.activeScenario} ceiling={model.activeCeiling} curves={model.curves} />
      <RooflineTable rows={model.rows} focusedPointId={focusedPointId} onSelect={select} />
    </div>
  );
}
