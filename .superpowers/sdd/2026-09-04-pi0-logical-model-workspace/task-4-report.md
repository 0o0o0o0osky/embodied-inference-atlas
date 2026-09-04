# Task 4 report: paper-style Pi0 visual redesign

## Status

Implemented the user-approved Pi0 redesign on `feature/pi0-logical-workspace`, starting from `80ac627`. After visual review, the final refinement is a single responsive paper-style SVG rather than a module-selected drill-down or a generic topology layout. Vision, Prefix, and Action are three side-by-side columns, each with a compact top-to-bottom main trunk, local parallel branches, side rails, and rounded repeated scopes.

Implementation commit: `1e3e96e19ffc3101ef058e4b2e787847cceed20b`

Post-review paper-layout correction: `dd04f150e97fafa7a26f15b2870da7c3f1ad4333`

Post-review clarity correction: `0753a31dfc8a344f971c832d5fd9fb236cd8bca9`

Post-review connector collision correction: `a520a1a711ac1cff2daeb44561b561cddc2c4b6c`

The topology has no cumulative repeat badges. It resolves the Vision `×27`, Prefix `×18`, Action expert `×18`, and outer `Denoise loop ×N_DENOISE` labels from the materialized modules/stage; no atomic node is labelled `×180`.

## Implementation notes

- Replaced the four array-ordered navigation strips with one deterministic native SVG figure under `#model-overview` and `#block-dag`, alongside the persistent `#operator-detail` inspector. At desktop width the inspector uses `clamp(21.5rem, 24vw, 23rem)`; it stacks below the figure at `80rem` before the paper diagram becomes illegible.
- Added a hand-authored `PI0_PAPER_LAYOUT` containing only canonical operator keys and row/mini-chain slots. It places all 67 declared operators, with a visible fallback region for any future unplaced operator. Overview boxes now show only short display aliases; canonical labels, formulas, and complete symbolic/concrete tensor shapes remain in each SVG title/ARIA description and the inspector.
- Preserved recursive tensor endpoint resolution through graph, module, block, and component boundaries as the truth index. The overview renders 51 hand-authored `PI0_PAPER_CONNECTORS` descriptors covering 91 displayed direct pairs rather than iterating the 97 internal model edges; the six omitted pairs are layer-carry edges represented by repeat scopes. Every direct pair is checked against the materialized producer/consumer edges before rendering; a missing pair suppresses that descriptor and produces both a visible SVG warning and a console error.
- Curated orthogonal buses cover main trunks, Q/K/V and RoPE branches, gate/up/GELU/Mul branches, residual rails, prefix cache handoff and action K/V joins, exactly two cross-column handoffs, and Euler feedback. All connector paths are deliberately unlabeled.
- Q/K/V, gate/up, suffix state versus action/time, and cached K/V remain compact branches inside vertical column trunks. Residual Add nodes and gated Mul nodes occupy their own rows so their input ports remain visually distinct. Vision uses 12 effective rows, Prefix 15, and Action 19 without padding the shorter stages.
- Only the repeated SigLIP, Gemma, expert, and denoise scopes render. Each rounded frame has a dedicated 18-unit header badge above a reserved content boundary, eliminating label/node collisions; component/module scope labels were removed.
- Kept all three stage bands visible. Operator clicks update only selection styling, hash/breadcrumb, and the inspector; they do not hide or replace any stage. Selection is tracked per direct tensor pair (with shared bus segments carrying union metadata), so only true one-hop neighbors receive the related state.
- Replaced decorative visualizers with controllable SVG microscopes for GEMM, attention, and convolution. Each supplies Play/Pause, Step, Reset, and speed controls; selection cancels the prior timer, and reduced-motion sessions start paused. Basic operators retain a static semantic flow.
- The GEMM and attention microscopes remain unchanged after review. The rebuilt Conv microscope derives the exact patch lattice from `H/P` and `W/P` (currently `16×16`), highlights one true `P×P×C` non-overlapping patch, keeps a fixed `[P²C × D]` weight panel, and lights the matching output-token cell. Step advances row-major by stride `P` and reports patch index, row/column, pixel ranges, and token. It is explicitly labelled illustrative math rather than a runtime tile, with a static honest fallback for inconsistent dimensions.
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

## Initial offline DOM/interaction smoke

Used the generated `site/models/pi0.html` and `site/assets/js/workspace.js` in one network-free minimal DOM session with reduced motion enabled. The single path checked only the requested review surface.

Result: exit code `0`, status `PASS`.

- Found 67 selectable atomic nodes, 90 tensor edges, and one Euler feedback edge.
- Confirmed default scopes `×27`, `×18`, `×18`, and `Denoise loop ×10`; no `×180` appeared.
- Confirmed attention-normalized hidden state has separate tensor edges to Q, K, and V; the vision residual bypass exists; MLP norm branches to gate/up; collected prefix K/V reaches both cached selectors and then key/value concatenation.
- Selected patch embedding, a projector GEMM, and action attention and found the `conv`, `gemm`, and `attention` microscopes plus Play/Pause, Step, Reset, and speed controls.
- Changed `N_DENOISE` from 10 to 12. The outer scope became `Denoise loop ×12`, an action linear operator's aggregate logical analysis changed, and the atomic-node count stayed 67.
- Confirmed the denoise input has `min=1`, no max, and the inspector has no out-of-scope panel.

The subsequent `file:///home/isrc/Projects/embodied-inference-atlas/.worktrees/pi0-logical-workspace/site/models/pi0.html` desktop-open attempt returned exit code `0`.

## Post-review correction verification

The paper-layout correction did not change canonical data, validation, build logic, or tests, so the unit suite was deliberately not rerun. No test method or test file was added or edited. The final source state was checked with:

```text
node --check web/js/workspace.js
python3 -m tools.build
python3 -m tools.build --check
git diff --check
```

- JavaScript syntax: exit code `0`; no output.
- Final site build: exit code `0`; `built 7 page(s)`.
- Deterministic build check: exit code `0`; `built 7 page(s) for check`.
- Diff check: exit code `0`; no output, recorded immediately before the correction commit.

One narrow, network-free DOM/layout smoke then executed the generated page and assets with a minimal DOM and reduced motion enabled. It passed with:

```text
PASS paper=0 0 1080 1678 operators=67/67 columns=14,370,726 globals=2 feedback=1 conv=16x16/256 step=token2
```

That single smoke confirmed:

- a responsive `1080`-unit paper canvas with side-by-side Vision, Prefix, and Action columns;
- 67/67 selectable operators in authored slots, zero canonical fallback operators, top-to-bottom Vision flow, and horizontal Vision Q/K/V slots;
- exactly two cross-column connector groups, one Euler feedback group, and no `<textPath>` or other text inside any edge group;
- materialized `×27`, `×18`, `×18`, and `Denoise loop ×10` scopes, with no `×180`;
- 256 input patch cells and 256 output token cells for the current `224/14 = 16` lattice, a fixed symbolic `[P²C × D]` / concrete `[588 × 1152]` weight panel, and the illustrative/runtime disclaimer;
- one Step transition from row 1 / column 1 / token 1 to row 1 / column 2 / pixel x range `14–27` / token 2.

## Final clarity correction verification

The alias/connector/scope/compaction correction changed only browser source and generated assets. It did not change canonical data, Python validation/build logic, or tests, so the unit suite was deliberately not rerun and no test was added or edited. The final source state was checked with:

```text
node --check web/js/workspace.js
python3 -m tools.build
python3 -m tools.build --check
git diff --check
```

- JavaScript syntax: exit code `0`; no output.
- Site build: exit code `0`; `built 7 page(s)`.
- Deterministic build check: exit code `0`; `built 7 page(s) for check`.
- Diff check: exit code `0`; no output, recorded after this report update.

One narrow, network-free DOM/geometry smoke executed the generated page and browser assets with reduced motion enabled. It passed with:

```text
PASS operators=67/67 connectors=40/97 rows=10/12/16 cross=2 feedback=1 selected=2+38 scopes=Denoise ×10,SigLIP block ×27,Gemma block ×18,Expert block ×18
```

That smoke confirmed 67/67 selectable operators, exactly one visible short alias per operator, no overview shape line, no edge text or `textPath`, 40 curated groups validated against 97 truth edges with zero missing pairs, two cross-column groups, one Euler feedback group, and valid orthogonal path coordinates. It also confirmed the 10/12/16 effective-row targets, four repeat-only scope frames with non-overlapping reserved headers, no `×180`, and initialized selected/incident/muted/related classes.

## Final connector collision correction

The collision correction changed only browser source and generated assets. It moved all six residual Add nodes and the two gated Mul nodes to independent rows, split each Transformer main entry from its residual bypass, and replaced heuristic side routing for loop, suffix, cache, and feedback paths with explicit ports and separated rails. Direct-pair metadata now drives selection instead of descriptor-wide endpoint unions.

No unit test was added or rerun. One disposable offline geometry checker was created outside the repository, run once, and removed. Together with the existing syntax/build checks it reported:

```text
unrelated_node_intersections=0
duplicate_arrow_endpoints=0
cross_connector_collinear_overlaps=0
invalid_connectors=0
operators=67/67
displayed_truth_pairs=91
view_box=1080x1198
built 7 page(s) for check
```

The loop-to-Euler input uses the Euler right port seven units above center, while Euler feedback leaves seven units below center, separating their horizontal segments by 14 units.

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

The post-review correction itself changed only:

- `web/js/workspace.js`
- `web/styles.css`
- `site/assets/js/workspace.js`
- `site/assets/styles.css`
- this report

The final clarity and connector collision corrections changed only the same browser source/generated asset pairs plus this report; they did not touch schema, data, Python, or tests.

## Honest visual limitations

- The environment has no inspectable GUI browser or installed browser-automation engine. Generated DOM, coordinates, responsive structure, and interaction state were exercised offline, but final font rendering, sticky-inspector feel, and color perception still require visual review.
- The complete 67-operator figure fits the normal desktop width without horizontal panning. The collision-free 12/15/19-row columns still use vertical page space; narrower layouts stack the inspector below the figure.
- Edges are intentionally unlabeled to keep the paper overview legible. Tensor names and full symbolic/concrete shapes remain in node titles and the inspector rather than on paths.
- The microscopes are explicitly illustrative mathematical views, not runtime scheduling, profiling, precision, performance, or roofline claims.
