import copy
import sqlite3
import unittest
from unittest.mock import patch

from extractors.fixed_case import build_e2e_bundle, build_fixed_case_bundle


class FixedCaseTests(unittest.TestCase):
    def test_one_representative_preserves_symbol_launch_groups_and_unknown_timing(self):
        c=sqlite3.connect(':memory:')
        self.addCleanup(c.close)
        c.executescript('''CREATE TABLE NVTX_EVENTS(text,start,end,globalTid);
          CREATE TABLE StringIds(id,value);
          CREATE TABLE CUPTI_ACTIVITY_KIND_KERNEL(start,end,demangledName,gridX,gridY,gridZ,blockX,blockY,blockZ,registersPerThread,staticSharedMemory,dynamicSharedMemory,streamId);
          CREATE TABLE CUPTI_ACTIVITY_KIND_MEMCPY(start,end);
          CREATE TABLE CUPTI_ACTIVITY_KIND_RUNTIME(start,end);
          CREATE TABLE CUPTI_ACTIVITY_KIND_SYNCHRONIZATION(start,end);
          CREATE TABLE SCHED_EVENTS(start);
          CREATE TABLE OSRT_API(start,end,globalTid,nameId);
          INSERT INTO StringIds VALUES(1,'reviewed_gemm'),(2,'unknown');''')
        for i in range(10):
            start=i*10000
            c.execute('INSERT INTO NVTX_EVENTS VALUES(?,?,?,?)',(f'pi0_steady_{i:02d}',start,start+1000,16777217))
            for offset,duration,name,grid in [(10,100,1,1),(120,200,1,2),(330,50,2,1)]:
                c.execute('INSERT INTO CUPTI_ACTIVITY_KIND_KERNEL VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(start+offset,start+offset+duration,name,grid,1,1,32,1,1,20,0,0,7))
        def parsed(connection,context,policy):
            self.assertEqual(policy['signature_rules'],[])
            return {'datasets':{'runs':[copy.deepcopy(context.run)],'kernel_observations':[],'kernel_signatures':[],
                'profiler_captures':[dict(capture_id='capture-temp',run_id=context.run['run_id'],source_id='source-local-thor',warnings=['partial_kernel_signature_coverage'],nsys={},coverage={'is_complete_for_population':True})],
                'timelines':[dict(timeline_id='timeline-temp',capture_id='capture-temp',run_id=context.run['run_id'],window={'start_ns':0,'duration_ns':1000},lanes=[],events=[],summaries=[],missing={})],
                'telemetry':[],'profiler_metrics':[],'operator_kernel_links':[]}}
        result=dict(runtime='test-runtime',samples_ms=[1]*10,warmup=5,profiled=True,finite=True,input_case_id='input-fixed',batch_id='batch-fixed',input_recipe='synthetic-fixed',output_shape=[50,32])
        run=dict(run_id='run-template-001',configuration_id='cfg-template',source_id='source-local-thor',system_id='thor-unit-01',model_id='pi0',runtime_id='test-runtime',capture_method='nsys',evidence='measured_local',operating_point={'operating_point_id':'unknown'})
        with patch('extractors.fixed_case.parse_nsys_sqlite',side_effect=parsed):
            stage,manifest,full=build_fixed_case_bundle(c,result,run,{'reviewed_gemm':dict(label='GEMM',function_family='gemm',confidence='high')})
        self.assertEqual(len(full['datasets']['timelines']),10)
        self.assertEqual(len(stage['datasets']['timelines']),1)
        self.assertEqual(len(stage['datasets']['kernel_signatures']),3)
        observed=stage['datasets']['kernel_observations']
        self.assertEqual(sum(o['duration']['value_ns'] for o in observed),350)
        self.assertEqual([m['same_symbol_ordinal'] for m in manifest],[0,1,0])
        signatures=stage['datasets']['kernel_signatures']
        self.assertTrue(all(s['precision_path']['input_dtype_class'] is None for s in signatures))
        self.assertNotEqual(signatures[0]['kernel_signature_id'],signatures[1]['kernel_signature_id'])
        self.assertEqual(stage['datasets']['profiler_captures'][0]['analysis_summary']['sample_count'],10)
        self.assertFalse(stage['datasets']['profiler_captures'][0]['cpu_capabilities']['scheduler_running'])

    def test_e2e_is_independent_stable_batch_and_has_no_profiler_duration(self):
        results=dict(samples_ms=[10,11,10,10,10,10,10,10,10,10],warmup=5,profiled=False,finite=True,input_case_id='input-fixed',batch_id='batch-e2e',input_recipe='synthetic-fixed',output_shape=[50,32])
        run=dict(run_id='run-fixed-e2e-001',source_id='source-local-thor',timing={'timing_boundary_id':'cpu-to-cpu'})
        bundle=build_e2e_bundle(results,run)
        self.assertEqual(bundle['datasets']['end_to_end'][0]['statistics'][2]['value'],10)
        self.assertNotIn('profiler_captures',bundle['datasets'])
        for bad in [dict(results,profiled=True),dict(results,samples_ms=[10]*9+[30])]:
            with self.assertRaises(ValueError):build_e2e_bundle(bad,run)

if __name__=='__main__':unittest.main()
