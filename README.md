# Embodied Inference Atlas

Offline, evidence-backed views of VLA, world-model, and world-action-model inference behavior.

Raw profiler reports stay on each collection machine under `.local/` and are never committed. This repository does not download models or install inference runtimes. Canonical data lives under `data/`; after running `python3 -m tools.build`, open `site/index.html` directly.
