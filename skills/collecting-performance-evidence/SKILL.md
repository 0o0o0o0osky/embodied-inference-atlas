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

Before acquisition for a new page, check the [onboarding contract](../../docs/analysis-components.md#新页面接入契约). Missing input/specification, uncollected evidence and unsupported capability are different states; only a named evidence gap warrants collection.

Use the [shared verification step](../../docs/single-inference-analysis.md#8-浏览器离线与体积验收): relevant incremental tests, one offline build that includes type/data checks, and review of the changed browser path. Generated `site/` stays outside Git; do not repeat build/check cycles for unchanged inputs.
