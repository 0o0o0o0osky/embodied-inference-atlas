# Methodology

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
`analytical_estimate` for analytical evidence, otherwise a measured mean when
available, otherwise a measured p50. The selected statistic is displayed with
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
INT8. `Q8_0` in this snapshot is weight-only quantization: activations and
execution retain their recorded floating-point semantics. It is not W8A8 or an
INT8 compute path, and its smaller weight representation does not justify
using an INT8 compute ceiling. The site consequently does not infer an INT8
roofline for Q8_0 weight-only records.

## Missing profiler, power, and throttle evidence

Missing observations remain missing rather than becoming zero. Many measured
runs do not provide `power_mode` or `clock_policy`; all current runs leave
`throttle_status` unobserved. This snapshot has no canonical telemetry time
series and no measured board/GPU/CPU power, temperature, or observed-clock
window from which to resolve those gaps. Where a source states an operating
mode, that statement is retained, but it is not evidence of stable observed
frequency or absence of throttling.

An operating-point ID of `unknown` is only a missing-information sentinel. Two
runs carrying that same sentinel may be grouped for side-by-side inspection,
but they do not satisfy the fixed power/clock invariant required for a ratio.
Attested controlled IDs such as `thor-120w-dynamic` and explicit analytical
assumption IDs are not treated as the unknown sentinel.

The snapshot also contains no canonical Nsys timeline or NCU kernel dataset.
Without scheduler or per-core observations it cannot conclude that the CPU was
idle. Without measured DRAM throughput and an applicable bandwidth ceiling it
cannot conclude that memory bandwidth was saturated. Analytical roofline
limiters describe a model under stated assumptions; without matching kernel
measurements and saturation evidence they cannot establish that execution was
kernel-bound, compute-bound, or memory-bound. These questions remain open for
the separate profiler-evidence phase.
