import unittest
from extractors.pi0_full_trace import group_launches

class FullTraceTests(unittest.TestCase):
    def test_same_symbol_different_launch_or_exact_shape_stay_separate(self):
        base = dict(demangledName=1, gridX=1,gridY=1,gridZ=1,blockX=32,blockY=1,blockZ=1, registersPerThread=24,staticSharedMemory=0,dynamicSharedMemory=0)
        rows=[dict(base,start=1,end=3,graphNodeId=10),dict(base,start=4,end=8,graphNodeId=11),dict(base,start=9,end=12,graphNodeId=12,gridX=2)]
        groups=group_launches(rows,{(1,3):'shape-a',(4,8):'shape-b'})
        self.assertEqual(len(groups),3)
        self.assertEqual(sum(len(v) for v in groups.values()),3)

    def test_unknown_precision_not_inferred_from_runtime(self):
        from extractors.pi0_full_trace import unknown_signature
        s=unknown_signature('kernel-signature-pi0-recorded-001','vlacpp recorded kernel 001')
        self.assertIsNone(s['precision_path']['input_dtype_class'])
        self.assertEqual(s['precision_path']['missing']['input_dtype_class'],'not_collected')

class CpuIntervalTests(unittest.TestCase):
    def test_core_time_and_sample_points_remain_distinct(self):
        import sqlite3
        from extractors.pi0_full_trace import add_cpu_evidence
        c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row
        c.executescript('''CREATE TABLE SCHED_EVENTS(start,cpu,isSchedIn,globalTid);
          CREATE TABLE COMPOSITE_EVENTS(id,start,globalTid);
          CREATE TABLE SAMPLING_CALLCHAINS(id,symbol,unresolved,stackDepth);
          CREATE TABLE OSRT_API(start,end,globalTid,nameId);
          CREATE TABLE StringIds(id,value);
          CREATE TABLE NVTX_EVENTS(text,globalTid);
          INSERT INTO NVTX_EVENTS VALUES('pi0_steady_00',16777217);
          INSERT INTO SCHED_EVENTS VALUES(0,0,1,16777217),(10,0,0,16777217),(0,1,1,16777218),(10,1,0,16777218);
          INSERT INTO COMPOSITE_EVENTS VALUES(1,5,16777217);
          INSERT INTO StringIds VALUES(1,'vla::predict');
          INSERT INTO SAMPLING_CALLCHAINS VALUES(1,1,0,0);''')
        timeline={'events':[],'lanes':[],'summaries':[]}
        bundle={'datasets':{'profiler_captures':[{'nsys':{},'analysis_sample':{'window_start_ns':0,'window_end_ns':10,'sample_index':0}}],'timelines':[timeline]}}
        add_cpu_evidence(c,bundle)
        self.assertEqual(timeline['summaries'][0]['value'],20)
        self.assertEqual(timeline['cpu_samples'][0]['time_ns'],5)
        self.assertNotIn('duration_ns',timeline['cpu_samples'][0])
        self.assertIn(timeline['cpu_samples'][0]['lane_id'],{x['lane_id'] for x in timeline['lanes']})
        self.assertFalse(bundle['datasets']['profiler_captures'][0]['cpu_capabilities']['thread_states'])

        c.close()

class AuditedSignatureTests(unittest.TestCase):
    def test_stride_copy_and_cutlass_classification_do_not_invent_shapes(self):
        from extractors.pi0_full_trace import audited_signature
        copy = audited_signature('036', 'void cpy_scalar<&cpy_1_scalar<float, float>>(const char *, char *, long)')
        self.assertEqual(copy['function_family'], 'copy')
        self.assertEqual(copy['precision_path']['input_dtype_class'], 'fp32')
        self.assertEqual(copy['precision_path']['output_dtype_class'], 'fp32')
        self.assertNotIn('shape', copy)
        gemm = audited_signature('040', 'void cutlass::Kernel2<cutlass_80_tensorop_s1688gemm_64x64_32x6_tn_align1>(T1::Params)')
        self.assertEqual(gemm['function_family'], 'gemm')
        self.assertIsNone(gemm['precision_path']['input_dtype_class'])
        with self.assertRaises(ValueError):
            audited_signature('036', 'unverified kernel')
