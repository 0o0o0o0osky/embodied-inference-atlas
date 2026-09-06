# Methodology

## Repository scope

The maintained artifact is the parsing and analysis workflow plus its minimal
reference evidence. After local batch stability checks, retain one real trace
per analysis case and a compact `analysis_summary`; other windows, duplicate
exports and exploratory artifacts remain in ignored local archives. A retained
summary preserves batch medians/CVs without requiring every trace in the UI.
Keep default BF16 analytical snapshots for regression; other precision points
are computed from the existing scenarios and formula engine when requested.
Do not append measurements, panels or assets just because they are available.

## Evidence

The Embodied Inference Atlas separates evidence by how a value was obtained:

- `measured_local` records come from a benchmark or profiler run on a named,
  anonymized system.
- `reported_external` records preserve facts reported by a public source. In
  this foundation snapshot, external records are status metadata rather than
  numeric measurements.
- `analytical` records are calculated from a model, formula, or stated hardware
  assumption. They are estimates, not measurements, even when expressed in the
  same units as measured results.

Evidence class is retained on runs and measurements and is shown in the static
site. An analytical latency, component workload, traffic estimate, or roofline
point must not be interpreted as observed execution behavior.

## Configuration, run, and measurement

A configuration describes the normalized experimental intent: model artifact,
workload, runtime, device, system, operating point, precision, and timing
policy. A run is one concrete benchmark, profiler capture, analytical
calculation, or external report record. A measurement is one result within a
run and carries its own method, statistic, sample count, work unit, and timing
boundary.

Different capture tools produce different runs, even when they share a
configuration. Linking those runs does not imply that they observed the same
execution sample, temperature, clock state, or thermal history.

## Single-axis comparisons

Comparison policy version `1.0.0` begins with each run's complete
`comparison_context`. The builder removes only the axis allowed by the declared
comparison kind, then requires exact equality of the remaining canonical
context:

- `runtime` allows only `runtime_id` to vary. Artifact, task, workload,
  precision, timing, platform, and operating point remain fixed.
- `precision` allows only the complete precision and quantization configuration
  to vary. Artifact, runtime, task, workload, timing, and platform remain fixed.
- `platform` allows only device, system, and operating point to vary. Artifact,
  runtime, task, workload, precision, and timing remain fixed.
- `workload_scale` allows one declared scalar leaf under `workload` to vary,
  such as camera views, executed prompt tokens, or denoising steps. It never
  relaxes two workload fields at once.
- `measured_vs_bound` allows evidence class, runtime overhead treatment, system,
  operating point, and runtime to vary. It is used for a measured-to-analytical
  gap, not for a runtime speedup claim.

The derived `cg-*` identifiers are display labels, not manually assigned proof
of comparability. A record pair whose remaining context differs is not placed
in the same comparison group.

Ratio interpretation also depends on correctness:

- `validated_speedup` requires both runs to have passed their declared
  correctness criterion.
- `latency_ratio_unvalidated` is used when the comparison context is eligible
  but correctness has not been established for both runs.
- `blocked_known_unequal` is used when either run is known to have failed
  correctness. The records may be shown side by side, but no ratio is
  calculated.
- `blocked_unknown_invariant` is used when either run's operating-point ID is
  the `unknown` sentinel. Equal unknown labels do not establish equal power or
  clock behavior, so the records remain side by side and no numeric ratio is
  emitted. A known correctness failure remains the stronger block.

The current canonical runs use `not_assessed` correctness, so the snapshot does
not present any validated speedup.

## Timing and stage summaries

The Pi0 runtime overview uses five untimed warmup predictions followed by ten
timed predictions of the same input shape. It displays one record's summary
per runtime/precision/contract, never a pooled percentile of separate runs.
Older protocols remain in local archives unless they are the only necessary
reference for another supported model; they are excluded from the current overview.
Warmup count alone does not prove stability: retain sample order locally and
inspect the ten measured durations without discarding inconvenient samples.

Latency values are comparable only when their timing boundaries, state or
prefix reuse, warm/cold policy, workload, and work unit match under the chosen
single-axis policy. End-to-end wall-clock timing, CUDA-event timing, profiler
capture, and analytical timing are distinct methods and are not silently
combined.

Run timing records preserve the source warmup iteration count when reported;
an unavailable or inapplicable count remains null with a controlled reason.
Measured distributions containing source p50 or p95 values use
`percentile_method=source_reported`. Analytical non-percentile estimates use a
null percentile method and zero samples.

For charts that need one latency per record, the site selects an
`analytical_estimate` for analytical evidence and the within-batch median
(`p50`) for measured summaries. A missing median stays unavailable; existing
means remain accessible in the evidence ledger. The selected statistic is displayed with
the selected value; an analytical estimate is never labeled as a measured
mean. The full E2E provenance table remains available even when a record has no
comparison-safe multi-record group.

Inclusive and exclusive stage durations can be derived from interval unions
only for events from the same run and timing window. A stacked stage breakdown
requires mutually exclusive stages that completely partition one timing
window. Independent summaries such as separately aggregated p50, p95, or mean
stage values are non-additive; the site displays them side by side and labels
them accordingly.

## Precision and quantization

Precision is a structured execution configuration, not a single label. Weight,
activation, accumulation, and execution dtypes are recorded separately from
quantization scheme, granularity, scale/zero-point storage, dequantization, and
fusion.

FP16 and FP8 configurations therefore remain distinct. FlashRT precision ID
`mixed-fp8-e4m3-fp16` denotes selective FP8-E4M3 GEMMs at operator-path
granularity with mixed FP8/FP16 activation and execution semantics; attention,
residual, and buffer execution remain FP16. It is neither uniform FP8 nor
INT8. `Q8_0` in this snapshot is weight-only quantization: the graph's activation
and output interfaces retain their recorded floating-point semantics. It is
not a uniformly W8A8 model, and its smaller weight representation does not justify
using an INT8 compute ceiling. The site consequently does not infer an INT8
roofline for Q8_0 weight-only records.

Here activation dtype describes the graph interface, not every kernel's
temporary representation. The audited GGML CUDA MMQ path can quantize F32
activations to Q8_1 and use integer MMA with packed Q8_0 weights and scales.
Any kernel-specific roofline must follow that confirmed path, including its
conversion work; neither a uniform floating-point nor uniform INT8 ceiling
can be inferred from the weight-file label alone. The current Pi0 Q8 artifact
quantizes selected ViT/VLM weights and leaves the action expert floating-point.

## Model reference and runtime execution bounds

The model DAG's BF16 analytical estimate is a model reference, not the bound
of a particular runtime. Runtime-local bounds follow that implementation's
fusion boundaries, precision segments, repeated calls, and modeled memory
traffic. Adding the original unfused operators is not a fused-group bound.

For a confirmed serial execution plan, complete local bounds can be summed.
For a plan with overlap, aggregation must respect dependencies and shared
resource budgets: the critical-path and resource lower bounds constrain the
whole plan together; a critical path alone assumes away resource contention.
Cross-group traffic must use consistent cache/residency assumptions. Necessary
CPU work, synchronization, and transfers belong to the declared E2E boundary;
overlapping intervals must not be added twice. Partial coverage cannot be
promoted to a complete E2E bound, and missing terms are not zero.

The runtime view accepts implementation-modeled records explicitly tied to
the selected run and realization, with matching workload and operating point.
A complete E2E bound additionally requires complete execution coverage and
dependency, compute-resource, memory-resource, and runtime-overhead modeling.
Until these exist, the UI leaves the runtime bound unavailable and keeps the
model reference separate. Ordinary execution timing is distinct from NCU
replay timing; replay observations are never used for the actual-to-bound gap.

The paired Kernel Roofline uses one record's work and traffic for both points:
arithmetic intensity is work / bytes; theoretical and observed throughput are
work / lower-bound time and work / ordinary execution time. Modeled traffic is
labeled explicitly. The vertical connector does not imply measured bandwidth.
An attainment ratio requires the record's comparison prerequisites and complete
coverage; missing timing leaves only the theoretical point. Kernel and fused
group boundaries remain separate. Dependency-constrained aggregates are not
forced onto a two-resource compute/bandwidth curve.

## Missing profiler, power, and throttle evidence

Missing observations remain missing rather than becoming zero. Many measured
runs do not provide `power_mode` or `clock_policy`; all current runs leave
`throttle_status` unobserved. Canonical telemetry includes time series and report snapshots. Each record
preserves its temporal alignment: same-run but unaligned readings cannot be
assigned to one launch, and a report snapshot cannot establish continuous
clock or thermal stability. Where a source states an operating
mode, that statement is retained, but it is not evidence of stable observed
frequency or absence of throttling.

An operating-point ID of `unknown` is only a missing-information sentinel. Two
runs carrying that same sentinel may be grouped for side-by-side inspection,
but they do not satisfy the fixed power/clock invariant required for a ratio.
Attested controlled IDs such as `thor-120w-dynamic` and explicit analytical
assumption IDs are not treated as the unknown sentinel.

The snapshot now contains canonical Nsys timelines and NCU representative-
launch evidence. Nsys scheduler-running intervals establish observed CPU
execution overlapping controlled intervals, but they do not establish CPU
idle time, useful work, or offload headroom. The graph and system-wide reports
provide CUDA Graph envelopes plus recorded copy intervals, not kernel lanes or
exact GPU-busy time. The intrusive node report provides a recorded kernel-plus-
copy activity union and controlled CPU-overlap summaries; even that union is
not evidence of all GPU activity. NCU preserves per-replay SM, tensor, clock-
rate, L1, L2, and L2 sysmem-fill metrics, but L2 and sysmem-fill activity is not
LPDDR or whole-system memory traffic. Some independent replays also contain SchedulerStats and scoreboard counters;
these diagnose only their selected launches. When a capture lacks DRAM counters, L2 sysmem-fill activity cannot establish
LPDDR saturation. Independently replayed memory counters and Nsys execution
times must not be combined into measured bandwidth. NCU replay
durations remain separate single-launch observations and are neither summed
across reports nor used as end-to-end or stage timing.

## Fixed-input batches and representative traces

A fixed-input case identifies the input recipe, shapes, dtypes, preprocessing
boundary, external noise and output checks. Finite output alone does not prove
task correctness. Optional run `analysis_batch` records preserve all ten
wall-clock samples after five warmups. Optional capture `analysis_sample`
records connect a real prediction window to its input case, batch and zero-based
sample index. Independent tools and repeated batches retain distinct identities.

All overall measured summaries use the median of one complete batch. Stability
uses sample standard deviation divided by the arithmetic mean, with a project
acceptance threshold of 5%; the mean is used in this diagnostic, not as the
displayed latency. No samples are dropped. At most one new batch is collected
when unstable; batches are retained separately, never pooled.

For a representative node trace, validate request wall-clock variability and
the first two GEMM and first non-GEMM execution classes ranked by median
cumulative kernel time. Each class must have consistent call count across ten
samples and cumulative-time CV at most 5%. Candidate traces must be within 5%
of every checked metric's median. Select the candidate closest to median wall
time, breaking ties by sample order. Full event coverage is required. An
unstable or incomplete batch has no automatically verified representative.

Kernel classes retain actual signature and launch configuration. Shape and
precision metadata must come from the implementation/capture, not the symbol
alone. Details select one real call nearest the class's within-trace median;
its actual event time drives the single-call Roofline. Class cumulative time
is useful for ranking, but overlap prevents treating it as wall-clock share.

CPU scheduled intervals, CUDA/OS runtime calls, device synchronization records
and timestamped function samples preserve distinct semantics. Samples carry
weights and sanitized recorded frames, never inferred duration. Device sync
records are not added to host API time. Pixel bins simplify only the rendered
overview; complete events and samples remain available in the offline export.
