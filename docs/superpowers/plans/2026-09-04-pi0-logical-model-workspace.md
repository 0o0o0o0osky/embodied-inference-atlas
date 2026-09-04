# Pi0 Logical Model Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one reviewable Pi0 model-first workspace that explains the logical model as stages, repeated modules, tensors, and atomic operators, with safe workload-driven shape evaluation and operator visualizers, while adding no runtime, hardware, profiler, or performance evidence.

**Architecture:** Add one closed, self-contained `model_graphs` record for Pi0. It embeds the first operator-definition and block-template vocabulary so the visual and data contract can be reviewed before that vocabulary is normalized across more models. Python validates internal graph references and evaluates a deliberately small arithmetic AST; the static builder embeds the validated record and a default materialization; browser JavaScript mirrors the same evaluator for local interactions. Pi0 receives the new workspace, while Pi0.5 and SmolVLA keep their current legacy pages.

**Tech Stack:** Python 3.10+ standard library, JSON, `unittest`, HTML5, CSS, vanilla JavaScript, vendored Apache ECharts 5.6.0, Git.

**Spec:** `docs/superpowers/specs/2026-09-04-model-operator-workspace-design.md`

## Global Constraints

- This increment covers Pi0 only. Do not create Pi0.5, SmolVLA, WM, WAM, or hybrid logical graphs.
- “No data” means no new run, latency, runtime realization, execution configuration, hardware result, Nsys event, NCU metric, kernel mapping, or roofline point. The Pi0 model definition itself is canonical metadata and is the only new model record.
- Do not modify files under `data/measurements/`, add profiler schemas, or infer execution behavior from existing measurements.
- Keep `data/architectures/pi0.json` as the legacy summary. Do not rewrite or delete the legacy architecture contract in this increment.
- Use canonical Pi0 model semantics: action horizon `50`, latent state/action width `32`, prompt capacity `48`, and default flow integration count `10`. Do not substitute FlashRT’s task-specific action chunk or physical robot DoF.
- Treat one to three camera views and actual prompt length as user bindings. Image resolution is `224×224`, patch size is `14×14`, and each view contributes `256` vision tokens.
- Use the official OpenPI public repository as the primary model source. Realtime-VLA may corroborate structure and inspire presentation, but it does not define the framework-independent graph.
- Do not add local paths, private revisions, host identifiers, or references to unrelated local projects to canonical JSON or generated HTML.
- Formula display strings and executable expressions are separate. Neither Python nor JavaScript may use `eval`, `exec`, `Function`, or code generation.
- Keep tests narrow: one graph-contract test, one representative Pi0 workload test, and the existing offline build smoke test updated for the workspace. Do not add browser automation, cross-products, fuzzing, stress tests, inference tests, or profiler tests.
- Generate `site/` only through `python3 -m tools.build`; never hand-edit generated files.

## Phase Boundary

This slice deliberately implements:

- a model-first home card for Pi0;
- a hand-authored Pi0 logical dataflow;
- stage → repeated module → atomic operator navigation;
- structured symbolic and concrete tensor shapes;
- workload controls for camera views, prompt length, action horizon, and denoise steps;
- formula, multiplicity, analytical operation-count expressions, and GEMM/attention/basic visualizers;
- one visible `Structure-only review` scope note; execution and performance panels are not rendered before a runtime/hardware selection model exists.

This slice deliberately defers:

- normalized cross-model `operator_definitions` and `block_templates` datasets;
- runtime and hardware selectors;
- precision and quantization scenario selectors;
- byte traffic and arithmetic intensity, because they require an explicit runtime or what-if dtype/quantization contract rather than a model-only assumption;
- fusion, split, fallback, execution-group, and kernel overlays;
- any measured metric or modeled latency, throughput, bandwidth, utilization, or roofline value.

The self-contained Pi0 record is a review boundary, not a permanent claim that reusable definitions must stay embedded. Normalize it only after the Pi0 information hierarchy and interactions have been reviewed.

## Model Graph Contract

Register `model_graphs` with primary key `model_graph_id`, data glob `data/model_graphs/*.json`, and schema `schema/model_graphs.schema.json`. A record has these closed top-level fields:

```text
model_graph_id, model_id, label, version, source_ids,
shape_symbols, operator_definitions, block_templates,
graph_tensors, stages, graph_inputs, graph_outputs
```

Use these nested records:

- `shape_symbols[]`: `symbol`, `label`, `semantic`, `editable`, `default`, `minimum`, `maximum`, `expression`. Exactly one of `default` and `expression` is non-null. Base symbols have a numeric default; editable bases have explicit bounds, while fixed constants use equal minimum/default/maximum values. Derived symbols have an expression, null default/bounds, and `editable: false`.
- `operator_definitions[]`: `definition_id`, `label`, `category`, `formula_display`, `visualizer`, `parameters`, `input_ports`, `output_ports`, `analysis`. `parameters` declares definition-local analysis symbols such as `M`, `N`, and `K`; `visualizer` is one of `gemm`, `attention`, or `basic`.
- `analysis[]`: `metric`, `unit`, `scope`, `expression`. The initial metrics are `flops`, `read_elements`, and `write_elements`; an operator may leave this array empty when no defensible counting convention is curated.
- `block_templates[]`: `template_id`, `label`, `parameters`, `input_ports`, `output_ports`, `tensors`, `operators`. Definition ports are string names; template ports are port-binding records that map the public port name to a template tensor.
- Template and graph `tensors[]`: `tensor_id`, `label`, `semantic_role`, `axes`, `producer`, `consumers`. Each axis is `axis` plus an expression. An endpoint is `node_kind`, `node_id`, and `port`; template endpoints use `node_kind: operator`, while graph endpoints use `module` or the stage’s declared `loop` pseudo-node.
- Template `operators[]`: `operator_id`, `label`, `definition_id`, `multiplicity`, `inputs`, `outputs`, `bindings`.
- Stage `modules[]`: `module_id`, `label`, `template_id`, `repeat`, `bindings`, `inputs`, `outputs`, `indexed_inputs`. An indexed input record contains `port`, `tensor_id`, `axis`, and `index_source: module_repeat_index`; it annotates a repeated module’s matching slice from an aggregate tensor without claiming a runtime layout.
- Port bindings: `port`, `tensor_id`.
- Symbol bindings: `symbol`, `expression`.
- `stages[]`: `stage_id`, `label`, `description`, `repeat`, `loop_carried`, `modules`. `loop_carried` is either null or contains `loop_id`, `initial_tensor_id`, `iteration_input_tensor_id`, `iteration_output_tensor_id`, and `final_tensor_id`.
- `graph_inputs` and `graph_outputs`: arrays of graph tensor IDs.

Expressions use only this recursive JSON grammar:

```text
Expression := finite number
            | {"symbol": non-empty-string}
            | {"op": "add" | "sub" | "mul" | "div" | "ceil_div",
               "args": [Expression, ...]}
```

`add` and `mul` require at least two arguments. `sub`, `div`, and `ceil_div` require exactly two. Unknown symbols, cycles, division by zero, non-finite results, fractional tensor axes, and negative shape/count results are validation errors.

Evaluation scopes are deterministic and do not shadow one another:

1. resolve global base and derived `shape_symbols`;
2. evaluate stage/module repeats against global symbols only;
3. require every module to bind every referenced template parameter exactly once, with expressions evaluated against global symbols only;
4. evaluate template tensor axes and operator multiplicity against the resulting template-parameter environment only;
5. require every operator to bind every referenced definition parameter exactly once, with expressions evaluated against template parameters only;
6. evaluate definition analysis expressions against the resulting definition-parameter environment only.

Extra bindings, missing bindings, duplicate names within one scope, references to a sibling binding, and implicit lookup into an outer scope are errors. A target parameter may reuse an outer symbol name only through an explicit binding. Python and JavaScript must follow this same order. Each materialized operator retains its resolved definition bindings, analysis metric/unit/scope/value records, symbolic tensor axes, and concrete tensor shapes.

The materialized browser payload keeps repeated blocks folded. It emits one representative template body plus `stage_repeat`, `module_repeat`, and `effective_repeat`; it must not duplicate 27 vision blocks, 18 prefix blocks, or 180 action-expert block invocations in HTML. Its top-level `named_repeats` map is keyed by module ID and contains each module's effective repeat after applying its enclosing stage repeat. Its `operators_by_id` map uses `stage-id/module-id/operator-id` keys and each value contains `analysis_by_metric` for direct UI lookup.

---

### Task 1: Add the closed graph contract and safe expression engine

**Files:**

- Create: `schema/model_graphs.schema.json`
- Create: `tools/lib/model_graph.py`
- Modify: `tests/helpers.py`
- Modify: `tests/test_validation.py`

**Interfaces:**

- `evaluate_expression(expression: object, bindings: Mapping[str, int | float]) -> int | float`
- `resolve_symbols(symbols: Sequence[Mapping[str, object]], overrides: Mapping[str, int | float] | None = None) -> dict[str, int | float]`
- `materialize_model_graph(record: Mapping[str, object], overrides: Mapping[str, int | float] | None = None) -> dict[str, object]`
- `graph_semantic_problems(record: Mapping[str, object]) -> list[GraphProblem]`
- `GraphProblem(path: str, code: str, message: str)` is local to `tools.lib.model_graph`; `tools.lib.contracts` translates it to the existing `Issue` type.

- [ ] **Step 1: Add one failing representative contract test**

Add `valid_model_graph_document()` to `tests/helpers.py`. Keep the fixture minimal: two base symbols (`B=1`, editable `V=3`), one derived symbol (`S=V×256`), one `linear` definition, one one-operator template, one stage/module, and input/output tensors.

Add this single test to `ValidationTests` in `tests/test_validation.py`:

```python
def test_model_graph_expression_and_internal_reference(self):
    document = valid_model_graph_document()
    graph = document["records"][0]
    self.assertEqual(graph_semantic_problems(graph), [])
    materialized = materialize_model_graph(graph, {"V": 3})
    self.assertEqual(materialized["bindings"]["S"], 768)
    self.assertEqual(
        materialized["stages"][0]["modules"][0]["outputs"][0]["shape"],
        [1, 768, 8],
    )

    graph["stages"][0]["modules"][0]["template_id"] = "missing-template"
    self.assertIn(
        "broken_reference",
        [problem.code for problem in graph_semantic_problems(graph)],
    )
```

Import `graph_semantic_problems` and `materialize_model_graph` from `tools.lib.model_graph`, and `valid_model_graph_document` from `tests.helpers`. Do not add separate tests for every AST operator.

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run:

```bash
python3 -m unittest tests.test_validation.ValidationTests.test_model_graph_expression_and_internal_reference -v
```

Expected: FAIL because `tools.lib.model_graph` does not exist.

- [ ] **Step 3: Implement the expression engine and folded materializer**

Create `tools/lib/model_graph.py` with no dependencies outside the standard library. Implement the expression grammar exactly as specified above with explicit type checks and an operation dispatch dictionary. Raise `ValueError` for direct evaluator misuse; convert validation failures to `GraphProblem` in `graph_semantic_problems`.

`resolve_symbols` must:

1. reject override keys that are not editable symbols;
2. enforce minimum/maximum bounds on editable values;
3. resolve derived symbols topologically;
4. report a deterministic error for unknown symbols or cycles.

`materialize_model_graph` must:

1. resolve global symbols;
2. evaluate graph tensor axes;
3. resolve each stage repeat;
4. evaluate module bindings into a template-only parameter environment;
5. evaluate each operator binding into a definition-only parameter environment;
6. materialize one copy of each referenced template’s tensors and operators;
7. emit concrete input/output shapes, resolved definition bindings, analytical expression records, and effective repeat counts without expanding repeated instances.

- [ ] **Step 4: Add the closed schema and semantic checks**

Create `schema/model_graphs.schema.json` using the repository’s existing small contract language, but do not register it in the manifest until the canonical Pi0 document is added in Task 2. This keeps the Task 1 commit valid without a temporary empty dataset. Close every record with `additional_properties: false`. The recursive expression object may expose only `symbol`, `op`, and `args`; conditional shape and arity rules belong in `graph_semantic_problems` because the internal schema language has no union discriminator or recursive reference support.

Internal semantic validation must cover only these necessary invariants:

- unique symbol, definition, template, stage, module, operator, and tensor IDs in their scopes;
- valid expression grammar and known symbols;
- acyclic derived symbols;
- module → template and operator → definition references;
- port names declared by the referenced template/definition;
- input/output tensor IDs present in the corresponding graph/template tensor set;
- graph input/output tensor IDs present;
- bidirectional agreement between every node port binding and the corresponding tensor-owned producer/consumer endpoint;
- null producers only for declared graph/template inputs or declared loop-carried iteration inputs;
- empty consumers only for declared graph/template outputs or declared loop-carried iteration outputs;
- at most one producer for a tensor inside a graph or template;
- valid loop-carried initial → iteration input and iteration output → final/back-edge tensor references;
- indexed inputs refer to an existing module input, a named tensor axis, and a module with integral repeat;
- concrete shape/count expressions evaluate to finite non-negative integers for defaults.

- [ ] **Step 5: Run the focused test**

Run:

```bash
python3 -m unittest tests.test_validation.ValidationTests.test_model_graph_expression_and_internal_reference -v
python3 -m json.tool schema/model_graphs.schema.json >/dev/null
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the graph foundation**

```bash
git add schema/model_graphs.schema.json tools/lib/model_graph.py tests/helpers.py tests/test_validation.py
git commit -m "feat: add logical model graph contract"
```

---

### Task 2: Hand-author the canonical Pi0 logical graph

**Files:**

- Create: `data/model_graphs/pi0.json`
- Modify: `schema/manifest.json`
- Modify: `tools/lib/contracts.py`
- Modify: `tools/validate.py`
- Modify: `data/catalog/sources.json`
- Modify: `data/catalog/models.json`
- Modify: `tests/test_validation.py`

**Interfaces:**

- `model_graph_id`: `pi0-logical-v1`
- `model_id`: `pi0`
- Primary provenance: `source-openpi`
- Presentation/implementation corroboration: existing `source-realtime-vla`
- Graph `source_ids`: `["source-openpi", "source-realtime-vla"]`
- Default model bindings: `B=1`, `V=3`, `L_PROMPT=48`, `T_ACTION=50`, `N_DENOISE=10`

- [ ] **Step 1: Write the failing representative Pi0 workload test**

Add only one new test method to `ValidationTests`:

```python
def test_pi0_representative_workload_materializes(self):
    document = load_json(ROOT / "data" / "model_graphs" / "pi0.json")
    self.assertEqual(validate_document("model_graphs", document, ROOT), [])
    graph = document["records"][0]
    materialized = materialize_model_graph(
        graph,
        {"V": 3, "L_PROMPT": 20, "T_ACTION": 50, "N_DENOISE": 10},
    )
    self.assertEqual(materialized["bindings"]["S_PREFIX"], 788)
    self.assertEqual(materialized["bindings"]["S_SUFFIX"], 51)
    self.assertEqual(materialized["bindings"]["S_ATTENTION"], 839)
    self.assertEqual(materialized["named_repeats"]["vision-blocks"], 27)
    self.assertEqual(materialized["named_repeats"]["prefix-blocks"], 18)
    self.assertEqual(materialized["named_repeats"]["action-expert-blocks"], 180)
    self.assertEqual(materialized["graph_outputs"][0]["shape"], [1, 50, 32])
    projection = materialized["operators_by_id"][
        "vision-encoder/vision-projector/project"
    ]
    self.assertEqual(projection["analysis_by_metric"]["flops"], 3_623_878_656)
```

Use the existing `load_json` helper. `named_repeats` is keyed by module ID and stores effective repeat after the enclosing stage repeat is applied.

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run:

```bash
python3 -m unittest tests.test_validation.ValidationTests.test_pi0_representative_workload_materializes -v
```

Expected: ERROR because `data/model_graphs/pi0.json` does not exist.

- [ ] **Step 3: Add public OpenPI provenance**

Append this sanitized source record to `data/catalog/sources.json`:

```json
{
  "source_id": "source-openpi",
  "evidence": "reported_external",
  "title": "OpenPI public repository",
  "url": "https://github.com/Physical-Intelligence/openpi",
  "published_date": null,
  "accessed_date": "2026-09-04",
  "summary": "Primary public implementation and configuration source for the Pi0 logical model definition."
}
```

Add `source-openpi` to the Pi0 model record’s `source_ids`. Do not add a local vendored path or local commit as canonical provenance.

- [ ] **Step 4: Define Pi0 symbols and top-level tensors**

Create `data/model_graphs/pi0.json` with one record. Define the following base symbols. `B` is a non-editable constant; the remaining four are editable workload bindings:

| Symbol | Default | Bounds | Meaning |
|---|---:|---:|---|
| `B` | 1 | fixed | batch |
| `V` | 3 | 1–3 | active camera views |
| `L_PROMPT` | 48 | 0–48 | executed prompt tokens |
| `T_ACTION` | 50 | 1–50 | action horizon |
| `N_DENOISE` | 10 | 1–10 | Euler/flow steps |

Define non-editable constants and derived symbols:

```text
H_IMAGE=224, W_IMAGE=224, C_IMAGE=3, PATCH=14,
T_VIEW=256, D_VISION=1152, D_VISION_MLP=4304,
N_VISION_LAYERS=27, N_VISION_HEADS=16, D_VISION_HEAD=72,
D_PREFIX=2048, D_PREFIX_MLP=16384, N_PREFIX_LAYERS=18,
D_ACTION=1024, D_ACTION_MLP=4096, N_ACTION_LAYERS=18,
N_QUERY_HEADS=8, N_KV_HEADS=1, D_HEAD=256, D_LATENT_ACTION=32,
S_PREFIX=V*T_VIEW+L_PROMPT,
S_SUFFIX=T_ACTION+1,
S_ATTENTION=S_PREFIX+S_SUFFIX
```

Represent these top-level logical tensors with named axes and no runtime layout claim:

- images `[B,V,H_IMAGE,W_IMAGE,C_IMAGE]`;
- prompt token IDs `[B,L_PROMPT]`;
- state `[B,D_LATENT_ACTION]`;
- initial noise/action state `[B,T_ACTION,D_LATENT_ACTION]`;
- per-iteration action state `[B,T_ACTION,D_LATENT_ACTION]`;
- projected view tokens `[B,V,T_VIEW,D_PREFIX]`;
- prefix tokens `[B,S_PREFIX,D_PREFIX]`;
- per-layer prefix K/V `[N_PREFIX_LAYERS,2,B,N_KV_HEADS,S_PREFIX,D_HEAD]`;
- suffix tokens `[B,S_SUFFIX,D_ACTION]`;
- velocity `[B,T_ACTION,D_LATENT_ACTION]`;
- updated action state `[B,T_ACTION,D_LATENT_ACTION]`;
- final action state `[B,T_ACTION,D_LATENT_ACTION]`.

Mark images, prompt token IDs, state, and initial noise/action state as graph inputs. Mark final action state as the sole graph output. The task-specific unnormalization and physical-DoF slice are outside this logical model graph.

For every graph tensor, persist the producing module/loop port (or null) and all consuming module/loop ports. For every template tensor, persist the producing operator port (or null) and all consuming operator ports. Module/operator `inputs` and `outputs` repeat the same relationships from the node side so validation can reject mismatches. A declared input may have a null producer; a declared output may have no consumers.

- [ ] **Step 5: Define the initial operator vocabulary**

Add definitions for exactly these logical operations:

```text
patch-embedding, token-embedding, linear, layer-norm, rms-norm,
rope, attention-core, gelu, silu, elementwise-multiply,
residual-add, concat, reshape, sinusoidal-time-embedding, euler-update
```

Use `gemm` for patch embedding and linear visualizers, `attention` for `attention-core`, and `basic` for every other definition. Keep each human formula in `formula_display`. Give `linear` the definition parameters `M`, `N`, and `K`, then add these precision-neutral analytical expressions:

```json
{
  "flops": {"op":"mul","args":[2,{"symbol":"M"},{"symbol":"N"},{"symbol":"K"}]},
  "read_elements": {"op":"add","args":[
    {"op":"mul","args":[{"symbol":"M"},{"symbol":"K"}]},
    {"op":"mul","args":[{"symbol":"K"},{"symbol":"N"}]}
  ]},
  "write_elements": {"op":"mul","args":[{"symbol":"M"},{"symbol":"N"}]}
}
```

Store these as three `analysis` records rather than one JSON object. Their scope text must state that multiply and add count as two FLOPs, logical operand elements are counted once, and bias, activation, cache behavior, runtime dtype, packing, quantization metadata, and fusion are excluded. Do not convert elements to bytes in this phase: byte traffic and arithmetic intensity require a later explicit precision/quantization scenario. Do not invent FLOP formulas for normalization, activation, RoPE, embedding lookup, or Euler update; leave their `analysis` arrays empty in this review slice.

The `attention-core` formula display is:

```text
QK^T -> scale/mask -> softmax -> P V
```

Its tensor shapes must expose query length, key/value length, query-head count, KV-head count, and head dimension. Do not claim that it is one fused runtime kernel.

- [ ] **Step 6: Define reusable Pi0 block templates**

Create these templates and keep all tensor edges explicit through shared tensor IDs and operator ports:

1. `image-patch-embedding`: patch projection from RGB images to `256` tokens/view.
2. `siglip-transformer-block`: LayerNorm; Q/K/V projections; attention core; output projection; residual; LayerNorm; up projection; GELU; down projection; residual.
3. `layer-normalization`: one standalone LayerNorm for the vision-tower output.
4. `multimodal-projector`: `1152 → 2048` linear projection with internal operator ID `project`; instantiate it as module ID `vision-projector`.
5. `prompt-prefix-builder`: token embedding, reshape/flatten view tokens, and concat to `S_PREFIX`.
6. `gemma-prefix-block`: RMSNorm; MQA Q/K/V projections; RoPE; attention core; output projection; residual; RMSNorm; gate/up projections; GELU; elementwise gate; down projection; residual; logical K/V cache output.
7. `action-suffix-builder`: state projection; noisy-action projection; sinusoidal timestep embedding; action/time concat; two-layer SiLU MLP; concat of one state token and `T_ACTION` action tokens.
8. `gemma-action-expert-block`: RMSNorm; action Q/K/V projections; RoPE; concat with the matching cached prefix K/V; attention over `S_ATTENTION`; output projection; residual; RMSNorm; gate/up projections; GELU; elementwise gate; down projection; residual.
9. `velocity-euler-update`: final RMSNorm; `1024 → 32` velocity projection on the action-token rows; `x_next = x + dt*v`, with `dt=-1/N_DENOISE` represented only in the display formula because shape evaluation does not require signed arithmetic.

The definitions are framework-independent. Separate Q/K/V projections in the logical graph even when a runtime may fuse their storage or launches.

- [ ] **Step 7: Assemble the three-stage folded graph**

Create these ordered stages:

1. `vision-encoder`, repeat `1`: image patch embedding; `vision-blocks` referencing `siglip-transformer-block` with repeat `27`; final normalization; multimodal projection.
2. `prefix-encoder`, repeat `1`: prompt/prefix builder; `prefix-blocks` referencing `gemma-prefix-block` with repeat `18`; produce per-layer prefix K/V.
3. `action-flow-decoder`, repeat `N_DENOISE`: suffix builder; `action-expert-blocks` referencing `gemma-action-expert-block` with repeat `18`; velocity/Euler update.

On `action-flow-decoder`, set `loop_carried` to:

```json
{
  "loop_id": "action-flow-loop",
  "initial_tensor_id": "initial-noise",
  "iteration_input_tensor_id": "action-state",
  "iteration_output_tensor_id": "updated-action-state",
  "final_tensor_id": "final-action-state"
}
```

This means iteration 0 reads initial noise, each later iteration reads the prior Euler output, and the final Euler output becomes the model result. Persist the loop pseudo-node in the relevant graph tensor producer/consumer endpoints so the back edge is visible and machine-checkable without unrolling ten iterations.

Make stage descriptions distinguish prefill-once work from the iterative hot loop. Bind the action expert’s query length to `S_SUFFIX`, its key/value length to `S_ATTENTION`, and the output to the `T_ACTION` action rows rather than the leading state row. Represent prefix K/V as a logical tensor with a leading layer axis; annotate the action-expert module input as consuming the matching layer slice. This is a logical indexed dependency, not a runtime layout claim.

- [ ] **Step 8: Register the canonical dataset and wire repository validation**

Register the dataset in `schema/manifest.json`:

```json
"model_graphs": {
  "data_glob": "data/model_graphs/*.json",
  "schema": "schema/model_graphs.schema.json",
  "primary_key": "model_graph_id"
}
```

In `tools/lib/contracts.py`, after structural validation and duplicate-key detection, call `graph_semantic_problems` when `dataset == "model_graphs"`. Preserve each returned relative path and code when converting it to the existing `Issue` type.

In `tools/validate.py`, extend `validate_references` so every model graph’s `model_id` resolves in `models` and every `source_id` resolves in `sources`. Add the minimal record from `valid_model_graph_document()` to the existing `test_representative_reference_is_blocking` fixture so this path stays covered without adding another test method.

- [ ] **Step 9: Run the representative test and repository validation**

Run:

```bash
python3 -m unittest tests.test_validation.ValidationTests.test_pi0_representative_workload_materializes -v
python3 -m tools.validate --all
```

Expected: both commands PASS. The test establishes only one representative workload; do not add separate 1-view and 2-view test cases.

- [ ] **Step 10: Commit the Pi0 definition**

```bash
git add schema/manifest.json tools/lib/contracts.py tools/validate.py data/model_graphs/pi0.json data/catalog/sources.json data/catalog/models.json tests/test_validation.py
git commit -m "data: define pi0 logical operator graph"
```

---

### Task 3: Render the Pi0 model-first review workspace

**Files:**

- Modify: `tools/lib/site.py`
- Create: `web/js/workspace.js`
- Modify: `web/js/index.js`
- Modify: `web/styles.css`
- Modify: `tests/test_build.py`
- Regenerate: `site/index.html`
- Regenerate: `site/models/pi0.html`
- Regenerate: `site/assets/js/workspace.js`
- Regenerate: `site/assets/js/index.js`
- Regenerate: `site/assets/styles.css`

**Interfaces:**

- Pi0 page data adds only `model_graph` and `default_materialization`; it does not invent an execution-evidence object.
- Model-card view records add `detail_kind`, with `logical_workspace` for Pi0 and `legacy_summary` for Pi0.5/SmolVLA.

- [ ] **Step 1: Update the existing build smoke test first**

Do not add a third build test. Extend `test_build_emits_foundation_pages_and_safe_comparisons` in `tests/test_build.py` to assert:

```python
index = (output / "index.html").read_text(encoding="utf-8")
pi0 = (output / "models" / "pi0.html").read_text(encoding="utf-8")
pi05 = (output / "models" / "pi05.html").read_text(encoding="utf-8")

self.assertIn("model-cards", index)
self.assertLess(index.index('id="model-cards"'), index.index('id="coverage"'))
self.assertIn("pi0-logical-v1", pi0)
self.assertIn("workspace.js", pi0)
self.assertIn("attention-core", pi0)
self.assertIn("euler-update", pi0)
self.assertIn("Structure-only review", pi0)
self.assertIn("model.js", pi05)
self.assertNotIn("workspace.js", pi05)
```

Replace the obsolete Pi0 assertion for `view-batched-vision-encoder`. Preserve the existing comparison-safety assertions.

- [ ] **Step 2: Run the focused build test and confirm the intended failure**

Run:

```bash
python3 -m unittest tests.test_build.BuildTests.test_build_emits_foundation_pages_and_safe_comparisons -v
```

Expected: FAIL because the home is still coverage-first and Pi0 still loads `model.js`.

- [ ] **Step 3: Build the Pi0 workspace payload and model-first home shell**

In `tools/lib/site.py`:

1. index `datasets["model_graphs"]` by `model_id` inside `_build_view_models`;
2. add `detail_kind` to each model card record;
3. attach the raw graph and `materialize_model_graph(graph)` result only to Pi0’s model page;
4. render a `#model-cards` section before the existing filters and coverage matrix;
5. change the home lede and shared home navigation label from coverage-first wording to `Models`, while naming coverage as a secondary section;
6. choose a Pi0-specific workspace body and `../assets/js/workspace.js` when a model graph exists;
7. leave Pi0.5 and SmolVLA on the current legacy body and `model.js`.

The Pi0 body must contain these stable hooks:

```text
#model-summary
#workload-controls
#graph-breadcrumb
#logical-workspace
#stage-flow
#module-flow
#operator-flow
#operator-detail
#phase-scope-note
```

Render `Structure-only review: runtime, hardware, precision, profiler, and roofline overlays are outside this slice.` in `#phase-scope-note`. Do not place existing latency measurements or evidence-status fields on the Pi0 logical workspace. Existing performance pages remain reachable through the shared navigation.

- [ ] **Step 4: Render model cards before the coverage matrix**

In `web/js/index.js`, render every model as a link card using the model catalog data. Each card shows model name, model type, input/output modalities, and one status label:

- Pi0: `Structured logical graph`;
- Pi0.5 and SmolVLA: `Legacy module summary`.

Keep the current coverage filtering and profiler-coverage rendering below the cards. Do not add runtime or hardware filtering to the cards in this increment.

- [ ] **Step 5: Implement safe local workload binding and hierarchy navigation**

Create `web/js/workspace.js` as a single offline script with these responsibilities:

1. parse `#page-data` through `Atlas.readPageData()`;
2. mirror the Python AST evaluator with an explicit `switch` over `add`, `sub`, `mul`, `div`, and `ceil_div`;
3. use the exact Python scope order: global derived symbols → stage/module repeat → module-to-template bindings → template tensor/operator multiplicity → operator-to-definition bindings → analysis expressions, with no implicit outer-scope lookup;
4. render controls only for editable symbols and enforce the bounds in the model graph;
5. recompute derived symbols, tensor shapes, resolved operator bindings, analytical records, and effective repeats on change;
6. render a left-to-right stage pipeline rather than the existing circular graph, including the denoise loop-carried arrow;
7. expand a selected stage to modules and a selected module to its one representative template body;
8. keep repeated blocks folded and label them `×27`, `×18`, `×10`, or effective `×180` as applicable;
9. parse and validate the URL hash on initial load and on `hashchange`, restoring valid stage/module/operator IDs and falling back to the first valid selection when IDs are stale;
10. update `#graph-breadcrumb` and the URL hash when selection changes;
11. open operator details in the persistent right-hand pane without replacing the main graph.

The browser evaluator must never evaluate arbitrary strings. On a binding error, retain symbolic axes and list the unresolved symbol in the detail pane.

- [ ] **Step 6: Implement the three operator-detail visualizers**

The detail pane always shows label, category, formula, symbolic input/output shapes, concrete input/output shapes, module/stage/effective multiplicity, and available analytical counts.

Implement exactly three reusable visual modes:

- `gemm`: show `D = A B + C`, labeled A/B/D dimensions, and a CSS-highlighted row/column/output-cell multiply-accumulate sequence. The animation explains semantics and must not claim a CUDA tile or kernel schedule.
- `attention`: show `QK^T → scale/mask → softmax → P V`, with the current query length, key/value length, head count, and head dimension.
- `basic`: show input chips → formula → output chips for normalization, activation, concat, reshape, residual, RoPE, embedding, and Euler update.

Do not render runtime, hardware, profiler, precision, quantization, or roofline controls/panels in this slice. The page-level `#phase-scope-note` is the only boundary message.

- [ ] **Step 7: Add only the styles required by the new workspace**

In `web/styles.css`, add model-card grid, pipeline, stage/module/operator node, breadcrumb, workload-control, two-column workspace, sticky detail pane, tensor-shape chip, visualizer, and scope-note styles. Reuse the existing color variables, panels, state chips, and responsive breakpoint. At narrow width, stack the graph above the detail pane and disable stickiness.

Do not introduce a CSS framework, icon library, web font, image asset, or network dependency.

- [ ] **Step 8: Regenerate and run the narrow verification set once**

Run:

```bash
python3 -m unittest tests.test_validation tests.test_build -v
python3 -m tools.validate --all
python3 -m tools.build
python3 -m tools.build --check
```

Expected: the focused validation/build tests pass, repository validation prints no issues, the site regenerates, and the deterministic check passes. Do not run inference, Nsys, NCU, profiler collection, or unrelated test suites.

- [ ] **Step 9: Perform one manual offline smoke path**

Open `site/index.html` with `file://` and perform only this path:

1. confirm model cards precede coverage;
2. open Pi0 and see Vision Encoder → Prefix Encoder → Action Flow Decoder;
3. set `V=3`, `L_PROMPT=20`, `T_ACTION=50`, `N_DENOISE=10`;
4. confirm `S_PREFIX=788`, `S_SUFFIX=51`, and attention span `839`;
5. open `vision-blocks`, then one linear operator, and inspect the GEMM visualization;
6. open `action-expert-blocks` and confirm stage `×10`, block `×18`, effective `×180`;
7. open `attention-core`, then `euler-update`, and inspect the attention and basic visual modes;
8. confirm the structure-only scope note is visible and no runtime, profiler, precision, or roofline panel is present.

Stop after this path. Do not test every operator or every workload combination.

- [ ] **Step 10: Commit the reviewable Pi0 workspace**

```bash
git add tools/lib/site.py web/js/workspace.js web/js/index.js web/styles.css tests/test_build.py site
git commit -m "feat: render pi0 logical model workspace"
```

## Review Checkpoint

After Task 3, stop and let the user review:

- whether the three-stage split is intuitive;
- whether repeated blocks are folded at the right level;
- whether tensor shapes and prompt/view controls are understandable;
- whether GEMM, attention, and basic operator details contain the right amount of information;
- whether the page hierarchy should change before normalizing reusable definitions or adding Pi0.5.

Do not begin Pi0.5, runtime realization, hardware selection, precision/quantization scenarios, Nsys, NCU, kernel tables, or roofline overlays until that review is complete.
