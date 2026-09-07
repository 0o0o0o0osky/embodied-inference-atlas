---
name: collecting-performance-evidence
description: Use when collecting bounded inference timing, CPU/GPU traces or selected Kernel counters for a concrete analysis question.
---

# Acquire sufficient evidence

Follow the acquisition sections of the [complete workflow](../../docs/single-inference-analysis.md).
Start with the concrete input, implementation and timing boundary; inspect existing
reports and installed capabilities before collecting. A new model needs an audited
adapter, not another model's shapes, markers or precision assumptions.

Keep E2E, tracing and counter replay independent. Use the bounded stability and
representative-selection procedure; preserve failed batches locally. Missing GPU
counters leave a local gap while available timing remains usable. Do not expand
sampling or alter the inference path, libraries or operating settings to fill a panel.
