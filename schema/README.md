# Atlas contract format

Atlas schemas use a small internal contract format. It is not a complete JSON
Schema implementation.

The validator supports these rule keys:

- `type` for `object`, `array`, `string`, `integer`, `number`, `boolean`, and
  `null`. Nullable values use an array, for example `["string", "null"]`.
- `required` for object fields that must be present.
- `properties` for object field rules.
- `additional_properties` to close an object when set to `false`.
- `items` for array element rules.
- `enum` for permitted literal values.
- `min_length` and `max_length` for string bounds.
- `minimum` for numeric lower bounds.

Catalog schema files contain a dataset name and the contract for each record.
Documents add the `schema_version`, `dataset`, and `records` wrapper that the
validator checks before applying the record contract.

Kernel Roofline records may use `traffic_basis=kernel_boundary_modeled` with
`traffic.value_kind=modeled`. These are source-derived tensor bytes at the
selected kernel boundary, not measured DRAM traffic. `timing.statistic=sum`
means the same selected launches in one prediction window contribute work,
bytes and Nsys duration; separate windows are separate points. A
`captured_kernel` scenario records the proven kernel precision path without
claiming that the whole model executes at that precision. Conditional ceilings
without observed matching clocks do not permit attainment or speedup ratios.

The bounded `python3 -m extractors.pi0_kernel_pairs HANDOFF --sqlite REPORT`
importer reads an existing local audited handoff and its Nsys export. It writes
only `.local/staging/pi0-kernel-pairs.json`; promotion remains a separate
`python3 -m tools.promote BUNDLE --apply` step. It does not collect, run or
modify an inference implementation.

An operator/kernel link may name multiple execution groups for a shared
signature population. `status=partial` with `reason_code=ambiguous_attribution`
retains that joint association without partitioning its measured duration
among groups. Source-audited fusion semantics and observed per-group timing
remain distinct; group lists must never duplicate a signature total into
additive per-group times.
