# Pi0 Runtime Analysis Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Pi0 runtime page as a Chinese summary-first performance funnel whose default surface is E2E evidence, followed by Nsys and Kernel analysis, with the implementation DAG mounted only on demand.

**Architecture:** Add one pure runtime-summary view-model builder and three focused presentation sections. Keep `Pi0RuntimeWorkspace` as the shared adapter/orchestrator, extract the current DAG composition into a delayed child, and reuse existing profiler adapters, timeline tracks, Kernel builders, and detail routes without duplicating raw evidence pages.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, canonical Atlas JSON, existing CSS modules-by-file.

**Spec:** `docs/superpowers/specs/2026-09-05-pi0-runtime-analysis-funnel-design.md`

## Global Constraints

- Implement only Pi0 × Jetson AGX Thor runtime analysis in this iteration.
- Keep the site fully offline and add no dependency.
- Preserve evidence classes and missing values; never convert missing profiler evidence to zero.
- Do not compute speedup or visually rank FlashRT against vla.cpp because their contexts differ.
- Keep VLA-Perf out of runtime selectors and measured runtime summaries.
- Nsys, NCU, E2E, Roofline, and source-audited mappings must retain separate provenance.
- The full implementation DAG must not mount until the user explicitly opens it.
- Add only one focused domain test file; do not expand or repair unrelated legacy tests.
- Verification is limited to the focused test, typecheck/build, and one rendered screenshot review.

---

### Task 1: Runtime system-summary view model

**Files:**
- Create: `src/features/runtime/domain/buildRuntimeSystemSummary.ts`
- Test: `src/features/runtime/domain/buildRuntimeSystemSummary.test.ts`

**Interfaces:**
- Consumes: `AtlasData`, `ProfilerEvidence`, `RuntimeStackSummary`, and `buildEvidenceRows`.
- Produces: `buildRuntimeSystemSummary(...)`, stable input-slice options, grouped measured rows, unavailable stack states, and capture counts scoped by model/runtime/hardware/precision.

- [ ] **Step 1: Write one failing behavior test**

Use a small literal fixture with FlashRT and vla.cpp records. Assert that the selected `V=2 / prompt=22` slice yields separate contract groups, preserves mean-versus-p50 labels, keeps a missing P95 as `null`, excludes the analytical tool, and never lends FlashRT profiler coverage to vla.cpp.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/features/runtime/domain/buildRuntimeSystemSummary.test.ts`

Expected: failure because `buildRuntimeSystemSummary` does not exist.

- [ ] **Step 3: Implement the minimal pure builder**

The builder must:

```ts
buildRuntimeSystemSummary({
  data,
  profiler,
  summaries,
  modelId,
  hardwareId,
  slice,
}): RuntimeSystemSummaryModel
```

It filters E2E evidence to `measured_local`, groups rows by runtime and actual precision, selects only the exact camera-view/prompt slice, derives contract groups from action shape/input contract/timing/state reuse/operating point, and represents missing measurement or profiler evidence with `null` or a discriminated missing state.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run src/features/runtime/domain/buildRuntimeSystemSummary.test.ts`

Expected: one test file passes with no warning or error.

- [ ] **Step 5: Commit**

```bash
git add src/features/runtime/domain/buildRuntimeSystemSummary.ts src/features/runtime/domain/buildRuntimeSystemSummary.test.ts
git commit -m "feat: summarize runtime system evidence"
```

### Task 2: Summary, Nsys, and Kernel sections

**Files:**
- Create: `src/features/runtime/components/Pi0SystemMetricsSection.tsx`
- Create: `src/features/runtime/components/Pi0NsysSection.tsx`
- Create: `src/features/runtime/components/Pi0KernelSection.tsx`
- Modify: `src/styles/runtime.css`

**Interfaces:**
- Consumes: Task 1's `RuntimeSystemSummaryModel`, existing `TimelineViewModel`, existing `KernelRowsModel`, selected `RuntimeRealizationRecord`, `RouteState`, and route navigation callbacks.
- Produces: three ordered, compact sections and links to existing detailed evidence routes.

- [ ] **Step 1: Build the system summary section**

Render input-slice selectors, contract-group headers, a maximum six-column table, selected-row state, and one compact line for unavailable runtimes. Do not render run IDs, raw samples, relative bars, rankings, or speedup.

- [ ] **Step 2: Build the Nsys section**

Render four same-capture summary cells in one ledger plus `TimelineTracks`. Default copy must distinguish graph envelopes from GPU busy and disclose missing prompt matching. A capture selector may switch graph/node/system-wide evidence; the detail link routes to `tab=timeline`.

- [ ] **Step 3: Build the Kernel section**

Render at most five Nsys aggregate hotspots, compact NCU/Roofline/link status, and the active realization's fusion/precision summary. Do not render the existing 13-column `KernelTable` on this overview. Link to `tab=roofline-kernels` for full counters and Roofline evidence.

- [ ] **Step 4: Add restrained funnel styling**

Use the token system and density rules in the spec. Keep surfaces full-width and structurally separated; make the Nsys timeline the only dark/high-contrast instrument. Add responsive table reduction and no decorative animation beyond interaction feedback.

- [ ] **Step 5: Run the focused domain test**

Run: `npx vitest run src/features/runtime/domain/buildRuntimeSystemSummary.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/runtime/components/Pi0SystemMetricsSection.tsx src/features/runtime/components/Pi0NsysSection.tsx src/features/runtime/components/Pi0KernelSection.tsx src/styles/runtime.css
git commit -m "feat: add runtime analysis funnel sections"
```

### Task 3: Delayed DAG and workspace integration

**Files:**
- Create: `src/features/runtime/components/Pi0ImplementationDagSection.tsx`
- Modify: `src/features/runtime/Pi0RuntimeWorkspace.tsx`
- Modify: `src/components/AtlasHeader.tsx` only if the existing active-state label remains misleading after integration.

**Interfaces:**
- Consumes: the existing Pi0 logical DAG/layout/connector/runtime-overlay inputs and Task 2 sections.
- Produces: final ordered page, deterministic default input slice, route-driven runtime/precision/capture selection, and an explicit mount/unmount control for the full DAG.

- [ ] **Step 1: Extract the existing implementation graph composition**

Move the graph focus, runtime-group selection, overlay, inspector, diagnostics, and mapping disclosure into `Pi0ImplementationDagSection`. Preserve the graph's layout and interaction behavior.

- [ ] **Step 2: Recompose `Pi0RuntimeWorkspace`**

Adapt profiler evidence once, build the system/Nsys/Kernel view models once, and render sections in this exact order:

```text
Pi0 toolbar → 总体表现 → Nsys 分解 → Kernel 与实现 → optional complete DAG
```

When no explicit workload is present, use the deterministic input slice `v=2,p=22`. Selecting a row writes runtime and actual precision to the route. Nsys and Kernel inherit that exact runtime/precision scope; they may report partial matching but must not silently select another runtime.

- [ ] **Step 3: Gate the DAG mount**

Render only the open/close control initially. Conditionally mount `Pi0ImplementationDagSection` after activation, and remove it from the DOM when closed.

- [ ] **Step 4: Run scoped verification**

Run:

```bash
npx vitest run src/features/runtime/domain/buildRuntimeSystemSummary.test.ts
npm run typecheck
npm run build
```

Expected: focused test passes; typecheck and build exit zero. Record unrelated baseline test failures separately without rerunning the entire suite.

- [ ] **Step 5: Render and review once**

At 1440×900, capture the full Pi0 runtime page and one native-scale crop for each section. Verify: no DAG on first paint, no collisions or unreadable helper text, the Nsys timeline is reachable, and opening the DAG preserves zoom/pan/node inspection.

- [ ] **Step 6: Commit and push**

```bash
git add src/features/runtime/components/Pi0ImplementationDagSection.tsx src/features/runtime/Pi0RuntimeWorkspace.tsx src/components/AtlasHeader.tsx src/styles/runtime.css docs/superpowers/specs/2026-09-05-pi0-runtime-analysis-funnel-design.md docs/superpowers/plans/2026-09-05-pi0-runtime-analysis-funnel.md
git commit -m "feat: reorder Pi0 runtime analysis"
git push
```

