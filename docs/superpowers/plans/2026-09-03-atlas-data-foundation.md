# Atlas Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first useful, offline Embodied Inference Atlas slice from the existing Pi0, Pi0.5, SmolVLA, VLA-Perf, and vla.cpp structured results, with sanitized canonical data and static comparison pages.

**Architecture:** Raw source files remain outside the repository and are rebuilt through allowlisted Python importers into `.local/staging`. A closed-schema validator and explicit promotion command produce committed JSON under `data/`; a standard-library static builder embeds that JSON into file-openable HTML and uses a vendored ECharts asset. This plan delivers the data foundation and first browsable site; Nsys/NCU/telemetry extraction and real WM/WAM datasets are separate implementation plans.

**Tech Stack:** Python 3.10+ standard library, JSON/JSONL, `unittest`, HTML5, CSS, vanilla JavaScript, vendored Apache ECharts 5.6.0, Git.

**Spec:** `docs/superpowers/specs/2026-09-03-embodied-inference-atlas-design.md`

## Global Constraints

- Do not download models, install inference runtimes, or execute model inference from this repository.
- Never commit `.nsys-rep`, `.ncu-rep`, SQLite exports, raw logs, model files, images, videos, or `.local/` contents.
- Importers rebuild records from explicit allowlists; they never copy arbitrary source dictionaries.
- Drop absolute paths, original prompt text, file/content hashes, hostnames, IPs, command lines, raw errors, and private checkpoint names.
- Preserve real device model names; distinguish physical machines only with anonymous `system_id` values such as `thor-unit-01`.
- Every result is explicitly `measured_local`, `reported_external`, or `analytical`; missing numeric metrics are `null` with `missing_reason`, never zero-filled.
- Numeric comparisons use a versioned single-axis policy. Known-unequal outputs are shown side by side without a ratio.
- BF16, FP16, FP8, and weight-only Q8 configurations remain distinct; a Q8 file-size reduction is not an INT8 compute roofline.
- The generated site must open from `file://` without a server, network request, CDN, Node, npm, or database.
- Keep tests narrow: representative import records, core schema/privacy/comparison rules, and one offline build smoke test. Do not add stress, fuzz, or combinatorial tests.
- `docs/superpowers/` remains in local planning history only and is excluded when a clean remote history is prepared.

## Scope Split

This plan implements acceptance slice 1 from the spec:

- Closed data contracts and promotion workflow.
- Existing structured measurements and analytical estimates.
- Runtime/model/device coverage, model flow, performance, operator-component, and roofline pages.
- Data-driven empty states for profiler evidence not yet collected.

The following require separate plans and are not implemented here:

- Nsys/NCU/tegrastats extractors, detailed timelines, kernel tables, and CPU/GPU overlap conclusions.
- Fine-grained traced operator shapes and operator-to-kernel correlation beyond VLA-Perf component summaries.
- Capturing the second complete profiler evidence chain on an independent runtime.
- Importing the first real WM or WAM measurement.
- Normalizing external numeric performance claims beyond source/runtime status metadata.
- Publishing a private GitHub remote and creating its clean product-only history.

## Planned File Map

### Repository policy and documentation

- `.gitignore`: blocks all local/raw/profiler/model artifacts.
- `AGENTS.md`: concise, framework-neutral contributor rules and commands.
- `CLAUDE.md`: points Claude Code to `AGENTS.md`.
- `.cursor/rules/project.mdc`: points Cursor to `AGENTS.md`.
- `README.md`: explains purpose, offline usage, evidence classes, and commands.
- `docs/methodology.md`: public methodology for timing, comparison, precision, and missing data.

### Contracts and canonical data

- `schema/manifest.json`: dataset path, primary key, and schema mapping.
- `schema/README.md`: documents the small Atlas contract language.
- `schema/catalog/*.schema.json`: model, device, system, runtime, and source contracts.
- `schema/measurements/*.schema.json`: run, E2E, stage, operator-component, and roofline contracts.
- `data/catalog/*.json`: sanitized seed catalogs.
- `data/architectures/*.json`: Pi0, Pi0.5, and SmolVLA module DAGs.
- `data/measurements/*.json`: promoted runs and measurements.

### Python boundaries

- `tools/lib/jsonio.py`: deterministic JSON load/write and atomic replacement.
- `tools/lib/contracts.py`: closed-schema validation.
- `tools/lib/comparison.py`: single-axis comparison keys and ratio eligibility.
- `tools/lib/privacy.py`: JSON, generated-site, and staged-tree release scanning.
- `tools/lib/promotion.py`: dry-run diff and atomic dataset merge.
- `tools/lib/site.py`: dataset joins, template rendering, and embedded JSON escaping.
- `tools/validate.py`, `tools/promote.py`, `tools/build.py`: thin CLIs over the library modules.
- `extractors/common.py`: JSONL reader, sequential IDs, and bundle helpers.
- `extractors/flashrt.py`, `extractors/lerobot.py`, `extractors/vla_cpp.py`: measured-data adapters.
- `extractors/benchmark.py`: measured-adapter CLI dispatch.
- `extractors/vla_perf.py`: analytical adapter and CLI.

### Static site

- `web/templates/base.html`: shared navigation and embedded page-data slot.
- `web/styles.css`: local visual system and evidence/status styling.
- `web/js/common.js`: filters, tables, formatting, and ECharts helpers.
- `web/js/index.js`, `model.js`, `performance.js`, `operators.js`, `rooflines.js`: page behavior.
- `assets/vendor/echarts.min.js`, `assets/vendor/echarts.LICENSE.txt`: pinned vendored dependency.
- `site/`: deterministic generated output.

### Focused tests

- `tests/helpers.py`: valid minimal records and temporary repository helper.
- `tests/fixtures/*.jsonl`: one sanitized representative record per source format.
- `tests/test_validation.py`: contract, comparison, and privacy checks.
- `tests/test_importers.py`: allowlist and semantic mapping checks.
- `tests/test_promotion.py`: dry-run and atomic promotion checks.
- `tests/test_build.py`: one complete offline build smoke test.

---

### Task 1: Establish the safe product shell

**Files:**
- Create: `.gitignore`
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `.cursor/rules/project.mdc`
- Create: `README.md`
- Create: `tools/__init__.py`
- Create: `tools/lib/__init__.py`
- Create: `extractors/__init__.py`
- Create: `tests/__init__.py`

**Interfaces:**
- Consumes: the approved design spec only.
- Produces: repository-wide safety rules and importable Python package directories used by every later task.

- [ ] **Step 1: Verify the intended safety files do not yet exist**

Run:

```bash
test ! -e .gitignore && test ! -e AGENTS.md && test ! -e README.md
```

Expected: PASS in the design-only repository.

- [ ] **Step 2: Add the deny-by-default ignore rules**

Create `.gitignore` with exactly these artifact classes:

```gitignore
.local/
__pycache__/
*.py[cod]
.coverage

*.nsys-rep
*.ncu-rep
*.sqlite
*.sqlite3
*.db
*.log

*.safetensors
*.gguf
*.onnx
*.engine
*.plan
*.pt
*.pth

*.jpg
*.jpeg
*.png
*.mp4
*.mov
```

- [ ] **Step 3: Add concise cross-agent guidance**

Create `AGENTS.md` with these rules and commands:

```markdown
# Repository Guidance

This repository stores sanitized inference evidence and generated offline reports. It does not install runtimes, download models, or contain model/kernel implementations.

- Read `docs/methodology.md` before changing comparison semantics.
- Put raw reports only under `.local/`; never force-add ignored files.
- Importers write `.local/staging`; only `tools/promote.py --apply` writes canonical `data/`.
- Preserve missing values and evidence type. Never convert missing profiler metrics to zero.
- Only compare records through the declared single-axis comparison policy.
- Before committing run `python3 -m unittest`, `python3 -m tools.validate --all`, and `python3 -m tools.build --check`.
```

Create `CLAUDE.md`:

```markdown
# Claude Code

Read and follow `AGENTS.md`. Do not duplicate or override its repository rules here.
```

Create `.cursor/rules/project.mdc`:

```markdown
---
description: Embodied Inference Atlas repository guidance
alwaysApply: true
---

Read and follow the root `AGENTS.md`. Do not duplicate or override its repository rules in Cursor-specific files.
```

- [ ] **Step 4: Add the initial user-facing README and package markers**

Create empty `__init__.py` files at the four package paths listed above. Start `README.md` with:

```markdown
# Embodied Inference Atlas

Offline, evidence-backed views of VLA, world-model, and world-action-model inference behavior.

Raw profiler reports stay on each collection machine under `.local/` and are never committed. This repository does not download models or install inference runtimes. Canonical data lives under `data/`; after running `python3 -m tools.build`, open `site/index.html` directly.
```

- [ ] **Step 5: Verify ignored artifacts and agent adapters**

Run:

```bash
git check-ignore .local/raw/test.nsys-rep test.ncu-rep model.safetensors trace.log
rg -n 'AGENTS.md' CLAUDE.md .cursor/rules/project.mdc
```

Expected: all four artifact paths are printed; both adapter files reference `AGENTS.md`.

- [ ] **Step 6: Commit the product shell**

```bash
git add .gitignore AGENTS.md CLAUDE.md .cursor README.md tools extractors tests
git commit -m "chore: establish atlas repository policy"
```

### Task 2: Implement the closed contract engine and catalog schemas

**Files:**
- Create: `schema/README.md`
- Create: `schema/manifest.json`
- Create: `schema/catalog/models.schema.json`
- Create: `schema/catalog/devices.schema.json`
- Create: `schema/catalog/systems.schema.json`
- Create: `schema/catalog/runtimes.schema.json`
- Create: `schema/catalog/sources.schema.json`
- Create: `schema/architectures.schema.json`
- Create: `tools/lib/jsonio.py`
- Create: `tools/lib/contracts.py`
- Create: `tests/helpers.py`
- Create: `tests/test_validation.py`

**Interfaces:**
- Consumes: JSON documents with string `schema_version`, string `dataset`, and an array-valued `records` field.
- Produces: `load_json(path: Path) -> dict`, `write_json_atomic(path: Path, value: object) -> None`, `validate_document(dataset: str, document: Mapping[str, object], repo_root: Path) -> list[Issue]`, and `load_manifest(repo_root: Path) -> dict`.

- [ ] **Step 1: Write the failing unknown-field and required-field tests**

Add to `tests/test_validation.py`:

```python
import copy
import unittest
from pathlib import Path

from tests.helpers import valid_model_document
from tools.lib.contracts import validate_document


ROOT = Path(__file__).resolve().parents[1]


class ContractTests(unittest.TestCase):
    def test_valid_model_document_passes(self):
        self.assertEqual(validate_document("models", valid_model_document(), ROOT), [])

    def test_unknown_field_is_rejected(self):
        document = copy.deepcopy(valid_model_document())
        document["records"][0]["checkpoint_path"] = "/private/model"
        issues = validate_document("models", document, ROOT)
        self.assertEqual([issue.code for issue in issues], ["unknown_field"])

    def test_missing_required_field_is_rejected(self):
        document = copy.deepcopy(valid_model_document())
        del document["records"][0]["model_type"]
        issues = validate_document("models", document, ROOT)
        self.assertEqual([issue.code for issue in issues], ["required"])
```

- [ ] **Step 2: Run the tests to verify the contract module is missing**

Run:

```bash
python3 -m unittest tests.test_validation.ContractTests -v
```

Expected: ERROR with `ModuleNotFoundError: No module named 'tools.lib.contracts'`.

- [ ] **Step 3: Define the Atlas contract language**

Document these supported rule keys in `schema/README.md`: `type`, `required`, `properties`, `additional_properties`, `items`, `enum`, `min_length`, `max_length`, `minimum`, and nullable types expressed as an array such as `["string", "null"]`. State explicitly that this is a small internal contract format, not a complete JSON Schema implementation.

Create `schema/manifest.json` with version `1.0.0`, these dataset names, schema paths, and primary keys:

```json
{
  "schema_version": "1.0.0",
  "datasets": {
    "models": {"data": "data/catalog/models.json", "schema": "schema/catalog/models.schema.json", "primary_key": "model_id"},
    "devices": {"data": "data/catalog/devices.json", "schema": "schema/catalog/devices.schema.json", "primary_key": "device_id"},
    "systems": {"data": "data/catalog/systems.json", "schema": "schema/catalog/systems.schema.json", "primary_key": "system_id"},
    "runtimes": {"data": "data/catalog/runtimes.json", "schema": "schema/catalog/runtimes.schema.json", "primary_key": "runtime_id"},
    "sources": {"data": "data/catalog/sources.json", "schema": "schema/catalog/sources.schema.json", "primary_key": "source_id"},
    "architectures": {"data_glob": "data/architectures/*.json", "schema": "schema/architectures.schema.json", "primary_key": "architecture_id"},
    "runs": {"data": "data/measurements/runs.json", "schema": "schema/measurements/runs.schema.json", "primary_key": "run_id"},
    "end_to_end": {"data": "data/measurements/end_to_end.json", "schema": "schema/measurements/end_to_end.schema.json", "primary_key": "measurement_id"},
    "stages": {"data": "data/measurements/stages.json", "schema": "schema/measurements/stages.schema.json", "primary_key": "measurement_id"},
    "operators": {"data": "data/measurements/operators.json", "schema": "schema/measurements/operators.schema.json", "primary_key": "operator_id"},
    "rooflines": {"data": "data/measurements/rooflines.json", "schema": "schema/measurements/rooflines.schema.json", "primary_key": "roofline_id"}
  }
}
```

- [ ] **Step 4: Define the six closed catalog contracts**

Every catalog record must set `additional_properties` to `false`. Use these exact required keys:

- models: `model_id`, `display_name`, `model_type`, `artifacts`, `parameter_count`, `architecture_id`, `input_modalities`, `output_modalities`, `execution_modes`, `source_ids`.
- devices: `device_id`, `display_name`, `accelerator_architecture`, `memory_capacity_gib`, `memory_type`, `compute_capability`, `peak_claims`, `source_ids`.
- systems: `system_id`, `device_ids`, `device_count`, `cpu_label`, `memory_capacity_gib`, `os_family`, `cuda_version`, `notes_code`.
- runtimes: `runtime_id`, `display_name`, `version_label`, `public_commit`, `backend`, `features`, `model_support`, `source_ids`.
- sources: `source_id`, `evidence`, `title`, `url`, `published_date`, `accessed_date`, `summary`.
- architectures: `architecture_id`, `model_id`, `nodes`, `edges`, `shape_symbols`, `source_ids`.

Use the model-type enum `vla | world_model | world_action_model | hybrid | other`, evidence enum `measured_local | reported_external | analytical`, runtime support enum `measured | analytical | reported | blocked | not_run | not_supported | unknown`, and nullable public URL/date/commit fields. Limit all free summaries to 500 characters.

Use these exact closed child records:

```text
artifact: artifact_id, label, public_model_id, public_revision
peak_claim: precision_id, value, unit, peak_source, source_id
runtime_feature: feature_id, status, evidence, source_id
model_support: model_id, status, evidence, reason_code, has_canonical_measurement, source_id
architecture_node: node_id, label, kind, multiplicity
architecture_edge: source, target, tensor_label
```

Use this file shape for every catalog contract:

```json
{
  "dataset": "models",
  "record": {
    "type": "object",
    "required": ["model_id", "display_name", "model_type", "artifacts", "parameter_count", "architecture_id", "input_modalities", "output_modalities", "execution_modes", "source_ids"],
    "additional_properties": false,
    "properties": {
      "model_id": {"type": "string", "min_length": 1, "max_length": 80},
      "display_name": {"type": "string", "min_length": 1, "max_length": 120},
      "model_type": {"type": "string", "enum": ["vla", "world_model", "world_action_model", "hybrid", "other"]},
      "artifacts": {"type": "array", "items": {"type": "object"}},
      "parameter_count": {"type": ["integer", "null"], "minimum": 0},
      "architecture_id": {"type": "string"},
      "input_modalities": {"type": "array", "items": {"type": "string"}},
      "output_modalities": {"type": "array", "items": {"type": "string"}},
      "execution_modes": {"type": "array", "items": {"type": "string"}},
      "source_ids": {"type": "array", "items": {"type": "string"}}
    }
  }
}
```

Replace the inline artifact rule with a closed object using the child fields above; apply the same explicit nested-object treatment to peak claims, runtime features, model support, nodes, and edges.

Add this minimal valid document to `tests/helpers.py`, completing the artifact with nullable public fields:

```python
def valid_model_document() -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "dataset": "models",
        "records": [{
            "model_id": "pi0",
            "display_name": "Pi0",
            "model_type": "vla",
            "artifacts": [{
                "artifact_id": "pi0-test-01",
                "label": "sanitized test artifact",
                "public_model_id": None,
                "public_revision": None,
            }],
            "parameter_count": None,
            "architecture_id": "arch-pi0",
            "input_modalities": ["image", "language", "state"],
            "output_modalities": ["action_chunk"],
            "execution_modes": ["flow_matching"],
            "source_ids": ["source-test"],
        }],
    }
```

- [ ] **Step 5: Implement deterministic JSON I/O**

Implement in `tools/lib/jsonio.py`:

```python
def load_json(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    os.replace(temporary, path)
```

- [ ] **Step 6: Implement recursive closed-schema validation**

Define `Issue` as a frozen dataclass with `path`, `code`, and `message`. `validate_document` must check the document wrapper, load the schema through `manifest.json`, recursively validate required keys/types/enums/bounds, reject unknown object fields, and reject duplicate primary keys. Treat `bool` as distinct from `integer` despite Python's subclass relationship.

Use this recursion boundary:

```python
@dataclass(frozen=True)
class Issue:
    path: str
    code: str
    message: str


def _validate(value: object, rule: Mapping[str, object], path: str) -> list[Issue]:
    issues = _validate_type(value, rule.get("type"), path)
    if issues:
        return issues
    if isinstance(value, dict):
        required = set(rule.get("required", []))
        properties = rule.get("properties", {})
        issues.extend(Issue(f"{path}.{key}", "required", "field is required") for key in sorted(required - value.keys()))
        if rule.get("additional_properties") is False:
            issues.extend(Issue(f"{path}.{key}", "unknown_field", "field is not allowed") for key in sorted(value.keys() - properties.keys()))
        for key in sorted(value.keys() & properties.keys()):
            issues.extend(_validate(value[key], properties[key], f"{path}.{key}"))
    elif isinstance(value, list) and "items" in rule:
        for index, item in enumerate(value):
            issues.extend(_validate(item, rule["items"], f"{path}[{index}]"))
    return issues
```

- [ ] **Step 7: Run the focused contract tests**

Run:

```bash
python3 -m unittest tests.test_validation.ContractTests -v
```

Expected: 3 tests PASS.

- [ ] **Step 8: Commit contracts and validation core**

```bash
git add schema tools/lib/jsonio.py tools/lib/contracts.py tests/helpers.py tests/test_validation.py
git commit -m "feat: add closed atlas data contracts"
```

### Task 3: Add run measurements and single-axis comparison policies

**Files:**
- Create: `schema/measurements/runs.schema.json`
- Create: `schema/measurements/end_to_end.schema.json`
- Create: `schema/measurements/stages.schema.json`
- Create: `schema/measurements/operators.schema.json`
- Create: `schema/measurements/rooflines.schema.json`
- Create: `tools/lib/comparison.py`
- Modify: `tests/helpers.py`
- Modify: `tests/test_validation.py`

**Interfaces:**
- Consumes: complete `comparison_context` dictionaries from run records.
- Produces: `comparison_key(context: Mapping, kind: str, varying_field: str | None = None) -> str`, `assign_group_ids(runs: Sequence[Mapping], kind: str, varying_field: str | None = None) -> dict[str, str]`, and `ratio_eligibility(left: Mapping, right: Mapping) -> str`.

- [ ] **Step 1: Write failing comparison-policy tests**

Add these cases to `tests/test_validation.py`:

```python
from tools.lib.comparison import assign_group_ids, ratio_eligibility
from tests.helpers import valid_run


class ComparisonTests(unittest.TestCase):
    def test_precision_policy_allows_only_precision_to_change(self):
        fp16 = valid_run("run-fp16", precision_id="uniform-fp16", views=1)
        fp8 = valid_run("run-fp8", precision_id="uniform-fp8", views=1)
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertEqual(groups["run-fp16"], groups["run-fp8"])

    def test_precision_policy_rejects_second_changed_axis(self):
        fp16 = valid_run("run-fp16", precision_id="uniform-fp16", views=1)
        fp8 = valid_run("run-fp8", precision_id="uniform-fp8", views=2)
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertNotEqual(groups["run-fp16"], groups["run-fp8"])

    def test_failed_correctness_blocks_ratio(self):
        left = valid_run("left", correctness="passed")
        right = valid_run("right", correctness="failed")
        self.assertEqual(ratio_eligibility(left, right), "blocked_known_unequal")
```

- [ ] **Step 2: Run the comparison tests to verify failure**

Run:

```bash
python3 -m unittest tests.test_validation.ComparisonTests -v
```

Expected: ERROR because `tools.lib.comparison` does not exist.

- [ ] **Step 3: Define the closed run contract**

Require these run keys: `schema_version`, `configuration_id`, `run_id`, `model_id`, `model_artifact_id`, `runtime_id`, `device_id`, `system_id`, `source_id`, `evidence`, `capture_method`, `workload`, `precision`, `timing`, `operating_point`, `correctness`, `comparison_context`, and `missing`. `system_id` is nullable only for analytical/external records with no physical collection host and must then have a controlled missing reason.

The discriminated `workload` object must contain `common` plus exactly one of `vla`, `world_model`, `world_action_model`, or `hybrid`. For this slice, imported records use `vla` with these closed fields: `camera_views`, `image_height`, `image_width`, `semantic_prompt_tokens`, `executed_prompt_tokens`, `action_dimension`, `action_chunk`, and `denoise_steps`; nullable numeric fields require an entry in the run's `missing` map.

The precision object must require: `precision_id`, `requested`, `weight_dtype`, `activation_dtype`, `accumulation_dtype`, `execution_dtype`, `quant_scheme`, `granularity`, `dequant_strategy`, and `fused`.

Use this exact closed shape for `comparison_context` so every policy in Step 5 consumes the same keys:

```json
{
  "model_id": "pi0",
  "model_artifact_id": "pi0-flashrt-local-01",
  "runtime_id": "flashrt",
  "evidence": "measured_local",
  "platform": {
    "device_id": "nvidia-jetson-agx-thor",
    "system_id": "thor-unit-01",
    "operating_point_id": "thor-120w-dynamic"
  },
  "task": {
    "task_id": "synthetic-vla-inference",
    "input_contract_id": "deterministic-preprocessed-observation",
    "output_contract_id": "action-chunk",
    "correctness_policy_id": "finite-only"
  },
  "workload": {},
  "precision": {},
  "timing": {
    "timing_boundary_id": "predict_cached_graph_sync",
    "state_reuse": "cached_prompt_and_graph",
    "warm_policy": "steady_state"
  },
  "runtime_overhead": "included"
}
```

The run's normalized `workload` and `precision` objects are copied into the two empty objects above before comparison grouping; no importer constructs a second, lossy version.

Implement `valid_run` in `tests/helpers.py` by constructing one complete run with `workload.vla.camera_views=views`, the supplied `precision_id`, and `correctness.status=correctness`; copy those workload/precision objects into `comparison_context`. Give it fixed IDs for Pi0, FlashRT, Thor, `thor-unit-01`, timing boundary `predict_cached_graph_sync`, and operating point `thor-120w-dynamic`. Its signature is:

```python
def valid_run(
    run_id: str,
    *,
    precision_id: str = "uniform-fp16",
    views: int = 1,
    correctness: str = "not_assessed",
) -> dict[str, object]:
    workload = {
        "common": {
            "batch_size": 1,
            "input_contract_id": "deterministic-preprocessed-observation",
            "output_contract_id": "action-chunk",
        },
        "vla": {
            "camera_views": views,
            "image_height": 224,
            "image_width": 224,
            "semantic_prompt_tokens": 4,
            "executed_prompt_tokens": 4,
            "action_dimension": 32,
            "action_chunk": 10,
            "denoise_steps": 10,
        },
    }
    precision = {
        "precision_id": precision_id,
        "requested": precision_id,
        "weight_dtype": "fp16",
        "activation_dtype": "fp16",
        "accumulation_dtype": "fp16",
        "execution_dtype": "fp16",
        "quant_scheme": "none",
        "granularity": "none",
        "dequant_strategy": "none",
        "fused": False,
    }
    timing = {
        "timing_boundary_id": "predict_cached_graph_sync",
        "state_reuse": "cached_prompt_and_graph",
        "warm_policy": "steady_state",
    }
    operating_point = {
        "operating_point_id": "thor-120w-dynamic",
        "power_mode": "120w-mode-1",
        "clock_policy": "dynamic",
        "throttle_status": "unknown",
    }
    comparison_context = {
        "model_id": "pi0",
        "model_artifact_id": "pi0-test-01",
        "runtime_id": "flashrt",
        "evidence": "measured_local",
        "platform": {
            "device_id": "nvidia-jetson-agx-thor",
            "system_id": "thor-unit-01",
            "operating_point_id": "thor-120w-dynamic",
        },
        "task": {
            "task_id": "synthetic-vla-inference",
            "input_contract_id": "deterministic-preprocessed-observation",
            "output_contract_id": "action-chunk",
            "correctness_policy_id": "finite-only",
        },
        "workload": copy.deepcopy(workload),
        "precision": copy.deepcopy(precision),
        "timing": copy.deepcopy(timing),
        "runtime_overhead": "included",
    }
    return {
        "schema_version": "1.0.0",
        "configuration_id": f"cfg-{run_id}",
        "run_id": run_id,
        "model_id": "pi0",
        "model_artifact_id": "pi0-test-01",
        "runtime_id": "flashrt",
        "device_id": "nvidia-jetson-agx-thor",
        "system_id": "thor-unit-01",
        "source_id": "source-test",
        "evidence": "measured_local",
        "capture_method": "wall_clock",
        "workload": workload,
        "precision": precision,
        "timing": timing,
        "operating_point": operating_point,
        "correctness": {"status": correctness, "criterion": "finite-only"},
        "comparison_context": comparison_context,
        "missing": {},
    }
```

Import `copy` at the top of `tests/helpers.py`; this helper fixes the public test interface and supplies every required run field.

- [ ] **Step 4: Define the four measurement contracts**

Use one measurement record per timing case, with a `statistics` array whose entries are closed `{statistic, value, unit}` objects. Require:

- end_to_end: `measurement_id`, `run_id`, `source_id`, `evidence`, `measurement_method`, `metric`, `statistics`, `sample_count`, `percentile_method`, `work_unit`, `timing_boundary_id`, `missing_reason`.
- stages: the same source/evidence/method/statistics metadata plus `stage_id`, `parent_stage_id`, `aggregation`, `additive`, and `execution_count`.
- operators: `operator_id`, `run_id`, `source_id`, `evidence`, `module_id`, `granularity`, `operator_kind`, `shape`, `execution_count`, `work_gflop`, `traffic_gib`, `arithmetic_intensity_flop_per_byte`, `source_method`, `missing`.
- rooflines: `roofline_id`, `run_id`, `source_id`, `evidence`, `operator_id`, `device_id`, `precision_id`, `memory_level`, `compute_peak_gflop_per_s`, `bandwidth_gib_per_s`, `peak_source`, `predicted_ms`, `limiter`, `modeling_fidelity`, `missing`.

Use `aggregation = interval | summary | analytical`, `additive = true | false`, `peak_source = vendor_theoretical | measured_empirical | reported_external | analytical_assumption`, and `modeling_fidelity = native | proxy | custom_operator_model`.

The E2E contract must accept this concrete distribution representation:

```json
{
  "measurement_id": "e2e-flashrt-pi0-matrix-001",
  "run_id": "run-flashrt-pi0-matrix-001",
  "source_id": "source-local-thor",
  "evidence": "measured_local",
  "measurement_method": "wall_clock",
  "metric": "latency",
  "statistics": [
    {"statistic": "p50", "value": 40.1136125, "unit": "ms"},
    {"statistic": "p95", "value": 40.4523936, "unit": "ms"}
  ],
  "sample_count": 100,
  "percentile_method": "source_reported",
  "work_unit": "action_chunk",
  "timing_boundary_id": "predict_cached_graph_sync",
  "missing_reason": null
}
```

Analytical estimates use `sample_count=0`, `percentile_method=null`, one `analytical_estimate` statistic, and `missing_reason=null`; a genuinely missing value uses `value=null` plus a controlled non-null reason.

- [ ] **Step 5: Implement versioned comparison projections**

Implement `comparison.py` around these exact removed paths:

```python
POLICY_VERSION = "1.0.0"
POLICY_REMOVALS = {
    "runtime": (("runtime_id",),),
    "precision": (("precision",),),
    "platform": (("platform",),),
    "measured_vs_bound": (
        ("runtime_id",), ("evidence",), ("runtime_overhead",),
        ("platform", "system_id"), ("platform", "operating_point_id"),
    ),
}
```

`workload_scale` must accept one path beginning with `workload.` and remove only that leaf. Serialize the projected context with sorted keys and compact separators. Sort unique keys before assigning `cg-<kind>-NNNN` labels so IDs are deterministic.

`ratio_eligibility` returns `validated_speedup` only when both records are `passed`, `blocked_known_unequal` if either is `failed`, and `latency_ratio_unvalidated` otherwise.

- [ ] **Step 6: Run run-schema and comparison tests**

Run:

```bash
python3 -m unittest tests.test_validation -v
```

Expected: all contract and comparison tests PASS.

- [ ] **Step 7: Commit measurement contracts and comparison policies**

```bash
git add schema/measurements tools/lib/comparison.py tests/helpers.py tests/test_validation.py
git commit -m "feat: enforce single-axis result comparisons"
```

### Task 4: Implement privacy scanning and reviewed promotion

**Files:**
- Create: `tools/lib/privacy.py`
- Create: `tools/lib/promotion.py`
- Create: `tools/validate.py`
- Create: `tools/promote.py`
- Create: `tests/test_promotion.py`
- Modify: `tests/test_validation.py`

**Interfaces:**
- Consumes: a promotion bundle with `bundle_version`, controlled `source_label`, and a `datasets` object whose values are record arrays.
- Produces: `scan_json(value: object, path: str = "$") -> list[Issue]`, `scan_release_tree(root: Path) -> list[Issue]`, `plan_promotion(bundle: Mapping, repo_root: Path) -> PromotionPlan`, and `apply_promotion(plan: PromotionPlan) -> None`.

- [ ] **Step 1: Write failing privacy and dry-run tests**

Add to `tests/test_validation.py`:

```python
from tools.lib.privacy import scan_json


class PrivacyTests(unittest.TestCase):
    def test_forbidden_key_and_local_path_are_rejected(self):
        issues = scan_json({"checkpoint_path": "/home/isrc/private/model"})
        self.assertEqual({issue.code for issue in issues}, {"forbidden_key", "local_path"})

    def test_public_url_is_allowed(self):
        self.assertEqual(scan_json({"url": "https://github.com/NVlabs/vla-perf"}), [])
```

Add a promotion test that creates an empty canonical `runs.json`, passes one valid run bundle to `plan_promotion`, asserts the plan reports one addition, and asserts the canonical file is unchanged until `apply_promotion` is called.

- [ ] **Step 2: Run the focused tests to verify missing modules**

Run:

```bash
python3 -m unittest tests.test_validation.PrivacyTests tests.test_promotion -v
```

Expected: ERROR because privacy and promotion modules do not exist.

- [ ] **Step 3: Implement the minimal blocking privacy scanner**

Use this exact key denylist in `privacy.py`:

```python
FORBIDDEN_KEYS = {
    "path", "checkpoint", "checkpoint_path", "prompt_text", "raw_log", "error",
    "sha256", "checkpoint_safetensors_sha256", "noise_sha256_float32",
    "output_sha256_float32", "hostname", "ip", "command", "environment",
}
```

Reject strings containing `/home/`, `/Users/`, `/root/`, Windows drive paths, PEM private-key headers, or credential-bearing URLs. For fields named `url`, accept only public HTTP(S) hostnames without username/password, localhost, or literal IP addresses. Do not add external DLP services or network checks.

`scan_release_tree` must reject symlinks and these staged/release suffixes: `.nsys-rep`, `.ncu-rep`, `.sqlite`, `.sqlite3`, `.db`, `.log`, `.safetensors`, `.gguf`, `.onnx`, `.engine`, `.plan`, `.pt`, `.pth`, `.jpg`, `.jpeg`, `.png`, `.mp4`, `.mov`.

- [ ] **Step 4: Implement dry-run-first promotion**

`plan_promotion` must:

1. Reject unknown datasets using `schema/manifest.json`.
2. Build a candidate document by primary-key merge.
3. Reject duplicate keys inside the bundle.
4. Validate the candidate contract and privacy scan before producing a plan.
5. Sort records by primary key.
6. Produce a sanitized unified diff with `difflib.unified_diff`.

`apply_promotion` writes every changed document through `write_json_atomic`; it is called only when the CLI receives `--apply`. Without `--apply`, `tools/promote.py` prints the diff and exits without writes.

Use this merge boundary:

```python
def _merge_records(current: list[dict], incoming: list[dict], primary_key: str) -> list[dict]:
    merged = {record[primary_key]: record for record in current}
    seen: set[str] = set()
    for record in incoming:
        key = record[primary_key]
        if key in seen:
            raise PromotionError(f"duplicate incoming key: {key}")
        seen.add(key)
        merged[key] = record
    return [merged[key] for key in sorted(merged)]
```

- [ ] **Step 5: Implement validation and promotion CLIs**

`tools/validate.py --all` validates catalog, architecture, measurement, and generated-site release paths; it skips `site/` only when that directory has not been generated yet. Add `--staged` to inspect names returned by `git diff --cached --name-only -z`. `tools/promote.py BUNDLE` defaults to dry-run and accepts `--apply` as the sole mutation flag. Both return exit code 1 and print one issue per line on validation failure.

Repository validation must also enforce these exact references: model → architecture/source; architecture → model/source and edge endpoints; system → device; runtime → model/source; run → model artifact/runtime/device/non-null system/source; E2E/stage/operator → run/source; roofline → run/operator/device/source. A missing target is a blocking `broken_reference` issue.

Keep each CLI thin:

```python
def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    plan = plan_promotion(load_json(args.bundle), Path.cwd())
    print(plan.diff, end="")
    if args.apply:
        apply_promotion(plan)
    return 0
```

- [ ] **Step 6: Run privacy and promotion tests**

Run:

```bash
python3 -m unittest tests.test_validation.PrivacyTests tests.test_promotion -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the release boundary**

```bash
git add tools/lib/privacy.py tools/lib/promotion.py tools/validate.py tools/promote.py tests
git commit -m "feat: add sanitized data promotion"
```

### Task 5: Import FlashRT and LeRobot structured measurements

**Files:**
- Create: `extractors/common.py`
- Create: `extractors/flashrt.py`
- Create: `extractors/lerobot.py`
- Create: `extractors/benchmark.py`
- Create: `tests/fixtures/flashrt-shape.jsonl`
- Create: `tests/fixtures/lerobot-smolvla.jsonl`
- Create: `tests/test_importers.py`

**Interfaces:**
- Consumes: iterables of parsed source records and an explicit `source_label`, `source_id`, and `system_id`.
- Produces: `read_jsonl(path: Path) -> Iterator[dict]`, `import_flashrt_shape(records: Iterable[Mapping], context: ImportContext) -> dict`, and `import_lerobot_shape(records: Iterable[Mapping], context: ImportContext) -> dict` promotion bundles.

- [ ] **Step 1: Create one sanitized source fixture per measured format**

The FlashRT fixture must contain one `run`, one `timing`, and one `complete` line for Pi0 FP8, 1 view, short prompt, p50/p95/mean/min/max, 100 repetitions, and 30 warmups. The LeRobot fixture must contain one `run`, one `timing`, and one `complete` line for SmolVLA mixed BF16/FP32, 1 view, 10 denoise steps, and total-wall/fixed-prefix/denoise summaries. Deliberately include `checkpoint`, `prompt_text`, and source hash fields so the allowlist test proves they are dropped.

Use these exact minimal values; each JSON object occupies one line in its fixture:

```json
{"record":"run","checkpoint":"/home/example/pi0","checkpoint_safetensors_sha256":"secret","model_family":"pi0","num_views":1,"requested_precision":"fp8","precision_semantics":"fp8_e4m3_gemms_with_fp16_attention_residuals_and_buffers"}
{"record":"timing","model_family":"pi0","num_views":1,"prompt_case":"short","prompt_text":"Go.","semantic_prompt_tokens":4,"executed_prompt_tokens":4,"vision_prefix_tokens":256,"encoder_sequence_length":260,"action_chunk_size":10,"output_shape":[10,7],"output_finite":true,"requested_precision":"fp8","repetitions":100,"warmups":30,"latency_ms":{"min":39.1,"mean":40.0,"p50":40.1,"p95":40.5,"max":40.8}}
{"record":"complete","status":"ok"}
```

```json
{"record":"run","checkpoint":"/home/example/smolvla","output_sha256_float32":"secret","model_family":"smolvla","num_steps":10,"action_chunk_size":50,"precision_semantics":"nonquantized BF16 and FP32 mixed","repetitions_per_case":50,"warmups_per_case":5}
{"record":"timing","model_family":"smolvla","num_views":1,"prompt_case":"short","prompt_text":"Go.","semantic_prompt_tokens":3,"executed_prompt_tokens":48,"output_shape":[1,50,6],"output_finite":true,"requested_precision":"bf16","latency_ms":{"total_wall_ms":{"min":249.0,"mean":251.0,"p50":250.9,"p95":252.9,"max":253.7},"fixed_prefix_span_ms":{"min":79.0,"mean":79.8,"p50":79.6,"p95":80.7,"max":81.1},"denoise_aggregate_ms":{"min":167.3,"mean":168.7,"p50":168.4,"p95":170.2,"max":170.3}}}
{"record":"complete","status":"ok"}
```

- [ ] **Step 2: Write failing importer tests**

Add to `tests/test_importers.py`:

```python
import unittest
from pathlib import Path

from extractors.common import ImportContext, read_jsonl
from extractors.flashrt import import_flashrt_shape
from extractors.lerobot import import_lerobot_shape
from tools.lib.privacy import scan_json


FIXTURES = Path(__file__).parent / "fixtures"


class MeasuredImporterTests(unittest.TestCase):
    def test_flashrt_maps_one_timing_without_raw_fields(self):
        context = ImportContext("fixture-flashrt", "source-local-thor", "thor-unit-01")
        bundle = import_flashrt_shape(read_jsonl(FIXTURES / "flashrt-shape.jsonl"), context)
        self.assertEqual(len(bundle["datasets"]["runs"]), 1)
        self.assertEqual(bundle["datasets"]["runs"][0]["evidence"], "measured_local")
        self.assertEqual(scan_json(bundle), [])

    def test_lerobot_stage_summaries_are_not_additive(self):
        context = ImportContext("fixture-lerobot", "source-local-thor", "thor-unit-01")
        bundle = import_lerobot_shape(read_jsonl(FIXTURES / "lerobot-smolvla.jsonl"), context)
        stages = bundle["datasets"]["stages"]
        self.assertTrue(stages)
        self.assertTrue(all(stage["aggregation"] == "summary" for stage in stages))
        self.assertTrue(all(stage["additive"] is False for stage in stages))
```

- [ ] **Step 3: Run importer tests to verify failure**

Run:

```bash
python3 -m unittest tests.test_importers.MeasuredImporterTests -v
```

Expected: ERROR because extractor modules do not exist.

- [ ] **Step 4: Implement safe JSONL reading and sequential IDs**

In `extractors/common.py`, define frozen `ImportContext(source_label, source_id, system_id)`. `read_jsonl` skips blank lines, requires every nonblank line to be a JSON object, and raises `SourceFormatError` with only the controlled source label and line number. Implement IDs as `<kind>-<source_label>-NNN`; never use the input path, timestamp, or hash.

```python
@dataclass(frozen=True)
class ImportContext:
    source_label: str
    source_id: str
    system_id: str | None


def record_id(kind: str, context: ImportContext, index: int) -> str:
    if not re.fullmatch(r"[a-z0-9-]+", context.source_label):
        raise ValueError("source_label must be lowercase kebab-case")
    return f"{kind}-{context.source_label}-{index:03d}"
```

- [ ] **Step 5: Implement the FlashRT allowlist adapter**

Treat each `run` source record as active context until `complete`; emit one normalized run and one E2E distribution for every `timing` record. Map:

- `model_family`, `num_views`, 224×224, semantic/executed prompt tokens, action chunk, output action dimension, and nullable denoise steps into `workload.vla`.
- `requested_precision` plus the allowlisted `precision_semantics` value into `uniform-fp16` or `mixed-fp8-e4m3-fp16`; do not infer INT8/INT4 execution.
- source `latency_ms` statistics into one E2E `statistics` array; do not import `samples_ms` or `frontend_latency_ms`.
- `output_finite=true` into correctness `finite_only`; `quality_claim=false` remains `not_assessed` for task quality.
- timing boundary into controlled ID `predict_cached_graph_sync`.
- absent embedded power/clock telemetry into operating point `unknown`, with `missing` reasons for power mode, clock policy, and throttle status; do not borrow values from another run.

Drop `captured`, `checkpoint`, all byte/hash fields, `input`, `prompt_text`, platform strings, frontend class, and original free-form timing text.

The adapter loop must select fields rather than mutate source records:

```python
for source in records:
    if source.get("record") == "run":
        active = normalize_flashrt_context(source)
    elif source.get("record") == "timing":
        if active is None:
            raise SourceFormatError(f"{context.source_label}: timing before run")
        run, measurement = normalize_flashrt_timing(active, source, context, len(runs) + 1)
        runs.append(run)
        end_to_end.append(measurement)
```

- [ ] **Step 6: Implement the LeRobot allowlist adapter**

Emit one normalized run per `timing` record. Map total-wall statistics to E2E with `measurement_method=wall_clock`; map fixed-prefix, prefix-prefill, denoise, and outside-loop summaries to non-additive stage records with `measurement_method=cuda_event`. Record physical prompt length separately from semantic prompt tokens, preserve 10 denoise steps and action chunk 50, and use controlled timing ID `predict_action_chunk_preprocessed`. Map precision to `mixed-bf16-fp32`; set unavailable power/clock/throttle fields to null with reasons. Drop sample arrays, per-step arrays, prompt text, hashes, checkpoint path, and source free text.

Use a fixed source-to-stage map so unknown nested keys are ignored:

```python
STAGE_KEYS = {
    "fixed_prefix_span_ms": "fixed-prefix",
    "prefix_prefill_ms": "prefix-prefill",
    "denoise_aggregate_ms": "denoise",
    "outside_fixed_prefix_and_denoise_ms": "outside-prefix-denoise",
}
```

- [ ] **Step 7: Add the measured importer CLI**

Support exactly:

```text
python3 -m extractors.benchmark --format flashrt-shape --input FILE --output FILE --source-label LABEL --source-id ID --system-id ID
python3 -m extractors.benchmark --format lerobot-smolvla --input FILE --output FILE --source-label LABEL --source-id ID --system-id ID
```

Require output paths to resolve under `.local/staging`; refuse any output under `data/`.

- [ ] **Step 8: Run measured importer tests**

Run:

```bash
python3 -m unittest tests.test_importers.MeasuredImporterTests -v
```

Expected: 2 tests PASS.

- [ ] **Step 9: Commit measured importers**

```bash
git add extractors tests/fixtures tests/test_importers.py
git commit -m "feat: import FlashRT and LeRobot measurements"
```

### Task 6: Import VLA-Perf analytical data and vla.cpp weight-only controls

**Files:**
- Create: `extractors/vla_perf.py`
- Create: `extractors/vla_cpp.py`
- Create: `tests/fixtures/vla-perf.jsonl`
- Create: `tests/fixtures/vla-cpp.jsonl`
- Modify: `extractors/benchmark.py`
- Modify: `tests/test_importers.py`

**Interfaces:**
- Consumes: VLA-Perf `run/estimate/limitations` JSONL and vla.cpp `run_config/artifact/timing/load_failure` JSONL.
- Produces: `import_vla_perf(records, context) -> dict` and `import_vla_cpp(records, context) -> dict` promotion bundles using the Task 3 contracts.

- [ ] **Step 1: Create representative analytical and Q8 fixtures**

The VLA-Perf fixture must contain one run and two estimates for the same Pi0/1-view/short workload at uniform FP16 and uniform FP8. Include vision/VLM/action GFLOP, GiB, intensity, predicted milliseconds, and the analytical hardware assumptions. The vla.cpp fixture must contain one run config, source BF16/F32 and Q8_0 artifact records, and matching timing rows; include forbidden path/hash/raw-error fields to prove they are discarded.

Use analytical assumptions `fp16_tflops=400`, `fp8_tflops=800`, and `memory_bandwidth_gib_per_s=270`. Use vla.cpp timing pairs with identical `model_family=pi0`, `views=1`, `synthetic_tokens=4`, output `[50,32]`, and p50 values 200 ms for `source_bf16_f32` and 220 ms for `q8_0_vlm_vit_weight_only`.

- [ ] **Step 2: Write failing precision-separation tests**

Add:

```python
from extractors.vla_cpp import import_vla_cpp
from extractors.vla_perf import import_vla_perf


class AnalyticalAndQuantImporterTests(unittest.TestCase):
    def test_vla_perf_emits_distinct_precision_rooflines(self):
        context = ImportContext("fixture-vla-perf", "source-vla-perf", None)
        bundle = import_vla_perf(read_jsonl(FIXTURES / "vla-perf.jsonl"), context)
        precision_ids = {item["precision_id"] for item in bundle["datasets"]["rooflines"]}
        self.assertEqual(precision_ids, {"uniform-fp16", "uniform-fp8"})

    def test_q8_is_weight_only_and_not_int8_compute(self):
        context = ImportContext("fixture-vla-cpp", "source-local-thor", "thor-unit-01")
        bundle = import_vla_cpp(read_jsonl(FIXTURES / "vla-cpp.jsonl"), context)
        q8 = next(run for run in bundle["datasets"]["runs"] if run["precision"]["quant_scheme"] == "q8_0_weight_only")
        self.assertNotIn(q8["precision"]["execution_dtype"], {"int8", "int4"})
        self.assertEqual(scan_json(bundle), [])
```

- [ ] **Step 3: Run the new importer tests to verify failure**

Run:

```bash
python3 -m unittest tests.test_importers.AnalyticalAndQuantImporterTests -v
```

Expected: ERROR because VLA-Perf and vla.cpp adapters do not exist.

- [ ] **Step 4: Implement VLA-Perf analytical mapping**

For each estimate, emit:

- one `analytical` run with capture method `vla_perf`;
- one E2E analytical estimate;
- vision, VLM, and action component stage records;
- three operator-component records carrying GFLOP/GiB/intensity;
- three roofline points carrying resolved precision, assumed compute/bandwidth ceilings, predicted time, limiter, and modeling fidelity.

Map Pi0 stock to `native`, Pi0.5 proxy to `proxy`, and the audited SmolVLA operator list to `custom_operator_model`. Preserve the distinction in `comparison_context`; proxy/custom points may be plotted but cannot produce `validated_speedup`. Drop `repo`, prompt text, source commit/path, and free-form limitations from measurement records; convert supported limitations into controlled `missing_reason` codes.

Select model fidelity with an explicit map:

```python
FIDELITY = {
    "vla_perf_stock_pi0": "native",
    "vla_perf_stock_pi0_as_pi05_proxy": "proxy",
    "audited_smolvla_genz_roofline": "custom_operator_model",
}
COMPONENTS = ("vision", "vlm", "action")
```

- [ ] **Step 5: Implement vla.cpp mapping**

For each timing row, emit one measured run and E2E summary with timing ID `vlacpp_engine_predict_synthetic`. Map controlled variants:

- `source_bf16_f32` and SmolVLA `bf16` → precision ID `mixed-bf16-fp32`.
- Pi0 `q8_0_vlm_vit_weight_only` → precision ID `q8_0-weight-only`, `weight_dtype=q8_0`, mixed floating activation/execution, `quant_scheme=q8_0_weight_only`, and `dequant_strategy=matmul_path`.

Ignore `load_failure` records in the measurement bundle and discard raw error, path, hash, packed tensor name, and raw-log reference. Task 7 records the audited SmolVLA Q8 support status manually as `not_supported` with reason code `loader_rejects_q8_tensor`. Mark all vla.cpp timing correctness as `not_assessed`, so BF16/Q8 comparison is `latency_ratio_unvalidated`.

Use this controlled variant map and reject timing variants outside it:

```python
VARIANT_PRECISION = {
    "source_bf16_f32": "mixed-bf16-fp32",
    "bf16": "mixed-bf16-fp32",
    "q8_0_vlm_vit_weight_only": "q8_0-weight-only",
}
```

- [ ] **Step 6: Extend the benchmark CLI and run all importer tests**

Add format `vla-cpp` to `extractors/benchmark.py`; give `extractors/vla_perf.py` the same input/output/source flags without a format switch and with optional `--system-id`. When omitted, emit `system_id=null` and missing reason `analytical_no_physical_system`.

Run:

```bash
python3 -m unittest tests.test_importers -v
```

Expected: all 4 importer tests PASS.

- [ ] **Step 7: Commit analytical and quantized importers**

```bash
git add extractors tests/fixtures tests/test_importers.py
git commit -m "feat: import analytical and weight-only results"
```

### Task 7: Seed catalogs, architectures, and the existing result matrix

**Files:**
- Create: `data/catalog/models.json`
- Create: `data/catalog/devices.json`
- Create: `data/catalog/systems.json`
- Create: `data/catalog/runtimes.json`
- Create: `data/catalog/sources.json`
- Create: `data/architectures/pi0.json`
- Create: `data/architectures/pi05.json`
- Create: `data/architectures/smolvla.json`
- Create: `data/measurements/runs.json`
- Create: `data/measurements/end_to_end.json`
- Create: `data/measurements/stages.json`
- Create: `data/measurements/operators.json`
- Create: `data/measurements/rooflines.json`

**Interfaces:**
- Consumes: the import CLIs and promotion workflow from Tasks 4–6 plus existing read-only files under `/home/isrc/Projects/vla-runtime-eval/results`.
- Produces: the first canonical, sanitized data release consumed by the site builder.

- [ ] **Step 1: Create catalog documents with explicit evidence**

Seed model families Pi0, Pi0.5, and SmolVLA, keeping distinct artifact IDs for non-equivalent checkpoints. Seed device `nvidia-jetson-agx-thor`, anonymous system `thor-unit-01`, and runtimes FlashRT, LeRobot, vla.cpp, Embodied.cpp, vLLM-Omni, Tether, Realtime-VLA, and VLA-Perf.

Use canonical public source URLs:

```text
https://github.com/flashrt-project/FlashRT
https://github.com/huggingface/lerobot
https://github.com/VinRobotics/vla.cpp
https://github.com/NVlabs/vla-perf
https://github.com/SEU-PAISys/Embodied.cpp
https://github.com/vllm-project/vllm-omni
https://github.com/FastCrest/tether
https://github.com/Dexmal/realtime-vla
```

Record FlashRT commit `054bea4d02ebc63f6a0c45991c6061b1e1caa46c`, LeRobot commit `fbb811fca92504439792b97d216f0d00c2268382`, vla.cpp commit `4c105b8711b86c60828844d244b48db20619bdf8`, VLA-Perf commit `1e2b9a7ef9d4188c7e1e2befbdc758222c60d760`, Embodied.cpp commit `1dad33f2c87ee1d390808cb5d776cd8c998f4a36`, vLLM-Omni commit `5d20f6b900dfcf22b42068e28a3cbbdb5b4707e7`, Tether commit `8bcfc680f0863fc2cc028ecb8b0bce2215ea609e`, and Realtime-VLA commit `b86a942a073ea241f9bd6916a705f81906f4638b` only as public upstream revisions.

Use these controlled support facts from the audited local status table:

```text
FlashRT: Pi0 measured; Pi0.5 measured
LeRobot: SmolVLA measured
vla.cpp: Pi0 measured; SmolVLA measured; SmolVLA Q8 not_supported (loader_rejects_q8_tensor)
Embodied.cpp unmodified: SmolVLA blocked (unsupported_projector)
vLLM-Omni: Pi0 blocked (startup_before_inference); Pi0.5 and SmolVLA not_supported
Tether: SmolVLA blocked (dependency_resolution_before_export)
Realtime-VLA: Pi0 not_run (source_audit_only)
VLA-Perf: Pi0 analytical; Pi0.5 analytical proxy; SmolVLA analytical custom_operator_model
```

Set `has_canonical_measurement=true` only for the four sources imported in Steps 4–5. Do not copy TSV notes, latency prose, or local artifact fields.

- [ ] **Step 2: Encode the three high-level module DAGs**

Use these node flows:

```text
Pi0: observations → view-batched vision encoder → multimodal projector → language/state context encoder → iterative action expert → action chunk
Pi0.5: observations → view-batched vision encoder → multimodal projector → language/state-prompt context encoder → iterative action expert → action chunk
SmolVLA: observations → per-view vision encoder → connector + language/state prefix → VLM prefill/KV → flow-matching expert → action chunk
```

Mark per-view, once-per-inference, and per-denoise-step multiplicities separately. Store shape symbols rather than invented fixed hidden dimensions when existing evidence does not establish a number.

- [ ] **Step 3: Initialize empty measurement documents and validate the seed catalogs**

Every measurement document starts as:

```json
{"schema_version":"1.0.0","dataset":"runs","records":[]}
```

with the dataset field changed for each file. Run:

```bash
python3 -m tools.validate --all
```

Expected: PASS before any imported measurement is promoted.

- [ ] **Step 4: Generate five staging bundles from existing structured files**

Run:

```bash
python3 -m extractors.benchmark --format flashrt-shape --input /home/isrc/Projects/vla-runtime-eval/results/flashrt-pi0-shape-precision.jsonl --output .local/staging/flashrt-pi0.json --source-label flashrt-pi0-matrix --source-id source-local-thor --system-id thor-unit-01
python3 -m extractors.benchmark --format flashrt-shape --input /home/isrc/Projects/vla-runtime-eval/results/flashrt-pi05-shape-precision.jsonl --output .local/staging/flashrt-pi05.json --source-label flashrt-pi05-matrix --source-id source-local-thor --system-id thor-unit-01
python3 -m extractors.benchmark --format lerobot-smolvla --input /home/isrc/Projects/vla-runtime-eval/results/lerobot-smolvla-shape-prompt.jsonl --output .local/staging/lerobot-smolvla.json --source-label lerobot-smolvla-matrix --source-id source-local-thor --system-id thor-unit-01
python3 -m extractors.benchmark --format vla-cpp --input /home/isrc/Projects/vla-runtime-eval/results/vla-cpp-quant-controls.jsonl --output .local/staging/vla-cpp-controls.json --source-label vla-cpp-controls --source-id source-local-thor --system-id thor-unit-01
python3 -m extractors.vla_perf --input /home/isrc/Projects/vla-runtime-eval/results/vla-perf-shape-precision-matrix.jsonl --output .local/staging/vla-perf-matrix.json --source-label vla-perf-matrix --source-id source-vla-perf
```

Expected normalized run counts: FlashRT Pi0 9, FlashRT Pi0.5 18, LeRobot SmolVLA 9, vla.cpp 27, and VLA-Perf 54; total 117.

- [ ] **Step 5: Review and apply every promotion bundle**

For each staging file, first run the command without `--apply`, inspect the sanitized diff, then run it with `--apply`:

```bash
python3 -m tools.promote .local/staging/flashrt-pi0.json
python3 -m tools.promote .local/staging/flashrt-pi0.json --apply
```

Repeat those two commands for `flashrt-pi05.json`, `lerobot-smolvla.json`, `vla-cpp-controls.json`, and `vla-perf-matrix.json`. Do not bypass a validation or privacy failure.

- [ ] **Step 6: Verify counts, references, and forbidden-source absence**

Run:

```bash
python3 -m tools.validate --all
python3 -m unittest tests.test_validation tests.test_importers tests.test_promotion -v
rg -n '/home/isrc|prompt_text|sha256|raw_log|checkpoint_path' data && exit 1 || true
```

Expected: validation/tests PASS; the final `rg` produces no matches.

- [ ] **Step 7: Commit the first canonical data release**

```bash
git add data
git commit -m "data: add initial embodied inference matrix"
```

### Task 8: Build a deterministic, file-openable static site shell

**Files:**
- Create: `assets/vendor/echarts.min.js`
- Create: `assets/vendor/echarts.LICENSE.txt`
- Create: `web/templates/base.html`
- Create: `web/styles.css`
- Create: `web/js/common.js`
- Create: `tools/lib/site.py`
- Create: `tools/build.py`
- Create: `tests/test_build.py`

**Interfaces:**
- Consumes: validated canonical documents under `data/`.
- Produces: `build_site(repo_root: Path, output_dir: Path, check: bool = False) -> BuildResult` and a self-contained `site/` tree with relative assets and embedded JSON.

- [ ] **Step 1: Write the failing offline-build smoke test**

Add to `tests/test_build.py`:

```python
import tempfile
import unittest
from pathlib import Path

from tools.lib.site import build_site


ROOT = Path(__file__).resolve().parents[1]


class BuildTests(unittest.TestCase):
    def test_build_writes_file_openable_index_without_remote_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            result = build_site(ROOT, output)
            html = (output / "index.html").read_text(encoding="utf-8")
            self.assertTrue(result.pages)
            self.assertIn('id="page-data"', html)
            self.assertNotIn('<script src="http', html)
            self.assertTrue((output / "assets" / "vendor" / "echarts.min.js").is_file())
```

- [ ] **Step 2: Run the test to verify the site module is missing**

Run:

```bash
python3 -m unittest tests.test_build.BuildTests -v
```

Expected: ERROR because `tools.lib.site` does not exist.

- [ ] **Step 3: Vendor ECharts and its license once**

Fetch the pinned official Apache ECharts 5.6.0 distribution during development, then commit it so all builds are offline:

```bash
curl -L --fail https://raw.githubusercontent.com/apache/echarts/5.6.0/dist/echarts.min.js --output assets/vendor/echarts.min.js
curl -L --fail https://raw.githubusercontent.com/apache/echarts/5.6.0/LICENSE --output assets/vendor/echarts.LICENSE.txt
```

No build or test command may download this asset.

- [ ] **Step 4: Implement safe embedded-data rendering**

In `tools/lib/site.py`, implement:

```python
def json_for_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).replace("</", "<\\/")


def render_template(template: str, *, title: str, root_prefix: str, content: str, page_data: object, page_script: str) -> str:
    return Template(template).substitute(
        title=html.escape(title),
        root_prefix=root_prefix,
        content=content,
        page_data=json_for_script(page_data),
        page_script=page_script,
    )
```

The base template must load only relative `assets/vendor/echarts.min.js`, `assets/styles.css`, `assets/js/common.js`, and the page-specific relative script. Embed page data in `<script id="page-data" type="application/json">` and never use `fetch()`.

- [ ] **Step 5: Implement deterministic site assembly**

`build_site` must validate data first, sort every record by the manifest primary key, copy only `web/styles.css`, `web/js`, and `assets/vendor`, and write pages atomically. It must not read `.local/`, include build timestamps, or serialize absolute paths. `tools/build.py --check` builds into a temporary directory, runs the release scan, and exits without replacing `site/`; without `--check`, it replaces `site/` only after a successful build and scan.

Keep the build boundary explicit:

```python
def build_site(repo_root: Path, output_dir: Path, check: bool = False) -> BuildResult:
    datasets = load_validated_datasets(repo_root / "data", repo_root)
    pages = render_foundation_pages(datasets, repo_root / "web")
    candidate = Path(tempfile.mkdtemp(prefix="atlas-site-"))
    write_pages(candidate, pages)
    copy_static_assets(repo_root, candidate)
    issues = scan_release_tree(candidate)
    if issues:
        raise BuildError(format_issues(issues))
    if not check:
        replace_tree(candidate, output_dir)
    return BuildResult(pages=tuple(sorted(pages)), checked=check)
```

- [ ] **Step 6: Run the build smoke test**

Run:

```bash
python3 -m unittest tests.test_build.BuildTests -v
```

Expected: 1 test PASS.

- [ ] **Step 7: Commit the offline build shell**

```bash
git add assets web/templates/base.html web/styles.css web/js/common.js tools/lib/site.py tools/build.py tests/test_build.py
git commit -m "feat: add deterministic offline site builder"
```

### Task 9: Render coverage, model, performance, operator, and roofline pages

**Files:**
- Create: `web/js/index.js`
- Create: `web/js/model.js`
- Create: `web/js/performance.js`
- Create: `web/js/operators.js`
- Create: `web/js/rooflines.js`
- Modify: `tools/lib/site.py`
- Modify: `web/styles.css`
- Modify: `tests/test_build.py`

**Interfaces:**
- Consumes: joined catalog/run/measurement view models and derived comparison groups.
- Produces: `site/index.html`, `site/models/<model_id>.html`, `site/performance.html`, `site/operators.html`, and `site/rooflines.html`.

- [ ] **Step 1: Extend the build test with page and evidence assertions**

Add assertions that the build emits all five page types, that the Pi0 model page embeds its module nodes, that the performance page contains all three evidence classes, and that a known-unequal or non-equivalent pair has no `validated_speedup` field.

Implement the assertions as a second test method:

```python
def test_build_emits_foundation_pages_and_safe_comparisons(self):
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "site"
        build_site(ROOT, output)
        expected = [
            "index.html", "performance.html", "operators.html", "rooflines.html",
            "models/pi0.html",
        ]
        self.assertTrue(all((output / path).is_file() for path in expected))
        pi0 = (output / "models" / "pi0.html").read_text(encoding="utf-8")
        performance = (output / "performance.html").read_text(encoding="utf-8")
        self.assertIn("view-batched-vision-encoder", pi0)
        self.assertIn("measured_local", performance)
        self.assertIn("analytical", performance)
        self.assertIn("reported_external", performance)
        self.assertNotIn('"ratio_kind":"validated_speedup","correctness":"failed"', performance)
```

Run:

```bash
python3 -m unittest tests.test_build.BuildTests -v
```

Expected: FAIL because only the shell index exists.

- [ ] **Step 2: Build the coverage page view model and UI**

Join model support from `runtimes.json` with promoted measurements. Render a model × runtime × system matrix with these states: `measured`, `analytical`, `reported`, `blocked`, `not_run`, `not_supported`, `unknown`. Add local filters for model type, model, runtime, system, evidence, precision, views, prompt tokens, and power mode. Use solid, patterned, dashed/hollow, gray, and red styles exactly as specified in the design.

All page scripts read only embedded data:

```javascript
const pageData = JSON.parse(document.getElementById("page-data").textContent);
const selected = Object.fromEntries(
  [...document.querySelectorAll("[data-filter]")].map((node) => [node.dataset.filter, node.value]),
);
renderCoverage(pageData.coverage.filter((row) => matchesFilters(row, selected)));
```

- [ ] **Step 3: Build model pages with module flow and measurements**

Render each architecture DAG with ECharts graph layout, preserving node multiplicity (`once`, `per_view`, `per_denoise_step`). Add workload tables and per-model latency curves over views, executed prompt tokens, precision, and denoise steps. Hide non-applicable fields instead of displaying zero.

Create graph data without evaluating model-specific code:

```javascript
const nodes = pageData.architecture.nodes.map((node) => ({
  id: node.node_id,
  name: node.label,
  value: node.multiplicity,
}));
const links = pageData.architecture.edges.map((edge) => ({
  source: edge.source,
  target: edge.target,
  value: edge.tensor_label,
}));
```

- [ ] **Step 4: Build the performance comparison page**

Render E2E p50/p95/mean where present, stage summaries, and analytical gap views. Every chart must declare `comparison_kind`; the builder supplies only records sharing its derived group. Label correctness-passed ratios `validated speedup`, unassessed ratios `latency ratio (quality unvalidated)`, and known-unequal records `not comparable` without a ratio.

Do not stack stage summaries whose `additive` field is false. Display them as grouped bars with the notice `independent summary statistics are not additive`.

Build comparison labels through one gate:

```javascript
function ratioLabel(row) {
  if (row.ratio_kind === "validated_speedup") return `${row.ratio.toFixed(2)}× validated speedup`;
  if (row.ratio_kind === "latency_ratio_unvalidated") return `${row.ratio.toFixed(2)}× latency ratio (quality unvalidated)`;
  return "not comparable";
}
```

- [ ] **Step 5: Build operator-component and roofline pages**

The operator page lists model module, granularity, GFLOP, GiB, arithmetic intensity, execution count, and evidence. The roofline page groups points by device, memory level, and precision ID; it draws separate compute ceilings for uniform FP16, uniform FP8, and any later precision records. Weight-only Q8 E2E records appear in the precision comparison table but do not receive an INT8 roofline unless an actual Q8 operator/ceiling record exists.

Construct each roofline series only from matching records:

```javascript
const series = groupBy(pageData.rooflines, (point) =>
  `${point.device_id}|${point.memory_level}|${point.precision_id}`
);
for (const [seriesId, points] of Object.entries(series)) {
  renderRooflineSeries(seriesId, points);
}
```

- [ ] **Step 6: Add honest profiler empty states**

On the coverage and performance pages, show `Nsys evidence: not collected in this data slice` and `NCU evidence: not collected in this data slice` when timelines/kernels datasets are absent. Do not infer CPU idle, DRAM saturation, or kernel boundness from E2E/VLA-Perf data.

Use an explicit data-driven empty state:

```javascript
if (!pageData.profiler_coverage.nsys) addEmptyState("Nsys evidence: not collected in this data slice");
if (!pageData.profiler_coverage.ncu) addEmptyState("NCU evidence: not collected in this data slice");
```

- [ ] **Step 7: Run the complete build test**

Run:

```bash
python3 -m unittest tests.test_build.BuildTests -v
```

Expected: all page assertions PASS.

- [ ] **Step 8: Commit the first data-driven pages**

```bash
git add web tools/lib/site.py tests/test_build.py
git commit -m "feat: visualize inference evidence and rooflines"
```

### Task 10: Finalize the verified local foundation snapshot

**Files:**
- Create: `docs/methodology.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Generate: `site/**`

**Interfaces:**
- Consumes: all foundation tasks.
- Produces: a clean, verified local product tree ready for the separate profiler-evidence plan and eventual clean private-remote publication.

- [ ] **Step 1: Document the public methodology**

`docs/methodology.md` must explain:

- evidence classes and why analytical estimates are not measurements;
- configuration/run/measurement separation;
- the five single-axis comparison policies;
- `validated_speedup`, `latency_ratio_unvalidated`, and blocked-known-unequal behavior;
- timing-boundary and non-additive stage rules;
- FP16/FP8 versus Q8_0 weight-only semantics;
- power/throttle fields that are currently missing;
- why this slice cannot conclude CPU idle, DRAM saturation, or kernel boundness.

- [ ] **Step 2: Finish README and agent commands**

Document these exact local commands:

```bash
python3 -m unittest
python3 -m tools.validate --all
python3 -m tools.build
python3 -m tools.build --check
```

State that users open `site/index.html` directly and that source import commands accept external file paths but never persist those paths.

- [ ] **Step 3: Generate and scan the committed site**

Run:

```bash
python3 -m tools.build
python3 -m tools.validate --all
```

Expected: both commands exit 0 and `site/index.html` exists.

- [ ] **Step 4: Run the complete narrow test suite**

Run:

```bash
python3 -m unittest -v
```

Expected: contract, comparison, privacy, importer, promotion, and one build-smoke group all PASS; no stress or fuzz suite exists.

- [ ] **Step 5: Verify offline and privacy invariants**

Run:

```bash
rg -n '<script[^>]+src="https?://|<link[^>]+href="https?://' site && exit 1 || true
rg -n '/home/isrc|prompt_text|sha256|raw_log|checkpoint_path' data site && exit 1 || true
find site -type l -print -quit | grep . && exit 1 || true
git diff --check
```

Expected: the first three checks produce no matches and `git diff --check` passes. Public source URLs embedded as data are allowed; executable scripts and styles must remain local.

- [ ] **Step 6: Manually inspect the five primary pages**

Open `site/index.html`, one page under `site/models/`, `site/performance.html`, `site/operators.html`, and `site/rooflines.html`. Confirm filters work, evidence styles differ, analytical data is labeled, Q8 is called weight-only, missing profiler data has an honest empty state, and no invalid speedup is displayed.

- [ ] **Step 7: Commit the verified foundation snapshot**

```bash
git add README.md AGENTS.md docs/methodology.md site
git commit -m "docs: finalize atlas foundation snapshot"
```

- [ ] **Step 8: Record the next plan boundary**

Run:

```bash
git status --short
git log --oneline -10
```

Expected: clean worktree. The next implementation plan starts with Nsys/NCU/telemetry extraction and does not alter the comparison or privacy contracts without a reviewed spec amendment.
