from copy import deepcopy
from pathlib import Path
import unittest
from tools.lib.jsonio import load_json
from tools.lib.runtime_realization import runtime_realization_problems

ROOT=Path(__file__).resolve().parents[1]

class FlashrtReuseTests(unittest.TestCase):
    def test_source_backed_results_and_plan_have_distinct_lifetimes(self):
        record=next(r for r in load_json(ROOT/'data/runtime_realizations/pi0.json')['records'] if r['realization_id']=='rr-flashrt-pi0-thor-fp8-v1')
        graph=load_json(ROOT/'data/model_graphs/pi0.json')['records'][0]
        self.assertEqual(runtime_realization_problems(record,graph),[])
        rows={r['reuse_id']:r for r in record['reuse']}
        self.assertEqual(rows['flashrt-prefix-kv']['lifetime'],'observation')
        self.assertEqual(rows['flashrt-time-projection']['lifetime'],'across_observations')
        self.assertEqual(rows['flashrt-cuda-graphs']['kind'],'execution_plan')
        self.assertEqual(rows['flashrt-cuda-graphs']['producer_refs'],[])
        evidence={e['evidence_id']:e for e in record['evidence']}
        for reuse in rows.values():
            self.assertEqual(reuse['implementation_status'],'implemented')
            self.assertTrue(any('/torch/' in evidence[e]['locator'] for e in reuse['evidence_ids']))
            self.assertTrue(all(reuse[k] is None for k in ('storage_bytes','preparation_ns','read_ns')))
        invalid=deepcopy(record);invalid['reuse'][0]['evidence_ids']=[]
        self.assertIn('reuse_evidence',{i.code for i in runtime_realization_problems(invalid,graph)})

if __name__=='__main__':unittest.main()
