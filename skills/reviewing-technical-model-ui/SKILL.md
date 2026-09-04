---
name: reviewing-technical-model-ui
description: Use when reviewing rendered technical model, dependency graph,
  runtime overlay, timeline, roofline, kernel, or operator-animation interfaces.
---

# Reviewing Technical Model UI

## Review contract

Judge rendered evidence, not intent. When execution is authorized, render before
reviewing; otherwise state that the review is screenshot-only. Inspect a full
page, then native-scale focused crops. For each artifact, record visible
model/tab/runtime/workload/precision/viewport; mark absent state unknown.

## Inspect in this order

1. Trace meaning before aesthetics. Horizontal siblings may denote parallel
   work; vertical progression may denote dependency. Confirm that branches such
   as Q/K/V or gated projections converge into the correct downstream work.
   Distinguish persistent storage or cache, read ports, and logical views; do not
   infer physical concatenation, fusion, or execution from proximity.
2. At native scale, follow each edge through its turns to a visible destination
   arrowhead. Check ordinary and selected edges for contrast, and inspect node,
   edge, and label collisions, label density, clipped versus reachable overflow,
   and wide state, selection, slice, cache, or control shapes that could be
   mistaken for arithmetic operators. At a narrow frame, report a missing
   navigation, scrollbar, fade, or other reachability cue without claiming that
   unseen content is inaccessible.
3. Inspect graph labels and explanation copy separately. Check apparent body-text
   legibility, label hierarchy, inspector proximity, whole-page scrolling, and
   any nested content scrolling. Without computed-size evidence, describe text
   as visually too small rather than asserting an exact pixel size.

Before prioritizing, account for each of these surfaces: ordinary edges and
arrowheads, graph-label density, narrow-edge reachability cues, prose and helper
copy relative to body text, and unusually wide non-arithmetic shapes. Combine
related visible failures rather than replacing them with speculative requests
for calculations or model details.

Call an edge collision only by naming the specific obscured intersection;
nearby parallel or orthogonal routes are not collisions when spacing and
destination arrows remain visible. Call clipping or a missing path only when
the pixels demonstrate it. A before/after pan pair can establish reachable
overflow; it does not establish responsive relayout or data loss.

## Evidence gates

- Verify runtime-layout invariance only from matched before/after geometry at the
  same viewport and graph state.
- Verify roofline integrity only when chart and table visibly share one
  accounting level, time basis, traffic basis, precision, workload, and hardware
  basis. Never turn missing evidence into a benchmark, bottleneck, bandwidth,
  speedup, gap, or provenance claim.
- Verify animation completeness only from interaction or sufficient frames that
  cover the full sequence and user controls. Check reduced-motion behavior
  separately.
- Static images alone leave runtime invariance, timing, keyboard behavior,
  animation traversal, reduced motion, and scrollbar behavior unverified.

## Output

Return, in order: `Verdict`, severity-ordered `Findings`, `Unverified`, and
`Evidence checked`. Every finding includes the artifact and visible region,
observation, violated invariant, impact, fix, and a concrete recheck. Never fill
an evidence gap with a claim.

Keep tracked review output sanitized: omit raw capture content, machine paths,
hostnames, process or device identifiers, credentials, and proxy values.
