# Repository Guidance

This project is a reusable inference-analysis workflow: import evidence, explain
execution, render an analysis, and help a person judge bottlenecks. Keep the
maintained code and evidence small; it is not a collection of every experiment.

- Start with one model, runtime and concrete input, and the question to answer.
  Reuse the existing parser, formula engine and visual components before adding data or UI.
- Check stability from a bounded local batch. Retain one real representative
  trace per analysis case, its small stability summary, the required E2E medians,
  and matched Kernel metrics. Other samples and duplicate exports stay local.
  Missing or unstable evidence must not become a claimed stable representative.
- Keep raw reports, sample sequences, screenshots, review logs and superseded
  data under ignored `.local/`. Archive before removing canonical records and
  validate the retained reference closure. Import via staging/promote; compact
  via the archive tool. Do not manually edit large generated datasets.
- Store formulas and scenario inputs rather than all derived precision/shape
  combinations. Keep a small default reference snapshot for regression checks.
- Read `docs/methodology.md` for timing, precision and comparison semantics.
  CPU core-time, request wall time, Nsys and NCU remain distinct. Missing is not zero.
- Use `skills/collecting-performance-evidence/SKILL.md` for bounded acquisition,
  `skills/analyzing-performance-evidence/SKILL.md` for interpretation, and
  `skills/reviewing-technical-model-ui/SKILL.md` for actual rendering/review.
- UI follows the question and selected object. One representative trace is shared
  by system, DAG and Kernel views; do not add duplicate selectors or data archives.
- Reuse the modules in `docs/analysis-components.md`. Put implementation-specific
  operations and evidence-backed prose in typed configuration; share layout,
  semantic style tokens and the `tools/render_review.mjs` browser helper. The
  complete sampling-to-review workflow belongs in `docs/single-inference-analysis.md`;
  skills link to it. Machine paths, credentials and launch settings stay local.
- New model/runtime/device entries follow the shared page contract: required
  identity and navigation, explicit capability states, and one available/missing
  case review. A missing graph must not hide valid timing or Kernel details.
- Additional collection must resolve a named evidence gap. Stop once the
  question is answerable; do not expand to all kernels, metrics or input combinations.
- Run relevant incremental tests, then one `python -m tools.build` (includes
  typecheck, canonical validation and offline asset checks), and inspect the changed
  browser path. Use `--check` instead only when output must remain untouched.
  Do not repeat the same checks before/after that build without new changes.
  Keep tests bounded; do not add stress/combination suites for UI edits.
- Before finishing, report useful findings, evidence limits, changed data/asset
  size and relevant checks. The deliverable is a readable analysis plus a repeatable process.
- Pinned third-party UI binaries are reproducible local dependencies, not source
  to vendor repeatedly. Generated `site/` and local reports stay out of Git. Development serves canonical
  records directly; deployment requires building the offline directory first.
  Do not download models, change clocks/power, or alter the inference implementation.
