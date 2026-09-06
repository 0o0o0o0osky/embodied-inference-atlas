---
name: reviewing-technical-model-ui
description: Use when rendering or reviewing model DAG, runtime, timeline, Roofline or Kernel analysis interfaces against a concrete user question.
---

# Render a readable analysis

Start with the question and current execution object. Reuse the accepted layout
and components; the page is an analysis, not an archive of every available record.
For drilldown changes read [performance-navigation.md](references/performance-navigation.md).

Show a compact overall summary, then the selected runtime's DAG/system/Kernel
analysis using one stable representative trace. Kernel lists stay folded below
the DAG. Do not add per-sample selectors, capture histories, repeated tool entry
points or large provenance panels merely because the records exist.

Explain calculation/data movement and evidence-supported fusion, quantization
and reuse. Keep facts, modeling assumptions and unknowns distinguishable. Missing
metrics remain local gaps; do not blank unrelated valid timing or invent a point.

System process diagrams use CPU/GPU lanes and qualitative order. Keep data
transfers, host submissions and reuse distinguishable; do not turn host enqueue
order into a GPU-completion dependency or use diagram widths as measured latency.
Capture boundaries and initialization/prompt preparation follow the selected stack.

Inspect a real browser at a desktop size and one relevant selection/return path.
Check the screenshot at native scale for overlap, density, readable labels,
inspector placement and reachable overflow. Check a narrow view when layout changed.
Match viewport/state for before/after DAG geometry comparisons. Follow actual
edge destinations; adjacency alone does not prove dependency or fusion.

Measure initial payload and verify offline loading when data/assets changed.
Third-party viewers are dependencies; their source maps, alternate tools and
complete release contents are not automatically part of the project.

Keep screenshots and detailed review notes local. Report concrete visible issues
and their recheck, plus material evidence limits. Fix demonstrated problems;
do not add decorative animation, a screenshot platform or repeated broad audits.
