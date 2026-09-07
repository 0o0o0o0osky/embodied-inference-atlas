import json
from pathlib import Path
import unittest
from tools.lib.representative_data import _batch_summary
from tools.lib.analysis_policy import SAMPLES, WARMUP


class RepresentativeContractTests(unittest.TestCase):
    def test_importer_representative_cases(self):
        cases = json.loads((Path(__file__).parent / 'fixtures/representative-cases.json').read_text())
        for case in cases:
            with self.subTest(case=case['name']):
                captures, timelines = [], {}
                for i, wall in enumerate(case['walls']):
                    cid = f'c{i}'
                    captures.append(dict(capture_id=cid, analysis_sample=dict(sample_index=i,
                        warmup_iterations=WARMUP, measured_iterations=SAMPLES, batch_id='b', input_case_id='input'),
                        coverage=dict(is_complete_for_population=True)))
                    timelines[cid] = dict(window=dict(start_ns=0, duration_ns=wall), summaries=[], events=[dict(
                        event_kind='kernel', kernel_signature_id='gemm', duration_ns=case['kernel_ns'][i], count=case['calls'][i])])
                summary = _batch_summary(captures, timelines, {'gemm': {'function_family': 'gemm'}})
                expected = case['representative_index']
                self.assertEqual(summary['representative_capture_id'] if summary else None,
                                 None if expected is None else f'c{expected}')
