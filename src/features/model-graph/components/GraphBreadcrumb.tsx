import type { MaterializedGraph, OperatorDetail } from "../domain/types";

interface GraphBreadcrumbProps {
  modelLabel: string;
  graph: MaterializedGraph;
  operator: OperatorDetail;
}

export function GraphBreadcrumb({ modelLabel, graph, operator }: GraphBreadcrumbProps) {
  const stage = graph.stages.find((item) => item.stageId === operator.ref.split("/")[0]);
  const module = stage?.modules.find((item) => item.moduleId === operator.ref.split("/")[1]);
  const component = module?.template.components.find(
    (item) => item.componentId === operator.ref.split("/")[2],
  );
  const crumbs = [
    ["Model", modelLabel],
    ["Stage", stage?.label ?? operator.ref.split("/")[0] ?? "Unknown"],
    ["Block/module", module?.label ?? operator.ref.split("/")[1] ?? "Unknown"],
    ...(component ? [["Component", component.label]] : []),
    ["Operator", operator.label],
  ];
  return (
    <nav className="graph-breadcrumb" aria-label="Selected logical operator">
      {crumbs.map(([kind, label], index) => (
        <span className="graph-crumb" key={`${kind}-${label}`}>
          {index ? <i aria-hidden="true">/</i> : null}
          <span>
            <small>{kind}</small>
            <strong>{label}</strong>
          </span>
        </span>
      ))}
    </nav>
  );
}
