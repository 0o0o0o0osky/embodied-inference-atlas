---
name: reviewing-technical-model-ui
description: Use when rendering or reviewing linked model, system timeline, Kernel, Roofline or execution-mechanism views.
---

# Render and inspect the answer

Follow [navigation and diagram semantics](references/performance-navigation.md),
the [component catalog](../../docs/analysis-components.md) and the browser section
of the [complete workflow](../../docs/single-inference-analysis.md).

Reuse the accepted shell, shared selection and semantic tokens. Put model/runtime
specific operations and parameters in evidence-backed configuration. Explain the
selected work directly; avoid duplicate selectors, long provenance blocks and
repeated cautions. Missing evidence should affect only its own result.

New models and runtimes use the same workspace, DAG renderer, performance chart
and detail panels. Add graph/presentation/evidence configuration rather than a
model-specific page or style branch. Review a model switch and a return to the
same inference: input, selected object and graph viewport must remain consistent.

Use the shared browser helper and inspect a real screenshot plus the changed
interaction. Check offline loading and payload when assets/data changed. Repair
visible failures and recheck that path; do not build a screenshot platform or
repeat broad reviews. Raw captures and detailed review logs stay local.

Every new entry must satisfy the [shared page contract](../../docs/analysis-components.md#新页面接入契约): identity, current input, navigation and required capability states. Inspect an available and a missing case; missing data uses shared defaults, not copied components, zeros or generated explanations.

Use the [shared verification step](../../docs/single-inference-analysis.md#8-浏览器离线与体积验收): relevant incremental tests, one offline build that includes type/data checks, and review of the changed browser path. Generated `site/` stays outside Git; do not repeat build/check cycles for unchanged inputs.
