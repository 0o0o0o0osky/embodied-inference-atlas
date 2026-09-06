---
name: analyzing-performance-evidence
description: Use when interpreting a fixed-input inference run, linking profiler evidence to operators, or explaining likely bottlenecks for visualization and human review.
---

# From evidence to an explanation

Identify the selected input, implementation and representative trace. Overall
statistics use the recorded batch median; kernel analysis uses a real event in
that trace. Keep E2E, Nsys and NCU measurements distinct.

Start with time contribution, then inspect the dominant CPU or GPU work. Match
operators/fusion/quantization to kernels through actual shape, precision and
launch evidence. Do not infer shapes from names or allocate a shared kernel's
entire duration to one logical operator.

Explain the operation, data movement and reuse scope with the existing formula
engine and rendering components. Model-derived bytes are not measured DRAM
traffic; low occupancy alone is not a bottleneck diagnosis. Separate observed
facts, plausible explanations and the one missing measurement that would
resolve uncertainty. Report local limits rather than a promised total speedup.

Retain only the representative trace, required metrics and concise conclusions.
Leave raw reports and exploratory detail local. Recompute derived what-if points
instead of committing all combinations. A new panel or dataset must help answer
the current question.

See [the workflow and interpretation tutorial](../../docs/single-inference-analysis.md).
Use the technical UI review skill to inspect the actual resulting page.
