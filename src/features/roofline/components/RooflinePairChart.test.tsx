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
it('shows attainment against the selected roof only in the comparison table',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={point} basis={basis}/>);
 expect(markup).toContain('所选假设曲线');
 const table=markup.match(/<table[^>]*class="roofline-pair-metrics"[^>]*>[\s\S]*?<\/table>/)?.[0] ?? '';
 for(const text of ['达到理论参考性能','理论参考','10 TFLOP/s','50 TFLOP/s','100 µs','20 µs','20%'])expect(table).toContain(text);
 expect(markup).not.toContain('40 TFLOP/s');expect(markup).not.toContain('80 µs');
 expect(markup).not.toContain('pair-gap-label');expect(markup).toContain('role="button"');
 expect(markup.replace(table,'')).not.toContain('20%');
 expect(point.derived.efficiency).toBeNull();
});
it('retains matched efficiency and does not falsely claim unmatched frequency',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={{...point,derived:{...point.derived,efficiency:.2}}} basis={{...basis,operating_point_id:'matched-op'}}/>);
 expect(markup).toContain('20%');expect(markup).toContain('已匹配运行条件');
 expect(markup).not.toContain('采集时频率尚未匹配');
});
it('does not turn independent replay timing into an actual pair or zero gap',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={point} basis={{...basis,time_basis:'ncu_kernel'}}/>);
 expect(markup).not.toContain('20%');expect(markup).not.toContain('data-reference-ratio=');
 expect(markup).toContain('未提供');
});

it('labels partial work with a conditional reference boundary while retaining full call timing',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={{...point,coverage:{...point.coverage,status:'partial'},derived:{...point.derived,status:'partial_lower_bound'}}} basis={basis}/>);
 expect(markup).toContain('部分建模');expect(markup).toContain('理论参考 · 带宽边界');expect(markup).toContain('100 µs');
 expect(markup).toContain('已确认的局部计算与数据边界');expect(markup).toContain('20%');expect(markup).toContain('所选假设曲线');
});

it('explains the explicitly omitted alpha epilogue and cast without generalizing to other partial points',()=>{
 const partial={...point,coverage:{...point.coverage,status:'partial' as const,omitted:[{ref:'alpha_epilogue_and_cast',reason:'not modeled'}]},derived:{...point.derived,status:'partial_lower_bound' as const}};
 const markup=renderToStaticMarkup(<RooflinePairChart point={partial} basis={basis}/>);
 expect(markup).toContain('矩阵乘加；α 缩放与 FP16 输出转换未单列。');
 const body=markup.split('<details')[0]!;
 expect(body).not.toContain('α 缩放');expect(body).not.toContain('不代表');
 expect(markup.match(/<details/g)).toHaveLength(1);
 expect(markup).toContain('Nsys 追踪记录');
 expect(renderToStaticMarkup(<RooflinePairChart point={{...partial,coverage:{...partial.coverage,omitted:[]}}} basis={basis}/>)).not.toContain('α 缩放');
});

it('retains ratios above 100 percent and flags the boundary for review',()=>{
 const markup=renderToStaticMarkup(<RooflinePairChart point={{...point,timing:{...point.timing,observed_second:1e-5}}} basis={basis}/>);
 expect(markup).toContain('200%');expect(markup).toContain('实测高于所选上限');
});
