"""Stage existing unprofiled batch samples without pooling or changing measurements."""
import argparse,copy,json
from pathlib import Path
from tools.lib.site import load_validated_datasets
from tools.lib.jsonio import write_json_atomic
from tools.lib.promotion import plan_promotion

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('samples',type=Path);a=p.parse_args();root=Path.cwd();ds=load_validated_datasets(root/'data',root);samples=json.loads(a.samples.read_text());runs=[]
 for i,key in enumerate(['bf16','q8'],1):
  sample=samples[key]
  if sample['warmup']!=5 or len(sample['latencies_ms'])!=10 or sample['profiled']:raise ValueError('Unexpected protocol')
  run=copy.deepcopy(next(r for r in ds['runs'] if r['run_id']==f'run-pi0-vlacpp-w5-r10-{i:03d}'))
  run['analysis_batch']=dict(batch_id=f'batch-pi0-vlacpp-e2e-{key}-001',input_case_id='input-pi0-synthetic-v1-p48-c50-d10',input_recipe='synthetic-rgb-pattern-sequential-tokens-padded-state-external-fixed-noise-v1',warmup_iterations=5,samples=[dict(sample_index=j,wall_time_ns=round(ms*1000000)) for j,ms in enumerate(sample['latencies_ms'])],output_finite=sample['finite'],output_shape=[50,32])
  runs.append(run)
 bundle={'bundle_version':'1.0.0','source_label':'pi0-batch-samples','datasets':{'runs':runs}};plan_promotion(bundle,root);write_json_atomic(root/'.local/staging/pi0-batch-metadata.json',bundle)
if __name__=='__main__':main()
