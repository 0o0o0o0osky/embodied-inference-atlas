(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
  const pageData = Atlas.readPageData();
  const graph = pageData.model_graph;
  const definitionsById = Object.fromEntries(
    graph.operator_definitions.map((definition) => [definition.definition_id, definition]),
  );
  const blocksById = Object.fromEntries(
    graph.block_templates.map((template) => [template.template_id, template]),
  );
  const componentsById = Object.fromEntries(
    graph.component_templates.map((template) => [template.template_id, template]),
  );
  const targets = {
    summary: document.getElementById("model-summary"),
    controls: document.getElementById("workload-controls"),
    breadcrumb: document.getElementById("graph-breadcrumb"),
    dag: document.getElementById("block-dag"),
    detail: document.getElementById("operator-detail"),
  };
  const state = {
    overrides: {},
    materialized: null,
    selection: { stage: null, module: null, component: null, operator: null },
    animation: null,
  };

  // The figure is intentionally composed like a paper diagram. Nodes placed
  // beside one another are independent branches; dependencies run downward.
  // Names, repeats, and connector validity are resolved after materialization.
  function paperScopedRow(scope, operatorIds, gapBefore = false) {
    const slots = operatorIds.map((operatorId) => (
      operatorId === null ? null : `${scope}/${operatorId}`
    ));
    return gapBefore ? { gapBefore: true, slots } : { slots };
  }

  function paperSerialRows(scope, operatorIds, gapBefore = false) {
    return operatorIds.map((operatorId, index) => (
      paperScopedRow(scope, [operatorId], gapBefore && index === 0)
    ));
  }

  function paperAttentionRows(scope, {
    entry = ["attention-norm"],
    rope = false,
    cacheOutput = false,
    prefixKvViews = false,
  } = {}) {
    const rows = [
      paperScopedRow(scope, entry, true),
      paperScopedRow(scope, ["query-projection", "key-projection", "value-projection"]),
    ];
    if (rope) rows.push(paperScopedRow(scope, ["query-rope", "key-rope", null]));
    if (prefixKvViews) rows.push(paperScopedRow(scope, ["key-concat", "value-concat"]));
    rows.push(cacheOutput
      ? paperScopedRow(scope, [null, "attention", "cache-output"])
      : paperScopedRow(scope, ["attention"]));
    rows.push(
      paperScopedRow(scope, ["output-projection"]),
      paperScopedRow(scope, ["attention-residual"]),
    );
    return rows;
  }

  function paperVitGeluMlpRows(scope) {
    return paperSerialRows(scope, [
      "mlp-norm",
      "mlp-up-projection",
      "mlp-gelu",
      "mlp-down-projection",
      "mlp-residual",
    ], true);
  }

  function paperGatedMlpRows(scope) {
    return [
      paperScopedRow(scope, ["mlp-norm"], true),
      paperScopedRow(scope, ["gate-projection", "up-projection"]),
      paperScopedRow(scope, ["gate-gelu", null]),
      paperScopedRow(scope, ["gate-product"]),
      paperScopedRow(scope, ["down-projection"]),
      paperScopedRow(scope, ["mlp-residual"]),
    ];
  }

  function paperActionHeadRows(scope) {
    return paperSerialRows(scope, [
      "final-norm",
      "select-action-rows",
      "velocity-projection",
      "euler-update",
    ], true);
  }

  function paperCenteredMergeRow(sourceIds, targetId) {
    return { slots: [targetId], centerBetween: sourceIds };
  }

  function paperAlignedRow(sourceId, targetId) {
    return { slots: [targetId], alignTo: sourceId };
  }

  const PI0_PAPER_LAYOUT = Object.freeze({
    "vision-encoder": [
      { slots: ["vision-encoder/image-patch-embedding/patch-project"] },
      ...paperAttentionRows("vision-encoder/vision-blocks/self-attention"),
      ...paperVitGeluMlpRows("vision-encoder/vision-blocks/feed-forward"),
      { gapBefore: true, slots: ["vision-encoder/vision-final-normalization/normalize"] },
      { slots: ["vision-encoder/vision-projector/project"] },
    ],
    "prefix-encoder": [
      { slots: [
        "prefix-encoder/prompt-prefix-builder/flatten-views",
        "prefix-encoder/prompt-prefix-builder/embed-prompt",
      ] },
      { slots: ["prefix-encoder/prompt-prefix-builder/build-prefix"] },
      ...paperAttentionRows("prefix-encoder/prefix-blocks/self-attention", {
        rope: true,
        cacheOutput: true,
      }),
      ...paperGatedMlpRows("prefix-encoder/prefix-blocks/feed-forward"),
    ],
    "action-flow-decoder": [
      { slots: [
        "action-flow-decoder/action-suffix-builder/state-projection",
        "action-flow-decoder/action-suffix-builder/action-projection",
        "action-flow-decoder/action-suffix-builder/time-embedding",
      ] },
      paperCenteredMergeRow([
        "action-flow-decoder/action-suffix-builder/action-projection",
        "action-flow-decoder/action-suffix-builder/time-embedding",
      ], "action-flow-decoder/action-suffix-builder/action-time-concat"),
      paperAlignedRow(
        "action-flow-decoder/action-suffix-builder/action-time-concat",
        "action-flow-decoder/action-suffix-builder/time-mlp-in",
      ),
      paperAlignedRow(
        "action-flow-decoder/action-suffix-builder/action-time-concat",
        "action-flow-decoder/action-suffix-builder/time-mlp-silu",
      ),
      paperAlignedRow(
        "action-flow-decoder/action-suffix-builder/action-time-concat",
        "action-flow-decoder/action-suffix-builder/time-mlp-out",
      ),
      { gapBefore: true, slots: ["action-flow-decoder/action-suffix-builder/suffix-concat"] },
      ...paperAttentionRows("action-flow-decoder/action-expert-blocks/self-attention", {
        entry: ["extract-prefix-key", "attention-norm", "extract-prefix-value"],
        rope: true,
        prefixKvViews: true,
      }),
      ...paperGatedMlpRows("action-flow-decoder/action-expert-blocks/feed-forward"),
      ...paperActionHeadRows("action-flow-decoder/velocity-euler-update"),
    ],
  });

  const PI0_PAPER_BOUNDARY_LAYOUT = Object.freeze({
    "prefix-encoder": Object.freeze({
      input: Object.freeze({
        slotCount: 2,
        lanes: Object.freeze({ "input/prompt-token-ids": 1 }),
      }),
    }),
    "action-flow-decoder": Object.freeze({
      input: Object.freeze({
        slotCount: 3,
        lanes: Object.freeze({
          "input/state": 0,
          "input/initial-noise": 1,
          "control/action-flow-loop/timestep": 2,
        }),
      }),
      loop: Object.freeze({
        slotCount: 3,
        lanes: Object.freeze({ "loop/action-flow-loop": 1 }),
      }),
    }),
  });

  const PAPER_OPERATOR_ALIASES = Object.freeze({
    "patch-project": "Patch",
    "attention-norm": "Norm",
    "query-projection": "Q",
    "key-projection": "K",
    "value-projection": "V",
    attention: "Attn",
    "output-projection": "O",
    "attention-residual": "Add",
    "mlp-norm": "MLP Norm",
    "mlp-up-projection": "Up",
    "mlp-gelu": "GELU",
    "mlp-down-projection": "Down",
    "mlp-residual": "Add",
    normalize: "Final Norm",
    project: "Project",
    "flatten-views": "reshape",
    "embed-prompt": "Token embed",
    "build-prefix": "concat",
    "query-rope": "Q RoPE",
    "key-rope": "K RoPE",
    "cache-output": "Prefix KV",
    "gate-projection": "Gate",
    "up-projection": "Up",
    "gate-gelu": "GELU",
    "gate-product": "Mul",
    "down-projection": "Down",
    "state-projection": "State",
    "action-projection": "Action",
    "time-embedding": "Sin/Cos",
    "action-time-concat": "concat",
    "time-mlp-in": "MLP in",
    "time-mlp-silu": "SiLU",
    "time-mlp-out": "MLP out",
    "suffix-concat": "concat",
    "extract-prefix-key": "Prefix K",
    "extract-prefix-value": "Prefix V",
    "key-concat": "K view",
    "value-concat": "V view",
    "final-norm": "Final RMSNorm",
    "select-action-rows": "Keep action rows",
    "velocity-projection": "Velocity proj",
    "euler-update": "Euler",
  });

  const PAPER_BOUNDARY_ALIASES = Object.freeze({
    "input/images": "Images",
    "input/prompt-token-ids": "Prompt",
    "input/state": "State input",
    "input/initial-noise": "Noise x₀",
    "loop/action-flow-loop": "xₖ",
    "control/action-flow-loop/timestep": "tₖ",
    "output/prefix-stack-output": "Prefix out",
    "output/final-action-state": "Actions",
  });

  const PAPER_NODE_ALIASES = Object.freeze({
    "prefix-encoder/prefix-blocks/self-attention/cache-output": "KVₚ[ℓ]",
    "action-flow-decoder/action-expert-blocks/self-attention/query-projection": "Qₛ",
    "action-flow-decoder/action-expert-blocks/self-attention/key-projection": "Kₛ",
    "action-flow-decoder/action-expert-blocks/self-attention/value-projection": "Vₛ",
    "action-flow-decoder/action-expert-blocks/self-attention/query-rope": "Qₛ RoPE",
    "action-flow-decoder/action-expert-blocks/self-attention/key-rope": "Kₛ RoPE",
  });

  const PI0_PAPER_CONNECTORS = Object.freeze([
    { id: "vision-input", kind: "chain", pairs: [["input/images", "vision-encoder/image-patch-embedding/patch-project"]] },
    { id: "vision-block-entry", kind: "chain", pairs: [["vision-encoder/image-patch-embedding/patch-project", "vision-encoder/vision-blocks/self-attention/attention-norm"]] },
    { id: "vision-patch-residual", kind: "residual", pairs: [["vision-encoder/image-patch-embedding/patch-project", "vision-encoder/vision-blocks/self-attention/attention-residual"]] },
    { id: "vision-qkv", kind: "branch-out", pairs: [
      ["vision-encoder/vision-blocks/self-attention/attention-norm", "vision-encoder/vision-blocks/self-attention/query-projection"],
      ["vision-encoder/vision-blocks/self-attention/attention-norm", "vision-encoder/vision-blocks/self-attention/key-projection"],
      ["vision-encoder/vision-blocks/self-attention/attention-norm", "vision-encoder/vision-blocks/self-attention/value-projection"],
    ] },
    { id: "vision-attn-input", kind: "branch-in", pairs: [
      ["vision-encoder/vision-blocks/self-attention/query-projection", "vision-encoder/vision-blocks/self-attention/attention"],
      ["vision-encoder/vision-blocks/self-attention/key-projection", "vision-encoder/vision-blocks/self-attention/attention"],
      ["vision-encoder/vision-blocks/self-attention/value-projection", "vision-encoder/vision-blocks/self-attention/attention"],
    ] },
    { id: "vision-attn-output", kind: "chain", pairs: [
      ["vision-encoder/vision-blocks/self-attention/attention", "vision-encoder/vision-blocks/self-attention/output-projection"],
      ["vision-encoder/vision-blocks/self-attention/output-projection", "vision-encoder/vision-blocks/self-attention/attention-residual"],
    ] },
    { id: "vision-ffn-entry", kind: "chain", pairs: [["vision-encoder/vision-blocks/self-attention/attention-residual", "vision-encoder/vision-blocks/feed-forward/mlp-norm"]] },
    { id: "vision-ffn-residual", kind: "residual", pairs: [["vision-encoder/vision-blocks/self-attention/attention-residual", "vision-encoder/vision-blocks/feed-forward/mlp-residual"]] },
    { id: "vision-ffn-exit", kind: "chain", pairs: [
      ["vision-encoder/vision-blocks/feed-forward/mlp-norm", "vision-encoder/vision-blocks/feed-forward/mlp-up-projection"],
      ["vision-encoder/vision-blocks/feed-forward/mlp-up-projection", "vision-encoder/vision-blocks/feed-forward/mlp-gelu"],
      ["vision-encoder/vision-blocks/feed-forward/mlp-gelu", "vision-encoder/vision-blocks/feed-forward/mlp-down-projection"],
      ["vision-encoder/vision-blocks/feed-forward/mlp-down-projection", "vision-encoder/vision-blocks/feed-forward/mlp-residual"],
      ["vision-encoder/vision-blocks/feed-forward/mlp-residual", "vision-encoder/vision-final-normalization/normalize"],
      ["vision-encoder/vision-final-normalization/normalize", "vision-encoder/vision-projector/project"],
    ] },
    { id: "vision-prefix", kind: "cross", pairs: [["vision-encoder/vision-projector/project", "prefix-encoder/prompt-prefix-builder/flatten-views"]] },
    { id: "prefix-input", kind: "branch-in", pairs: [
      ["input/prompt-token-ids", "prefix-encoder/prompt-prefix-builder/embed-prompt"],
      ["prefix-encoder/prompt-prefix-builder/flatten-views", "prefix-encoder/prompt-prefix-builder/build-prefix"],
      ["prefix-encoder/prompt-prefix-builder/embed-prompt", "prefix-encoder/prompt-prefix-builder/build-prefix"],
    ] },
    { id: "prefix-block-entry", kind: "chain", pairs: [["prefix-encoder/prompt-prefix-builder/build-prefix", "prefix-encoder/prefix-blocks/self-attention/attention-norm"]] },
    { id: "prefix-block-residual", kind: "residual", pairs: [["prefix-encoder/prompt-prefix-builder/build-prefix", "prefix-encoder/prefix-blocks/self-attention/attention-residual"]] },
    { id: "prefix-qkv", kind: "branch-out", pairs: [
      ["prefix-encoder/prefix-blocks/self-attention/attention-norm", "prefix-encoder/prefix-blocks/self-attention/query-projection"],
      ["prefix-encoder/prefix-blocks/self-attention/attention-norm", "prefix-encoder/prefix-blocks/self-attention/key-projection"],
      ["prefix-encoder/prefix-blocks/self-attention/attention-norm", "prefix-encoder/prefix-blocks/self-attention/value-projection"],
    ] },
    { id: "prefix-rope", kind: "chain", pairs: [
      ["prefix-encoder/prefix-blocks/self-attention/query-projection", "prefix-encoder/prefix-blocks/self-attention/query-rope"],
      ["prefix-encoder/prefix-blocks/self-attention/key-projection", "prefix-encoder/prefix-blocks/self-attention/key-rope"],
    ] },
    { id: "prefix-attn-input", kind: "branch-in", pairs: [
      ["prefix-encoder/prefix-blocks/self-attention/query-rope", "prefix-encoder/prefix-blocks/self-attention/attention"],
      ["prefix-encoder/prefix-blocks/self-attention/key-rope", "prefix-encoder/prefix-blocks/self-attention/attention"],
      ["prefix-encoder/prefix-blocks/self-attention/value-projection", "prefix-encoder/prefix-blocks/self-attention/attention"],
    ] },
    { id: "prefix-cache", kind: "cache", route: "right-to-top", pairs: [
      ["prefix-encoder/prefix-blocks/self-attention/key-rope", "prefix-encoder/prefix-blocks/self-attention/cache-output"],
      ["prefix-encoder/prefix-blocks/self-attention/value-projection", "prefix-encoder/prefix-blocks/self-attention/cache-output"],
    ] },
    { id: "prefix-attn-output", kind: "chain", pairs: [
      ["prefix-encoder/prefix-blocks/self-attention/attention", "prefix-encoder/prefix-blocks/self-attention/output-projection"],
      ["prefix-encoder/prefix-blocks/self-attention/output-projection", "prefix-encoder/prefix-blocks/self-attention/attention-residual"],
    ] },
    { id: "prefix-ffn-entry", kind: "chain", pairs: [["prefix-encoder/prefix-blocks/self-attention/attention-residual", "prefix-encoder/prefix-blocks/feed-forward/mlp-norm"]] },
    { id: "prefix-ffn-residual", kind: "residual", pairs: [["prefix-encoder/prefix-blocks/self-attention/attention-residual", "prefix-encoder/prefix-blocks/feed-forward/mlp-residual"]] },
    { id: "prefix-gate-up", kind: "branch-out", pairs: [
      ["prefix-encoder/prefix-blocks/feed-forward/mlp-norm", "prefix-encoder/prefix-blocks/feed-forward/gate-projection"],
      ["prefix-encoder/prefix-blocks/feed-forward/mlp-norm", "prefix-encoder/prefix-blocks/feed-forward/up-projection"],
    ] },
    { id: "prefix-gate-activation", kind: "chain", pairs: [["prefix-encoder/prefix-blocks/feed-forward/gate-projection", "prefix-encoder/prefix-blocks/feed-forward/gate-gelu"]] },
    { id: "prefix-gated-join", kind: "branch-in", pairs: [
      ["prefix-encoder/prefix-blocks/feed-forward/gate-gelu", "prefix-encoder/prefix-blocks/feed-forward/gate-product"],
      ["prefix-encoder/prefix-blocks/feed-forward/up-projection", "prefix-encoder/prefix-blocks/feed-forward/gate-product"],
    ] },
    { id: "prefix-exit", kind: "chain", pairs: [
      ["prefix-encoder/prefix-blocks/feed-forward/gate-product", "prefix-encoder/prefix-blocks/feed-forward/down-projection"],
      ["prefix-encoder/prefix-blocks/feed-forward/down-projection", "prefix-encoder/prefix-blocks/feed-forward/mlp-residual"],
      ["prefix-encoder/prefix-blocks/feed-forward/mlp-residual", "output/prefix-stack-output"],
    ] },
    { id: "action-inputs", kind: "chain", pairs: [
      ["input/state", "action-flow-decoder/action-suffix-builder/state-projection"],
      ["input/initial-noise", "loop/action-flow-loop"],
    ] },
    { id: "action-loop-local", kind: "chain", pairs: [["loop/action-flow-loop", "action-flow-decoder/action-suffix-builder/action-projection"]] },
    { id: "action-time-control", kind: "chain", pairs: [["control/action-flow-loop/timestep", "action-flow-decoder/action-suffix-builder/time-embedding"]] },
    { id: "action-loop-euler", kind: "rail", side: "right", railInset: 26, sourceOffset: -5, targetOffset: -7, pairs: [["loop/action-flow-loop", "action-flow-decoder/velocity-euler-update/euler-update"]] },
    { id: "action-loop-output", kind: "rail", side: "right", railInset: 14, sourceOffset: 5, pairs: [["loop/action-flow-loop", "output/final-action-state"]] },
    { id: "action-time-input", kind: "branch-in", pairs: [
      ["action-flow-decoder/action-suffix-builder/action-projection", "action-flow-decoder/action-suffix-builder/action-time-concat"],
      ["action-flow-decoder/action-suffix-builder/time-embedding", "action-flow-decoder/action-suffix-builder/action-time-concat"],
    ] },
    { id: "action-time-mlp", kind: "chain", pairs: [
      ["action-flow-decoder/action-suffix-builder/action-time-concat", "action-flow-decoder/action-suffix-builder/time-mlp-in"],
      ["action-flow-decoder/action-suffix-builder/time-mlp-in", "action-flow-decoder/action-suffix-builder/time-mlp-silu"],
      ["action-flow-decoder/action-suffix-builder/time-mlp-silu", "action-flow-decoder/action-suffix-builder/time-mlp-out"],
    ] },
    { id: "action-state-suffix", kind: "rail", side: "left", railInset: 32, pairs: [["action-flow-decoder/action-suffix-builder/state-projection", "action-flow-decoder/action-suffix-builder/suffix-concat"]] },
    { id: "action-token-suffix", kind: "chain", pairs: [["action-flow-decoder/action-suffix-builder/time-mlp-out", "action-flow-decoder/action-suffix-builder/suffix-concat"]] },
    { id: "action-block-entry", kind: "chain", pairs: [["action-flow-decoder/action-suffix-builder/suffix-concat", "action-flow-decoder/action-expert-blocks/self-attention/attention-norm"]] },
    { id: "action-block-residual", kind: "residual", pairs: [["action-flow-decoder/action-suffix-builder/suffix-concat", "action-flow-decoder/action-expert-blocks/self-attention/attention-residual"]] },
    { id: "prefix-kv-action", kind: "cross", pairs: [
      ["prefix-encoder/prefix-blocks/self-attention/cache-output", "action-flow-decoder/action-expert-blocks/self-attention/extract-prefix-key"],
      ["prefix-encoder/prefix-blocks/self-attention/cache-output", "action-flow-decoder/action-expert-blocks/self-attention/extract-prefix-value"],
    ] },
    { id: "action-qkv", kind: "branch-out", pairs: [
      ["action-flow-decoder/action-expert-blocks/self-attention/attention-norm", "action-flow-decoder/action-expert-blocks/self-attention/query-projection"],
      ["action-flow-decoder/action-expert-blocks/self-attention/attention-norm", "action-flow-decoder/action-expert-blocks/self-attention/key-projection"],
      ["action-flow-decoder/action-expert-blocks/self-attention/attention-norm", "action-flow-decoder/action-expert-blocks/self-attention/value-projection"],
    ] },
    { id: "action-rope", kind: "chain", pairs: [
      ["action-flow-decoder/action-expert-blocks/self-attention/query-projection", "action-flow-decoder/action-expert-blocks/self-attention/query-rope"],
      ["action-flow-decoder/action-expert-blocks/self-attention/key-projection", "action-flow-decoder/action-expert-blocks/self-attention/key-rope"],
    ] },
    { id: "action-key-cache", kind: "rail", side: "left", railInset: 22, pairs: [["action-flow-decoder/action-expert-blocks/self-attention/extract-prefix-key", "action-flow-decoder/action-expert-blocks/self-attention/key-concat"]] },
    { id: "action-key-local", kind: "chain", pairs: [["action-flow-decoder/action-expert-blocks/self-attention/key-rope", "action-flow-decoder/action-expert-blocks/self-attention/key-concat"]] },
    { id: "action-value-cache", kind: "rail", side: "right", railInset: 22, pairs: [["action-flow-decoder/action-expert-blocks/self-attention/extract-prefix-value", "action-flow-decoder/action-expert-blocks/self-attention/value-concat"]] },
    { id: "action-value-local", kind: "chain", pairs: [["action-flow-decoder/action-expert-blocks/self-attention/value-projection", "action-flow-decoder/action-expert-blocks/self-attention/value-concat"]] },
    { id: "action-query-attn", kind: "rail", side: "left", railInset: 32, pairs: [["action-flow-decoder/action-expert-blocks/self-attention/query-rope", "action-flow-decoder/action-expert-blocks/self-attention/attention"]] },
    { id: "action-attn-input", kind: "branch-in", route: "top-bus", pairs: [
      ["action-flow-decoder/action-expert-blocks/self-attention/key-concat", "action-flow-decoder/action-expert-blocks/self-attention/attention"],
      ["action-flow-decoder/action-expert-blocks/self-attention/value-concat", "action-flow-decoder/action-expert-blocks/self-attention/attention"],
    ] },
    { id: "action-attn-output", kind: "chain", pairs: [
      ["action-flow-decoder/action-expert-blocks/self-attention/attention", "action-flow-decoder/action-expert-blocks/self-attention/output-projection"],
      ["action-flow-decoder/action-expert-blocks/self-attention/output-projection", "action-flow-decoder/action-expert-blocks/self-attention/attention-residual"],
    ] },
    { id: "action-ffn-entry", kind: "chain", pairs: [["action-flow-decoder/action-expert-blocks/self-attention/attention-residual", "action-flow-decoder/action-expert-blocks/feed-forward/mlp-norm"]] },
    { id: "action-ffn-residual", kind: "residual", pairs: [["action-flow-decoder/action-expert-blocks/self-attention/attention-residual", "action-flow-decoder/action-expert-blocks/feed-forward/mlp-residual"]] },
    { id: "action-gate-up", kind: "branch-out", pairs: [
      ["action-flow-decoder/action-expert-blocks/feed-forward/mlp-norm", "action-flow-decoder/action-expert-blocks/feed-forward/gate-projection"],
      ["action-flow-decoder/action-expert-blocks/feed-forward/mlp-norm", "action-flow-decoder/action-expert-blocks/feed-forward/up-projection"],
    ] },
    { id: "action-gate-activation", kind: "chain", pairs: [["action-flow-decoder/action-expert-blocks/feed-forward/gate-projection", "action-flow-decoder/action-expert-blocks/feed-forward/gate-gelu"]] },
    { id: "action-gated-join", kind: "branch-in", pairs: [
      ["action-flow-decoder/action-expert-blocks/feed-forward/gate-gelu", "action-flow-decoder/action-expert-blocks/feed-forward/gate-product"],
      ["action-flow-decoder/action-expert-blocks/feed-forward/up-projection", "action-flow-decoder/action-expert-blocks/feed-forward/gate-product"],
    ] },
    { id: "action-expert-exit", kind: "chain", pairs: [
      ["action-flow-decoder/action-expert-blocks/feed-forward/gate-product", "action-flow-decoder/action-expert-blocks/feed-forward/down-projection"],
      ["action-flow-decoder/action-expert-blocks/feed-forward/down-projection", "action-flow-decoder/action-expert-blocks/feed-forward/mlp-residual"],
      ["action-flow-decoder/action-expert-blocks/feed-forward/mlp-residual", "action-flow-decoder/velocity-euler-update/final-norm"],
    ] },
    { id: "action-head", kind: "chain", pairs: [
      ["action-flow-decoder/velocity-euler-update/final-norm", "action-flow-decoder/velocity-euler-update/select-action-rows"],
      ["action-flow-decoder/velocity-euler-update/select-action-rows", "action-flow-decoder/velocity-euler-update/velocity-projection"],
      ["action-flow-decoder/velocity-euler-update/velocity-projection", "action-flow-decoder/velocity-euler-update/euler-update"],
    ] },
    { id: "euler-feedback", kind: "feedback", railOffset: 6, sourceOffset: 7, pairs: [["action-flow-decoder/velocity-euler-update/euler-update", "loop/action-flow-loop"]] },
  ]);

  class ExpressionError extends Error {
    constructor(message, symbol) {
      super(message);
      this.name = "ExpressionError";
      this.symbol = symbol || null;
    }
  }

  function finiteNumber(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ExpressionError(`${label} must be a finite number`);
    }
    return value;
  }

  function nonNegativeInteger(value, label) {
    const number = finiteNumber(value, label);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new ExpressionError(`${label} must be a non-negative integer`);
    }
    return number;
  }

  function evaluateExpression(expression, bindings) {
    if (typeof expression === "number") return finiteNumber(expression, "expression");
    if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
      throw new ExpressionError("expression must be a finite number or expression object");
    }
    const keys = Object.keys(expression).sort();
    if (keys.length === 1 && keys[0] === "symbol") {
      const symbol = expression.symbol;
      if (typeof symbol !== "string" || !symbol) throw new ExpressionError("symbol must be a non-empty string");
      if (!Object.prototype.hasOwnProperty.call(bindings, symbol)) {
        throw new ExpressionError(`unknown symbol: ${symbol}`, symbol);
      }
      const value = bindings[symbol];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ExpressionError(`binding ${symbol} must be a finite number`, symbol);
      }
      return value;
    }
    if (keys.length !== 2 || keys[0] !== "args" || keys[1] !== "op" || !Array.isArray(expression.args)) {
      throw new ExpressionError("expression object must be a symbol or op/args pair");
    }
    const values = expression.args.map((argument) => evaluateExpression(argument, bindings));
    let result;
    switch (expression.op) {
      case "add":
        if (values.length < 2) throw new ExpressionError("add requires at least two arguments");
        result = values.reduce((total, value) => total + value, 0);
        break;
      case "sub":
        if (values.length !== 2) throw new ExpressionError("sub requires exactly two arguments");
        result = values[0] - values[1];
        break;
      case "mul":
        if (values.length < 2) throw new ExpressionError("mul requires at least two arguments");
        result = values.reduce((total, value) => total * value, 1);
        break;
      case "div":
        if (values.length !== 2) throw new ExpressionError("div requires exactly two arguments");
        if (values[1] === 0) throw new ExpressionError("division by zero");
        result = values[0] / values[1];
        break;
      case "ceil_div":
        if (values.length !== 2) throw new ExpressionError("ceil_div requires exactly two arguments");
        if (values[1] === 0) throw new ExpressionError("division by zero");
        result = Math.ceil(values[0] / values[1]);
        break;
      default:
        throw new ExpressionError("unknown expression operation");
    }
    return finiteNumber(result, "expression result");
  }

  function expressionSymbols(expression) {
    if (typeof expression === "number") return [];
    if (!expression || typeof expression !== "object" || Array.isArray(expression)) return [];
    if (Object.keys(expression).length === 1 && typeof expression.symbol === "string") {
      return [expression.symbol];
    }
    if (!Array.isArray(expression.args)) return [];
    return [...new Set(expression.args.flatMap(expressionSymbols))];
  }

  function recordExpressionError(error, unresolved) {
    if (error instanceof ExpressionError && error.symbol) unresolved.add(error.symbol);
    else unresolved.add(error.message || "invalid expression");
  }

  function safelyEvaluateCount(expression, bindings, unresolved, label) {
    try {
      return nonNegativeInteger(evaluateExpression(expression, bindings), label);
    } catch (error) {
      recordExpressionError(error, unresolved);
      return null;
    }
  }

  function resolveGlobalSymbols(symbols, overrides, unresolved) {
    const entries = Object.fromEntries(symbols.map((item) => [item.symbol, item]));
    const resolved = {};
    const resolving = [];

    function resolve(symbol) {
      if (Object.prototype.hasOwnProperty.call(resolved, symbol)) return resolved[symbol];
      const item = entries[symbol];
      if (!item || resolving.includes(symbol)) {
        unresolved.add(symbol);
        return null;
      }
      resolving.push(symbol);
      let value = null;
      if (item.expression === null) {
        value = Object.prototype.hasOwnProperty.call(overrides, symbol) ? overrides[symbol] : item.default;
        try {
          value = nonNegativeInteger(value, `symbol ${symbol}`);
        } catch (error) {
          value = null;
        }
        if (
          value === null
          || value < item.minimum
          || (item.maximum !== null && value > item.maximum)
          || value > MAX_SAFE_INTEGER
        ) {
          unresolved.add(symbol);
          value = null;
        }
      } else {
        const references = expressionSymbols(item.expression);
        const localBindings = Object.fromEntries(references.map((name) => [name, resolve(name)]));
        value = safelyEvaluateCount(item.expression, localBindings, unresolved, `symbol ${symbol}`);
      }
      resolving.pop();
      resolved[symbol] = value;
      return value;
    }

    symbols.forEach((item) => resolve(item.symbol));
    return resolved;
  }

  function evaluateBindings(bindings, parameters, environment, unresolved) {
    const actual = Object.fromEntries((bindings || []).map((item) => [item.symbol, item]));
    return Object.fromEntries((parameters || []).map((symbol) => {
      if (!actual[symbol]) {
        unresolved.add(symbol);
        return [symbol, null];
      }
      return [
        symbol,
        safelyEvaluateCount(actual[symbol].expression, environment, unresolved, `binding ${symbol}`),
      ];
    }));
  }

  function materializeTensors(tensors, environment, unresolved) {
    return (tensors || []).map((tensor) => {
      const tensorUnresolved = new Set();
      const shape = tensor.axes.map((axis) => safelyEvaluateCount(
        axis.expression,
        environment,
        tensorUnresolved,
        `tensor ${tensor.tensor_id} axis ${axis.axis}`,
      ));
      tensorUnresolved.forEach((symbol) => unresolved.add(symbol));
      return { ...tensor, shape, unresolved_symbols: [...tensorUnresolved] };
    });
  }

  function materializePorts(ports, tensorsById) {
    return (ports || []).map((port) => ({
      ...port,
      tensor: tensorsById[port.tensor_id] || null,
      shape: tensorsById[port.tensor_id] ? tensorsById[port.tensor_id].shape : null,
    }));
  }

  function materializeAtomicTemplate(template, environment, effectiveRepeat, keyPrefix, operatorsById, unresolved) {
    const tensors = materializeTensors(template.tensors, environment, unresolved);
    const tensorsById = Object.fromEntries(tensors.map((tensor) => [tensor.tensor_id, tensor]));
    const operators = template.operators.map((operator) => {
      const operatorUnresolved = new Set();
      const definition = definitionsById[operator.definition_id];
      const multiplicity = safelyEvaluateCount(
        operator.multiplicity,
        environment,
        operatorUnresolved,
        `operator ${operator.operator_id} multiplicity`,
      );
      const bindings = evaluateBindings(
        operator.bindings,
        definition ? definition.parameters : [],
        environment,
        operatorUnresolved,
      );
      const analysis = (definition ? definition.analysis : []).map((metric) => ({
        ...metric,
        value: safelyEvaluateCount(
          metric.expression,
          bindings,
          operatorUnresolved,
          `analysis ${metric.metric}`,
        ),
      }));
      const key = `${keyPrefix}/${operator.operator_id}`;
      const operatorCopy = {
        ...operator,
        bindings,
        multiplicity,
        analysis,
        analysis_by_metric: Object.fromEntries(analysis.map((metric) => [metric.metric, metric.value])),
        effective_repeat: multiplicity === null || effectiveRepeat === null ? null : effectiveRepeat * multiplicity,
        definition,
        key,
        input_tensors: materializePorts(operator.inputs, tensorsById),
        output_tensors: materializePorts(operator.outputs, tensorsById),
        scope_bindings: { ...environment },
        unresolved_symbols: [...operatorUnresolved],
      };
      operatorCopy.input_tensors.concat(operatorCopy.output_tensors).forEach((port) => {
        (port.tensor ? port.tensor.unresolved_symbols : []).forEach((symbol) => operatorUnresolved.add(symbol));
      });
      operatorCopy.unresolved_symbols = [...operatorUnresolved];
      operatorUnresolved.forEach((symbol) => unresolved.add(symbol));
      operatorsById[key] = operatorCopy;
      return operatorCopy;
    });
    return { ...template, tensors, operators };
  }

  function materializeGraph(overrides) {
    const unresolved = new Set();
    const globals = resolveGlobalSymbols(graph.shape_symbols, overrides, unresolved);
    const graphTensors = materializeTensors(graph.graph_tensors, globals, unresolved);
    const graphTensorsById = Object.fromEntries(graphTensors.map((tensor) => [tensor.tensor_id, tensor]));
    const operatorsById = {};
    const namedRepeats = {};
    const stages = graph.stages.map((stage) => {
      const stageRepeat = safelyEvaluateCount(
        stage.repeat,
        globals,
        unresolved,
        `stage ${stage.stage_id} repeat`,
      );
      const modules = stage.modules.map((module) => {
        const template = blocksById[module.template_id];
        const moduleRepeat = safelyEvaluateCount(
          module.repeat,
          globals,
          unresolved,
          `module ${module.module_id} repeat`,
        );
        const effectiveRepeat = stageRepeat === null || moduleRepeat === null ? null : stageRepeat * moduleRepeat;
        const moduleBindings = evaluateBindings(module.bindings, template.parameters, globals, unresolved);
        namedRepeats[module.module_id] = effectiveRepeat;
        const blockTensors = materializeTensors(template.tensors, moduleBindings, unresolved);
        const blockTensorsById = Object.fromEntries(blockTensors.map((tensor) => [tensor.tensor_id, tensor]));
        const keyPrefix = `${stage.stage_id}/${module.module_id}`;
        let templateCopy;
        if (template.operators.length) {
          templateCopy = materializeAtomicTemplate(
            template,
            moduleBindings,
            effectiveRepeat,
            keyPrefix,
            operatorsById,
            unresolved,
          );
        } else {
          const components = template.components.map((component) => {
            const componentTemplate = componentsById[component.template_id];
            const componentBindings = evaluateBindings(
              component.bindings,
              componentTemplate.parameters,
              moduleBindings,
              unresolved,
            );
            return {
              ...component,
              bindings: componentBindings,
              inputs: materializePorts(component.inputs, blockTensorsById),
              outputs: materializePorts(component.outputs, blockTensorsById),
              template: materializeAtomicTemplate(
                componentTemplate,
                componentBindings,
                effectiveRepeat,
                `${keyPrefix}/${component.component_id}`,
                operatorsById,
                unresolved,
              ),
            };
          });
          templateCopy = { ...template, tensors: blockTensors, components };
        }
        return {
          ...module,
          bindings: moduleBindings,
          module_repeat: moduleRepeat,
          effective_repeat: effectiveRepeat,
          inputs: materializePorts(module.inputs, graphTensorsById),
          outputs: materializePorts(module.outputs, graphTensorsById),
          template: templateCopy,
        };
      });
      return { ...stage, stage_repeat: stageRepeat, modules };
    });
    return {
      ...graph,
      bindings: globals,
      graph_tensors: graphTensors,
      graph_inputs: graph.graph_inputs.map((tensorId) => graphTensorsById[tensorId]),
      graph_outputs: graph.graph_outputs.map((tensorId) => graphTensorsById[tensorId]),
      stages,
      named_repeats: namedRepeats,
      operators_by_id: operatorsById,
      unresolved_symbols: [...unresolved],
    };
  }

  function selectedStage() {
    return state.materialized.stages.find((stage) => stage.stage_id === state.selection.stage);
  }

  function selectedModule() {
    const stage = selectedStage();
    return stage && stage.modules.find((module) => module.module_id === state.selection.module);
  }

  function selectedComponent() {
    const module = selectedModule();
    return module && (module.template.components || []).find(
      (component) => component.component_id === state.selection.component,
    );
  }

  function operatorKey(selection) {
    return [selection.stage, selection.module, selection.component, selection.operator].filter(Boolean).join("/");
  }

  function selectedOperator() {
    return state.materialized.operators_by_id[operatorKey(state.selection)] || null;
  }

  function operatorsFor(module, component) {
    if (!module) return [];
    return component ? component.template.operators : module.template.operators;
  }

  function normalizedSelection(candidate) {
    const stage = state.materialized.stages.find((item) => item.stage_id === candidate.stage)
      || state.materialized.stages[0];
    const module = stage.modules.find((item) => item.module_id === candidate.module) || stage.modules[0];
    const components = module.template.components || [];
    const component = components.length
      ? components.find((item) => item.component_id === candidate.component) || components[0]
      : null;
    const operators = operatorsFor(module, component);
    const operator = operators.find((item) => item.operator_id === candidate.operator) || operators[0];
    return {
      stage: stage.stage_id,
      module: module.module_id,
      component: component ? component.component_id : null,
      operator: operator ? operator.operator_id : null,
    };
  }

  function selectionFromHash() {
    const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return {
      stage: parameters.get("stage"),
      module: parameters.get("module"),
      component: parameters.get("component"),
      operator: parameters.get("operator"),
    };
  }

  function syncHash() {
    const parameters = new URLSearchParams();
    ["stage", "module", "component", "operator"].forEach((key) => {
      if (state.selection[key]) parameters.set(key, state.selection[key]);
    });
    const nextHash = `#${parameters.toString()}`;
    if (window.location.hash !== nextHash) window.history.replaceState(null, "", nextHash);
  }

  function select(candidate) {
    cancelAnimation();
    state.selection = normalizedSelection(candidate);
    updateDagSelection();
    renderBreadcrumb();
    renderOperatorDetail();
    syncHash();
  }

  function updateDagSelection() {
    const selectedKey = operatorKey(state.selection);
    const adjacent = new Set();
    targets.dag.querySelectorAll(".dag-connector-segment").forEach((connector) => {
      const sources = (connector.getAttribute("data-source-ids") || "").split(" ").filter(Boolean);
      const targets = (connector.getAttribute("data-target-ids") || "").split(" ").filter(Boolean);
      const incident = Boolean(selectedKey) && (sources.includes(selectedKey) || targets.includes(selectedKey));
      connector.classList.toggle("is-incident", incident);
      connector.classList.toggle("is-muted", Boolean(selectedKey) && !incident);
      if (incident && connector.classList.contains("dag-connector-pair")) {
        sources.concat(targets).forEach((nodeId) => {
          if (nodeId !== selectedKey) adjacent.add(nodeId);
        });
      }
    });
    targets.dag.querySelectorAll(".dag-node--operator").forEach((node) => {
      const nodeId = node.getAttribute("data-node-id");
      node.classList.toggle("is-selected", nodeId === selectedKey);
      node.classList.toggle("is-related", adjacent.has(nodeId));
    });
  }

  function renderSummary() {
    Atlas.clear(targets.summary);
    const model = pageData.model;
    const facts = Atlas.element("dl", { className: "model-summary-grid" });
    [
      ["Model type", model.model_type],
      ["Input → output", `${model.input_modalities.join(" + ")} → ${model.output_modalities.join(" + ")}`],
      ["Logical graph", `${graph.model_graph_id} · v${graph.version}`],
    ].forEach(([label, value]) => facts.appendChild(modelSummaryFact(label, value)));
    targets.summary.append(
      Atlas.element("p", { className: "section-kicker", text: "Model identity" }),
      Atlas.element("h2", { text: model.display_name }),
      facts,
    );
  }

  function modelSummaryFact(label, value) {
    const fact = Atlas.element("div", { className: "model-summary-fact" });
    fact.append(Atlas.element("dt", { text: label }), Atlas.element("dd", { text: value }));
    return fact;
  }

  function validatedControlValue(item, value) {
    try {
      const count = nonNegativeInteger(value, `symbol ${item.symbol}`);
      if (count < item.minimum || (item.maximum !== null && count > item.maximum)) {
        return state.overrides[item.symbol];
      }
      return count;
    } catch (error) {
      return state.overrides[item.symbol];
    }
  }

  function renderControls() {
    Atlas.clear(targets.controls);
    const controls = Atlas.element("div", { className: "workload-control-grid" });
    graph.shape_symbols.filter((item) => item.editable).forEach((item) => {
      const label = Atlas.element("label", { className: "workload-control" });
      const title = Atlas.element("span", { className: "workload-control-label", text: item.label });
      const input = Atlas.element("input");
      input.type = "number";
      input.id = `workload-${item.symbol.toLowerCase().replaceAll("_", "-")}`;
      input.dataset.symbol = item.symbol;
      input.min = String(item.minimum);
      if (item.maximum !== null) input.max = String(item.maximum);
      input.step = "1";
      input.value = String(state.overrides[item.symbol]);
      input.addEventListener("change", () => {
        const enteredValue = input.value.trim() ? Number(input.value) : NaN;
        const nextValue = validatedControlValue(item, enteredValue);
        state.overrides[item.symbol] = nextValue;
        input.value = String(nextValue);
        recompute();
      });
      const range = item.maximum === null
        ? `${item.symbol} ≥ ${item.minimum}`
        : `${item.symbol} · ${item.minimum}–${item.maximum}`;
      label.append(title, input, Atlas.element("small", { text: range }));
      controls.appendChild(label);
    });
    const derived = Atlas.element("div", { className: "derived-symbols" });
    derived.id = "derived-symbols";
    targets.controls.append(controls, derived);
    renderDerivedSymbols();
  }

  function renderDerivedSymbols() {
    const target = document.getElementById("derived-symbols");
    if (!target || !state.materialized) return;
    Atlas.clear(target);
    target.appendChild(Atlas.element("h3", { text: "Derived sequence lengths" }));
    graph.shape_symbols.filter((item) => item.expression !== null).forEach((item) => {
      const value = state.materialized.bindings[item.symbol];
      const chip = Atlas.element("span", { className: "derived-symbol" });
      chip.append(
        Atlas.element("strong", { text: item.symbol }),
        Atlas.element("span", { text: value === null ? "unresolved" : Atlas.format(value, 0) }),
      );
      target.appendChild(chip);
    });
  }

  function svgElement(tagName, attributes, text) {
    const element = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes || {}).forEach(([name, value]) => {
      if (value !== null && value !== undefined) element.setAttribute(name, String(value));
    });
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function findTensor(template, tensorId) {
    return (template.tensors || []).find((tensor) => tensor.tensor_id === tensorId) || null;
  }

  function resolveTemplateProducer(template, endpoint, prefix) {
    if (!endpoint) return [];
    if (endpoint.node_kind === "operator") return [`${prefix}/${endpoint.node_id}`];
    if (endpoint.node_kind !== "component") return [];
    const component = (template.components || []).find(
      (item) => item.component_id === endpoint.node_id,
    );
    if (!component) return [];
    const port = (component.template.output_ports || []).find(
      (item) => item.port === endpoint.port,
    );
    if (!port) return [];
    return resolveTensorProducers(
      component.template,
      port.tensor_id,
      `${prefix}/${component.component_id}`,
    );
  }

  function resolveTemplateConsumer(template, endpoint, prefix) {
    if (!endpoint) return [];
    if (endpoint.node_kind === "operator") return [`${prefix}/${endpoint.node_id}`];
    if (endpoint.node_kind !== "component") return [];
    const component = (template.components || []).find(
      (item) => item.component_id === endpoint.node_id,
    );
    if (!component) return [];
    const port = (component.template.input_ports || []).find(
      (item) => item.port === endpoint.port,
    );
    if (!port) return [];
    return resolveTensorConsumers(
      component.template,
      port.tensor_id,
      `${prefix}/${component.component_id}`,
    );
  }

  function resolveTensorProducers(template, tensorId, prefix) {
    const tensor = findTensor(template, tensorId);
    return tensor ? resolveTemplateProducer(template, tensor.producer, prefix) : [];
  }

  function resolveTensorConsumers(template, tensorId, prefix) {
    const tensor = findTensor(template, tensorId);
    if (!tensor) return [];
    return (tensor.consumers || []).flatMap(
      (endpoint) => resolveTemplateConsumer(template, endpoint, prefix),
    );
  }

  function buildDagModel() {
    const nodes = new Map();
    const edges = [];
    const edgeKeys = new Set();
    const scopes = [];
    let order = 0;

    function addNode(node) {
      if (!nodes.has(node.id)) nodes.set(node.id, { ...node, order: order += 1 });
    }

    function addEdge(source, target, tensor, kind, labelOverride) {
      if (!source || !target || source === target) return;
      const key = `${source}|${target}|${tensor ? tensor.tensor_id : labelOverride}|${kind || "tensor"}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({
        source,
        target,
        tensor: tensor || null,
        kind: kind || "tensor",
      });
    }

    function addTemplateNodes(stage, module) {
      const modulePrefix = `${stage.stage_id}/${module.module_id}`;
      const moduleNodeIds = [];
      if ((module.template.operators || []).length) {
        module.template.operators.forEach((operator) => {
          addNode({
            id: operator.key,
            kind: "operator",
            label: operator.label,
            definitionId: operator.definition_id,
            category: operator.definition.category,
            operator,
            stageId: stage.stage_id,
            moduleId: module.module_id,
            componentId: null,
          });
          moduleNodeIds.push(operator.key);
        });
      } else {
        (module.template.components || []).forEach((component) => {
          const componentNodeIds = [];
          component.template.operators.forEach((operator) => {
            addNode({
              id: operator.key,
              kind: "operator",
              label: operator.label,
              definitionId: operator.definition_id,
              category: operator.definition.category,
              operator,
              stageId: stage.stage_id,
              moduleId: module.module_id,
              componentId: component.component_id,
            });
            componentNodeIds.push(operator.key);
            moduleNodeIds.push(operator.key);
          });
          scopes.push({
            kind: "component",
            label: component.label,
            stageId: stage.stage_id,
            moduleId: module.module_id,
            nodeIds: componentNodeIds,
          });
        });
      }
      if (module.module_repeat > 1) {
        scopes.push({
          kind: "transformer",
          label: `${module.label} ×${Atlas.format(module.module_repeat, 0)}`,
          stageId: stage.stage_id,
          moduleId: module.module_id,
          nodeIds: moduleNodeIds,
        });
      } else if (moduleNodeIds.length > 1) {
        scopes.push({
          kind: "module",
          label: module.label,
          stageId: stage.stage_id,
          moduleId: module.module_id,
          nodeIds: moduleNodeIds,
        });
      }
      return modulePrefix;
    }

    function addTemplateEdges(template, prefix) {
      (template.tensors || []).forEach((tensor) => {
        const sources = resolveTemplateProducer(template, tensor.producer, prefix);
        const consumers = (tensor.consumers || []).flatMap(
          (endpoint) => resolveTemplateConsumer(template, endpoint, prefix),
        );
        sources.forEach((source) => consumers.forEach(
          (target) => addEdge(source, target, tensor, "tensor"),
        ));
      });
      (template.components || []).forEach((component) => {
        addTemplateEdges(component.template, `${prefix}/${component.component_id}`);
      });
    }

    const modulesById = new Map();
    state.materialized.stages.forEach((stage) => {
      stage.modules.forEach((module) => {
        modulesById.set(module.module_id, { stage, module });
        const prefix = addTemplateNodes(stage, module);
        addTemplateEdges(module.template, prefix);
      });
    });

    function moduleProducer(endpoint) {
      const context = modulesById.get(endpoint.node_id);
      if (!context) return [];
      const port = (context.module.template.output_ports || []).find(
        (item) => item.port === endpoint.port,
      );
      return port
        ? resolveTensorProducers(
          context.module.template,
          port.tensor_id,
          `${context.stage.stage_id}/${context.module.module_id}`,
        )
        : [];
    }

    function moduleConsumers(endpoint) {
      const context = modulesById.get(endpoint.node_id);
      if (!context) return [];
      const port = (context.module.template.input_ports || []).find(
        (item) => item.port === endpoint.port,
      );
      return port
        ? resolveTensorConsumers(
          context.module.template,
          port.tensor_id,
          `${context.stage.stage_id}/${context.module.module_id}`,
        )
        : [];
    }

    function ensureLoopNode(endpoint) {
      const stage = state.materialized.stages.find(
        (item) => item.loop_carried && item.loop_carried.loop_id === endpoint.node_id,
      );
      const control = stage && (stage.loop_carried.iteration_controls || []).find(
        (item) => item.port === endpoint.port,
      );
      const id = control
        ? `control/${endpoint.node_id}/${endpoint.port}`
        : `loop/${endpoint.node_id}`;
      addNode({
        id,
        kind: control ? "control" : "loop",
        label: control ? endpoint.port : "Denoise state",
        definitionId: control ? control.formula_display : "loop state",
        stageId: stage ? stage.stage_id : "action-flow-decoder",
        moduleId: null,
        componentId: null,
      });
      return [id];
    }

    function graphProducers(endpoint) {
      if (!endpoint) return [];
      if (endpoint.node_kind === "module") return moduleProducer(endpoint);
      if (endpoint.node_kind === "loop") return ensureLoopNode(endpoint);
      return [];
    }

    function graphConsumers(endpoint) {
      if (!endpoint) return [];
      if (endpoint.node_kind === "module") return moduleConsumers(endpoint);
      if (endpoint.node_kind === "loop") return ensureLoopNode(endpoint);
      return [];
    }

    state.materialized.graph_tensors.forEach((tensor) => {
      let sources = graphProducers(tensor.producer);
      let consumers = (tensor.consumers || []).flatMap(graphConsumers);
      if (!sources.length) {
        const firstConsumer = consumers.map((id) => nodes.get(id)).find(Boolean);
        const stageId = firstConsumer ? firstConsumer.stageId : state.materialized.stages[0].stage_id;
        const id = `input/${tensor.tensor_id}`;
        addNode({
          id,
          kind: "input",
          label: tensor.label,
          definitionId: "model input",
          stageId,
          moduleId: null,
          componentId: null,
        });
        sources = [id];
      }
      if (!consumers.length) {
        const firstSource = sources.map((id) => nodes.get(id)).find(Boolean);
        const id = `output/${tensor.tensor_id}`;
        addNode({
          id,
          kind: "output",
          label: tensor.label,
          definitionId: "model output",
          stageId: firstSource ? firstSource.stageId : state.materialized.stages.at(-1).stage_id,
          moduleId: null,
          componentId: null,
        });
        consumers = [id];
      }
      const feedback = (tensor.consumers || []).some(
        (endpoint) => endpoint.node_kind === "loop" && endpoint.port === "iteration_output",
      );
      sources.forEach((source) => consumers.forEach(
        (target) => addEdge(source, target, tensor, feedback ? "feedback" : "tensor"),
      ));
    });

    state.materialized.stages.forEach((stage) => {
      stage.modules.forEach((module) => {
        if (!module.repeat_carried || module.module_repeat <= 1) return;
        const prefix = `${stage.stage_id}/${module.module_id}`;
        const inputPort = (module.template.input_ports || []).find(
          (item) => item.port === module.repeat_carried.input_port,
        );
        const outputPort = (module.template.output_ports || []).find(
          (item) => item.port === module.repeat_carried.output_port,
        );
        if (!inputPort || !outputPort) return;
        const sources = resolveTensorProducers(module.template, outputPort.tensor_id, prefix);
        const consumers = resolveTensorConsumers(module.template, inputPort.tensor_id, prefix);
        const tensor = findTensor(module.template, outputPort.tensor_id);
        sources.forEach((source) => consumers.forEach(
          (target) => addEdge(source, target, tensor, "repeat", "next layer hidden"),
        ));
      });
    });

    const actionStage = state.materialized.stages.find(
      (stage) => stage.stage_id === "action-flow-decoder",
    );
    if (actionStage) {
      scopes.push({
        kind: "denoise",
        label: `Denoise loop ×${Atlas.format(actionStage.stage_repeat, 0)}`,
        stageId: actionStage.stage_id,
        moduleId: null,
        nodeIds: [...nodes.values()]
          .filter((node) => node.stageId === actionStage.stage_id)
          .map((node) => node.id),
      });
    }
    return { nodes, edges, scopes };
  }

  const PAPER_COMPACT_DEFINITIONS = new Set([
    "concat",
    "euler-update",
    "gelu",
    "layer-norm",
    "reshape",
    "rms-norm",
    "rope",
    "silu",
    "slice",
  ]);
  const PAPER_INLINE_DEFINITIONS = new Set(["residual-add", "elementwise-multiply"]);
  const PAPER_STORAGE_NODE_IDS = new Set([
    "prefix-encoder/prefix-blocks/self-attention/cache-output",
  ]);
  const PAPER_READ_PORT_NODE_IDS = new Map([
    ["action-flow-decoder/action-expert-blocks/self-attention/extract-prefix-key", "Kₚ"],
    ["action-flow-decoder/action-expert-blocks/self-attention/extract-prefix-value", "Vₚ"],
  ]);
  const PAPER_LOGICAL_VIEW_NODE_IDS = new Map([
    ["action-flow-decoder/action-expert-blocks/self-attention/key-concat", ["Kₚ", "Kₛ"]],
    ["action-flow-decoder/action-expert-blocks/self-attention/value-concat", ["Vₚ", "Vₛ"]],
  ]);

  function paperNodeVisual(node) {
    if (node.kind !== "operator") return "box";
    if (PAPER_STORAGE_NODE_IDS.has(node.id)) return "storage";
    if (PAPER_READ_PORT_NODE_IDS.has(node.id)) return "read-port";
    if (PAPER_LOGICAL_VIEW_NODE_IDS.has(node.id)) return "logical-view";
    if (node.definitionId === "reshape" || node.definitionId === "concat") return "line-op";
    if (PAPER_INLINE_DEFINITIONS.has(node.definitionId)) {
      return "inline";
    }
    return "box";
  }

  function paperNodeAlias(node) {
    if (node.kind !== "operator") return PAPER_BOUNDARY_ALIASES[node.id] || node.kind;
    if (PAPER_NODE_ALIASES[node.id]) return PAPER_NODE_ALIASES[node.id];
    const fallback = node.operator.operator_id
      .split("-")
      .slice(0, 2)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");
    return PAPER_OPERATOR_ALIASES[node.operator.operator_id] || fallback.slice(0, 14);
  }

  function paperSlotIds(slot) {
    if (!slot) return [];
    return Array.isArray(slot) ? slot : [slot];
  }

  function paperLayoutIds() {
    return Object.values(PI0_PAPER_LAYOUT).flatMap((rows) => rows.flatMap(
      (row) => row.slots.flatMap(paperSlotIds),
    ));
  }

  function paperNodeSize(node, availableWidth, solo) {
    const visual = paperNodeVisual(node);
    if (visual === "inline") {
      return { width: 20, height: 20, compact: true, inline: true };
    }
    if (visual === "storage") {
      return { width: Math.min(64, availableWidth), height: 28, compact: true, inline: false };
    }
    if (visual === "read-port") {
      return { width: Math.min(30, availableWidth), height: 24, compact: true, inline: false };
    }
    if (visual === "logical-view") {
      return { width: Math.min(82, availableWidth), height: 26, compact: true, inline: false };
    }
    if (visual === "line-op") {
      return { width: Math.min(58, availableWidth), height: 20, compact: true, inline: false };
    }
    if (visual === "control") {
      return { width: Math.min(42, availableWidth), height: 22, compact: true, inline: false };
    }
    const compact = node.kind !== "operator" || PAPER_COMPACT_DEFINITIONS.has(node.definitionId);
    const aliasWidth = Math.max(54, paperNodeAlias(node).length * 6.4 + 20);
    return {
      width: Math.min(availableWidth, solo ? Math.max(84, aliasWidth) : aliasWidth),
      height: compact ? 28 : 38,
      compact,
      inline: false,
    };
  }

  function placePaperRow(positions, nodes, stageLayout, row, centerY, rowIndex) {
    const slotWidth = stageLayout.contentWidth / row.slots.length;
    row.slots.forEach((slot, slotIndex) => {
      const nodeIds = paperSlotIds(slot);
      if (!nodeIds.length) return;
      const chainGap = 10;
      const availableWidth = (slotWidth - chainGap * (nodeIds.length - 1)) / nodeIds.length;
      const sizes = nodeIds.map((nodeId) => {
        const node = nodes.get(nodeId);
        return node ? paperNodeSize(node, availableWidth - 4, row.slots.length === 1 && nodeIds.length === 1) : null;
      });
      const chainWidth = sizes.reduce(
        (total, size) => total + (size ? size.width : 0),
        chainGap * (nodeIds.length - 1),
      );
      let x = stageLayout.contentX + slotIndex * slotWidth + (slotWidth - chainWidth) / 2;
      if (row.centerBetween && row.slots.length === 1 && nodeIds.length === 1) {
        const sourceBoxes = row.centerBetween.map((nodeId) => positions.get(nodeId)).filter(Boolean);
        if (sourceBoxes.length === row.centerBetween.length) {
          const sourceCenters = sourceBoxes.map((box) => box.x + box.width / 2);
          x = sourceCenters.reduce((total, value) => total + value, 0) / sourceCenters.length
            - chainWidth / 2;
        }
      } else if (row.alignTo && row.slots.length === 1 && nodeIds.length === 1) {
        const sourceBox = positions.get(row.alignTo);
        if (sourceBox) x = sourceBox.x + sourceBox.width / 2 - chainWidth / 2;
      }
      nodeIds.forEach((nodeId, chainIndex) => {
        const node = nodes.get(nodeId);
        const size = sizes[chainIndex];
        if (!node || !size) return;
        positions.set(nodeId, {
          x,
          y: centerY - size.height / 2,
          width: size.width,
          height: size.height,
          compact: size.compact,
          inline: size.inline,
          row: rowIndex,
          lane: slotIndex,
          chain: chainIndex,
        });
        x += size.width + chainGap;
      });
    });
  }

  function placePaperBoundaryRow(
    positions,
    nodes,
    stageLayout,
    entries,
    centerY,
    rowName,
    authoredLayout,
  ) {
    if (!entries.length) return;
    const slotCount = authoredLayout && authoredLayout.slotCount
      ? authoredLayout.slotCount
      : entries.length;
    const slotWidth = stageLayout.contentWidth / slotCount;
    entries.forEach((entry, slotIndex) => {
      const nodeId = entry.id;
      const node = nodes.get(nodeId);
      const lane = authoredLayout && authoredLayout.lanes && authoredLayout.lanes[nodeId] !== undefined
        ? authoredLayout.lanes[nodeId]
        : slotIndex;
      const size = paperNodeSize(node, slotWidth - 10, slotCount === 1);
      positions.set(nodeId, {
        x: stageLayout.contentX + lane * slotWidth + (slotWidth - size.width) / 2,
        y: centerY - size.height / 2,
        width: size.width,
        height: 28,
        compact: true,
        row: rowName,
        lane,
      });
    });
  }

  function layoutPaperDag(model) {
    const width = 1080;
    const margin = 14;
    const columnWidth = 340;
    const columnGap = 16;
    const positions = new Map();
    const stages = [];
    const fallbacks = [];
    const configuredIds = new Set(paperLayoutIds());

    state.materialized.stages.forEach((stage, stageIndex) => {
      const stageNodes = [...model.nodes.values()].filter((node) => node.stageId === stage.stage_id);
      const stageLayout = {
        stage,
        x: margin + stageIndex * (columnWidth + columnGap),
        y: 10,
        width: columnWidth,
        height: 0,
        contentX: margin + stageIndex * (columnWidth + columnGap) + 24,
        contentWidth: columnWidth - 48,
      };
      const inputs = stageNodes.filter((node) => node.kind === "input");
      const loops = stageNodes.filter((node) => node.kind === "loop");
      const controls = stageNodes.filter((node) => node.kind === "control");
      const inputBoundaryNodes = [...inputs, ...controls];
      const boundaryLayout = PI0_PAPER_BOUNDARY_LAYOUT[stage.stage_id] || {};
      placePaperBoundaryRow(
        positions,
        model.nodes,
        stageLayout,
        inputBoundaryNodes,
        loops.length || controls.length ? 116 : 76,
        "input",
        boundaryLayout.input,
      );
      placePaperBoundaryRow(
        positions,
        model.nodes,
        stageLayout,
        loops,
        166,
        "loop",
        boundaryLayout.loop,
      );

      const rows = PI0_PAPER_LAYOUT[stage.stage_id] || [];
      const firstRowY = loops.length || controls.length ? 214 : 120;
      const rowStep = 48;
      const moduleGap = 20;
      let rowY = firstRowY;
      let lastCenterY = firstRowY;
      rows.forEach((row, rowIndex) => {
        if (rowIndex && row.gapBefore) rowY += moduleGap;
        placePaperRow(
          positions,
          model.nodes,
          stageLayout,
          row,
          rowY,
          rowIndex,
        );
        lastCenterY = rowY;
        rowY += rowStep;
      });

      const unplaced = stageNodes.filter(
        (node) => node.kind === "operator" && !configuredIds.has(node.id),
      );
      if (unplaced.length) {
        const fallbackTop = lastCenterY + 62;
        unplaced.forEach((node, fallbackIndex) => {
          placePaperRow(
            positions,
            model.nodes,
            stageLayout,
            { slots: [node.id] },
            fallbackTop + 44 + fallbackIndex * rowStep,
            `fallback-${fallbackIndex}`,
          );
        });
        lastCenterY = fallbackTop + 44 + (unplaced.length - 1) * rowStep;
        fallbacks.push({
          stageId: stage.stage_id,
          x: stageLayout.contentX,
          y: fallbackTop,
          width: stageLayout.contentWidth,
          height: 68 + (unplaced.length - 1) * rowStep,
          count: unplaced.length,
        });
      }

      const outputs = stageNodes.filter((node) => node.kind === "output");
      const outputY = lastCenterY + 76;
      placePaperBoundaryRow(positions, model.nodes, stageLayout, outputs, outputY, "output");
      const stageBoxes = stageNodes.map((node) => positions.get(node.id)).filter(Boolean);
      const bottom = Math.max(160, ...stageBoxes.map((box) => box.y + box.height));
      stageLayout.height = bottom + 48;
      stageLayout.effectiveRows = rows.length;
      stages.push(stageLayout);
    });

    const operators = [...model.nodes.values()].filter((node) => node.kind === "operator");
    const placedOperators = operators.filter((node) => positions.has(node.id));
    const missingSlotIds = [...configuredIds].filter((nodeId) => !model.nodes.has(nodeId));
    return {
      positions,
      stages,
      fallbacks,
      width,
      height: Math.max(...stages.map((stage) => stage.height)) + 10,
      coverage: {
        operators: operators.length,
        placed: placedOperators.length,
        fallback: fallbacks.reduce((total, item) => total + item.count, 0),
        missingSlotIds,
      },
    };
  }

  function paperScopeBounds(scope, positions, padding) {
    const values = scope.nodeIds.map((id) => positions.get(id)).filter(Boolean);
    if (!values.length) return null;
    const headerHeight = 18;
    const headerGap = 12;
    const left = Math.min(...values.map((value) => value.x));
    const top = Math.min(...values.map((value) => value.y));
    const right = Math.max(...values.map((value) => value.x + value.width));
    const bottom = Math.max(...values.map((value) => value.y + value.height));
    const contentTop = top - padding;
    const headerBottom = contentTop - headerGap;
    return {
      x: left - padding,
      y: headerBottom - headerHeight,
      width: right - left + padding * 2,
      height: bottom - headerBottom + padding + headerHeight,
      contentTop,
      headerBottom,
      headerHeight,
    };
  }

  function paperScopeLabel(scope) {
    if (scope.kind === "denoise") {
      const stage = state.materialized.stages.find((item) => item.stage_id === scope.stageId);
      return `Denoise ×${stage ? Atlas.format(stage.stage_repeat, 0) : "?"}`;
    }
    const stage = state.materialized.stages.find((item) => item.stage_id === scope.stageId);
    const module = stage && stage.modules.find((item) => item.module_id === scope.moduleId);
    const aliases = {
      "vision-blocks": "SigLIP",
      "prefix-blocks": "Gemma",
      "action-expert-blocks": "Expert",
    };
    const label = aliases[scope.moduleId] || (module ? module.label : "Repeated block");
    return `${label} ×${module ? Atlas.format(module.module_repeat, 0) : "?"}`;
  }

  function paperScopeExecutionNote(scope) {
    if (scope.moduleId !== "prefix-blocks") return null;
    return {
      label: "17 full + L18 KV tail",
      description: "Optimized FlashRT / Realtime-VLA prefill: layer 18 still runs pre-attention RMSNorm, fused QKV, RoPE, and K/V cache write; its attention, output projection, and feed-forward tail are skipped. Fused QKV currently also produces an unused Q.",
    };
  }

  function connectorPairKey(source, target) {
    return `${source}|${target}`;
  }

  function resolvePaperConnectors(model) {
    const edgeIndex = new Map();
    model.edges.forEach((edge) => {
      const key = connectorPairKey(edge.source, edge.target);
      if (!edgeIndex.has(key)) edgeIndex.set(key, []);
      edgeIndex.get(key).push(edge);
    });
    const resolved = [];
    const invalid = [];
    PI0_PAPER_CONNECTORS.forEach((descriptor) => {
      const missing = descriptor.pairs.filter(([source, target]) => (
        !model.nodes.has(source)
        || !model.nodes.has(target)
        || !edgeIndex.has(connectorPairKey(source, target))
      ));
      if (missing.length) invalid.push({ descriptor, missing });
      else resolved.push({ ...descriptor, edges: descriptor.pairs.flatMap(
        ([source, target]) => edgeIndex.get(connectorPairKey(source, target)),
      ) });
    });
    if (invalid.length) {
      console.error("Pi0 paper connector truth validation failed", invalid.map((item) => ({
        connector: item.descriptor.id,
        missing: item.missing,
      })));
    }
    return { resolved, invalid };
  }

  function paperBoxAnchor(box) {
    return {
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
  }

  function paperStageForNode(layout, model, nodeId) {
    const node = model.nodes.get(nodeId);
    return node && layout.stages.find((item) => item.stage.stage_id === node.stageId);
  }

  function appendConnectorPath(group, d, arrow) {
    const attributes = { d };
    if (arrow) attributes["marker-end"] = "url(#dag-arrow)";
    group.appendChild(svgElement("path", attributes));
  }

  function paperConnectorSegment(group, sourceIds, targetIds, kind) {
    const segment = svgElement("g", {
      class: `dag-connector-segment dag-connector-${kind}`,
      "data-source-ids": sourceIds.join(" "),
      "data-target-ids": targetIds.join(" "),
    });
    group.appendChild(segment);
    return segment;
  }

  function paperPairSegment(group, sourceId, targetId) {
    return paperConnectorSegment(group, [sourceId], [targetId], "pair");
  }

  function renderConnectorPair(group, sourceId, targetId, layout) {
    const sourceBox = layout.positions.get(sourceId);
    const targetBox = layout.positions.get(targetId);
    if (!sourceBox || !targetBox) return;
    const segment = paperPairSegment(group, sourceId, targetId);
    const source = paperBoxAnchor(sourceBox);
    const target = paperBoxAnchor(targetBox);
    if (Math.abs(source.y - target.y) < 3) {
      if (source.x < target.x) appendConnectorPath(segment, `M ${source.right} ${source.y} H ${target.left}`, true);
      else appendConnectorPath(segment, `M ${source.left} ${source.y} H ${target.right}`, true);
      return;
    }
    if (target.top >= source.bottom) {
      if (Math.abs(source.x - target.x) < 1) {
        appendConnectorPath(segment, `M ${source.x} ${source.bottom} V ${target.top}`, true);
        return;
      }
      const bendY = (source.bottom + target.top) / 2;
      appendConnectorPath(segment, `M ${source.x} ${source.bottom} V ${bendY} H ${target.x} V ${target.top}`, true);
      return;
    }
    const railX = Math.max(source.right, target.right) + 10;
    appendConnectorPath(segment, `M ${source.right} ${source.y} H ${railX} V ${target.y} H ${target.right}`, true);
  }

  function renderBranchOut(group, descriptor, layout) {
    const bySource = new Map();
    descriptor.pairs.forEach(([source, target]) => {
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(target);
    });
    bySource.forEach((targetIds, sourceId) => {
      const sourceBox = layout.positions.get(sourceId);
      const targetBoxes = targetIds.map((id) => layout.positions.get(id));
      if (!sourceBox || targetBoxes.some((box) => !box)) return;
      if (targetBoxes.length === 1) {
        renderConnectorPair(group, sourceId, targetIds[0], layout);
        return;
      }
      const source = paperBoxAnchor(sourceBox);
      const targets = targetBoxes.map(paperBoxAnchor);
      const busY = (source.bottom + Math.min(...targets.map((target) => target.top))) / 2;
      const minimumX = Math.min(...targets.map((target) => target.x));
      const maximumX = Math.max(...targets.map((target) => target.x));
      const shared = paperConnectorSegment(group, [sourceId], targetIds, "shared");
      appendConnectorPath(shared, `M ${source.x} ${source.bottom} V ${busY} M ${minimumX} ${busY} H ${maximumX}`, false);
      targets.forEach((target, index) => {
        const pair = paperPairSegment(group, sourceId, targetIds[index]);
        appendConnectorPath(pair, `M ${target.x} ${busY} V ${target.top}`, true);
      });
    });
  }

  function renderRightToTopFanIn(group, sourceIds, targetId, sourceBoxes, targetBox, stage) {
    const sources = sourceBoxes.map(paperBoxAnchor);
    const target = paperBoxAnchor(targetBox);
    const railX = stage.x + stage.width - 13;
    const busY = target.top - 7;
    sources.forEach((source, index) => {
      const pair = paperPairSegment(group, sourceIds[index], targetId);
      appendConnectorPath(pair, `M ${source.right} ${source.y} H ${railX}`, false);
    });
    const shared = paperConnectorSegment(group, sourceIds, [targetId], "shared");
    appendConnectorPath(shared, `M ${railX} ${Math.min(...sources.map((source) => source.y))} V ${busY} H ${target.x} V ${target.top}`, true);
  }

  function renderBranchIn(group, descriptor, layout, model) {
    const byTarget = new Map();
    descriptor.pairs.forEach(([source, target]) => {
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push(source);
    });
    byTarget.forEach((sourceIds, targetId) => {
      const targetBox = layout.positions.get(targetId);
      const sourceBoxes = sourceIds.map((id) => layout.positions.get(id));
      if (!targetBox || sourceBoxes.some((box) => !box)) return;
      if (sourceBoxes.length === 1) {
        renderConnectorPair(group, sourceIds[0], targetId, layout);
        return;
      }
      const target = paperBoxAnchor(targetBox);
      const sources = sourceBoxes.map(paperBoxAnchor);
      const stage = paperStageForNode(layout, model, targetId);
      if (descriptor.route === "right-to-top") {
        renderRightToTopFanIn(group, sourceIds, targetId, sourceBoxes, targetBox, stage);
        return;
      }
      const busY = (target.top + Math.max(...sources.map((source) => source.bottom))) / 2;
      const minimumX = Math.min(...sources.map((source) => source.x), target.x);
      const maximumX = Math.max(...sources.map((source) => source.x), target.x);
      sources.forEach((source, index) => {
        const pair = paperPairSegment(group, sourceIds[index], targetId);
        appendConnectorPath(pair, `M ${source.x} ${source.bottom} V ${busY}`, false);
      });
      const shared = paperConnectorSegment(group, sourceIds, [targetId], "shared");
      appendConnectorPath(shared, `M ${minimumX} ${busY} H ${maximumX} M ${target.x} ${busY} V ${target.top}`, true);
    });
  }

  function renderResidual(group, descriptor, layout, model) {
    const bySource = new Map();
    descriptor.pairs.forEach(([source, target]) => {
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(target);
    });
    bySource.forEach((targetIds, sourceId) => {
      const sourceBox = layout.positions.get(sourceId);
      const targetBoxes = targetIds.map((id) => layout.positions.get(id));
      const stage = paperStageForNode(layout, model, sourceId);
      if (!sourceBox || !stage || targetBoxes.some((box) => !box)) return;
      const source = paperBoxAnchor(sourceBox);
      const targets = targetBoxes.map(paperBoxAnchor);
      const railX = stage.x + 13;
      targets.forEach((target, index) => {
        const pair = paperPairSegment(group, sourceId, targetIds[index]);
        const sourceX = source.x - Math.min(12, sourceBox.width / 4);
        const turnY = source.bottom + 6;
        appendConnectorPath(pair, `M ${sourceX} ${source.bottom} V ${turnY} H ${railX} V ${target.y} H ${target.left}`, true);
      });
    });
  }

  function renderCrossConnector(group, descriptor, layout, model) {
    const sourceIds = [...new Set(descriptor.pairs.map(([source]) => source))];
    if (sourceIds.length !== 1) {
      descriptor.pairs.forEach(([sourceId, targetId]) => renderConnectorPair(group, sourceId, targetId, layout));
      return;
    }
    const sourceId = sourceIds[0];
    const targetIds = descriptor.pairs.map(([, target]) => target);
    const sourceBox = layout.positions.get(sourceId);
    const targetBoxes = targetIds.map((id) => layout.positions.get(id));
    const sourceStage = paperStageForNode(layout, model, sourceId);
    const targetStage = paperStageForNode(layout, model, targetIds[0]);
    if (!sourceBox || !sourceStage || !targetStage || targetBoxes.some((box) => !box)) return;
    const source = paperBoxAnchor(sourceBox);
    const targets = targetBoxes.map(paperBoxAnchor);
    const gapX = (sourceStage.x + sourceStage.width + targetStage.x) / 2;
    if (targets.length === 1) {
      const pair = paperPairSegment(group, sourceId, targetIds[0]);
      appendConnectorPath(pair, `M ${source.right} ${source.y} H ${gapX} V ${targets[0].y} H ${targets[0].left}`, true);
      return;
    }
    const busY = Math.min(...targets.map((target) => target.top)) - 7;
    const shared = paperConnectorSegment(group, [sourceId], targetIds, "shared");
    appendConnectorPath(shared, `M ${source.right} ${source.y} H ${gapX} V ${busY} H ${Math.max(...targets.map((target) => target.x))}`, false);
    targets.forEach((target, index) => {
      const pair = paperPairSegment(group, sourceId, targetIds[index]);
      appendConnectorPath(pair, `M ${target.x} ${busY} V ${target.top}`, true);
    });
  }

  function renderRail(group, descriptor, layout, model) {
    descriptor.pairs.forEach(([sourceId, targetId]) => {
      const sourceBox = layout.positions.get(sourceId);
      const targetBox = layout.positions.get(targetId);
      const stage = paperStageForNode(layout, model, sourceId);
      if (!sourceBox || !targetBox || !stage) return;
      const source = paperBoxAnchor(sourceBox);
      const target = paperBoxAnchor(targetBox);
      const inset = descriptor.railInset || 18;
      const railX = descriptor.side === "left"
        ? stage.x + inset
        : stage.x + stage.width - inset;
      const sourceX = descriptor.side === "left" ? source.left : source.right;
      const targetX = descriptor.side === "left" ? target.left : target.right;
      const sourceY = source.y + (descriptor.sourceOffset || 0);
      const targetY = target.y + (descriptor.targetOffset || 0);
      const pair = paperPairSegment(group, sourceId, targetId);
      appendConnectorPath(pair, `M ${sourceX} ${sourceY} H ${railX} V ${targetY} H ${targetX}`, true);
    });
  }

  function renderFeedback(group, descriptor, layout, model) {
    descriptor.pairs.forEach(([sourceId, targetId]) => {
      const sourceBox = layout.positions.get(sourceId);
      const targetBox = layout.positions.get(targetId);
      const stage = paperStageForNode(layout, model, sourceId);
      if (!sourceBox || !targetBox || !stage) return;
      const source = paperBoxAnchor(sourceBox);
      const target = paperBoxAnchor(targetBox);
      const railX = stage.x + stage.width + (descriptor.railOffset || 6);
      const sourceY = source.y + (descriptor.sourceOffset || 0);
      const pair = paperPairSegment(group, sourceId, targetId);
      appendConnectorPath(pair, `M ${source.right} ${sourceY} H ${railX} V ${target.y} H ${target.right}`, true);
    });
  }

  function renderPaperConnector(svg, descriptor, layout, model) {
    const sourceIds = [...new Set(descriptor.pairs.map(([source]) => source))];
    const targetIds = [...new Set(descriptor.pairs.map(([, target]) => target))];
    const classes = ["dag-connector", `dag-connector--${descriptor.kind}`];
    if (descriptor.kind === "cross") classes.push("dag-global-connector");
    const group = svgElement("g", {
      class: classes.join(" "),
      "data-connector-id": descriptor.id,
      "data-source-ids": sourceIds.join(" "),
      "data-target-ids": targetIds.join(" "),
      "data-pair-count": descriptor.pairs.length,
    });
    if (descriptor.kind === "branch-out") renderBranchOut(group, descriptor, layout);
    else if (descriptor.kind === "branch-in" || descriptor.kind === "cache") renderBranchIn(group, descriptor, layout, model);
    else if (descriptor.kind === "residual") renderResidual(group, descriptor, layout, model);
    else if (descriptor.kind === "cross") renderCrossConnector(group, descriptor, layout, model);
    else if (descriptor.kind === "rail") renderRail(group, descriptor, layout, model);
    else if (descriptor.kind === "feedback") renderFeedback(group, descriptor, layout, model);
    else descriptor.pairs.forEach(([sourceId, targetId]) => renderConnectorPair(group, sourceId, targetId, layout));
    svg.appendChild(group);
  }

  function paperPortSummary(label, ports) {
    if (!ports.length) return `${label}: none`;
    return `${label}: ${ports.map((port) => (
      `${port.port} [${symbolicShape(port.tensor)}] → [${concreteShape(port.tensor)}]`
    )).join("; ")}`;
  }

  function paperNodeDescription(node) {
    if (node.kind !== "operator") return `${node.label} · ${node.definitionId}`;
    const definition = node.operator.definition;
    return [
      node.label,
      `${definition.label} · ${definition.category}`,
      definition.formula_display,
      paperPortSummary("Inputs", node.operator.input_tensors),
      paperPortSummary("Outputs", node.operator.output_tensors),
    ].join(" · ");
  }

  function renderDagNode(svg, node, box) {
    const alias = paperNodeAlias(node);
    const description = paperNodeDescription(node);
    const visual = paperNodeVisual(node);
    const inline = visual === "inline";
    const visualClass = visual === "box" ? "" : ` dag-node--${visual}`;
    const group = svgElement("g", {
      class: `dag-node dag-node--${node.kind}${box.compact ? " dag-node--compact" : " dag-node--main"}${visualClass}`,
      transform: `translate(${box.x} ${box.y})`,
      "data-node-id": node.id,
      "data-node-kind": node.kind,
      "data-definition-id": node.definitionId,
      "data-display-alias": alias,
    });
    if (node.kind === "operator") {
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
      group.setAttribute("aria-label", `Inspect ${description}`);
    }
    if (inline) {
      const symbol = node.definitionId === "residual-add" ? "+" : node.definitionId === "elementwise-multiply" ? "×" : "∥";
      group.append(
        svgElement("circle", {
          cx: box.width / 2,
          cy: box.height / 2,
          r: 9,
        }),
        svgElement("text", {
          x: box.width / 2,
          y: box.height / 2 + 4.5,
          class: "dag-node-label dag-node-junction-label",
          "text-anchor": "middle",
        }, symbol),
        svgElement("title", {}, description),
      );
    } else if (visual === "line-op" || visual === "control") {
      group.append(
        svgElement("rect", {
          width: box.width,
          height: box.height,
          rx: box.height / 2,
        }),
        svgElement("text", {
          x: box.width / 2,
          y: box.height / 2 + 3.5,
          class: "dag-node-label",
          "text-anchor": "middle",
        }, paperNodeAlias(node)),
        svgElement("title", {}, description),
      );
    } else if (visual === "storage") {
      group.append(
        svgElement("ellipse", { cx: box.width / 2, cy: 4, rx: box.width / 2, ry: 4 }),
        svgElement("rect", { x: 0, y: 4, width: box.width, height: 18 }),
        svgElement("ellipse", { cx: box.width / 2, cy: 22, rx: box.width / 2, ry: 4 }),
        svgElement("text", {
          x: box.width / 2,
          y: 14.5,
          class: "dag-node-label",
          "text-anchor": "middle",
        }, paperNodeAlias(node)),
        svgElement("title", {}, description),
      );
    } else if (visual === "read-port") {
      group.append(
        svgElement("polygon", {
          points: `${box.width / 2},0 ${box.width},${box.height / 2} ${box.width / 2},${box.height} 0,${box.height / 2}`,
        }),
        svgElement("text", {
          x: box.width / 2 - 1,
          y: box.height / 2 + 4,
          class: "dag-node-label",
          "text-anchor": "middle",
        }, PAPER_READ_PORT_NODE_IDS.get(node.id)),
        svgElement("title", {}, description),
      );
    } else if (visual === "logical-view") {
      const labels = PAPER_LOGICAL_VIEW_NODE_IDS.get(node.id);
      group.append(
        svgElement("rect", {
          width: box.width,
          height: box.height,
          rx: 7,
        }),
        svgElement("line", {
          x1: box.width / 2,
          y1: 2,
          x2: box.width / 2,
          y2: box.height - 2,
          class: "dag-logical-view-divider",
        }),
        svgElement("text", {
          x: box.width / 4,
          y: box.height / 2 + 4,
          class: "dag-node-label",
          "text-anchor": "middle",
        }, labels[0]),
        svgElement("text", {
          x: box.width * 0.75,
          y: box.height / 2 + 4,
          class: "dag-node-label",
          "text-anchor": "middle",
        }, labels[1]),
        svgElement("title", {}, `${description} · logical view; a runtime may avoid a physical copy`),
      );
    } else {
      group.append(
        svgElement("rect", {
          width: box.width,
          height: box.height,
          rx: node.kind === "operator" ? 8 : 18,
        }),
        svgElement("text", {
          x: box.width / 2,
          y: box.height / 2 + 4,
          class: "dag-node-label",
          "text-anchor": "middle",
        }, alias),
        svgElement("title", {}, description),
      );
    }
    if (node.kind === "operator") {
      const selectNode = () => select({
        stage: node.stageId,
        module: node.moduleId,
        component: node.componentId,
        operator: node.operator.operator_id,
      });
      group.addEventListener("click", selectNode);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode();
        }
      });
    }
    svg.appendChild(group);
  }

  function renderDag() {
    Atlas.clear(targets.dag);
    const model = buildDagModel();
    const layout = layoutPaperDag(model);
    const connectors = resolvePaperConnectors(model);
    const warningHeight = connectors.invalid.length ? 30 + connectors.invalid.length * 16 : 0;
    const legend = Atlas.element("div", { className: "dag-legend" });
    [["dag-legend-tensor", "curated declared flow"], ["dag-legend-repeat", "residual / denoise rail"]].forEach(([kind, label]) => {
      const item = Atlas.element("span", { className: `dag-legend-item ${kind}` });
      item.append(
        Atlas.element("span", { className: "dag-legend-line" }),
        Atlas.element("span", { text: label }),
      );
      legend.appendChild(item);
    });
    legend.appendChild(Atlas.element("span", {
      className: "dag-legend-note",
      text: "Paper-style overview · select a short operator alias for full detail.",
    }));
    const svgHeight = layout.height + warningHeight;
    const svg = svgElement("svg", {
      class: "dag-svg",
      viewBox: `0 0 ${layout.width} ${svgHeight}`,
      width: layout.width,
      height: svgHeight,
      role: "img",
      "aria-label": "Pi0 paper-style logical operator overview",
      "data-layout": "paper-columns",
      "data-operator-count": layout.coverage.operators,
      "data-placed-operator-count": layout.coverage.placed,
      "data-fallback-operator-count": layout.coverage.fallback,
      "data-truth-edge-count": model.edges.length,
      "data-connector-count": connectors.resolved.length,
      "data-invalid-connector-count": connectors.invalid.length,
    });
    const definitions = svgElement("defs");
    const marker = svgElement("marker", {
      id: "dag-arrow",
      markerWidth: 6,
      markerHeight: 6,
      refX: 5.4,
      refY: 3,
      orient: "auto",
      markerUnits: "userSpaceOnUse",
      overflow: "visible",
    });
    marker.append(
      svgElement("path", { d: "M 0 0 L 6 3 L 0 6", class: "dag-arrow-halo" }),
      svgElement("path", { d: "M 0 0 L 6 3 L 0 6", class: "dag-arrow-head" }),
    );
    definitions.appendChild(marker);
    svg.appendChild(definitions);

    layout.stages.forEach((item, index) => {
      const stageGroup = svgElement("g", {
        class: `dag-stage dag-stage--${index + 1}`,
        "data-stage-id": item.stage.stage_id,
        "data-effective-rows": item.effectiveRows,
      });
      const shortLabel = item.stage.label.split(/\s+/)[0];
      stageGroup.append(
        svgElement("rect", {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rx: 18,
        }),
        svgElement("text", {
          x: item.x + 18,
          y: item.y + 31,
          class: "dag-stage-index",
        }, `0${index + 1}`),
        svgElement("text", {
          x: item.x + 54,
          y: item.y + 31,
          class: "dag-stage-label",
        }, shortLabel),
      );
      svg.appendChild(stageGroup);
    });

    layout.fallbacks.forEach((fallback) => {
      const group = svgElement("g", {
        class: "dag-fallback",
        "data-stage-id": fallback.stageId,
        "data-operator-count": fallback.count,
      });
      group.append(
        svgElement("rect", {
          x: fallback.x,
          y: fallback.y,
          width: fallback.width,
          height: fallback.height,
          rx: 12,
        }),
        svgElement("text", {
          x: fallback.x + 10,
          y: fallback.y + 18,
        }, `Unplaced future operators · ${fallback.count}`),
      );
      svg.appendChild(group);
    });

    const scopeHeaders = [];
    [...model.scopes]
      .filter((scope) => scope.kind === "denoise" || scope.kind === "transformer")
      .sort((left, right) => (left.kind === "denoise" ? -1 : right.kind === "denoise" ? 1 : 0))
      .forEach((scope) => {
        const padding = scope.kind === "denoise" ? 8 : 4;
        const bounds = paperScopeBounds(scope, layout.positions, padding);
        if (!bounds) return;
        const label = paperScopeLabel(scope);
        const badgeWidth = Math.min(bounds.width - 16, Math.max(84, label.length * 6.6 + 18));
        const executionNote = paperScopeExecutionNote(scope);
        const noteGap = 6;
        const availableNoteWidth = bounds.width - 16 - badgeWidth - noteGap;
        const showExecutionNote = Boolean(executionNote && availableNoteWidth >= 112);
        const noteWidth = showExecutionNote ? Math.min(114, availableNoteWidth) : 0;
        const group = svgElement("g", {
          class: `dag-scope dag-scope--${scope.kind}`,
          "data-scope-kind": scope.kind,
          "data-module-id": scope.moduleId,
          "data-header-bottom": bounds.headerBottom,
          "data-content-top": bounds.contentTop,
        });
        group.appendChild(svgElement("rect", {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          rx: 14,
          class: "dag-scope-frame",
        }));
        svg.appendChild(group);

        const header = svgElement("g", {
          class: `dag-scope-header dag-scope--${scope.kind}`,
          "data-scope-kind": scope.kind,
          "data-module-id": scope.moduleId,
        });
        header.append(
          svgElement("rect", {
            x: bounds.x + 8,
            y: bounds.y,
            width: badgeWidth,
            height: bounds.headerHeight,
            rx: 7,
            class: "dag-scope-badge",
          }),
          svgElement("text", {
            x: bounds.x + 17,
            y: bounds.y + 12.5,
            class: "dag-scope-label",
          }, label),
        );
        if (showExecutionNote) {
          const noteX = bounds.x + bounds.width - noteWidth - 8;
          const note = svgElement("g", { class: "dag-scope-execution-note" });
          note.append(
            svgElement("rect", {
              x: noteX,
              y: bounds.y,
              width: noteWidth,
              height: bounds.headerHeight,
              rx: 7,
            }),
            svgElement("text", {
              x: noteX + noteWidth / 2,
              y: bounds.y + 12.5,
              "text-anchor": "middle",
            }, executionNote.label),
            svgElement("title", {}, executionNote.description),
          );
          header.appendChild(note);
        }
        scopeHeaders.push(header);
      });

    connectors.resolved.forEach((descriptor) => renderPaperConnector(svg, descriptor, layout, model));
    scopeHeaders.forEach((header) => svg.appendChild(header));
    [...model.nodes.values()].forEach((node) => {
      const box = layout.positions.get(node.id);
      if (box) renderDagNode(svg, node, box);
    });
    connectors.invalid.forEach((item, index) => {
      svg.appendChild(svgElement("text", {
        x: 24,
        y: layout.height + 24 + index * 16,
        class: "dag-connector-warning",
      }, `Missing declared connector ${item.descriptor.id}: ${item.missing.map((pair) => pair.join(" → ")).join(", ")}`));
    });
    targets.dag.append(legend, svg);
    updateDagSelection();
  }

  function renderStages() {
    renderDag();
  }

  function renderModules() {
    // The complete model stays visible; operator selection never changes topology.
  }

  function renderComponents() {
    // Component boundaries are subtle regions inside each Transformer scope.
  }

  function renderOperators() {
    // Atomic operators are rendered as selectable SVG nodes in the complete DAG.
  }

  function renderBreadcrumb() {
    Atlas.clear(targets.breadcrumb);
    const stage = selectedStage();
    const module = selectedModule();
    const component = selectedComponent();
    const operator = selectedOperator();
    const values = [
      ["Model", pageData.model.display_name],
      ["Stage", stage.label],
      ["Block/module", module.label],
    ];
    if (component) values.push(["Component", component.label]);
    if (operator) values.push(["Operator", operator.label]);
    values.forEach(([kind, label], index) => {
      if (index) targets.breadcrumb.appendChild(Atlas.element("span", { className: "breadcrumb-separator", text: "/" }));
      const crumb = Atlas.element("span", { className: "breadcrumb-item" });
      crumb.append(
        Atlas.element("small", { text: kind }),
        Atlas.element("strong", { text: label }),
      );
      targets.breadcrumb.appendChild(crumb);
    });
  }

  function expressionLabel(expression) {
    if (typeof expression === "number") return String(expression);
    if (!expression || typeof expression !== "object") return "?";
    if (typeof expression.symbol === "string") return expression.symbol;
    const args = (expression.args || []).map(expressionLabel);
    switch (expression.op) {
      case "add": return `(${args.join(" + ")})`;
      case "sub": return `(${args[0]} - ${args[1]})`;
      case "mul": return `(${args.join(" × ")})`;
      case "div": return `(${args[0]} / ${args[1]})`;
      case "ceil_div": return `ceil(${args[0]} / ${args[1]})`;
      default: return "?";
    }
  }

  function symbolicShape(tensor) {
    return tensor ? tensor.axes.map((axis) => expressionLabel(axis.expression)).join(" × ") : "unresolved";
  }

  function concreteShape(tensor) {
    if (!tensor || !Array.isArray(tensor.shape)) return "unresolved";
    return tensor.shape.map((value) => value === null ? "?" : Atlas.format(value, 2)).join(" × ");
  }

  function renderTensorShapes(title, ports) {
    const group = Atlas.element("section", { className: "tensor-group" });
    group.appendChild(Atlas.element("h3", { text: title }));
    if (!ports.length) {
      group.appendChild(Atlas.element("p", { className: "empty-state", text: "No declared tensors." }));
      return group;
    }
    ports.forEach((port) => {
      const row = Atlas.element("div", { className: "tensor-shape-row" });
      row.append(
        Atlas.element("strong", { className: "tensor-port", text: port.port }),
        Atlas.element("span", { className: "tensor-shape-chip symbolic-shape", text: `symbolic [${symbolicShape(port.tensor)}]` }),
        Atlas.element("span", { className: "tensor-shape-chip concrete-shape", text: `concrete [${concreteShape(port.tensor)}]` }),
      );
      group.appendChild(row);
    });
    return group;
  }

  function renderAnalysis(operator) {
    const section = Atlas.element("section", { className: "operator-analysis" });
    section.appendChild(Atlas.element("h3", { text: "Logical analysis" }));
    if (!operator.analysis.length) {
      section.appendChild(Atlas.element("p", { className: "empty-state", text: "No analytical count is declared for this atomic operator." }));
      return section;
    }
    const stage = selectedStage();
    const module = selectedModule();
    const factors = {
      stage: stage.stage_repeat,
      layer: module.module_repeat,
      intrinsic: operator.multiplicity,
    };
    const list = Atlas.element("dl", { className: "analysis-grid" });
    operator.analysis.forEach((metric) => {
      const fact = Atlas.element("div", { className: "analysis-fact" });
      const aggregate = metric.value === null
        ? null
        : metric.value * factors.stage * factors.layer * factors.intrinsic;
      fact.append(
        Atlas.element("dt", { text: metric.metric.replaceAll("_", " ") }),
        Atlas.element("dd", {
          className: "analysis-primary",
          text: metric.value === null
            ? "Per atomic invocation · unresolved"
            : `Per atomic invocation · ${Atlas.format(metric.value, 2)} ${metric.unit}`,
        }),
        Atlas.element("dd", {
          className: "analysis-aggregate",
          text: aggregate === null
            ? "Aggregate logical value · unresolved"
            : `Aggregate logical value · ${Atlas.format(aggregate, 2)} ${metric.unit}`,
        }),
        Atlas.element("dd", {
          className: "analysis-factors",
          text: `stage ${Atlas.format(factors.stage, 0)} × layers ${Atlas.format(factors.layer, 0)} × intrinsic ${Atlas.format(factors.intrinsic, 0)}`,
        }),
      );
      list.appendChild(fact);
    });
    section.appendChild(list);
    return section;
  }

  function gemmDimensions(operator) {
    const values = operator.bindings;
    if ([values.M, values.N, values.K].every((value) => typeof value === "number")) {
      return { M: values.M, N: values.N, K: values.K };
    }
    const scope = operator.scope_bindings;
    if (operator.definition_id === "patch-embedding") {
      return {
        M: scope.B * scope.V * scope.T,
        N: scope.D,
        K: scope.P * scope.P * scope.C,
      };
    }
    const inputShape = operator.input_tensors[0] && operator.input_tensors[0].shape;
    const outputShape = operator.output_tensors[0] && operator.output_tensors[0].shape;
    if (!inputShape || !outputShape || inputShape.includes(null) || outputShape.includes(null)) {
      return { M: null, N: null, K: null };
    }
    return {
      M: inputShape.slice(0, -1).reduce((total, value) => total * value, 1),
      N: outputShape[outputShape.length - 1],
      K: inputShape[inputShape.length - 1],
    };
  }

  function cancelAnimation() {
    if (state.animation && state.animation.timer !== null) {
      window.clearTimeout(state.animation.timer);
    }
    state.animation = null;
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function microscopeCanvas(label, height) {
    const canvasHeight = height || 210;
    return svgElement("svg", {
      class: "microscope-canvas",
      viewBox: `0 0 420 ${canvasHeight}`,
      role: "img",
      "aria-label": label,
    });
  }

  function diagramTile(svg, x, y, width, height, label, className, role) {
    const group = svgElement("g", {
      class: `microscope-tile ${className || ""}`,
      "data-tile-role": role,
    });
    group.append(
      svgElement("rect", { x, y, width, height, rx: 7 }),
      svgElement("text", {
        x: x + width / 2,
        y: y + height / 2 + 4,
        "text-anchor": "middle",
      }, label),
    );
    svg.appendChild(group);
    return group;
  }

  function diagramMatrixGrid(svg, options) {
    const cellSize = 24;
    const rows = 3;
    const columns = 3;
    const group = svgElement("g", {
      class: "gemm-matrix",
      "data-matrix-role": options.role,
    });
    group.append(
      svgElement("text", {
        x: options.x,
        y: options.y - 18,
        class: "gemm-matrix-label",
      }, options.label),
      svgElement("text", {
        x: options.x + columns * cellSize,
        y: options.y - 5,
        class: "gemm-axis-label",
        "text-anchor": "end",
      }, options.columnAxis),
      svgElement("text", {
        x: options.x - 7,
        y: options.y + rows * cellSize / 2,
        class: "gemm-axis-label",
        "text-anchor": "middle",
        transform: `rotate(-90 ${options.x - 7} ${options.y + rows * cellSize / 2})`,
      }, options.rowAxis),
    );
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const lane = options.lane(row, column);
        const focus = options.focus(row, column);
        const complete = options.complete ? options.complete(row, column) : false;
        const classes = ["gemm-cell"];
        if (lane) classes.push("is-lane");
        if (focus) classes.push(options.written ? "is-written" : "is-focus");
        if (complete) classes.push("is-complete");
        group.appendChild(svgElement("rect", {
          x: options.x + column * cellSize,
          y: options.y + row * cellSize,
          width: cellSize,
          height: cellSize,
          class: classes.join(" "),
          "data-row-tile": row,
          "data-column-tile": column,
        }));
        if (focus) {
          group.appendChild(svgElement("text", {
            x: options.x + (column + 0.5) * cellSize,
            y: options.y + (row + 0.5) * cellSize + 3,
            class: "gemm-cell-label",
            "text-anchor": "middle",
          }, options.focusLabel));
        }
      }
    }
    svg.appendChild(group);
  }

  function diagramKReduction(svg, activeK, written) {
    const startX = 109;
    const y = 226;
    for (let k = 0; k < 3; k += 1) {
      const classes = ["gemm-k-step"];
      if (written || k < activeK) classes.push("is-complete");
      if (!written && k === activeK) classes.push("is-active");
      svg.append(
        svgElement("rect", {
          x: startX + k * 68,
          y,
          width: 54,
          height: 20,
          rx: 10,
          class: classes.join(" "),
        }),
        svgElement("text", {
          x: startX + k * 68 + 27,
          y: y + 13.5,
          class: "gemm-k-step-label",
          "text-anchor": "middle",
        }, `K tile ${k + 1}`),
      );
    }
  }

  function animationControls(visualizer, frameCount, drawFrame) {
    const controls = Atlas.element("div", { className: "animation-controls" });
    const toggle = Atlas.element("button", { text: "Play" });
    const step = Atlas.element("button", { text: "Step" });
    const reset = Atlas.element("button", { text: "Reset" });
    [toggle, step, reset].forEach((button) => { button.type = "button"; });
    const speedLabel = Atlas.element("label", { className: "animation-speed" });
    speedLabel.appendChild(Atlas.element("span", { text: "Speed" }));
    const speed = Atlas.element("select");
    [[0.5, "0.5×"], [1, "1×"], [2, "2×"]].forEach(([value, label]) => {
      const option = Atlas.element("option", { text: label });
      option.value = String(value);
      if (value === 1) option.selected = true;
      speed.appendChild(option);
    });
    speedLabel.appendChild(speed);
    const status = Atlas.element("span", { className: "animation-status" });
    status.setAttribute("aria-live", "polite");
    controls.append(toggle, step, reset, speedLabel, status);
    visualizer.appendChild(controls);

    const animation = {
      frame: 0,
      playing: false,
      speed: 1,
      timer: null,
    };
    state.animation = animation;

    function paint() {
      status.textContent = drawFrame(animation.frame);
      visualizer.dataset.animationFrame = String(animation.frame);
    }

    function schedule() {
      if (!animation.playing || state.animation !== animation) return;
      animation.timer = window.setTimeout(() => {
        animation.frame = (animation.frame + 1) % frameCount;
        paint();
        schedule();
      }, 900 / animation.speed);
    }

    function setPlaying(playing) {
      if (animation.timer !== null) window.clearTimeout(animation.timer);
      animation.timer = null;
      animation.playing = playing;
      toggle.textContent = playing ? "Pause" : "Play";
      toggle.setAttribute("aria-label", playing ? "Pause computation animation" : "Play computation animation");
      schedule();
    }

    toggle.addEventListener("click", () => setPlaying(!animation.playing));
    step.addEventListener("click", () => {
      setPlaying(false);
      animation.frame = (animation.frame + 1) % frameCount;
      paint();
    });
    reset.addEventListener("click", () => {
      setPlaying(false);
      animation.frame = 0;
      paint();
    });
    speed.addEventListener("change", () => {
      animation.speed = Number(speed.value);
      if (animation.playing) setPlaying(true);
    });
    paint();
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) setPlaying(true);
  }

  function renderGemmVisualizer(operator) {
    const dimensions = gemmDimensions(operator);
    const visualizer = Atlas.element("section", { className: "operator-visualizer microscope microscope--gemm" });
    visualizer.dataset.visualizerMode = "gemm";
    visualizer.append(
      Atlas.element("h3", { text: "GEMM tile microscope" }),
      Atlas.element("p", { className: "visualizer-formula", text: "D = A @ B + C" }),
    );
    const labels = Atlas.element("div", { className: "microscope-dimensions" });
    labels.append(
      Atlas.element("span", { text: `M ${dimensions.M ?? "?"}` }),
      Atlas.element("span", { text: `N ${dimensions.N ?? "?"}` }),
      Atlas.element("span", { text: `K ${dimensions.K ?? "?"}` }),
      Atlas.element("span", { text: "Schematic 3-way K partition" }),
    );
    const canvas = microscopeCanvas("A row tiles multiply B column tiles and reduce along K into one D output tile", 260);
    visualizer.append(labels, canvas);
    animationControls(visualizer, 36, (frame) => {
      clearSvg(canvas);
      const outputTile = Math.floor(frame / 4);
      const phase = frame % 4;
      const kTile = Math.min(phase, 2);
      const outputCoordinates = Array.from(
        { length: 9 },
        (_unused, index) => [Math.floor(index / 3), index % 3],
      );
      const [mTile, nTile] = outputCoordinates[outputTile];
      const written = phase === 3;
      const completedCoordinates = outputCoordinates.slice(0, outputTile);
      canvas.append(
        svgElement("text", { x: 14, y: 24, class: "microscope-phase" }, written
          ? `Write D[${mTile},${nTile}] after the K reduction`
          : `D[${mTile},${nTile}] uses A row ${mTile} @ B column ${nTile} · K tile ${kTile + 1}/3`),
        svgElement("text", { x: 125, y: 103, class: "microscope-symbol", "text-anchor": "middle" }, "@"),
        svgElement("text", { x: 276, y: 88, class: "gemm-flow-label", "text-anchor": "middle" }, "reduce K + C"),
        svgElement("path", { d: "M 245 103 H 304", class: "gemm-flow-arrow" }),
        svgElement("path", { d: "M 304 99 L 311 103 L 304 107 Z", class: "gemm-flow-arrow-head" }),
      );
      diagramMatrixGrid(canvas, {
        x: 22,
        y: 66,
        label: "A  [M × K]",
        rowAxis: "M tiles",
        columnAxis: "K tiles →",
        role: "a-matrix",
        lane: (row) => row === mTile,
        focus: (row, column) => !written && row === mTile && column === kTile,
        focusLabel: "A",
      });
      diagramMatrixGrid(canvas, {
        x: 154,
        y: 66,
        label: "B  [K × N]",
        rowAxis: "K tiles",
        columnAxis: "N tiles →",
        role: "b-matrix",
        lane: (_row, column) => column === nTile,
        focus: (row, column) => !written && row === kTile && column === nTile,
        focusLabel: "B",
      });
      diagramMatrixGrid(canvas, {
        x: 326,
        y: 66,
        label: "D  [M × N]",
        rowAxis: "M tiles",
        columnAxis: "N tiles →",
        role: "d-matrix",
        lane: (row, column) => row === mTile && column === nTile,
        focus: (row, column) => row === mTile && column === nTile,
        complete: (row, column) => completedCoordinates.some(([m, n]) => m === row && n === column),
        focusLabel: written ? "D" : `${kTile + 1}/3`,
        written,
      });
      canvas.append(
        svgElement("rect", { x: 55, y: 166, width: 310, height: 50, rx: 8, class: `gemm-accumulator${written ? " is-written" : ""}` }),
        svgElement("text", { x: 210, y: 185, class: "gemm-accumulator-label", "text-anchor": "middle" }, written
          ? `D[${mTile},${nTile}] = C[${mTile},${nTile}] +`
          : `acc[${mTile},${nTile}] = C[${mTile},${nTile}] +`),
        svgElement("text", { x: 210, y: 202, class: "gemm-accumulator-label", "text-anchor": "middle" }, written
          ? `Σₖ A[${mTile},k] @ B[k,${nTile}]`
          : `Σ(k=0..${kTile}) A[${mTile},k] @ B[k,${nTile}]`),
      );
      diagramKReduction(canvas, kTile, written);
      return phase < 3
        ? `D tile row ${mTile}, column ${nTile}: accumulate K tile ${kTile + 1} of 3`
        : `Write D tile row ${mTile}, column ${nTile}`;
    });
    return visualizer;
  }

  function firstNumber(values) {
    return values.find((value) => typeof value === "number") ?? null;
  }

  function renderAttentionVisualizer(operator) {
    const bindings = operator.scope_bindings;
    const queryLength = firstNumber([bindings.SQ, bindings.S, bindings.T]);
    const keyValueLength = firstNumber([bindings.SKV, bindings.S, bindings.T]);
    const visualizer = Atlas.element("section", { className: "operator-visualizer microscope microscope--attention" });
    visualizer.dataset.visualizerMode = "attention";
    visualizer.appendChild(Atlas.element("h3", { text: "Attention tile microscope" }));
    const dimensions = Atlas.element("dl", { className: "attention-dimensions microscope-dimensions" });
    [
      ["Query length", queryLength],
      ["Key/value length", keyValueLength],
      ["Head count", bindings.H],
      ["Head dimension", bindings.HD],
    ].forEach(([label, value]) => dimensions.appendChild(modelSummaryFact(label, value ?? "unresolved")));
    const canvas = microscopeCanvas("Tiled attention from query-key scores through softmax and value projection");
    visualizer.append(dimensions, canvas);
    animationControls(visualizer, 8, (frame) => {
      clearSvg(canvas);
      const scorePhase = frame < 3;
      const scalePhase = frame === 3;
      const softmaxPhase = frame === 4;
      const valuePhase = frame > 4;
      diagramTile(canvas, 12, 64, 56, 62, "Q", scorePhase ? "is-active" : "is-complete", "query-tile");
      diagramTile(canvas, 82, 64, 56, 62, "Kᵀ", scorePhase ? "is-active" : "is-complete", "key-tile");
      diagramTile(canvas, 158, 64, 68, 62, scorePhase ? `QKᵀ ${frame + 1}/3` : "scores", (scorePhase || scalePhase) ? "is-active" : "is-complete", "score-tile");
      diagramTile(canvas, 246, 64, 68, 62, softmaxPhase ? "softmax row" : "P", (scalePhase || softmaxPhase) ? "is-active" : (valuePhase ? "is-complete" : ""), "probability-tile");
      diagramTile(canvas, 328, 64, 38, 62, "V", valuePhase ? "is-active" : "", "value-tile");
      diagramTile(canvas, 378, 64, 38, 62, "O", valuePhase ? "is-written" : "", "attention-output-tile");
      canvas.appendChild(svgElement("text", { x: 12, y: 28, class: "microscope-phase" }, scorePhase
        ? `Tiled QKᵀ · score tile ${frame + 1} of 3`
        : scalePhase
          ? "Scale scores and apply the declared mask"
          : softmaxPhase
            ? "Normalize one score row with softmax"
            : `Tiled P V · output tile ${frame - 4} of 3`));
      if (scorePhase) return `QK transpose score tile ${frame + 1} of 3`;
      if (scalePhase) return "Scale and mask scores";
      if (softmaxPhase) return "Row softmax";
      return `P V output tile ${frame - 4} of 3`;
    });
    return visualizer;
  }

  function renderConvVisualizer(operator) {
    const bindings = operator.scope_bindings;
    const visualizer = Atlas.element("section", { className: "operator-visualizer microscope microscope--conv" });
    visualizer.dataset.visualizerMode = "conv";
    visualizer.append(
      Atlas.element("h3", { text: "Patch convolution microscope" }),
      Atlas.element("p", { className: "visualizer-formula", text: "patch · weight → output" }),
    );
    const dimensions = Atlas.element("div", { className: "microscope-dimensions" });
    [
      `Image ${bindings.H} × ${bindings.W}`,
      `Patch ${bindings.P} × ${bindings.P}`,
      `Stride ${bindings.P} × ${bindings.P}`,
      `Channels ${bindings.C}`,
      `Tokens / view ${bindings.T}`,
      `Output width ${bindings.D}`,
    ].forEach((label) => dimensions.appendChild(Atlas.element("span", { text: label })));
    dimensions.appendChild(Atlas.element("span", { text: "Illustrative math · not a runtime tile" }));
    const canvas = microscopeCanvas(
      "Illustrative patch embedding math with an exact image patch lattice and matching output token lattice",
      248,
    );
    visualizer.append(dimensions, canvas);

    const valid = [bindings.H, bindings.W, bindings.P, bindings.C, bindings.T, bindings.D]
      .every((value) => Number.isSafeInteger(value) && value > 0)
      && bindings.H % bindings.P === 0
      && bindings.W % bindings.P === 0;
    const rows = valid ? bindings.H / bindings.P : null;
    const columns = valid ? bindings.W / bindings.P : null;
    const frameCount = rows && columns ? rows * columns : null;
    if (!valid || frameCount !== bindings.T) {
      clearSvg(canvas);
      canvas.append(
        svgElement("text", { x: 18, y: 36, class: "microscope-phase" }, "Static view: patch lattice is unresolved"),
        svgElement("text", { x: 18, y: 64, class: "microscope-caption" }, "The declared image, patch, and token dimensions do not form one honest non-overlapping lattice."),
      );
      visualizer.appendChild(Atlas.element("p", {
        className: "conv-static-fallback",
        text: "Animation is unavailable because H/P, W/P, or the token count is inconsistent.",
      }));
      return visualizer;
    }

    const inputX = 12;
    const outputX = 296;
    const gridY = 64;
    const gridSize = 112;
    const inputCell = gridSize / columns;
    const outputCell = gridSize / columns;
    const weightRows = 7;
    const weightColumns = 7;
    const weightCell = 8;
    animationControls(visualizer, frameCount, (frame) => {
      clearSvg(canvas);
      const row = Math.floor(frame / columns);
      const column = frame % columns;
      const pixelYStart = row * bindings.P;
      const pixelYEnd = pixelYStart + bindings.P - 1;
      const pixelXStart = column * bindings.P;
      const pixelXEnd = pixelXStart + bindings.P - 1;
      const flattenedPatch = bindings.P * bindings.P * bindings.C;

      canvas.append(
        svgElement("text", { x: 12, y: 24, class: "microscope-phase" }, `Patch ${frame + 1}/${frameCount} · row ${row + 1}, column ${column + 1}`),
        svgElement("text", { x: inputX, y: 49, class: "conv-grid-label" }, "INPUT IMAGE"),
        svgElement("text", { x: inputX + gridSize, y: 49, class: "conv-grid-meta", "text-anchor": "end" }, `${rows}×${columns} patch lattice`),
        svgElement("text", { x: 151, y: 49, class: "conv-grid-label" }, "KERNEL / WEIGHT"),
        svgElement("text", { x: outputX, y: 49, class: "conv-grid-label" }, "OUTPUT TOKENS"),
      );

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const active = x === column && y === row;
          canvas.appendChild(svgElement("rect", {
            x: inputX + x * inputCell,
            y: gridY + y * inputCell,
            width: inputCell,
            height: inputCell,
            class: `conv-lattice-cell conv-input-cell${active ? " is-active" : ""}`,
            "data-tile-role": active ? "input-receptive-field" : "input-patch-cell",
            "data-row": y + 1,
            "data-column": x + 1,
          }));
          canvas.appendChild(svgElement("rect", {
            x: outputX + x * outputCell,
            y: gridY + y * outputCell,
            width: outputCell,
            height: outputCell,
            class: `conv-lattice-cell conv-output-cell${active ? " is-written" : ""}`,
            "data-tile-role": active ? "output-token" : "output-token-cell",
            "data-token-index": y * columns + x + 1,
          }));
        }
      }

      const weightGroup = svgElement("g", {
        class: "conv-weight-panel",
        "data-tile-role": "weight-panel",
      });
      weightGroup.appendChild(svgElement("rect", {
        x: 151,
        y: 64,
        width: 120,
        height: 112,
        rx: 9,
      }));
      for (let y = 0; y < weightRows; y += 1) {
        for (let x = 0; x < weightColumns; x += 1) {
          weightGroup.appendChild(svgElement("rect", {
            x: 183 + x * weightCell,
            y: 78 + y * weightCell,
            width: weightCell - 1,
            height: weightCell - 1,
            class: "conv-weight-cell",
          }));
        }
      }
      weightGroup.append(
        svgElement("text", { x: 211, y: 147, class: "conv-weight-symbol", "text-anchor": "middle" }, "[P²C × D]"),
        svgElement("text", { x: 211, y: 162, class: "conv-grid-meta", "text-anchor": "middle" }, `[${flattenedPatch} × ${bindings.D}]`),
      );
      canvas.appendChild(weightGroup);
      canvas.append(
        svgElement("text", { x: 137, y: 120, class: "microscope-symbol", "text-anchor": "middle" }, "·"),
        svgElement("text", { x: 283, y: 113, class: "microscope-symbol", "text-anchor": "middle" }, "Σ"),
        svgElement("text", { x: 283, y: 130, class: "conv-grid-meta", "text-anchor": "middle" }, "accumulate"),
        svgElement("text", { x: 12, y: 200, class: "microscope-caption" }, `Current P×P×C patch: ${bindings.P}×${bindings.P}×${bindings.C}`),
        svgElement("text", { x: 12, y: 216, class: "microscope-caption" }, `Pixels y ${pixelYStart}–${pixelYEnd}, x ${pixelXStart}–${pixelXEnd} → output token ${frame + 1}`),
        svgElement("text", { x: 12, y: 236, class: "conv-illustrative-note" }, "Illustrative math: one true stride-P patch advances per step; this is not a runtime tile."),
      );
      return `Patch ${frame + 1}/${frameCount} · row ${row + 1}, column ${column + 1} · pixels y ${pixelYStart}–${pixelYEnd}, x ${pixelXStart}–${pixelXEnd} → token ${frame + 1}`;
    });
    return visualizer;
  }

  function visualizerTensorChip(port) {
    const label = `${port.port} [${concreteShape(port.tensor)}]`;
    return Atlas.element("span", { className: "basic-tensor-chip", text: label });
  }

  function renderBasicVisualizer(operator) {
    const visualizer = Atlas.element("section", { className: "operator-visualizer basic-visualizer" });
    visualizer.appendChild(Atlas.element("h3", { text: "Operator semantics" }));
    const flow = Atlas.element("div", { className: "basic-operator-flow" });
    const inputs = Atlas.element("div", { className: "basic-tensors" });
    operator.input_tensors.forEach((port) => inputs.appendChild(visualizerTensorChip(port)));
    const outputs = Atlas.element("div", { className: "basic-tensors" });
    operator.output_tensors.forEach((port) => outputs.appendChild(visualizerTensorChip(port)));
    flow.append(
      inputs,
      Atlas.element("span", { className: "visualizer-arrow", text: "→" }),
      Atlas.element("span", { className: "basic-formula", text: operator.definition.formula_display }),
      Atlas.element("span", { className: "visualizer-arrow", text: "→" }),
      outputs,
    );
    visualizer.appendChild(flow);
    return visualizer;
  }

  function renderVisualizer(operator) {
    switch (operator.definition.visualizer) {
      case "gemm": return renderGemmVisualizer(operator);
      case "attention": return renderAttentionVisualizer(operator);
      case "conv": return renderConvVisualizer(operator);
      case "basic": return renderBasicVisualizer(operator);
      default: return renderBasicVisualizer(operator);
    }
  }

  function renderOperatorDetail() {
    cancelAnimation();
    Atlas.clear(targets.detail);
    const operator = selectedOperator();
    if (!operator) {
      targets.detail.appendChild(Atlas.element("p", { className: "empty-state", text: "Select an atomic operator." }));
      return;
    }
    targets.detail.append(
      Atlas.element("p", { className: "detail-eyebrow", text: `${operator.definition.category} · ${operator.definition_id}` }),
      Atlas.element("h2", { text: operator.label }),
      Atlas.element("p", { className: "operator-formula", text: operator.definition.formula_display }),
    );
    if (operator.unresolved_symbols.length) {
      targets.detail.appendChild(Atlas.element("p", {
        className: "binding-warning",
        text: `Unresolved symbols: ${[...new Set(operator.unresolved_symbols)].join(", ")}. Symbolic axes are retained below.`,
      }));
    }
    targets.detail.append(
      renderTensorShapes("Input shapes", operator.input_tensors),
      renderTensorShapes("Output shapes", operator.output_tensors),
    );
    targets.detail.append(renderAnalysis(operator), renderVisualizer(operator));
  }

  function renderWorkspace() {
    renderStages();
    renderModules();
    renderComponents();
    renderOperators();
    renderBreadcrumb();
    renderOperatorDetail();
  }

  function recompute() {
    state.materialized = materializeGraph(state.overrides);
    state.selection = normalizedSelection(state.selection);
    renderDerivedSymbols();
    renderWorkspace();
    syncHash();
  }

  const defaultBindings = pageData.default_materialization.bindings || {};
  graph.shape_symbols.filter((item) => item.editable).forEach((item) => {
    state.overrides[item.symbol] = defaultBindings[item.symbol] ?? item.default;
  });
  state.materialized = materializeGraph(state.overrides);
  state.selection = normalizedSelection(selectionFromHash());
  renderSummary();
  renderControls();
  renderWorkspace();
  syncHash();

  window.addEventListener("hashchange", () => {
    cancelAnimation();
    state.selection = normalizedSelection(selectionFromHash());
    updateDagSelection();
    renderBreadcrumb();
    renderOperatorDetail();
    syncHash();
  });
}());
