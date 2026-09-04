# Model-first runtime and roofline workbench implementation plan

> **For implementers:** Use `superpowers:subagent-driven-development` task by task. Keep reports in the ignored SDD workspace. Do not read the whole plan; use the generated task brief.

**Goal:** Replace the hard-coded static report UI with a reusable, offline React/TypeScript workbench that explains Pi0, Pi0.5, and SmolVLA logical computation, runtime realizations, end-to-end behavior, timeline evidence, and level-correct roofline/kernel gaps on Jetson Thor.

**Architecture:** Canonical sanitized JSON remains the source of truth. Python validates and builds deterministic offline snapshots; a Vite/React/TypeScript application consumes generated typed payloads. One stable logical DAG anchors every view. Runtime, precision, profiler, and analytical data are overlays keyed to logical references rather than alternate layouts.

**Spec authority:** The requirements and rulings in this plan are the approved spec for this implementation. Existing evidence/comparison semantics in `docs/methodology.md` remain binding unless this plan narrows them.

## Global Constraints

- The product is model-first: catalog → one model workbench with `Logical`, `Runtime`, `End-to-end`, `Timeline`, and `Roofline & Kernels` views.
- Core models are Pi0, Pi0.5, and SmolVLA. A GR00T N1.7 3B preflight is optional only after every core task is complete.
- The application is React + TypeScript + Vite. It must run locally on Thor bound to `127.0.0.1`; access from another machine is through SSH local port forwarding. No runtime internet request is allowed.
- Canonical records contain only sanitized structured data. Raw `.nsys-rep`, `.ncu-rep`, screenshots, temporary reviews, local paths, hostnames, PIDs, serials, credentials, passwords, and proxy settings stay ignored and local. Device model names such as `Jetson AGX Thor T5000` are allowed. Do not generate or store hashes for privacy theater.
- The repository never downloads models or installs runtimes. Any task that inspects or runs an existing external stack treats it as read-only. Model artifacts live only below `/home/isrc/Projects/models`; no copies enter this repository.
- Preserve missing measurements as missing with a reason. Never convert missing values to zero and never infer whole-LPDDR saturation from Thor `lts__*sysmem` counters.
- Evidence classes remain `measured_local`, `analytical`, and `reported_external`. External reported numbers are visually separate and never presented as locally validated speedup.
- Benchmark comparison remains single-axis. Do not build Cartesian product, fuzz, stress, soak, or long-tail suites. Add only one focused behavior test for each new high-value contract and run the full suite once at task completion.
- The baseline device operating point is Thor 120W. Do not sweep power modes. Record observed clocks, temperature, power fields, and throttle status when available; unknown stays unknown.
- Selecting a runtime must not change logical DAG nodes, edges, coordinates, folded state, zoom, or pan. Runtime data is an overlay: fusion boundaries, split/eliminated/preserved badges, precision, and mappings.
- Horizontal placement means parallel work; vertical placement means dependency. Add, multiply, and concat are inline junctions. Cache/state/control are not arithmetic operators. Repeat blocks use a rounded boundary and `×N`, never expanded totals such as `×180`.
- Prompt length, camera views, action horizon, and denoise steps have defaults, not artificial maxima. Workload controls accept any positive value consistent with the selected model contract; zero prompt tokens are allowed when the model contract permits them.
- The right inspector uses at least 16px body text and page scrolling, not a nested content scrollbar. Graph edges are high-contrast, orthogonal, have visible arrowheads, and avoid boxes/labels. Keep node labels short; explanations live in the inspector.
- Operator animations are user-controlled. GEMM shows complete row-major tile traversal and `D = A @ B + C`; attention shows `Q @ Kᵀ → softmax → P @ V`. Chart reveal duration is 350–450ms and `prefers-reduced-motion` disables nonessential motion.
- Frontend files have focused responsibilities. Model definitions, graph layout, formulas, runtime mappings, chart data, and view components are not embedded as one monolithic HTML/JavaScript file.
- Precision support and analytical precision are distinct. A runtime may expose one supported execution configuration while the roofline what-if selector offers additional analytical scenarios.
- Default analytical precision is dense BF16. Precompute BF16 dense, FP16 dense, FP8 W8A8, NVFP4 W4A4, W8A16, W4A16, and runtime Q8_0/mixed scenarios. Arbitrary workload changes are labeled `interactive analytical`.
- FMA counts as 2 FLOPs. Q8_0 weight storage is 1.0625 byte/value and does not use an INT8 Tensor Core ceiling. W8A16/W4A16 use the BF16 compute ceiling; byte savings include quantization metadata and dequantization costs. Mixed precision is `Σ F_p / P_p`, not one fabricated uniform curve.
- Use these Thor T5000 published maxima as source facts: dense FP8 517 TFLOP/s, dense FP4 1035 TFLOP/s, sparse FP4 2070 TFLOP/s, sparse FP16 517 TFLOP/s, memory 273 GB/s, maximum GPU clock about 1.575GHz. The 120W 1.386GHz ceilings are labeled `mode_scaled_analytical`: BF16/FP16 ≈227.5, FP8 ≈455, NVFP4 ≈910.8 TFLOP/s. BF16 is derived from sparse FP16/2. Sparse ceilings are enabled only by observed `sparsity_on`. If EMC is not locked at 4266MHz, scale the bandwidth assumption and label it.
- VLA-Perf 400/800 TFLOP/s and 270GiB/s are retained only as `legacy_tool_assumption`, never the current official Thor roof.
- Every roofline series has exactly one accounting level, time basis, traffic basis, precision path, work unit, workload, and hardware operating point. Never mix Atomic/Fused, NCU/Nsys, DRAM/L2, BF16/FP8, different workloads, or fused groups with different logical coverage.
- Canonical roofline levels are `stage`, `atomic`, `fused`, and `kernel`. `Overview` is a UI mode containing four separate summaries. The whole-model point is an explicit root stage `model_total`, not a cross-level aggregate.
- Roofline formulas are:
  - `T_compute(U) = Σ_p F(U,p) / P_run,p`
  - `T_memory(U) = Q(U) / B_run`
  - `T_roof(U) = max(T_compute, T_memory)`
  - `AI(U) = Σ_p F(U,p) / Q(U)`
  - `P_achieved(U) = Σ_p F(U,p) / T_observed(U)`
  - `efficiency(U) = T_roof(U) / T_observed(U) = P_achieved(U) / P_roof(U)`
  - `gap(U) = T_observed(U) / T_roof(U)`
- Total/stage lower bounds follow the logical DAG critical path, including branches and loops, rather than naïve summation or aggregate intensity.
- Atomic traffic assumes inputs/weights read once, output written once, and intermediates materialized.
- A fused group has a composite roofline: mapped logical FLOPs plus runtime extras, with boundary global bytes, packed weights/scales/zero-points/padding/reformat/unfused QDQ/spills/materialized intermediates. Internal traffic is excluded only with evidence. Group duration is never allocated back to atomic operators.
- Kernel points use `AI = F_executed / Q_system-memory` and `Y = F_executed / t`. GEMM work may use verified `2MNK`; non-GEMM work requires reliable counters or a curated formula. A measured duration with modeled traffic uses a half-filled marker.
- Roofline markers: filled measured, hollow analytical, half-filled measured time + modeled traffic; marker size reflects time share.
- The adjacent table has Entity, Shape/Coverage, Calls, Work, Traffic, AI, Roof time, Actual time, Efficiency/Gap, and Limiter. Precision, provenance, mapping, raw metrics, and missing reasons live in the inspector.
- Existing profiler evidence is reused. Supplemental NCU is limited to at most three existing signatures: `encoder_big_gemm`, `decoder_nvjet_512x16`, and `siglip_fmha`. First collect SpeedOfLight, ComputeWorkloadAnalysis, MemoryWorkloadAnalysis, LaunchStats, Occupancy, and SchedulerStats. Add WarpStateStats only if scheduler evidence is insufficient; add SourceCounters only when source localization is required. Never use `--set full`, all-kernel capture, or launch-wide sweeps.
- Existing NCU durations are per-report observations and must never be summed. Existing L2/Memory SOL percentages are not LPDDR utilization. Long/short scoreboard and other warp stall reasons are diagnostic, not standalone bottleneck verdicts.
- If supplemental profiling is run, use the existing 120W mode, lock clocks only for the small capture, record the state, then restore the previous dynamic-clock state. Do not change global profiling security policy. If sysmem sector metrics are unavailable, record `unavailable` and stop.
- Core benchmark policy: one smoke run; compile/capture; 5 warmups + 20 measured iterations. Repeat once only if CV >5% or throttling is observed. Workload samples are a default plus single-axis view (1/2/3) and prompt (short/default/long) changes; action/NFE stay native during the first round.
- Core stack intent: Pi0 FlashRT/vla.cpp/VLA-Perf; Pi0.5 FlashRT/VLA-Perf with matching action semantics; SmolVLA LeRobot/vla.cpp/VLA-Perf. Unsupported or unavailable combinations remain visible with reasons rather than being forced to run.

### Task 1: Establish the typed offline application shell

**Files:** create `package.json`, TypeScript/Vite configuration, `src/`, and focused app-shell tests; modify `tools/lib/site.py`, `tools/build.py`, `.gitignore`, `README.md`, and generated `site/` only through the build command.

1. Write one failing test that proves the builder emits a local application entry and no remote asset URL.
2. Add React, TypeScript, Vite, Vitest, React Flow, and a small charting dependency only when actually used. Keep the lockfile committed and dependencies vendored by the build output, not fetched at runtime.
3. Create a model-first shell with catalog and routeable workbench tabs. Retain deep links for model, tab, runtime, hardware, workload, precision scenario, and selected entity.
4. Add a deterministic bridge that converts validated canonical JSON into generated frontend data and copies Vite assets into `site/`. `python3 -m tools.build --check` remains the release-snapshot check.
5. Remove the obsolete hand-authored page/script duplication after the new shell provides equivalent navigation. Do not delete canonical data or Python validators.
6. Verify the focused test, `npm run typecheck`, `npm run build`, and the existing Python suite once. Commit.

### Task 2: Build reusable logical graph templates and migrate Pi0

**Files:** create focused `src/features/model-graph/` components, generic graph template/layout modules, typed adapters, and shared operator visualizers; modify canonical model-graph contracts/data only where required.

1. Write one focused test for a generic Transformer attention block: Q/K/V must be parallel siblings, attention/output/residual must be downstream, and the stable layout must not depend on runtime selection.
2. Normalize reusable Transformer, ViT, attention, gated MLP, action-expert, embedding, projection, cache, and flow-update structures. Keep arithmetic junctions inline and cache/state/control typed separately.
3. Render Pi0 as the first complete vertical slice using the accepted information architecture and current corrected layout. Preserve the `17 full + L18 KV tail` VLM behavior explicitly. Time is an input to the time embedding; do not invent a generated time state.
4. Implement workload bindings without UI caps and show short node labels, repeat boundaries, stage rails, orthogonal edges, collision-safe labels, breadcrumbs, and a readable inspector.
5. Implement user-controlled GEMM, attention, convolution/patch, normalization, activation, reshape, and flow-update explainers. GEMM traverses all visible tiles in row-major order.
6. Verify the focused graph test, typecheck/build, and one screenshot review at desktop and narrow desktop sizes. Commit.

### Task 3: Add Pi0.5 and SmolVLA model definitions

**Files:** add sanitized canonical graph/model records and sources for Pi0.5 and SmolVLA; add adapters only when a genuinely new reusable operator/block is needed.

1. Write one table-driven materialization test with one representative workload per new model; it must validate key stage shapes and output shapes, not snapshot source text.
2. Curate Pi0.5 and SmolVLA from existing local model configuration/source evidence. Label uncertain dimensions or unavailable artifacts instead of guessing.
3. Compose both from the reusable graph vocabulary. Do not fork the Pi0 renderer or duplicate large graph/layout definitions.
4. Make model switching retain the workbench structure while resetting only selections invalid for the new model.
5. Verify the focused model test, validation, typecheck/build, and visually inspect each model once. Commit.

### Task 4: Add runtime realization contracts and stable overlays

**Files:** create canonical `runtime_realizations` schema/data and `src/features/runtime/`; update manifest, validators, generated payload, and the Runtime view.

1. Write one focused validator/UI test covering preserved, fused, split, eliminated, fallback, opaque, and ambiguous mappings, including invalid many-to-many mappings.
2. Model execution groups and many-to-many mappings with explicit method, confidence, provenance, precision path, dependencies, and kernel references.
3. Add available core-stack realizations using existing source/runtime evidence. Unsupported/unmeasured combinations remain explicit states.
4. Overlay fused boundaries, split counts, eliminated styling, group precision, and ambiguity without moving logical nodes or drawing a second dependency graph.
5. Cross-select logical node ↔ execution group while keeping the inspector as the detailed mapping surface.
6. Verify focused tests, canonical validation, typecheck/build, and a runtime-toggle screenshot comparison proving stable geometry. Commit.

### Task 5: Implement level-correct roofline analysis

**Files:** replace/extend roofline canonical contracts; create a pure TypeScript/Python-compatible analytical formula layer, scenario data, Thor ceiling data, and `src/features/roofline/`.

1. Write focused tests for the approved formulas, mixed-precision compute time, Q8_0 bytes, W4A16 compute ceiling, fused boundary traffic, and a branched critical path. Use hand-derived literal expectations in one compact test file.
2. Add source-backed Thor T5000 maxima, 120W mode-scaled analytical ceilings, precision/quantization paths, and legacy VLA-Perf assumptions with distinct provenance labels.
3. Define basis and point contracts that make accounting level, time basis, traffic basis, precision path, work unit, workload, capture, realization, and operating point non-mixable.
4. Precompute default workload scenario points for the required precision paths. Recompute arbitrary workload what-if points client-side from the same formulas and label them interactive analytical.
5. Implement `[Overview][Stage][Atomic][Fused][Kernel]`, one active basis per chart/table, logarithmic roofline axes, marker semantics, limiter/gap derivation, selected-runtime pile of points, cross-view links, and the ten-column readable table.
6. Implement attention analytical work/traffic as explicit score, softmax, and value components; use partial-envelope labels where VLA-Perf omits work. Do not fabricate unsupported non-GEMM kernel FLOPs.
7. Verify focused formula tests, Python validation, typecheck/build, and one visual chart/table review. Commit.

### Task 6: Import existing profiler and end-to-end evidence

**Files:** create sanitized Nsys/NCU canonical contracts/importers and `src/features/timeline/`, `src/features/performance/`, and kernel-detail components; update canonical measured records only from existing local evidence.

1. Write one focused importer test using a tiny synthetic fixture that proves local identifiers/paths are stripped and missing metrics stay missing.
2. Reuse the existing 16 FlashRT Pi0 NCU reports and available Nsys/benchmark summaries. Extract locally, promote only sanitized fields, and never commit raw captures or generated screenshots.
3. Preserve metric identity, unit, section, raw counter name, per-launch basis, confidence, and missing reason. Record that current captures lack whole-system DRAM traffic and scheduler/scoreboard sections.
4. Render an Nsys-style CPU/GPU timeline with lanes, zoom/selection, CPU occupancy summaries, launch gaps, overlap, and honest idle/unknown semantics. It must answer whether CPU work overlaps GPU work without claiming unobserved per-core idleness.
5. Render kernel table/details with duration share, launch geometry, occupancy, SM/tensor/L1/L2 relative metrics, and available scheduler/long-short-scoreboard fields. Explicitly separate L2 pressure from LPDDR saturation.
6. Populate end-to-end and stage views for every existing compatible Pi0/Pi0.5/SmolVLA record. Show VLA-Perf bounds and external claims as separate evidence, with no ratio when workload/correctness/operating point is incompatible.
7. Verify the focused importer test, canonical privacy scan, validation, typecheck/build, and one timeline/kernel screenshot review. Commit.

### Task 7: Add minimal supplemental evidence when executable

**Files:** raw outputs only under ignored local directories; canonical changes are sanitized measurement/missing-reason records and collection notes.

1. Inspect current runtime commands and existing profiler signatures without installing or upgrading system software.
2. If executable and safe, collect no more than the three approved NCU signatures with the approved sections. Use SchedulerStats first; collect WarpStateStats only to answer an unresolved scheduler question. Stop on unavailable sysmem sectors or unstable replay.
3. If existing core benchmark commands and models are ready, run only missing representative default/single-axis samples under the approved 5+20 policy. Do not repair incompatible runtime environments merely to fill a matrix.
4. Record mode, observed clocks, EMC, temperatures, power fields, throttle status, and collection limitations. Restore dynamic clocks after the small capture.
5. Promote only sanitized facts and missing reasons. This task may legitimately end with explicit unavailable records and no new numeric measurement.
6. Verify changed canonical documents and privacy scan, then commit only canonical data/docs. Never commit raw reports, logs, or local scripts tied to a machine.

### Task 8: Create and validate the technical model UI review skill

**Files:** create `skills/reviewing-technical-model-ui/SKILL.md` plus only essential supporting references; update `AGENTS.md` with a concise trigger.

1. RED: give a fresh agent the current UI screenshot and a constrained review request without the skill. Record its missed overlap/semantics/legibility issues only in the ignored SDD report.
2. Write the minimal tool-neutral skill that captures observed failures: render before judging, inspect full-page and focused crops, verify dependency/parallel layout meaning, edge/node collisions, label density, inspector typography, runtime-layout invariance, roofline basis integrity, animation completeness, and reduced motion.
3. GREEN: give a fresh agent the same task with the skill; verify it produces evidence-backed findings and does not invent benchmark claims.
4. Keep the skill concise and discoverable for Codex, Cursor, and Claude Code. Do not bake repository-local absolute paths or one-off Pi0 coordinates into it.
5. Run the skill validator and commit. Skill test reports remain ignored.

### Task 9: Final visual integration, migration cleanup, and release snapshot

**Files:** all workbench features, documentation, generated `site/`, and obsolete frontend files that are now provably unused.

1. Write no new broad test suite. Fix only concrete defects found by the final visual review or existing focused tests.
2. Run the local Vite server on `127.0.0.1`, capture each core model and each workbench tab, and inspect images yourself. Fix overlaps, clipped arrows, unreadable labels, nested scrollbars, misleading parallelism, empty/dead controls, and chart/table mismatch.
3. Add one restrained 350–450ms chart-reveal animation and honor reduced motion. Do not scatter decorative motion across the UI.
4. Confirm every cross-view selection and deep link works, and that runtime toggles preserve graph geometry/viewport.
5. Remove replaced hard-coded frontend artifacts and brittle tests that only asserted generated source text. Keep only the necessary behavior-focused tests introduced above.
6. Update README with offline build, local serve, SSH forwarding, data promotion, and privacy boundaries. Do not document credentials or proxy values.
7. Run exactly one final verification pass: focused frontend tests, `npm run typecheck`, `npm run build`, `python3 -m unittest`, `python3 -m tools.validate --all`, `python3 -m tools.build`, `python3 -m tools.build --check`, and a canonical/site privacy scan. Commit the deterministic snapshot.
8. Dispatch a whole-branch review and one scoped fix wave if needed. Do not merge or push without the user’s next instruction.
