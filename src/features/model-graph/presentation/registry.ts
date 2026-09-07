import { operatorAliases } from "./operatorCatalog";
import type {
  GraphPresentation,
  LogicalDag,
  LogicalRef,
  MaterializedGraph,
} from "../domain/types";
import { deriveConnectorHints } from "./deriveConnectorHints";
import { pi0Presentation } from "./pi0Presentation";
import { pi05Presentation } from "./pi05Presentation";
import { smolvlaPresentation } from "./smolvlaPresentation";

export interface GraphPresentationProfile {
  presentation: GraphPresentation;
  panelLabel: string;
  diagramLabel: string;
}

interface ProfileSpec extends Omit<GraphPresentationProfile, "presentation"> {
  presentation: GraphPresentation;
  connectors: "authored" | "derived";
}



const profiles: Readonly<Record<string, ProfileSpec>> = {
  "pi0-logical-v1": {
    presentation: pi0Presentation,
    connectors: "authored",
    panelLabel: "Pi0 logical operator graph",
    diagramLabel: "Pi0 logical operator graph with three authored stage columns",
  },
  "pi05-droid-logical-v1": {
    presentation: pi05Presentation,
    connectors: "derived",
    panelLabel: "Pi0.5 logical operator graph",
    diagramLabel: "Pi0.5 logical operator graph with three stage columns with a final action output region",
  },
  "smolvla-base-logical-v1": {
    presentation: smolvlaPresentation,
    connectors: "derived",
    panelLabel: "SmolVLA logical operator graph",
    diagramLabel: "SmolVLA logical operator graph with three stage columns with a final action output region",
  },
};

const profilesByGraphOrModel: Readonly<Record<string, ProfileSpec>> = {
  ...profiles,
  pi0: profiles["pi0-logical-v1"]!,
  pi05: profiles["pi05-droid-logical-v1"]!,
  smolvla: profiles["smolvla-base-logical-v1"]!,
};

function aliasesFor(dag: LogicalDag): Record<LogicalRef, string> {
  return Object.fromEntries(
    [...dag.nodes.values()]
      .filter((node) => node.operatorId)
      .map((node) => [node.ref, operatorAliases[node.operatorId!] ?? node.label]),
  );
}

function fallbackSpec(graph: MaterializedGraph, dag: LogicalDag): ProfileSpec {
  return {
    presentation: {
      rowsByStage: Object.fromEntries(
        dag.stageOrder.map((stageId) => [stageId, [...dag.nodes.values()]
          .filter((node) => node.stageId === stageId && node.kind === "operator")
          .map((node) => ({ slots: [node.ref] }))]),
      ),
      boundaryLanes: {},
      aliases: {},
      visualOverrides: {},
      connectorHints: [],
    },
    connectors: "derived",
    panelLabel: `${graph.label} logical operator graph`,
    diagramLabel: `${graph.label} logical operator graph`,
  };
}

export function resolvePresentationProfile(
  graph: MaterializedGraph,
  dag: LogicalDag,
): GraphPresentationProfile {
  const spec = profilesByGraphOrModel[graph.graphId]
    ?? profilesByGraphOrModel[graph.modelId]
    ?? fallbackSpec(graph, dag);
  const { connectors, ...profile } = spec;
  return {
    ...profile,
    presentation: {
      ...spec.presentation,
      aliases: { ...aliasesFor(dag), ...spec.presentation.aliases },
      connectorHints: connectors === "derived"
        ? deriveConnectorHints(dag, spec.presentation.connectorHints, spec.presentation.stageColumns)
        : spec.presentation.connectorHints,
    },
  };
}
