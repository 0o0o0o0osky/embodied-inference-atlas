# Pi0 Completion Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reviewable Pi0-only checkpoint with honest target-support states, reachable existing profiler evidence, inline operator Roofline results, and at most three new representative latency measurements.

**Architecture:** Extend the existing Pi0 view models rather than replacing the accepted DAG or evidence contracts. A pure capability-aware performance builder owns measured/pending/unsupported state; a separate analytical selector adapts existing materialized Roofline points into the operator drawer. Existing Nsys/NCU adapters remain capture-local, with an explicit compatibility key that permits independent warmup policies but rejects known semantic mismatches.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, canonical JSON, existing Python promotion/build tools, existing local Pi0 runtimes.

**Spec:** `docs/superpowers/specs/2026-09-06-pi0-completion-checkpoint-design.md`

## Global Constraints

- Pi0 and NVIDIA Jetson AGX Thor only; do not alter Pi0.5 or SmolVLA presentation.
- Target coordinates are P=48, N=10, V=1/2/3, A=20/50.
- Preserve missing values and evidence class; do not fill target cells from historical or analytical evidence.
- Unsupported requires a source-audited realization incompatibility; absence alone is pending.
- Runtime measurements, analytical bounds, source audit, Nsys, and NCU remain separate evidence planes.
- No new dependency, model download, environment installation, kernel change, or runtime semantic change.
- Benchmark at most three representative target coordinates, each with one smoke, 3 warmups, and 10 measured samples; never rerun automatically.
- No new profiler capture before the user reviews this checkpoint.
- Add only focused behavior tests and do not run the full test suite at this checkpoint.
- Render and inspect four Pi0 screenshots before handoff.

---

### Task 1: Capability-aware target states and profiler compatibility

**Files:**
- Modify: `src/features/runtime/domain/buildPi0PerformanceOverview.ts`
- Modify: `src/features/runtime/domain/buildPi0PerformanceOverview.test.ts`
- Modify: `src/features/runtime/domain/scopeRuntimeProfiler.ts`
- Modify: `src/features/runtime/domain/scopeRuntimeProfiler.test.ts`

**Interfaces:**
- Consumes: canonical measured runs, Pi0 runtime realizations, existing `Pi0PerformanceFacet`, and selected workload context.
- Produces: `Pi0PerformanceCell` states `measured | pending_supported | unsupported`, `nativeEvidenceSelection`, and a profiler compatibility result that distinguishes exact known fields from partial independent-capture context.

- [ ] **Step 1: Add failing target-state tests**

Create fixtures for a horizon-10 realization, a horizon-50 realization, and a runtime with no realization. Assert A=20/50 is unsupported only for the fixed horizon-10 realization, A=20 is unsupported for the fixed horizon-50 realization, and unknown capability remains pending. Assert native evidence selection references a real configuration and never changes a target cell to measured.

- [ ] **Step 2: Run the performance builder test and verify RED**

Run: `npx vitest run src/features/runtime/domain/buildPi0PerformanceOverview.test.ts`

Expected: failure because the new states and native selection do not exist.

- [ ] **Step 3: Implement capability-aware cells**

Pass Pi0 realization records into `buildPi0PerformanceOverview`, resolve applicability by runtime plus actual precision, and classify only fixed action/denoise mismatches as unsupported. Pick native evidence deterministically by exact runtime/precision/facet, closest prompt to 48, then V=2, without borrowing its value into the target grid.

- [ ] **Step 4: Add a failing real-contract profiler test**

Use independent wall-clock and Nsys runs with the same model artifact, runtime, hardware, device/system, precision, task contracts, timing boundary, state reuse, and known workload fields, but different warmup counts and an unknown profiler prompt. Assert the capture is retained and labeled partial. Assert known action mismatch remains rejected.

- [ ] **Step 5: Run the profiler test and verify RED**

Run: `npx vitest run src/features/runtime/domain/scopeRuntimeProfiler.test.ts`

Expected: the warmup-difference fixture is rejected by the old full-context matcher.

- [ ] **Step 6: Implement the explicit compatibility key and verify GREEN**

Compare only the spec-listed semantic fields, track unknown workload/operating fields as partial, and keep warmup/sample policy outside compatibility. Run both focused test files and expect them to pass.

- [ ] **Step 7: Commit**

Commit message: `fix: distinguish Pi0 target support and profiler scope`

### Task 2: Compact Pi0 performance overview and reachable native evidence

**Files:**
- Modify: `src/features/runtime/components/Pi0PerformanceOverviewChart.tsx`
- Modify: `src/features/runtime/components/pi0PerformanceOverviewChart.css`
- Modify: `src/features/runtime/Pi0RuntimeWorkspace.tsx`
- Modify: `src/features/runtime/components/Pi0SelectedRuntimeSummary.tsx`
- Modify: `src/components/AtlasHeader.tsx`
- Modify: `src/styles/runtime.css`

**Interfaces:**
- Consumes: Task 1 facet/cell states and `nativeEvidenceSelection`.
- Produces: shallow target matrices, measurement-only mini plots, explicit native-evidence navigation, and context controls on Pi0 detail surfaces.

- [ ] **Step 1: Replace empty chart canvases**

When a facet has no exact target measurement, render only its 2×3 state matrix. When it has measurements, render a compact latency-versus-view plot above the same matrix. Use Chinese labels `已测`, `待测`, and `不支持`.

- [ ] **Step 2: Separate target and native navigation**

Rename the pending-facet action to `查看已有原生证据` when native evidence exists. Navigate to its canonical configuration ID and keep the target acquisition grid unchanged. If no native evidence exists, show a disabled `暂无可下钻证据` state.

- [ ] **Step 3: Restore scoped controls and selected-summary disclosure**

Keep Pi0’s compact context bar on runtime, timeline, and Roofline detail routes. The selected summary states whether the selection is a target measurement or independent native evidence and never labels a native A=10 point as target A=20/50.

- [ ] **Step 4: Apply the compact visual hierarchy**

Limit each facet to the height needed by its content; remove the large empty axes, preserve one cyan selection color, and show support state through concise text plus shape rather than color alone.

- [ ] **Step 5: Run Task 1 focused tests and typecheck**

Run the two Task 1 Vitest files and `npm run typecheck`. Do not run unrelated tests.

- [ ] **Step 6: Commit**

Commit message: `feat: make Pi0 performance evidence reachable`

### Task 3: Inline Pi0 operator and model Roofline summaries

**Files:**
- Create: `src/features/roofline/presentation/buildOperatorRooflineSummary.ts`
- Create: `src/features/roofline/presentation/buildOperatorRooflineSummary.test.ts`
- Create: `src/features/model-graph/components/OperatorRooflinePanel.tsx`
- Create: `src/features/roofline/components/Pi0RooflineOverview.tsx`
- Modify: `src/features/model-graph/ModelGraphWorkspace.tsx`
- Modify: `src/features/model-graph/components/OperatorDrawer.tsx`
- Modify: `src/features/performance/PerformanceView.tsx`
- Modify: `src/styles/model-graph.css`
- Modify: `src/styles/roofline.css`

**Interfaces:**
- Consumes: selected logical ref, route workload/precision/hardware, canonical roofline records, and the existing interactive materializer.
- Produces: `buildOperatorRooflineSummary(...)` with selected point rows/ceilings and a model-level `Pi0RooflineOverview` with model-total/stage lower bounds.

- [ ] **Step 1: Write the failing analytical-selection test**

Materialize Pi0 BF16 at V=3, P=48, A=50, N=10 and select one GEMM ref plus one attention ref. Assert GEMM returns one logical point; attention returns its score/softmax/value/composite rows; all rows share one basis, workload, precision, hardware, and analytical timing basis.

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx vitest run src/features/roofline/presentation/buildOperatorRooflineSummary.test.ts`

Expected: failure because the summary builder does not exist.

- [ ] **Step 3: Implement the pure selector and drawer panel**

Reuse `materializeInteractiveRoofline` and canonical indexes. Display work, traffic, AI, roof time, limiter, and ceiling source in the drawer. Do not derive measured efficiency/gap. Keep a single link to the full Atomic analysis.

- [ ] **Step 4: Add the summary-first model Roofline overview**

Use the active Stage basis to render model-total and stage lower bounds with partial-coverage labels and direct Stage/Atomic actions. Show Fused and Kernel availability as separate concise status lines.

- [ ] **Step 5: Localize touched Pi0 analytical copy**

Translate labels in the Pi0 wrapper/panels while retaining technical acronyms. Do not redesign shared non-Pi0 surfaces.

- [ ] **Step 6: Run the one new focused test and typecheck**

Run the new Vitest file and `npm run typecheck`.

- [ ] **Step 7: Commit**

Commit message: `feat: surface Pi0 analytical limits in context`

### Task 4: Collect three representative target measurements

**Files:**
- Raw/local only: `.local/pi0-checkpoint/`
- Modify only after successful verified runs: canonical measurement/source files required by the existing promotion workflow

**Interfaces:**
- Consumes: existing local Pi0 artifacts and runtime binaries/environments.
- Produces: at most three sanitized measured-local runs with explicit timing/workload/precision/operating-point contracts.

- [ ] **Step 1: Record the current non-mutating system state**

Capture current power mode, clock policy, temperature, and available throttle evidence into ignored local logs. Do not change the power mode or install tools.

- [ ] **Step 2: Run one vla.cpp BF16 target point**

Run V=1, P=48, A=50, N=10 with one smoke, 3 warmups, and 10 measurements. Preserve the synthetic-token and engine timing boundary.

- [ ] **Step 3: Run one vla.cpp Q8_0 target point**

Repeat only the same coordinate with the validated Q8_0 artifact. Label it weight-only; do not claim INT8 execution.

- [ ] **Step 4: Run one LeRobot BF16 target point**

Verify a known tensor was loaded from the local safetensors checkpoint before timing. Run the model-core API at V=3, P=48, A=50, N=10. If loading or correctness verification fails, stop this point and promote nothing.

- [ ] **Step 5: Sanitize and promote successful results**

Use the existing staging/promotion contracts. Record each point as its own run/measurement; keep incompatible artifacts and timing boundaries in separate comparison groups.

- [ ] **Step 6: Validate only changed canonical records**

Run the narrow validator/importer checks needed by the promotion path. Do not run the repository-wide suite.

- [ ] **Step 7: Commit successful canonical records**

Commit message: `data: add representative Pi0 target measurements`

### Task 5: Build and visual checkpoint

**Files:**
- Generated by build: `site/`
- Local screenshots only: `.local/pi0-checkpoint/review/`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a deterministic offline site and four review images served locally.

- [ ] **Step 1: Run partial verification**

Run only the three focused domain test files, `npm run typecheck`, `npm run build`, and `python3 -m tools.build`. Do not run the full frontend/Python suites.

- [ ] **Step 2: Render four 1440×900 review states**

Capture Pi0 DAG overview, one focused GEMM/attention Roofline drawer, the performance summary, and selected FlashRT native Nsys/Kernel flow.

- [ ] **Step 3: Inspect at native scale**

Use `skills/reviewing-technical-model-ui/SKILL.md`. Check information hierarchy, arrow/node collisions, empty plot space, readable copy, status semantics, Nsys background stability, and navigation back to the DAG.

- [ ] **Step 4: Fix only concrete checkpoint defects**

Do not broaden the feature or add speculative tests. Re-run only the covering focused test/typecheck and recapture the affected image.

- [ ] **Step 5: Commit the generated snapshot and stop**

Commit message: `build: publish Pi0 completion checkpoint`. Keep the local server running for user review; do not start the remaining target grid or new profiler capture until requested.

