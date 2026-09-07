# Navigation and diagram semantics

Preserve accepted layouts for local changes. The [complete workflow](../../../docs/single-inference-analysis.md)
owns acquisition and tool instructions; the [component catalog](../../../docs/analysis-components.md)
owns reusable rendering entry points.

- Compare implementations at an explicit input and actual precision. Keep one
  representative trace shared by system, DAG and Kernel views. Return restores
  input, selection and camera; the complete Kernel/CPU list stays folded below the DAG.
- A logical operator, implementation group and executed Kernel are distinct
  objects with many-to-many links. Selecting a mapped Kernel highlights its
  established location; shared work offers choices. CPU/API work can locate its
  recorded interval without a fabricated model-node association.
- DAG arrows are solid for tensor data, dashed for control or inter-iteration
  dependencies (including state feedback). Routing rails, residuals, cache reads
  and missing mappings do not change that meaning. Keep node borders solid;
  distinguish compute, layout/view, storage and grouping by shape and fill.
- Lead with what executes, time contribution and data movement. Explain metrics
  positively. Put collection policies and a useful pinned source version in
  folded detail; omit record ordinals, duplicate repository links and empty tables.
- System flow uses CPU/GPU lanes and qualitative ordering. Show transfers,
  submissions, graph boundaries and reuse with distinct edge meanings. CPU enqueue
  order alone does not prove GPU completion. Track order is not a thread identity.
- Mechanism comparisons show removed repeated work, preparation and work that
  remains. For CUDA Graph, use two CPU/GPU timelines: individual launches versus
  graph replay, with visible submission spacing and identical GPU work. Current
  graph count and scope come from the selected implementation's evidence.
  The comparison is qualitative; measured savings require separate evidence.
- Time-precompute operations, device, step count and lifetime come from audited
  configuration. A generic template supplies layout, not a model's mathematics.
  Hide routine within-observation prefix K/V on the optimization page. Distinguish
  results, execution plans and storage; keep meaningful dependencies and rebuild conditions.
- Roofline pairs use the same object and intensity. A reference percentage uses
  the point on the selected curve, not peak throughput. Preserve conditional
  ceilings, traffic domains and partial modeling; local headroom is not total speedup.
- Show function-sample analysis when labels identify useful work; only
  other/unresolved labels do not justify a 100% ranking. Keep actual wait/API
  durations separate from CPU running intervals. Define CV as timing variability.
- Ctrl + wheel zooms graphs/timelines; ordinary wheel scrolls the page. Inspect
  real edge destinations, selection, closing and return behavior, not just a screenshot.
