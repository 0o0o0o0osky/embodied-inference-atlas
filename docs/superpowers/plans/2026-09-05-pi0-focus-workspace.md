# Pi0 Focus Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one reviewable Pi0 model page whose default state is a clean full-width DAG and whose selected state smoothly focuses the chosen operator while opening a readable right-hand analysis drawer.

**Architecture:** Keep the canonical Pi0 graph, authored coordinates, and URL-backed logical entity as the source of truth. Add a small presentation-state layer that derives `overview` versus `focus` from route selection, computes a selected scope viewport, and mounts detail tabs only in focus mode. Restyle only the shared shell portions required to make the Pi0 route modern and Chinese; do not redesign Pi0.5, SmolVLA, E2E, or Nsys in this batch.

**Tech Stack:** React 19, TypeScript, Vite, authored SVG DAG, CSS transitions, existing canonical JSON.

**Spec:** `docs/superpowers/specs/2026-09-05-chinese-summary-first-ui-design.md`

## Global Constraints

- Phase 1 acceptance covers only Pi0 on `NVIDIA Jetson AGX Thor` with analytical precision defaulting to `BF16`.
- Default state shows the DAG at full width and no permanent inspector.
- Selecting an operator opens a 28–32rem drawer and focuses the DAG on the selected scope plus immediate graph context; closing restores the full DAG view.
- Horizontal placement continues to mean parallel work and vertical placement continues to mean dependency.
- Canonical evidence and Pi0 authored topology/coordinates are unchanged.
- All user-facing navigation and summaries touched by this batch are Chinese; technical acronyms stay English.
- Every first viewport has one primary question, one primary visualization, and no more than four short summary metrics; available empty space is not permission to expose deeper evidence.
- No new chart or animation dependency. Motion is a restrained 300–450ms spatial transition and is disabled by `prefers-reduced-motion`.
- Add only two focused behavior tests; run the full frontend build once after the visual checkpoint.
- Do not modify Pi0.5 or SmolVLA presentation files in this batch.

---

### Task 1: Introduce the Pi0 two-state DAG viewport contract

**Files:**
- Create: `src/features/model-graph/domain/focusViewport.ts`
- Test: `src/features/model-graph/domain/focusViewport.test.ts`
- Modify: `src/features/model-graph/ModelGraphWorkspace.tsx`
- Modify: `src/features/model-graph/components/LogicalDagSvg.tsx`

**Interfaces:**
- Consumes: `LogicalDag`, `LogicalLayout`, selected logical ref, and existing route navigation.
- Produces: `resolveFocusViewport(dag, layout, selectedRef): GraphViewport` where `GraphViewport` contains `x`, `y`, `width`, `height`, and `scopeId`; `LogicalDagSvg` receives `mode: "overview" | "focus"` and `viewport`.

- [ ] **Step 1: Write the focused viewport test**

  Assert that no selected ref returns the full authored canvas, while a Pi0 operator returns a padded rectangle containing its scope and direct neighbors without exceeding layout bounds.

- [ ] **Step 2: Run the single test and confirm the missing resolver fails**

  Run `npm test -- src/features/model-graph/domain/focusViewport.test.ts` and expect failure because `resolveFocusViewport` does not exist.

- [ ] **Step 3: Implement the viewport resolver**

  Resolve the smallest containing logical scope, union its node boxes with directly adjacent node boxes, add fixed padding, preserve a usable aspect ratio, and clamp to the authored SVG bounds. Return the full canvas when no valid operator is selected.

- [ ] **Step 4: Remove the implicit first-operator selection**

  In `ModelGraphWorkspace`, treat a missing or invalid `route.entity` as overview mode. Mount `OperatorInspector` only when an explicit valid operator is selected. Add a close action that navigates with `{ entity: null }`.

- [ ] **Step 5: Animate the spatial state change**

  In `LogicalDagSvg`, keep one stable authored graph and animate an inner SVG scene transform from the full graph to the computed focus viewport. Do not recompute Pi0 coordinates or hide connectivity; mute unrelated nodes and edges only after selection.

- [ ] **Step 6: Run the focused test**

  Run `npm test -- src/features/model-graph/domain/focusViewport.test.ts` and expect one passing test file.

### Task 2: Replace the permanent inspector with a progressive Pi0 drawer

**Files:**
- Create: `src/features/model-graph/components/OperatorDrawer.tsx`
- Test: `src/features/model-graph/components/OperatorDrawer.test.tsx`
- Modify: `src/features/model-graph/components/OperatorInspector.tsx`
- Modify: `src/features/model-graph/visualizers/OperatorVisualizer.tsx`
- Modify: `src/styles/model-graph.css`

**Interfaces:**
- Consumes: selected `OperatorDetail`, route-backed reset key, and `onClose()`.
- Produces: mutually exclusive tabs `概览`, `计算过程`, `Roofline`, and `实测 Kernel`; only the active tab is mounted.

- [ ] **Step 1: Write the focused drawer test**

  Render one Pi0 operator, verify `概览` is the only active/mounted panel, switch to `计算过程`, and verify closing calls `onClose` exactly once.

- [ ] **Step 2: Run the single test and confirm it fails**

  Run `npm test -- src/features/model-graph/components/OperatorDrawer.test.tsx` and expect failure because the drawer component does not exist.

- [ ] **Step 3: Implement the drawer shell and concise overview**

  Put the short label, formula, repeat semantics, and compact input/output shape rows in `概览`. Move the existing interactive visualizer into `计算过程`. `Roofline` and `实测 Kernel` show a concise exact-evidence availability state and a link into the existing analytical/performance route; they must not fabricate an operator/kernel match.

- [ ] **Step 4: Apply the two-state layout**

  Default `.logical-workspace-grid` to one full-width column. Add `.is-focused` with `minmax(0, 1fr) clamp(28rem, 31vw, 32rem)`. Make the drawer sticky on desktop without a nested scrollbar and a bottom sheet on narrow screens.

- [ ] **Step 5: Make spatial intent obvious**

  Use one selected accent, reduce card borders, increase drawer body typography to at least 16px, keep formulas in mono, and provide a visible `返回完整模型` action. Avoid cards inside cards and remove edge-count/debug copy from the normal viewport.

- [ ] **Step 6: Run the focused drawer test**

  Run `npm test -- src/features/model-graph/components/OperatorDrawer.test.tsx` and expect one passing test file.

### Task 3: Simplify and modernize the Pi0 entry surface

**Files:**
- Modify: `src/app/routes.ts`
- Modify: `src/app/AtlasApp.tsx`
- Modify: `src/components/AtlasHeader.tsx`
- Modify: `src/features/workbench/Workbench.tsx`
- Modify: `src/features/model-graph/ModelGraphWorkspace.tsx`
- Modify: `src/styles/base.css`
- Modify: `src/styles/shell.css`
- Modify: `src/styles/model-graph.css`
- Generated by build: `site/`

**Interfaces:**
- Consumes: existing model/runtime/device capability data and route state.
- Produces: root route defaulting to Pi0; compact Chinese context header; three top-level entries `模型结构`, `端到端`, `Nsys`; Pi0 page starts directly at the DAG.

- [ ] **Step 1: Make Pi0 the zero-configuration route**

  Default an empty URL to `model=pi0`, `tab=logical`, `hardware=nvidia-jetson-agx-thor`, and `precision=bf16_dense` while retaining explicit URL overrides.

- [ ] **Step 2: Remove pre-DAG information debt**

  Replace the catalog breadcrumb, giant workbench heading, inventory counts, permanent four-field context grid, model intro block, derived-symbol strip, annotation, and breadcrumb with one compact control bar and one scenario summary. Keep editing workload values behind a `场景` control rather than displaying the form by default.

- [ ] **Step 3: Apply the modern visual system**

  Use a dark graphite top bar, cold-white canvas, white surfaces, one cyan interaction color, normal-width system/IBM Plex font stacks, restrained radii, softer separators, and clearer whitespace hierarchy. Do not add glassmorphism, giant hero text, gradients, decorative motion, or dense dashboard cards.

- [ ] **Step 4: Preserve out-of-scope routes**

  Keep Pi0.5, SmolVLA, Runtime, E2E, Timeline, and Roofline routes functional but do not visually redesign or change their graph presentation in this batch.

- [ ] **Step 5: Build once and perform one visual review loop**

  Run `npm run build`, serve the local site, capture Pi0 at 1920×1200 in overview and focused states, and inspect both images for overlap, clipping, unreadable labels, wrong focus target, and unexpected scrollbars. Fix only concrete defects from these two screenshots.

- [ ] **Step 6: Commit the review checkpoint**

  Commit source and deterministic `site/` output with `feat(ui): add Pi0 focus workspace`, then stop for user review before touching Pi0.5, SmolVLA, E2E, or Nsys redesigns.

## Self-review

- Spec coverage: the plan implements the newly confirmed full-width default, selected local focus, conditional drawer, Chinese compact shell, restrained motion, and Pi0-only checkpoint.
- Deliberate deferrals: detailed operator Roofline/kernel composition, E2E summary redesign, Nsys flame view, and other model DAGs remain for later checkpoints.
- Placeholder scan: every deferred item is an explicit out-of-scope boundary, not an unfinished step inside this batch.
- Type consistency: `GraphViewport`, `resolveFocusViewport`, `mode`, `viewport`, and `onClose` use one spelling across tasks.
