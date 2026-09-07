---
name: collecting-performance-evidence
description: Use when acquiring profiler or timing evidence for a concrete inference question, including checking stability before choosing a representative trace.
---

# Collect only what answers the question

Fix the input content/shape, runtime, actual precision and timing boundary first.
Inspect available local evidence and the installed profiler's supported options.
Collect only a named missing measurement; do not start a parameter matrix by default.

For the atlas's steady case, use 5 warmups and 10 measurements. Check the complete
batch locally, including total wall time and major hotspot counts/durations.
Use one real stable representative trace for analysis and store a compact check
summary. Keep all other samples/raw exports local; their existence is not a
reason to add them to the repository or page. Do not discard outliers to pass.
For node tracing, enable instrumentation before the same five warmups when
startup affects the first measurement; label only the ten measured windows.

Use Nsys node events when the question concerns individual kernels; include CPU
scheduling when the question concerns CPU/GPU execution. Graph envelopes answer
coarser questions and need not become a parallel default dataset. Acquire NCU
only for selected hotspots and preserve independent replay identity and policy.

Stop when the evidence is sufficient. Missing counters do not justify exhaustive
metric collection. Do not change model/runtime behavior or power/clock settings.
See [the collection tutorial](../../docs/single-inference-analysis.md) for timing,
CPU sampling and counter interpretation.
