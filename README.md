# Embodied Inference Atlas

English | [简体中文](README.zh-CN.md)

An interactive workbench for understanding embodied-model inference, starting with vision-language-action (VLA) models. It connects model structure, implementation choices and performance measurements so you can follow a request from its inputs to its GPU work.

Use it to compare inference stacks, find where time goes, inspect the computation behind a hotspot, and understand how an implementation reuses results or execution plans.

## Explore the workbench

- **Model theory:** navigate the model DAG, inspect tensor shapes, and step through matrix multiplication, attention and normalization with illustrated calculations.
- **Runtime comparison:** compare measured latency for a selected input shape, stack and precision path.
- **System execution:** follow CPU/GPU processing, inspect the representative timeline, and open Perfetto for a closer look at threads, calls and GPU activity.
- **Execution hotspots:** move between the execution DAG and linked Kernel records, including available Nsight Compute metrics.
- **Roofline and optimizations:** explore compute and memory bounds, then examine mechanisms such as time-projection precomputation and CUDA Graph submission.

The current analysis focuses on Pi0, with measurements from vla.cpp, FlashRT and realtime-vla. The workbench also includes model graphs and available performance data for Pi0.5 and SmolVLA.

The generated site runs offline after setup. The included data lets you explore the workbench without a GPU or model weights.

## Quick start

You need Python 3, Node.js **22.12+**, and npm. From the repository root:

```bash
npm ci
python3 tools/vendor_perfetto.py
python3 -m tools.build
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open **http://127.0.0.1:8000/**.

The setup command prepares the pinned Perfetto viewer; the build validates the data and creates `site/`. To prepare Perfetto from an existing archive, use `python3 tools/vendor_perfetto.py --archive perfetto-ui.zip`. See [offline Perfetto setup](docs/offline-perfetto.md) for details.

## Develop or add an analysis

The frontend uses TypeScript, React and Vite. Python tools parse reports, validate evidence and generate the site. Start the frontend development server with `npm run dev`; run type checks with `npm run typecheck`.

- [Analysis workflow](docs/single-inference-analysis.md): go from a fixed input and profiling question to a reviewed, interactive analysis.
- [Component catalog and integration contract](docs/analysis-components.md): reuse the existing views when adding a model, runtime or device.
- [Methodology](docs/methodology.md): understand timing boundaries, precision, modeled traffic and comparison rules.
- [Contributor guidance](AGENTS.md): repository workflow and verification.

For browser review, `node tools/render_review.mjs --help` describes the screenshot helper. Tests can be run with `npm test -- <test-path>` or `python3 -m unittest <test-module>`.
