---
name: analyzing-performance-evidence
description: Use when explaining inference bottlenecks or linking measured work to model operators, precision, data movement and reuse.
---

# Explain the selected execution

Use the [complete workflow](../../docs/single-inference-analysis.md) for statistical,
Nsys/NCU, mapping and Roofline contracts. Use the [component catalog](../../docs/analysis-components.md)
to render existing evidence before inventing a new panel.

The batch median describes overall performance; one real representative trace
supplies Kernel calls. Agent analysis establishes implementation semantics and
source-backed associations; deterministic tools calculate units, intervals,
formulas and layouts. Keep many-to-many mappings and unknowns explicit.

A mechanism template explains established work, not measured savings. Reuse a
confirmed implementation's mechanism across devices, but resolve actual precision,
launch behavior and hardware ceilings again. Separate observations, supported
explanations and the smallest unresolved evidence gap.

For new models, runtimes or devices, supply the [minimum structured content](../../docs/analysis-components.md#新页面接入契约): identity, actual input/precision, evidence and applicability. Preserve unlinked timing; do not invent values or prose to make every capability appear complete.
