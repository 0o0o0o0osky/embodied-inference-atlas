import unittest
from types import SimpleNamespace
from extractors.ncu import _csv_rows

class NcuQuotedSessionTests(unittest.TestCase):
 def test_installed_export_unescaped_template_quote_retains_command(self):
  command='ncu --kernel-name "regex:^void convert_unary<float, __nv_bfloat16>" --launch-count 1'
  raw='"Profiler Command Line","'+command+'"\n'
  self.assertEqual(_csv_rows(raw,SimpleNamespace(source_label='test'),'session'),[['Profiler Command Line',command]])

 def test_copy_sections_preserve_independent_selected_replay(self):
  from extractors.ncu import _session_facts
  payload='Nsight Compute Target,2025.3.0.0 (build 36273991) (public-release)\nProfiler Command Line,ncu --kernel-name copy --launch-skip 109 --launch-count 1 --replay-mode kernel --cache-control none --clock-control none --section LaunchStats --section SpeedOfLight --section SchedulerStats --section MemoryWorkloadAnalysis\n'
  facts=_session_facts(payload,SimpleNamespace(source_label='stride-copy'),{})
  self.assertEqual(facts['section_mode'],'section_set')
  self.assertEqual(facts['replay_mode'],'kernel')
  self.assertEqual(facts['clock_control_request'],'none')
  self.assertEqual(facts['cache_control_request'],'none')

 def test_section_report_retains_measured_cache_rates_without_inventing_memory_bytes(self):
  from extractors.ncu import _metrics
  context=SimpleNamespace(source_label='copy',run={'run_id':'run-copy-001'})
  metrics=_metrics({'lts__t_sector_hit_rate.pct':97.48593,'l1tex__t_sector_hit_rate.pct':0},
      'capture-copy-001','run-copy-001','source-local', 'kernel-observation-copy-001',context,{'section_mode':'section_set'})
  by_name={m['metric_name']:m for m in metrics}
  self.assertEqual(by_name['l2_sector_hit_rate_percent']['value'],97.48593)
  self.assertEqual(by_name['l1tex_sector_hit_rate_percent']['value'],0)
  self.assertIsNone(by_name['system_memory_bytes']['value'])
