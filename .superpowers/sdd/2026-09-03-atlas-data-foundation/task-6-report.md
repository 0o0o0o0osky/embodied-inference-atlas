# Task 6 report

## Files changed

- `extractors/vla_perf.py`: analytical VLA-Perf importer and staging CLI.
- `extractors/vla_cpp.py`: vla.cpp controlled-variant importer.
- `extractors/benchmark.py`: `vla-cpp` format routing.
- `tests/test_importers.py`, `tests/fixtures/vla-perf.jsonl`, and
  `tests/fixtures/vla-cpp.jsonl`: the two requested representative tests.

## Test commands and output

```text
$ python3 -m unittest tests.test_importers.AnalyticalAndQuantImporterTests -v
test_q8_is_weight_only_and_not_int8_compute (...) ... ok
test_vla_perf_emits_distinct_precision_rooflines (...) ... ok
Ran 2 tests in 0.002s
OK

$ python3 -m unittest tests.test_importers -v
test_q8_is_weight_only_and_not_int8_compute (...) ... ok
test_vla_perf_emits_distinct_precision_rooflines (...) ... ok
test_flashrt_maps_one_timing_without_raw_fields (...) ... ok
test_lerobot_emits_non_additive_stage_summaries (...) ... ok
Ran 4 tests in 0.007s
OK
```

## Read-only real imports and validation

```text
$ python3 -m extractors.benchmark --format vla-cpp \
    --input /home/isrc/Projects/vla-runtime-eval/results/vla-cpp-quant-controls.jsonl \
    --output .local/staging/vla-cpp.json --source-label vla-cpp-real \
    --source-id source-local-thor --system-id thor-unit-01
$ python3 -m extractors.vla_perf \
    --input /home/isrc/Projects/vla-runtime-eval/results/vla-perf-shape-precision-matrix.jsonl \
    --output .local/staging/vla-perf.json --source-label vla-perf-real \
    --source-id source-vla-perf
```

The emitted vla.cpp bundle has 27 runs and 27 E2E records. The VLA-Perf
bundle has 54 runs, 54 E2E records, and 162 records each for stages,
operators, and rooflines. `validate_document` returned zero issues for every
emitted dataset; `scan_json` returned zero issues for both bundles.

## Concerns

Stock VLA-Perf source rows omit component GFLOP/GiB values, so the importer
derives them from the reported component duration, arithmetic intensity, and
the controlled roofline ceiling; audited SmolVLA rows retain their reported
component work and traffic. Outputs are only in ignored `.local/staging`.
