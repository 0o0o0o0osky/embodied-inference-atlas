from copy import deepcopy
from pathlib import Path
import unittest
import tempfile
import json
from unittest.mock import patch
from tools.lib.jsonio import load_json
from tools.lib.contracts import validate_document
from tools.lib.roofline import _validate_operation_rates
from tools.lib.roofline_materialize import ceilings, operation_rates_schema

ROOT = Path(__file__).resolve().parents[1]

class OperationRateTests(unittest.TestCase):
    def test_generated_profile_and_schema_match_retained_configuration(self):
        generated = {r['ceiling_id']: r for r in ceilings()}
        document = load_json(ROOT/'data/analysis/roofline_ceilings.json')
        for record in document['records']:
            self.assertEqual(record.get('operation_rates'), generated[record['ceiling_id']].get('operation_rates'))
        schema = load_json(ROOT/'schema/analysis/roofline_ceilings.schema.json')
        self.assertEqual(schema['record']['properties']['operation_rates'], operation_rates_schema())
        self.assertEqual(validate_document('roofline_ceilings', document, ROOT), [])

    def test_explicit_device_mode_and_missing_rates_are_valid_but_duplicate_or_stale_binding_is_not(self):
        record = deepcopy(ceilings()[0])
        record['device_id'] = record['operation_rates']['device_id'] = 'fixture-device'
        record['operating_point']['power_mode'] = 'fixture-mode'
        record['operation_rates']['rates'][0]['operation_per_second'] = None
        self.assertEqual(validate_document('roofline_ceilings', {'dataset':'roofline_ceilings','schema_version':'2.0.0','records':[record]}, ROOT), [])
        issues = []
        _validate_operation_rates(issues, record, '$')
        self.assertEqual(issues, [])
        record['operation_rates']['rates'].append(deepcopy(record['operation_rates']['rates'][0]))
        record['operation_rates']['gpu_clock_hz'] = 123
        _validate_operation_rates(issues, record, '$')
        self.assertEqual({issue.code for issue in issues}, {'operation_rate_duplicate', 'operation_rate_binding'})

    def test_rebuild_preserves_an_independently_configured_device_from_the_catalog(self):
        record = deepcopy(ceilings()[0])
        record['ceiling_id'] = 'fixture-ceiling'
        record['device_id'] = record['operation_rates']['device_id'] = 'fixture-device'
        record['operation_rates']['rates'][0]['operation_per_second'] = 123
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root/'data/analysis/roofline_ceilings.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'records':[record]}))
            with patch('tools.lib.roofline_materialize.ROOT', root):
                self.assertEqual(ceilings(), [record])
                record['operation_rates']['device_id'] = 'wrong-device'
                path.write_text(json.dumps({'records':[record]}))
                with self.assertRaises(ValueError):
                    ceilings()
