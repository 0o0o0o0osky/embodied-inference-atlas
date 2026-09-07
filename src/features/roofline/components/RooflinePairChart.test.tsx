import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it } from 'vitest';
import { RooflinePairChart } from './RooflinePairChart';
import type { RooflineBasisRecord,RooflinePointRecord } from '../domain/types';
const point={entity:{label:'已确认单次 GEMM',shape_or_coverage:'M=304 N=32768 K=2048'},calls:1,
 work:{total_flop:1e9,components:[]},traffic:{total_byte:1e8,value_kind:'modeled',memory_domain:'device_memory'},
 coverage:{status:'complete',included_refs:[],omitted:[]},timing:{observed_second:1e-4},
 derived:{compute_second:1e-5,memory_second:2e-5,roof_second:2e-5,status:'complete',efficiency:null},
} as unknown as RooflinePointRecord;
const basis={time_basis:'nsys_interval',operating_point_id:'unknown'} as RooflineBasisRecord;
it('shows default single-call rates and conditional timing gaps without inventing efficiency',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={point} basis={basis}/>);
 expect(markup).toContain('所选假设曲线');expect(markup).toContain('参考差距');
 for(const text of ['实际吞吐','模型边界吞吐','Nsys 追踪下执行耗时','条件理论耗时下界','40 TFLOP/s','80 µs'])expect(markup).toContain(text);
 expect(markup).not.toContain('达到所选上限');
 expect(markup).toContain('class="pair-gap-label"');expect(markup).toContain('role="button"');
});
it('retains matched efficiency and does not falsely claim unmatched frequency',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={{...point,derived:{...point.derived,efficiency:.2}}} basis={{...basis,operating_point_id:'matched-op'}}/>);
 expect(markup).toContain('达到所选上限 20%');
 expect(markup).not.toContain('采集时频率尚未匹配');
});
it('does not turn independent replay timing into an actual pair or zero gap',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={point} basis={{...basis,time_basis:'ncu_kernel'}}/>);
 expect(markup).not.toContain('40 TFLOP/s');expect(markup).not.toContain('80 µs');
 expect(markup).toContain('未提供');
});

it('labels partial work with a conditional reference boundary while retaining full call timing',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={{...point,coverage:{...point.coverage,status:'partial'},derived:{...point.derived,status:'partial_lower_bound'}}} basis={basis}/>);
 expect(markup).toContain('部分建模的条件参考边界');expect(markup).toContain('模型边界由带宽项决定');expect(markup).toContain('100 µs');
 expect(markup).toContain('未建模步骤不视为零开销');expect(markup).not.toContain('达到所选上限');
});

it('explains the explicitly omitted alpha epilogue and cast without generalizing to other partial points',()=>{
 const partial={...point,coverage:{...point.coverage,status:'partial' as const,omitted:[{ref:'alpha_epilogue_and_cast',reason:'not modeled'}]},derived:{...point.derived,status:'partial_lower_bound' as const}};
 const markup=renderToStaticMarkup(<RooflinePairChart point={partial} basis={basis}/>);
 expect(markup).toContain('计算量只计矩阵乘加；α 缩放与 FP16 输出转换未单独建模，计时仍覆盖完整 Kernel。');
 expect(renderToStaticMarkup(<RooflinePairChart point={{...partial,coverage:{...partial.coverage,omitted:[]}}} basis={basis}/>)).not.toContain('α 缩放');
});
