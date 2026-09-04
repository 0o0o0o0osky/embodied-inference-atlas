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
  title: string;
  summary: string;
  callout: { label: string; value: string; note: string };
  panelLabel: string;
  diagramLabel: string;
  workloadNote: string;
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
  "grid-rearrange": "4×4 merge",
  "connector-projection": "Project",
  "pad-state": "pad to 32",
  "state-projection": "State token",
  "pair-key-layers": "K layer pairs",
  "pair-value-layers": "V layer pairs",
  "public-action-slice": "slice 32 → 6",
};

const profiles: Readonly<Record<string, ProfileSpec>> = {
  "pi0-logical-v1": {
    presentation: pi0Presentation,
    connectors: "authored",
    title: "Pi0 logical model",
    summary: "One authored dependency diagram. Select a short operator label to inspect its tensors and computation.",
    callout: {
      label: "Required prefix output",
      value: "17 full blocks + L18 K/V tail",
      note: "Logical semantics; runtime work is a later overlay.",
    },
    panelLabel: "Pi0 logical operator graph",
    diagramLabel: "Pi0 logical operator graph with three authored stage columns",
    workloadNote: "Measured native workloads are evidence annotations, not limits on these logical bindings.",
  },
  "pi05-droid-logical-v1": {
    presentation: pi05Presentation,
    connectors: "derived",
    title: "Pi0.5 logical model",
    summary: "The evidenced DROID checkpoint, shown as a prefix pass followed by time-conditioned flow matching.",
    callout: {
      label: "Full prefix execution",
      value: "18 complete layers",
      note: "AdaRMS scale, shift, and gates are conditioned by time; time is not an action token.",
    },
    panelLabel: "Pi0.5 logical operator graph",
    diagramLabel: "Pi0.5 logical operator graph with three authored stage columns",
    workloadNote: "Prompt length is the executed post-tokenization length. Native preprocessing and runtime-executed camera slots remain evidence annotations, not UI limits.",
  },
  "smolvla-base-logical-v1": {
    presentation: smolvlaPresentation,
    connectors: "derived",
    title: "SmolVLA logical model",
    summary: "Vision and language form a cached prefix; eight ordered self/cross expert pairs update the flow state.",
    callout: {
      label: "Action boundary",
      value: "50×32 internal → 50×6 public",
      note: "The public slice is part of the model contract; prefix cache and flow state stay distinct.",
    },
    panelLabel: "SmolVLA logical operator graph",
    diagramLabel: "SmolVLA logical operator graph with four authored stage columns",
    workloadNote: "The saved raw feature declaration is 256×256; policy execution uses 512×512. Editable workload values keep true minima without artificial maxima.",
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
    title: graph.label,
    summary: "Canonical logical operators and declared tensor dependencies.",
    callout: {
      label: "Canonical graph",
      value: graph.graphId,
      note: "Runtime work remains a separate overlay.",
    },
    panelLabel: `${graph.label} logical operator graph`,
    diagramLabel: `${graph.label} logical operator graph`,
    workloadNote: "Editable workload values use their canonical defaults and true minima.",
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
        ? deriveConnectorHints(dag, spec.presentation.connectorHints)
        : spec.presentation.connectorHints,
    },
  };
}
