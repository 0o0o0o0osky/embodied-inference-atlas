# Task 4 report: DAG-first Pi0 visual redesign

## Status

Implemented the user-approved Pi0 redesign on `feature/pi0-logical-workspace`, starting from `80ac627`. The final refinement is a single always-visible tensor graph rather than a module-selected drill-down: Vision, Prefix, and Action bands simultaneously expose one representative atomic DAG, while rounded regions fold the repeated Transformer and denoise scopes.

Implementation commit: `1e3e96e19ffc3101ef058e4b2e787847cceed20b`

The topology has no cumulative repeat badges. It shows `Transformer layers ×27`, two `Transformer layers ×18` scopes, and an outer `Denoise loop ×N_DENOISE`; no atomic node is labelled `×180`.

## Implementation notes

- Replaced the four array-ordered navigation strips with one deterministic native SVG graph under `#model-overview` and `#block-dag`, alongside the persistent `#operator-detail` inspector.
- Derived every visible dependency edge from tensor `producer` and `consumers` endpoints. Recursive public-port resolution maps graph tensors through modules, block tensors through components, and component boundary tensors to the actual atomic producers/consumers.
- Rendered component regions inside folded Transformer scopes. The total graph keeps Q/K/V and gate/up branches parallel, joins them only at their declared consumers, exposes residual skips, carries collected prefix K/V into cached key/value selection and concat, and draws layer/action feedback separately from acyclic ranking.
- Kept all three stage bands visible. Operator clicks update only selection styling, hash/breadcrumb, and the inspector; they do not hide or replace any stage.
- Replaced decorative visualizers with controllable SVG microscopes for GEMM, attention, and convolution. Each supplies Play/Pause, Step, Reset, and speed controls; selection cancels the prior timer, and reduced-motion sessions start paused. Basic operators retain a static semantic flow.
- The GEMM view labels actual M/N/K and illustrates A/B K-tile accumulation into an output tile with `D = A B + C`. Attention illustrates tiled `QKᵀ`, scale/mask, row softmax, and tiled `P V` while retaining actual attention dimensions. Patch embedding illustrates receptive-field/weight/output movement while retaining actual image, patch/stride, channel, token, and output-width labels.
- Analytical metrics show both the per-atomic-invocation value and aggregate logical value, plus separate stage, layer, and intrinsic factors.
- Added `conv` to the closed visualizer enum and assigned it to Pi0 patch embedding. No runtime tiling dataset or external asset was added.
- Changed canonical `N_DENOISE` to default `10`, minimum `1`, and no maximum. Python and browser resolution accept safe integers above 10, reject invalid counts, and preserve all other true bounds.
- Removed the page-specific scope panel that named out-of-scope systems. No runtime, performance, profiler, precision, or roofline panel/data was added.

## RED evidence

Before production changes, modified only the two existing methods named by the brief and ran them together once:

```text
python3 -m unittest tests.test_validation.ValidationTests.test_pi0_representative_workload_materializes tests.test_build.BuildTests.test_build_emits_foundation_pages_and_safe_comparisons -v
```

Exit code `1`; `Ran 2 tests in 0.864s`; `FAILED (failures=2, errors=1)`.

The intended failures were:

- patch embedding returned `gemm` instead of `conv`;
- `materialize_model_graph(..., {"N_DENOISE": 12})` raised `symbol override is out of bounds: N_DENOISE`;
- generated Pi0 HTML lacked `id="model-overview"` and still contained the old strip shell.

No test method or test file was added.

## Focused GREEN attempt and observed recovery

Reran the same focused command once after implementation, as capped by the brief. The Pi0 validation/materialization method passed, but the build method stopped in the release privacy scan:

```text
test_pi0_representative_workload_materializes ... ok
test_build_emits_foundation_pages_and_safe_comparisons ... ERROR
BuildError: $/assets/styles.css: ip_address: literal IP addresses are forbidden
Ran 2 tests in 0.899s
FAILED (errors=1)
```

Root-cause tracing found that the privacy scanner's IPv6 expression interpreted `::bef` inside the new CSS selector `::before` as an address. The legend was changed to use an ordinary child element, removing the triggering token. The focused pair was not run a third time. The prescribed full suite below ran after that correction and passed both methods as part of all 16 tests.

## Narrow verification

Ran the prescribed commands once each:

```text
python3 -m unittest tests.test_validation tests.test_build -v
python3 -m tools.validate --all
node --check web/js/workspace.js
python3 -m tools.build
python3 -m tools.build --check
git diff --check
```

- Unit tests: exit code `0`; `Ran 16 tests in 1.779s`; `OK`.
- Repository validation: exit code `0`; no output.
- JavaScript syntax: exit code `0`; no output.
- Site build: exit code `0`; `built 7 page(s)`.
- Deterministic build check: exit code `0`; `built 7 page(s) for check`.
- Diff check: recorded immediately before the implementation commit.

No inference, download, profiler, broad browser matrix, or additional test command was run.

## Single offline DOM/interaction smoke

Used the generated `site/models/pi0.html` and `site/assets/js/workspace.js` in one network-free minimal DOM session with reduced motion enabled. The single path checked only the requested review surface.

Result: exit code `0`, status `PASS`.

- Found 67 selectable atomic nodes, 90 tensor edges, and one Euler feedback edge.
- Confirmed default scopes `×27`, `×18`, `×18`, and `Denoise loop ×10`; no `×180` appeared.
- Confirmed attention-normalized hidden state has separate tensor edges to Q, K, and V; the vision residual bypass exists; MLP norm branches to gate/up; collected prefix K/V reaches both cached selectors and then key/value concatenation.
- Selected patch embedding, a projector GEMM, and action attention and found the `conv`, `gemm`, and `attention` microscopes plus Play/Pause, Step, Reset, and speed controls.
- Changed `N_DENOISE` from 10 to 12. The outer scope became `Denoise loop ×12`, an action linear operator's aggregate logical analysis changed, and the atomic-node count stayed 67.
- Confirmed the denoise input has `min=1`, no max, and the inspector has no out-of-scope panel.

The subsequent `file:///home/isrc/Projects/embodied-inference-atlas/.worktrees/pi0-logical-workspace/site/models/pi0.html` desktop-open attempt returned exit code `0`.

## Files changed

Source, data, and existing tests:

- `schema/model_graphs.schema.json`
- `data/model_graphs/pi0.json`
- `tools/lib/model_graph.py`
- `tools/lib/site.py`
- `web/js/workspace.js`
- `web/styles.css`
- `tests/test_validation.py`
- `tests/test_build.py`

Mechanically regenerated output:

- `site/models/pi0.html`
- `site/assets/js/workspace.js`
- `site/assets/styles.css`

Report:

- `.superpowers/sdd/2026-09-04-pi0-logical-model-workspace/task-4-report.md`

## Honest visual limitations

- The environment had a desktop opener but no inspectable GUI browser or installed browser-automation engine. Behavior and DOM structure were exercised offline, but final typography, edge-label collision, sticky-inspector feel, and color perception still require the user's visual review in the opened page.
- The complete representative graph is intentionally dense. Dependency ranks and horizontal overflow preserve branch truth, but smaller screens require panning before the inspector stacks below the graph.
- Edge labels use compact truncation plus concrete shapes to limit clutter; full tensor/operator names remain available from node titles and the inspector, but edge hover expansion is not included in this slice.
- Animation tile sizes and frame counts are explicitly illustrative mathematical views, not runtime scheduling claims.
