# Repository Guidance

This repository stores sanitized inference evidence and generated offline reports. It does not install runtimes, download models, or contain model/kernel implementations.

- Read `docs/methodology.md` before changing comparison semantics.
- Put raw reports only under `.local/`; never force-add ignored files.
- Importers write `.local/staging`; only `tools/promote.py --apply` writes canonical `data/`.
- Preserve missing values and evidence type. Never convert missing profiler metrics to zero.
- Only compare records through the declared single-axis comparison policy.
- Before committing run `python3 -m unittest`, `python3 -m tools.validate --all`, and `python3 -m tools.build --check`.
