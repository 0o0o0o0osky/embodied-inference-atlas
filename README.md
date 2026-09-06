# Embodied Inference Atlas

Offline, evidence-backed views of VLA, world-model, and world-action-model inference behavior.

The maintained project is a small, repeatable workflow for parsing evidence,
rendering execution and identifying bottlenecks. Canonical `data/` retains one
representative trace per required case, its stability summary and the measurements
needed for analysis. Other samples, raw reports and review artifacts stay under
ignored `.local/`. Formulas generate additional theoretical points on demand.
This repository does not download models or install inference runtimes.

## Local commands

```bash
npm ci
python3 tools/vendor_perfetto.py
npm run typecheck
python3 -m tools.validate --all
python3 -m tools.build
python3 -m tools.build --check
```

Prepare the pinned Perfetto dependency once. For an offline preparation, use
`python3 tools/vendor_perfetto.py --archive /path/to/perfetto-ui.zip` instead;
the installer verifies the fixed archive hash. Its binaries remain local and
are excluded from Git. The build copies them into the runnable offline `site/`.
Normal builds do not download assets. Run the tests relevant to the change with
`npm test -- <test-path>` or `python3 -m unittest <test-module>`.

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

Promotion imports reviewed evidence. To compact accumulated evidence, run
`python3 -m tools.archive_analysis` for a validated size/selection preview, then
`python3 -m tools.archive_analysis --apply`. The latter backs up exact originals
and a manifest under `.local/archive/` before writing the reduced corpus.

See [the single-inference workflow](docs/single-inference-analysis.md) for agent
analysis and rendering, [methodology](docs/methodology.md) for data semantics,
and [AGENTS.md](AGENTS.md) for scope and retention rules.
