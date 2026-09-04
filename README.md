# Embodied Inference Atlas

Offline, evidence-backed views of VLA, world-model, and world-action-model inference behavior.

Raw profiler reports stay on each collection machine under `.local/` and are never committed. This repository does not download models or install inference runtimes. Canonical data lives under `data/`; generated offline pages live under `site/`.

## Local commands

```bash
python3 -m unittest
python3 -m tools.validate --all
python3 -m tools.build
python3 -m tools.build --check
```

After building, open `site/index.html` directly in a browser. The generated
pages embed validated page data and use only local scripts, styles, and vendored
assets.

Source import commands accept an external file path through `--input` and write
sanitized bundles only under `.local/staging/`. The input path is used to read
the source and is never persisted in a staging bundle, canonical `data/`, or the
generated site. Review a promotion diff before using `tools.promote --apply` to
write canonical data.

See `docs/methodology.md` for evidence, timing, comparison, precision, and
missing-data semantics.
