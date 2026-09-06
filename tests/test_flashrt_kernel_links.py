import unittest
from pathlib import Path
from extractors.flashrt_kernel_links import shared_geglu_bundle
from tools.lib.site import load_validated_datasets
from tools.lib.runtime_realization import runtime_realization_problems
from tools.lib.profiler import profiler_semantic_issues

ROOT = Path(__file__).resolve().parents[1]


class FlashrtKernelLinkTests(unittest.TestCase):
    def test_shared_signature_keeps_whole_window_population_without_group_attribution(self):
        datasets = load_validated_datasets(ROOT/'data', ROOT)
        bundle = shared_geglu_bundle(datasets)
        realization = bundle['datasets']['runtime_realizations'][0]
        link = bundle['datasets']['operator_kernel_links'][0]
        self.assertEqual(link['status'], 'partial')
        self.assertEqual(link['reason_code'], 'ambiguous_attribution')
        self.assertEqual(link['execution_group_ids'], ['prefix-geglu-fp8', 'action-geglu-fp8'])
        self.assertEqual(link['coverage'], {'mapped_launches':197, 'population_launches':197, 'unit':'launch'})
        self.assertEqual(len(bundle['datasets']['operator_kernel_links']), 1)
        graph = next(g for g in datasets['model_graphs'] if g['model_graph_id']==realization['model_graph_id'])
        self.assertEqual(runtime_realization_problems(realization,graph), [])
        datasets['runtime_realizations'] = [realization if r['realization_id']==realization['realization_id'] else r for r in datasets['runtime_realizations']]
        datasets['operator_kernel_links'] = [link]
        self.assertEqual(profiler_semantic_issues(datasets), [])
