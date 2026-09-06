import { useState } from "react";

import type { CrossViewEntityKey } from "../../workbench/entityKeys";
import { isRooflinePlotBlocker, type RooflineViewModel } from "../presentation/viewModel";
import { RooflineChart } from "./RooflineChart";
import { RooflineInspector } from "./RooflineInspector";
import { RooflineTable } from "./RooflineTable";
import { TheoryPointSummary } from "./TheoryPointSummary";

export function RooflineAnalysis({
  model,
  selectedEntityKey,
  onSelect,
  modelTheory = false,
}: {
  model: RooflineViewModel;
  selectedEntityKey: CrossViewEntityKey | null;
  onSelect: (key: CrossViewEntityKey) => void;
  modelTheory?: boolean;
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
  const routeSelectsPoint = model.rows.some((row) => row.selected);
  const defaultPoint = modelTheory && !routeSelectsPoint
    ? model.records.find((point) => point.entity.kind === "model_total") ?? model.inspectorPoint
    : model.inspectorPoint;
  const selectedPoint = focusedPointId
    ? model.records.find((point) => point.point_id === focusedPointId) ?? model.inspectorPoint
    : defaultPoint;
  const declaredPlotBlockers = selectedPoint?.missing.filter((item) => isRooflinePlotBlocker(selectedPoint, item.field)) ?? [];
  const otherEvidence = selectedPoint?.missing.filter((item) => !isRooflinePlotBlocker(selectedPoint, item.field)) ?? [];
  const unplottedSelection = selectedPoint && (focusedPointId !== null || routeSelectsPoint)
    && !model.points.some((point) => point.pointId === selectedPoint.point_id)
    ? {
        label: selectedPoint.entity.label,
        plotBlockers: declaredPlotBlockers.length
          ? declaredPlotBlockers.map((item) => `${item.field}: ${item.reason.replaceAll("_", " ")} — ${item.detail}`)
          : ["derived chart coordinates: no positive, basis-compatible AI and throughput pair is available."],
        otherEvidence: otherEvidence.map((item) => `${item.field}: ${item.reason.replaceAll("_", " ")} — ${item.detail}`),
      }
    : null;
  const select = (entityKey: CrossViewEntityKey, pointId: string) => {
    setFocus({ basisId: model.activeBasis!.basis_id, entityKey, pointId });
    onSelect(entityKey);
  };
  return (
    <div className={`roofline-analysis-grid${modelTheory ? " is-model-theory" : ""}`}>
      <RooflineChart
        title={modelTheory ? model.activeBasis.level === "stage" ? "模型与各阶段的理论上限" : "模型算子的理论上限（融合前）" : model.activeBasis.label}
        modelTheory={modelTheory}
        labelAllPoints={modelTheory && model.activeBasis.level === "stage"}
        curves={model.curves}
        points={model.points}
        reveal={{ key: `${model.activeBasis.basis_id}:${model.activeScenario.scenario_id}`, durationMs: 400 }}
        focusedPointId={focusedPointId ?? (modelTheory ? selectedPoint?.point_id ?? null : null)}
        unplottedSelection={unplottedSelection}
        onSelect={select}
      />
      {modelTheory ? <>
        <TheoryPointSummary point={selectedPoint} />
        <details className="theory-point-details">
          <summary>完整算子数据与所选点依据</summary>
          <RooflineTable rows={model.rows} focusedPointId={focusedPointId} onSelect={select} />
          <RooflineInspector point={selectedPoint} basis={model.activeBasis} scenario={model.activeScenario} ceiling={model.activeCeiling} curves={model.curves} />
        </details>
      </> : <>
        <RooflineInspector point={selectedPoint} basis={model.activeBasis} scenario={model.activeScenario} ceiling={model.activeCeiling} curves={model.curves} />
        <RooflineTable rows={model.rows} focusedPointId={focusedPointId} onSelect={select} />
      </>}
    </div>
  );
}
