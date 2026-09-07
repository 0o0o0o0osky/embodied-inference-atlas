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

const operatorAliases: Readonly<Record<string, string>> = {
  "patch-project": "Patch",
  "attention-norm": "Norm",
  "query-projection": "Q",
  "key-projection": "K",
  "value-projection": "V",
  attention: "Attn",
  "output-projection": "O",
  "attention-residual": "Add",
  "mlp-norm": "MLP norm",
  "mlp-up-projection": "Up",
  "mlp-gelu": "GELU",
  "mlp-down-projection": "Down",
  "mlp-residual": "Add",
  "gate-projection": "Gate",
  "up-projection": "Up",
  "gate-gelu": "GELU",
  "gate-silu": "SiLU",
  "gate-product": "Mul",
  "down-projection": "Down",
  normalize: "Final norm",
  project: "Project",
  "flatten-views": "reshape",
  "embed-prompt": "Token embed",
  "image-language-concat": "image + text",
  "build-prefix": "concat",
  "query-rope": "Q RoPE",
  "key-rope": "K RoPE",
  "key-cache-output": "K cache",
  "value-cache-output": "V cache",
  "action-projection": "Action",
  "time-embedding": "Sin/Cos",
  "broadcast-time": "broadcast",
  "action-time-concat": "action + time",
  "time-mlp-in": "MLP in",
  "time-silu-in": "SiLU",
  "time-mlp-silu": "SiLU",
  "time-mlp-out": "MLP out",
  "time-silu-out": "SiLU",
  "extract-prefix-key": "Prefix K",
  "extract-prefix-value": "Prefix V",
  "flatten-prefix-key": "flatten K",
  "flatten-prefix-value": "flatten V",
  "key-adapter": "K adapter",
  "value-adapter": "V adapter",
  "rearrange-key-heads": "K heads",
  "rearrange-value-heads": "V heads",
  "key-concat": "K view",
  "value-concat": "V view",
  "rms-norm": "RMSNorm",
  "condition-projection": "condition → 3D",
  "scale-slice": "scale",
  "shift-slice": "shift",
  "gate-slice": "gate",
  "scale-product": "× scale",
  "scale-offset": "1 + scale",
  "shift-add": "+ shift",
  "residual-gate": "× gate",
  "residual-add": "Add",
  "final-rms-norm": "Final RMSNorm",
  "final-condition-projection": "condition → 2D",
  "final-scale-slice": "scale",
  "final-shift-slice": "shift",
  "final-scale-product": "× scale",
  "final-scale-offset": "1 + scale",
  "final-shift-add": "+ shift",
  "final-norm": "Final RMSNorm",
  "velocity-projection": "Velocity",
  "euler-update": "Euler",
  "grid-rearrange": "Patch-grid merge",
  "connector-projection": "Project",
  "connector-scale": "×√DOUT",
  "prompt-scale": "×√D",
  "pad-state": "Zero-pad state",
  "state-projection": "State token",
  "pair-key-layers": "K layer pairs",
  "pair-value-layers": "V layer pairs",
  "public-action-slice": "Public boundary",
};

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
