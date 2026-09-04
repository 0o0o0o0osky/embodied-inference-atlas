# Embodied Inference Atlas

Offline, evidence-backed views of VLA, world-model, and world-action-model inference behavior.

Raw profiler reports stay on each collection machine under `.local/` and are never committed. This repository does not download models or install inference runtimes. Canonical data lives under `data/`; generated offline pages live under `site/`.

## Local commands

```bash
npm ci
npm run typecheck
npm run build
python3 -m unittest
python3 -m tools.validate --all
python3 -m tools.build
python3 -m tools.build --check
```

The Python builder validates canonical JSON, creates the deterministic frontend
payload, runs the locked Vite build, and replaces `site/` with relative,
offline assets. Review the generated application through a local-only server:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Then open `http://127.0.0.1:8000/`. The application makes no runtime internet
requests. Direct `file://` viewing is not a release target because browsers may
block the generated JSON request.

Source import commands accept an external file path through `--input` and write
sanitized bundles only under `.local/staging/`. The input path is used to read
the source and is never persisted in a staging bundle, canonical `data/`, or the
generated site. Review a promotion diff before applying it, for example:

```bash
python3 -m tools.promote .local/staging/<bundle>.json --apply
```

Only the promotion command writes canonical data.

See `docs/methodology.md` for evidence, timing, comparison, precision, and
missing-data semantics.
