"""The bounded analysis contract shared with browser E2E statistics."""
import json
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parents[2] / 'schema' / 'analysis-policy.json').read_text())
WARMUP = POLICY['warmup_iterations']
SAMPLES = POLICY['measured_iterations']
CV_LIMIT = POLICY['cv_limit']
NEAR_LIMIT = POLICY['representative_relative_distance_limit']
