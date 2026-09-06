import unittest
from types import SimpleNamespace
from extractors.ncu import _csv_rows

class NcuQuotedSessionTests(unittest.TestCase):
 def test_installed_export_unescaped_template_quote_retains_command(self):
  command='ncu --kernel-name "regex:^void convert_unary<float, __nv_bfloat16>" --launch-count 1'
  raw='"Profiler Command Line","'+command+'"\n'
  self.assertEqual(_csv_rows(raw,SimpleNamespace(source_label='test'),'session'),[['Profiler Command Line',command]])
