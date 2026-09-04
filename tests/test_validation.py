import tempfile
import unittest
from pathlib import Path

from tests.helpers import valid_model_document, valid_model_graph_document, valid_run
from tools.lib.comparison import assign_group_ids, ratio_eligibility
from tools.lib.contracts import validate_document
from tools.lib.jsonio import load_json
from tools.lib.model_graph import (
    graph_semantic_problems,
    materialize_model_graph,
    resolve_symbols,
)
from tools.lib.privacy import scan_json, scan_release_tree
from tools.validate import validate_references


ROOT = Path(__file__).resolve().parents[1]


class ValidationTests(unittest.TestCase):
    def test_json_privacy_boundary(self):
        issues = scan_json({"checkpoint_path": "/home/isrc/private/model"})
        self.assertEqual({issue.code for issue in issues}, {"forbidden_key", "local_path"})
        self.assertEqual(scan_json({"url": "https://github.com/NVlabs/vla-perf"}), [])
        self.assertTrue(scan_json({"url": "https://user:secret@example.com/report"}))

    def test_release_tree_rejects_raw_profiler_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "capture.nsys-rep"
            report.touch()
            issues = scan_release_tree(Path(directory))
        self.assertIn("blocked_suffix", [issue.code for issue in issues])

    def test_closed_model_contract(self):
        document = valid_model_document()
        self.assertEqual(validate_document("models", document, ROOT), [])
        document["records"][0]["checkpoint_path"] = "/private/model"
        self.assertEqual(
            [issue.code for issue in validate_document("models", document, ROOT)],
            ["unknown_field"],
        )

    def test_component_boundary_shapes_require_symbolic_equivalence(self):
        graph = valid_model_graph_document()["records"][0]
        batch = next(
            symbol for symbol in graph["shape_symbols"]
            if symbol["symbol"] == "B"
        )
        batch.update({"default": 2, "minimum": 2, "maximum": 2})
        component = graph["block_templates"][0]["components"][0]
        tokens = next(
            binding for binding in component["bindings"]
            if binding["symbol"] == "M"
        )
        tokens["expression"] = {"symbol": "B"}

        self.assertIn(
            "boundary_mismatch",
            [problem.code for problem in graph_semantic_problems(graph)],
        )

    def test_component_boundary_shapes_accept_subtract_zero_identity(self):
        graph = valid_model_graph_document()["records"][0]
        component = graph["block_templates"][0]["components"][0]
        tokens = next(
            binding for binding in component["bindings"]
            if binding["symbol"] == "M"
        )
        tokens["expression"] = {
            "op": "sub",
            "args": [{"symbol": "M"}, 0],
        }

        self.assertEqual(graph_semantic_problems(graph), [])

    def test_component_ports_reject_duplicate_bindings(self):
        graph = valid_model_graph_document()["records"][0]
        component = graph["block_templates"][0]["components"][0]
        component["inputs"].append({"port": "input", "tensor_id": "input"})

        self.assertIn(
            "duplicate",
            [problem.code for problem in graph_semantic_problems(graph)],
        )

    def test_model_graph_final_review_regressions(self):
        document = valid_model_graph_document()
        graph = document["records"][0]
        graph["graph_inputs"] = None
        try:
            issues = validate_document("model_graphs", document, ROOT)
        except TypeError as error:
            self.fail(f"structural validation propagated TypeError: {error}")
        self.assertEqual(
            [(issue.path, issue.code) for issue in issues],
            [("$.records[0].graph_inputs", "type")],
        )
        try:
            problems = graph_semantic_problems(graph)
        except TypeError as error:
            self.fail(f"graph_semantic_problems propagated TypeError: {error}")
        self.assertIn(
            ("$.graph_inputs", "invalid_collection"),
            [(problem.path, problem.code) for problem in problems],
        )

        graph = valid_model_graph_document()["records"][0]
        module = graph["stages"][0]["modules"][0]
        next(
            binding for binding in module["bindings"]
            if binding["symbol"] == "N"
        )["expression"] = 9
        with self.subTest(boundary="ordinary module output"):
            self.assertIn(
                (
                    "$.stages[stage].modules[module].outputs[output]",
                    "boundary_mismatch",
                ),
                [
                    (problem.path, problem.code)
                    for problem in graph_semantic_problems(graph)
                ],
            )

        pi0_document = load_json(ROOT / "data" / "model_graphs" / "pi0.json")
        pi0_graph = pi0_document["records"][0]
        final_action = next(
            tensor for tensor in pi0_graph["graph_tensors"]
            if tensor["tensor_id"] == "final-action-state"
        )
        final_action["axes"][-1]["expression"] = 31
        with self.subTest(boundary="loop-carried tensors"):
            self.assertIn(
                (
                    "$.stages[action-flow-decoder].loop_carried",
                    "boundary_mismatch",
                ),
                [
                    (problem.path, problem.code)
                    for problem in graph_semantic_problems(pi0_graph)
                ],
            )

        graph = valid_model_graph_document()["records"][0]
        graph["operator_definitions"][0]["analysis"][0]["expression"] = 2.5
        with self.subTest(analysis_scope="definition"):
            self.assertIn(
                "invalid_count",
                [problem.code for problem in graph_semantic_problems(graph)],
            )

        graph = valid_model_graph_document()["records"][0]
        graph["operator_definitions"][0]["analysis"][0]["expression"] = {
            "op": "sub",
            "args": [2, {"symbol": "K"}],
        }
        operator = graph["component_templates"][0]["operators"][0]
        next(
            binding for binding in operator["bindings"]
            if binding["symbol"] == "K"
        )["expression"] = 8
        with self.subTest(analysis_scope="actual operator bindings"):
            self.assertIn(
                "invalid_count",
                [problem.code for problem in graph_semantic_problems(graph)],
            )

        pi0_graph = load_json(
            ROOT / "data" / "model_graphs" / "pi0.json"
        )["records"][0]
        for symbol in ("N_DENOISE", "T_ACTION"):
            with self.subTest(fractional_override=symbol):
                with self.assertRaisesRegex(ValueError, "non-negative integer"):
                    materialize_model_graph(pi0_graph, {symbol: 2.7})

    def test_model_graph_expression_and_internal_reference(self):
        document = valid_model_graph_document()
        graph = document["records"][0]
        self.assertEqual(graph_semantic_problems(graph), [])
        materialized = materialize_model_graph(graph, {"V": 3})
        self.assertEqual(materialized["bindings"]["S"], 768)
        self.assertEqual(
            materialized["stages"][0]["modules"][0]["outputs"][0]["shape"],
            [1, 768, 8],
        )
        nested_operator = materialized["operators_by_id"][
            "stage/module/linear/linear-op"
        ]
        self.assertEqual(nested_operator["analysis_by_metric"]["flops"], 98_304)
        self.assertEqual(nested_operator["effective_repeat"], 1)

        component = graph["block_templates"][0]["components"][0]
        component["template_id"] = "missing-component-template"
        self.assertIn(
            "broken_reference",
            [problem.code for problem in graph_semantic_problems(graph)],
        )
        component["template_id"] = "linear-component"

        module = graph["stages"][0]["modules"][0]
        module["repeat"] = 3
        module["repeat_carried"] = {
            "input_port": "input",
            "output_port": "output",
        }
        graph["graph_outputs"] = []
        self.assertEqual(graph_semantic_problems(graph), [])
        materialized = materialize_model_graph(graph, {"V": 3})
        carry = materialized["stages"][0]["modules"][0]["repeat_carried"]
        self.assertEqual(carry["input_shape"], [1, 768, 8])
        self.assertEqual(carry["output_shape"], [1, 768, 8])
        module["repeat_carried"]["output_port"] = "missing"
        self.assertIn(
            "invalid_repeat_carry",
            [problem.code for problem in graph_semantic_problems(graph)],
        )
        del module["repeat_carried"]
        graph["graph_outputs"] = ["graph-output"]

        original_output_axes = graph["graph_tensors"][1]["axes"]
        graph["graph_tensors"][1]["axes"] = [
            {"axis": "layer", "expression": 3},
            *original_output_axes,
        ]
        module["collected_outputs"] = [{
            "port": "output",
            "tensor_id": "graph-output",
            "axis": "layer",
            "index_source": "module_repeat_index",
        }]
        self.assertEqual(graph_semantic_problems(graph), [])
        materialized = materialize_model_graph(graph, {"V": 3})
        collected = materialized["stages"][0]["modules"][0][
            "collected_outputs"
        ][0]
        self.assertEqual(collected["shape"], [3, 1, 768, 8])
        self.assertEqual(collected["element_shape"], [1, 768, 8])
        graph["graph_tensors"][1]["axes"][0]["expression"] = 2
        self.assertIn(
            "invalid_collection",
            [problem.code for problem in graph_semantic_problems(graph)],
        )
        del module["collected_outputs"]
        module["repeat"] = 1
        graph["graph_tensors"][1]["axes"] = original_output_axes

        module["indexed_inputs"] = [{
            "port": "input",
            "tensor_id": "graph-output",
            "axis": "tokens",
            "index_source": "module_repeat_index",
        }]
        self.assertIn(
            "broken_reference",
            [problem.code for problem in graph_semantic_problems(graph)],
        )
        module["indexed_inputs"] = []

        graph["stages"][0]["loop_carried"] = {
            "loop_id": "loop",
            "initial_tensor_id": "graph-input",
            "iteration_input_tensor_id": "loop-input",
            "iteration_output_tensor_id": "graph-output",
            "final_tensor_id": "loop-final",
        }
        module["inputs"][0]["tensor_id"] = "loop-input"
        graph["graph_tensors"][0]["consumers"] = [{
            "node_kind": "loop", "node_id": "loop", "port": "initial",
        }]
        graph["graph_tensors"][1]["consumers"] = [{
            "node_kind": "loop", "node_id": "loop", "port": "iteration_output",
        }]
        graph["graph_tensors"].extend([
            {
                "tensor_id": "loop-input", "label": "Loop input", "semantic_role": "input",
                "axes": graph["graph_tensors"][0]["axes"],
                "producer": {"node_kind": "loop", "node_id": "loop", "port": "iteration_input"},
                "consumers": [{"node_kind": "module", "node_id": "module", "port": "input"}],
            },
            {
                "tensor_id": "loop-final", "label": "Loop final", "semantic_role": "output",
                "axes": graph["graph_tensors"][1]["axes"],
                "producer": {"node_kind": "loop", "node_id": "loop", "port": "final"},
                "consumers": [],
            },
        ])
        graph["graph_outputs"] = ["loop-final"]
        self.assertEqual(graph_semantic_problems(graph), [])
        graph["graph_tensors"][1]["consumers"] = []
        self.assertEqual(graph_semantic_problems(graph), [])
        graph["graph_tensors"][1]["consumers"] = [{
            "node_kind": "loop", "node_id": "loop", "port": "wrong",
        }]
        self.assertIn(
            "invalid_endpoint",
            [problem.code for problem in graph_semantic_problems(graph)],
        )

        with self.assertRaisesRegex(ValueError, "unknown symbol: a"):
            resolve_symbols([{
                "symbol": "derived", "editable": False, "default": None,
                "expression": {"op": "add", "args": [{"symbol": "z"}, {"symbol": "a"}]},
            }])

        graph["stages"][0]["modules"][0]["template_id"] = "missing-template"
        self.assertIn(
            "broken_reference",
            [problem.code for problem in graph_semantic_problems(graph)],
        )

    def test_pi0_representative_workload_materializes(self):
        document = load_json(ROOT / "data" / "model_graphs" / "pi0.json")
        self.assertEqual(validate_document("model_graphs", document, ROOT), [])
        graph = document["records"][0]
        materialized = materialize_model_graph(
            graph,
            {"V": 3, "L_PROMPT": 20, "T_ACTION": 50, "N_DENOISE": 10},
        )
        self.assertEqual(materialized["bindings"]["S_PREFIX"], 788)
        self.assertEqual(materialized["bindings"]["S_SUFFIX"], 51)
        self.assertEqual(materialized["bindings"]["S_ATTENTION"], 839)
        self.assertEqual(materialized["named_repeats"]["vision-blocks"], 27)
        self.assertEqual(materialized["named_repeats"]["prefix-blocks"], 18)
        self.assertEqual(materialized["named_repeats"]["action-expert-blocks"], 180)
        self.assertEqual(materialized["graph_outputs"][0]["shape"], [1, 50, 32])
        vision_module = materialized["stages"][0]["modules"][1]
        self.assertEqual(
            vision_module["repeat_carried"],
            {
                "input_port": "input",
                "output_port": "output",
                "input_tensor_id": "vision-patch-tokens",
                "output_tensor_id": "vision-block-output",
                "input_shape": [1, 3, 256, 1152],
                "output_shape": [1, 3, 256, 1152],
            },
        )
        projection = materialized["operators_by_id"][
            "vision-encoder/vision-projector/project"
        ]
        self.assertEqual(projection["analysis_by_metric"]["flops"], 3_623_878_656)

        component_template_ids = {
            template["template_id"] for template in graph["component_templates"]
        }
        self.assertEqual(
            component_template_ids,
            {
                "layernorm-mha-self-attention",
                "layernorm-gelu-feed-forward",
                "rmsnorm-rope-mqa-prefill-attention",
                "rmsnorm-rope-mqa-cached-attention",
                "rmsnorm-gated-gelu-feed-forward",
            },
        )
        transformer_templates = {
            template["template_id"]: template
            for template in graph["block_templates"]
            if template["template_id"] in {
                "siglip-transformer-block",
                "gemma-prefix-block",
                "gemma-action-expert-block",
            }
        }
        self.assertTrue(all(
            not template["operators"] and len(template["components"]) == 2
            for template in transformer_templates.values()
        ))
        gemma_feed_forward_references = [
            component["template_id"]
            for template in transformer_templates.values()
            if template["template_id"].startswith("gemma-")
            for component in template["components"]
            if component["component_id"] == "feed-forward"
        ]
        self.assertEqual(
            gemma_feed_forward_references,
            [
                "rmsnorm-gated-gelu-feed-forward",
                "rmsnorm-gated-gelu-feed-forward",
            ],
        )
        nested_projection = materialized["operators_by_id"][
            "action-flow-decoder/action-expert-blocks/self-attention/query-projection"
        ]
        self.assertEqual(
            nested_projection["analysis_by_metric"]["flops"],
            213_909_504,
        )
        self.assertEqual(nested_projection["effective_repeat"], 180)

        definitions = {
            definition["definition_id"]: definition
            for definition in graph["operator_definitions"]
        }
        self.assertEqual(len(definitions), 16)
        self.assertEqual(definitions["slice"]["visualizer"], "basic")
        with self.subTest(visualizer="patch embedding"):
            self.assertEqual(
                definitions["patch-embedding"]["visualizer"],
                "conv",
            )
        with self.subTest(workload="unbounded denoise count"):
            twelve_step = materialize_model_graph(graph, {"N_DENOISE": 12})
            self.assertEqual(twelve_step["stages"][2]["stage_repeat"], 12)

        suffix_template = next(
            template for template in graph["block_templates"]
            if template["template_id"] == "action-suffix-builder"
        )
        suffix_tensors = {
            tensor["tensor_id"]: tensor
            for tensor in suffix_template["tensors"]
        }
        suffix_operators = {
            operator["operator_id"]: operator
            for operator in suffix_template["operators"]
        }
        self.assertIn(
            {"port": "timestep", "tensor_id": "denoise-timestep"},
            suffix_template["input_ports"],
        )
        self.assertIsNone(suffix_tensors["denoise-timestep"]["producer"])
        self.assertNotIn("denoise-time-schedule", suffix_operators)
        self.assertEqual(
            suffix_operators["time-embedding"]["inputs"],
            [{"port": "timestep", "tensor_id": "denoise-timestep"}],
        )
        timestep_tensor = next(
            tensor for tensor in graph["graph_tensors"]
            if tensor["tensor_id"] == "denoise-timestep"
        )
        self.assertEqual(
            timestep_tensor["producer"],
            {
                "node_kind": "loop",
                "node_id": "action-flow-loop",
                "port": "timestep",
            },
        )
        self.assertEqual(
            timestep_tensor["consumers"],
            [{
                "node_kind": "module",
                "node_id": "action-suffix-builder",
                "port": "timestep",
            }],
        )
        action_stage = next(
            stage for stage in graph["stages"]
            if stage["stage_id"] == "action-flow-decoder"
        )
        self.assertEqual(
            action_stage["loop_carried"]["iteration_controls"],
            [{
                "tensor_id": "denoise-timestep",
                "port": "timestep",
                "formula_display": "t_k = 1 - k/N_DENOISE, k = 0..N_DENOISE-1",
            }],
        )

        prefix_template = next(
            template for template in graph["block_templates"]
            if template["template_id"] == "gemma-prefix-block"
        )
        prefix_attention = next(
            template for template in graph["component_templates"]
            if template["template_id"] == "rmsnorm-rope-mqa-prefill-attention"
        )
        prefix_operators = {
            operator["operator_id"]: operator
            for operator in prefix_attention["operators"]
        }
        self.assertEqual(
            prefix_operators["cache-output"]["inputs"],
            [
                {"port": "left", "tensor_id": "key-rope"},
                {"port": "right", "tensor_id": "value"},
            ],
        )
        self.assertEqual(
            [axis["axis"] for axis in next(
                tensor for tensor in prefix_attention["tensors"]
                if tensor["tensor_id"] == "prefix-kv"
            )["axes"]],
            ["kv", "batch", "sequence", "kv_head", "head_dim"],
        )
        self.assertEqual(
            [axis["axis"] for axis in next(
                tensor for tensor in graph["graph_tensors"]
                if tensor["tensor_id"] == "prefix-kv"
            )["axes"]],
            ["layer", "kv", "batch", "sequence", "kv_head", "head_dim"],
        )

        prefix_module = materialized["stages"][1]["modules"][1]
        self.assertEqual(
            prefix_module["repeat_carried"],
            {
                "input_port": "input",
                "output_port": "hidden",
                "input_tensor_id": "prefix-tokens",
                "output_tensor_id": "prefix-stack-output",
                "input_shape": [1, 788, 2048],
                "output_shape": [1, 788, 2048],
            },
        )
        self.assertEqual(
            prefix_module["collected_outputs"][0]["shape"],
            [18, 2, 1, 788, 1, 256],
        )
        self.assertEqual(
            prefix_module["collected_outputs"][0]["element_shape"],
            [2, 1, 788, 1, 256],
        )

        action_template = next(
            template for template in graph["block_templates"]
            if template["template_id"] == "gemma-action-expert-block"
        )
        self.assertEqual(
            [axis["axis"] for axis in next(
                tensor for tensor in action_template["tensors"]
                if tensor["tensor_id"] == "prefix-kv"
            )["axes"]],
            ["kv", "batch", "sequence", "kv_head", "head_dim"],
        )
        action_module = materialized["stages"][2]["modules"][1]
        self.assertEqual(action_module["outputs"][0]["shape"], [1, 51, 1024])
        self.assertEqual(action_module["repeat_carried"]["input_shape"], [1, 51, 1024])
        self.assertEqual(action_module["repeat_carried"]["output_shape"], [1, 51, 1024])
        self.assertEqual(
            action_module["indexed_inputs"][0]["element_shape"],
            [2, 1, 788, 1, 256],
        )

        update_template = next(
            template for template in graph["block_templates"]
            if template["template_id"] == "velocity-euler-update"
        )
        self.assertEqual(
            [port["port"] for port in update_template["input_ports"]],
            ["expert_hidden", "action_state"],
        )
        update_operators = {
            operator["operator_id"]: operator
            for operator in update_template["operators"]
        }
        self.assertEqual(
            update_operators["select-action-rows"]["definition_id"],
            "slice",
        )
        update_module = materialized["stages"][2]["modules"][2]
        self.assertEqual(
            [port["port"] for port in update_module["inputs"]],
            ["expert_hidden", "action_state"],
        )
        update_tensors = {
            tensor["tensor_id"]: tensor
            for tensor in update_module["template"]["tensors"]
        }
        self.assertEqual(update_tensors["normalized"]["shape"], [1, 51, 1024])
        self.assertEqual(update_tensors["action-hidden"]["shape"], [1, 50, 1024])
        self.assertEqual(update_tensors["velocity"]["shape"], [1, 50, 32])

    def test_run_context_must_match(self):
        run = valid_run("run-context")
        document = {"schema_version": "1.0.0", "dataset": "runs", "records": [run]}
        self.assertEqual(validate_document("runs", document, ROOT), [])
        run["comparison_context"]["platform"]["device_id"] = "another-device"
        self.assertIn(
            "context_mismatch",
            [issue.code for issue in validate_document("runs", document, ROOT)],
        )

    def test_end_to_end_contract(self):
        record = {
            "measurement_id": "e2e-test-001",
            "run_id": "run-test-001",
            "source_id": "source-test",
            "evidence": "measured_local",
            "measurement_method": "wall_clock",
            "metric": "latency",
            "statistics": [{"statistic": "p50", "value": 40.1, "unit": "ms"}],
            "sample_count": 100,
            "percentile_method": "source_reported",
            "work_unit": "action_chunk",
            "timing_boundary_id": "predict_cached_graph_sync",
            "missing_reason": None,
        }
        document = {
            "schema_version": "1.0.0",
            "dataset": "end_to_end",
            "records": [record],
        }
        self.assertEqual(validate_document("end_to_end", document, ROOT), [])

    def test_representative_reference_is_blocking(self):
        model_graph = valid_model_graph_document()["records"][0]
        model_graph["model_id"] = "model-test"
        datasets = {
            "sources": [{"source_id": "source-test"}],
            "models": [{
                "model_id": "model-test",
                "architecture_id": "arch-test",
                "artifacts": [{"artifact_id": "artifact-test"}],
                "source_ids": ["source-test"],
            }],
            "architectures": [{
                "architecture_id": "arch-test",
                "model_id": "model-test",
                "nodes": [],
                "edges": [],
                "source_ids": ["source-test"],
            }],
            "model_graphs": [model_graph],
            "devices": [{"device_id": "device-test"}],
            "systems": [{"system_id": "system-test", "device_ids": ["device-test"]}],
            "runtimes": [{
                "runtime_id": "runtime-test",
                "features": [],
                "model_support": [],
                "source_ids": ["source-test"],
            }],
            "runs": [{
                "run_id": "run-test",
                "model_id": "model-test",
                "model_artifact_id": "artifact-test",
                "runtime_id": "runtime-test",
                "device_id": "device-test",
                "system_id": "system-test",
                "source_id": "source-test",
            }],
            "end_to_end": [],
            "stages": [],
            "operators": [],
            "rooflines": [],
        }
        self.assertEqual(validate_references(datasets), [])
        datasets["runs"][0]["runtime_id"] = "missing-runtime"
        self.assertIn("broken_reference", [issue.code for issue in validate_references(datasets)])


class ComparisonTests(unittest.TestCase):
    def test_single_axis_grouping(self):
        fp16 = valid_run("run-fp16", precision_id="uniform-fp16", views=1)
        fp8 = valid_run("run-fp8", precision_id="uniform-fp8", views=1)
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertEqual(groups["run-fp16"], groups["run-fp8"])

        fp8["comparison_context"]["workload"]["vla"]["camera_views"] = 2
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertNotEqual(groups["run-fp16"], groups["run-fp8"])

        two_views = valid_run("two-views", views=2)
        groups = assign_group_ids(
            [fp16, two_views], "workload_scale", "workload.vla.camera_views"
        )
        self.assertEqual(groups["run-fp16"], groups["two-views"])

    def test_correctness_controls_ratio_kind(self):
        expected = {
            ("passed", "passed"): "validated_speedup",
            ("passed", "not_assessed"): "latency_ratio_unvalidated",
            ("passed", "failed"): "blocked_known_unequal",
        }
        for statuses, result in expected.items():
            with self.subTest(statuses=statuses):
                left = valid_run("left", correctness=statuses[0])
                right = valid_run("right", correctness=statuses[1])
                self.assertEqual(ratio_eligibility(left, right), result)


if __name__ == "__main__":
    unittest.main()
