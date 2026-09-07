# Performance workbench navigation

Use this reference for information hierarchy, drilldown, or linked performance
views. These are design criteria, not a mandate to rewrite existing screens.
Preserve the user's accepted layout when the request is a local correction.

## Separate the object from its evidence

The object hierarchy is model / request, stage, implementation group, kernel.
Logical operators and runtime groups have explicit many-to-many mappings;
one fusion group need not be one kernel. A diagram, timeline, roofline and NCU
counters are views or evidence about these objects, not interchangeable levels.

For this atlas, the default model entry is the theoretical DAG. Runtime
performance is a sibling entry, not another section beneath a long diagram.

| User question | First visible answer | Detail after selection |
| --- | --- | --- |
| What does the model compute? | Model DAG and scenario summary | Shape, formula/animation, analytical roofline |
| Which implementation is faster? | One comparison chart at a fixed input shape | Selected runtime's aggregate latency and bound availability |
| Where does this runtime spend time? | Stage/system summary and overview timeline | Selected stage or time window, CPU threads and GPU streams |
| Which executed work deserves attention? | Hotspots ranked by time contribution | Same group's DAG location and implementation-specific roofline |
| Why is this kernel below its ceiling? | Matched theoretical/measured point pair | NCU counters, collection conditions and caveats |

One screen answers one of these questions first. Context controls stay stable;
advanced configuration and essential provenance belong in folded detail. Raw
per-sample records and capture archives stay local; after stability is checked,
the page carries one representative trace rather than a trace selector. Every drilldown has a visible return action. Closing an
inspector restores its parent, not the default model or a different workload.

Default copy names the object, measurement and useful conclusion. Put collection
passes, NCU profiling duration, association method and modeling assumptions in
folded details. Omit an index when there is only one record; when several exist,
show the total. Avoid repeating generic cautions or lists of uncollected fields.
Keep a local notice only for a missing result or conflict affecting the current
judgment. Add tile/warp/buffering detail when it answers the current question.

## Linked views, not duplicate destinations

- Theoretical analysis uses the model's selected analytical precision. Runtime
  analysis uses the implementation's proven precision/fusion path. Carry both
  explicitly; a BF16 model reference does not become a runtime bound.
- At runtime hotspots, DAG and roofline share the selected execution object.
  Use the runtime DAG as the primary entry: selecting a node or fusion/precision
  boundary opens associated Kernel details. Keep the complete Kernel/CPU list
  collapsed below the graph. A representative real trace is shared by all tabs.
- A summary statistic describes a declared population; a representative trace
  describes a particular capture. Label that distinction without displaying the
  entire capture contract above the chart.
- Roofline needs the object's work, traffic assumption/domain, compute ceiling
  and timing. Modeled bytes are not measured memory traffic. Show missing terms
  locally; an unsupported ratio must not suppress a valid timing summary.
- A local ceiling gap is diagnostic headroom, not promised E2E speedup. Kernel
  totals are not request latency; overlapping work and dependency/resource
  constraints matter. Non-arithmetic overhead still belongs in hotspot analysis
  even if it has no meaningful FLOP/s point.
- NVTX nesting, CPU stack samples, CUDA launch correlation and model dataflow
  are distinct relationships. Display only the relationships actually captured.

## Source patterns to consult

Read relevant implementation, not just its screenshot, before choosing reuse:

- [XProf](https://github.com/openxla/xprof): `frontend/app/components/overview_page`,
  `op_profile`, `roofline_model`; `xprof/convert/op_stats_to_roofline_model.cc`.
  Reuse grouping and shared selection ideas, not its dense default tool chrome.
- [PyProf](https://github.com/NVIDIA/PyProf): `pyprof/nvtx/nvmarker.py`,
  `pyprof/parse/nsight.py`, `pyprof/prof/blas.py`. Attribution comes from metadata
  plus trace correlation; kernel names alone are not tensor shapes.
- [HTA](https://github.com/facebookresearch/HolisticTraceAnalysis):
  `hta/analyzers/critical_path_analysis.py`. Inspect input/dependency assumptions
  before transferring its critical-path classifications to native CUDA Graphs.
- [Perfetto](https://perfetto.dev/docs/visualization/embedding-the-ui): reuse the
  self-hosted viewer for timeline navigation; Nsight conversion and domain
  plugins are separate work. Offline means locally packaged assets from startup.
- [TREx](https://github.com/NVIDIA/TensorRT/tree/release/10.13/tools/experimental/trt-engine-explorer):
  `trex/engine_plan.py`, `compare_engines.py`, `graphing.py`. Useful graph/profile
  joins and precision overlays; do not copy missing-as-zero handling.

Public project behavior and compatibility can change. Verify the version under
review, license and offline dependencies before copying code or installing it.
