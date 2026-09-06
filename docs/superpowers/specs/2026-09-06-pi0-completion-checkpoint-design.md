# Pi0 completion checkpoint design

Date: 2026-09-06  
Status: approved in chat; implementation checkpoint before the remaining measurement grid

## Objective

Turn the current Pi0 vertical slice into a reviewable model-first analysis flow without expanding Pi0.5 or SmolVLA. The checkpoint must make existing evidence reachable, distinguish unsupported configurations from measurements that simply have not been collected, and show analytical operator Roofline results inside the DAG inspector. It may collect only a small representative subset of the approved target matrix before visual review.

## Authority and scope

This document narrows the confirmed `2026-09-05-chinese-summary-first-ui-design.md` for the next checkpoint. Where the older runtime-funnel spec differs, this document is authoritative for Pi0.

- Model: Pi0 only.
- Hardware: NVIDIA Jetson AGX Thor.
- Target workload: prompt 48, denoise 10, views 1/2/3, action chunk 20/50.
- Keep the accepted Pi0 logical DAG geometry and visual language.
- Do not modify kernels, runtime model semantics, or checkpoint weights.
- Do not download models or install environments.
- Do not run a broad benchmark, stress, power-mode, or profiler sweep.
- Preserve measured, analytical, source-audited, Nsys, and NCU evidence as separate planes.

## Performance overview

The current large empty facet charts are replaced by a compact summary-first surface. Each runtime/actual-precision facet exposes six target cells and one explicit native-evidence entry.

Target cells have three states:

1. `measured`: exactly one canonical measured-local latency matches the complete target coordinate.
2. `pending_supported`: the runtime realization supports the coordinate, but no exact measurement exists.
3. `unsupported`: a source-audited realization fixes an incompatible action horizon or denoise count.

Unsupported must never be presented as merely waiting for a benchmark. A missing realization remains pending rather than inferred unsupported. Existing P=4/22/42 or native chunk-10 measurements never fill P=48, chunk-20/50 target cells.

The primary visual is a compact latency-versus-view plot only when a facet contains exact measurements. Without exact points, the facet uses a shallow status matrix rather than an empty plotting area. One explicit “view existing native evidence” action selects a deterministic canonical measurement; it never pretends that evidence is a target point.

## Runtime-to-profiler scope

Nsys and NCU captures are independent observations, so wall-clock warmup count and profiler warmup count are not equality keys. A profiler capture may be shown under a selected measured runtime when all known values agree for:

- model and model artifact;
- runtime, device, system, and actual precision;
- task, input contract, output contract, timing boundary, and state-reuse policy;
- known workload fields.

Unknown profiler workload fields make the relationship partial. Any known workload mismatch rejects it. Operating-point unknowns and different warmup/sample policies remain visible disclosures and never support speedup, idle, or matched-run claims.

The default Nsys capture is the process-tree node trace because it provides kernel/copy intervals. Existing graph and system-wide captures remain selectable evidence, not fallbacks for missing node evidence.

## Operator drawer Roofline

Selecting a Pi0 operator continues to focus the DAG. Its Roofline tab now materializes the current analytical scenario using the existing formula layer and displays only the selected logical operator:

- work and modeled traffic;
- arithmetic intensity;
- analytical roof time;
- theoretical limiter;
- compute and bandwidth ceiling provenance.

Attention may show score, softmax, value, and composite rows because they are distinct analytical components. The drawer does not display measured efficiency or gap without a basis-compatible observation. The Kernel tab keeps a truthful unavailable state until an exact operator/kernel mapping exists.

## Model-level Roofline overview

The default theoretical overview answers the model-level question before showing detailed charts. It presents the model-total and stage lower bounds for the selected workload/precision, clearly labels partial coverage, and links to the existing Stage and Atomic detail views. Fused and Kernel remain separate levels; an empty fused basis explicitly reports missing boundary traffic.

Pi0-facing copy in the touched flow is Chinese. Technical terms such as Roofline, Nsys, NCU, BF16, FP8, and Kernel remain unchanged.

## Partial measurement checkpoint

Before visual review, collect at most three target measurements:

- LeRobot Pi0 core, mixed BF16/FP32, V=3, P=48, A=50, N=10;
- vla.cpp full/BF16 path, V=1, P=48, A=50, N=10;
- vla.cpp Q8_0 weight-only path, V=1, P=48, A=50, N=10.

Each uses one smoke inference followed by 3 warmups and 10 measured samples. No automatic rerun occurs. A failed or unverified weight load produces no canonical latency record. LeRobot model-core timing and vla.cpp engine timing remain different contracts and are not ranked or divided.

FlashRT target chunks 20/50 are marked unsupported from the source-audited horizon-10 realization. Its existing native measurements and profiler captures remain reachable as native evidence; no new FlashRT capture is required at this checkpoint.

Raw outputs stay under ignored local storage. Only sanitized facts are promoted.

## Visual direction

This remains a modern, quiet engineering workbench:

- cold-white canvas and graphite type;
- cyan only for selection/data flow;
- one strong visualization per level;
- no KPI-card grid, nested card stack, decorative gradients, or empty chart canvas;
- compact status chips carry acquisition state;
- details remain behind explicit navigation or disclosure.

## Checkpoint verification

Verification is deliberately partial:

- run only focused tests covering the new status model, profiler compatibility, and selected-operator Roofline adapter;
- run TypeScript typecheck and the deterministic frontend build;
- inspect four screenshots: Pi0 DAG overview, focused operator Roofline, performance summary, and selected FlashRT Nsys/Kernel flow;
- do not run the full Python or frontend suite before the user reviews this checkpoint.

