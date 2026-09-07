import type {OperatorDetail} from '../domain/types';
import type {RooflineScenarioRecord,RooflineCeilingRecord} from '../../roofline/domain/types';
import {attentionShapeFromDetail,operationPrecision,plainAttentionStorage} from '../../roofline/presentation/attentionInput';
import {resolveAttentionHardwareProfile} from '../../roofline/domain/attentionHardwareProfile';
import {AttentionRooflinePanel} from '../../roofline/components/AttentionRooflinePanel';
import {ConcatCostPanel} from './ConcatCostPanel';
import {concatCostFromDetail} from '../domain/concatCost';
import {AnalysisPlaceholder} from '../../../components/AnalysisPlaceholder';

export function OperatorExecutionEstimate({detail,scenario,ceiling,bandwidth}:{
 detail:OperatorDetail;scenario:RooflineScenarioRecord;ceiling:RooflineCeilingRecord;bandwidth:number|null;
}) {
 const segment=operationPrecision(detail,scenario);
 if(!segment) return <AnalysisPlaceholder state="unlinked" title="当前算子的精度待关联" detail="需要该算子输入、输出及计算路径的精度记录。"/>;
 if(detail.definitionId==='concat'||detail.definitionId==='reshape') {
  const compatible=segment.activation.bits_per_value===segment.output.bits_per_value && plainAttentionStorage(segment);
  if(!compatible) return <AnalysisPlaceholder state="not_recorded" title="当前存储路径待补充" detail="需要输入、输出的存储编码及转换方式。"/>;
  const cost=concatCostFromDetail(detail,segment.activation.bits_per_value);
  return cost?<ConcatCostPanel {...cost} precisionLabel={segment.activation.format.toUpperCase()} bandwidthBytesPerSecond={bandwidth}/>:null;
 }
 const shape=attentionShapeFromDetail(detail);
 if(!shape) return <AnalysisPlaceholder state="not_recorded" title="Attention 形状待补充" detail="需要一致的 Q、K、V 头数、长度和维度。"/>;
 if(!plainAttentionStorage(segment)) return <AnalysisPlaceholder state="not_recorded" title="当前量化路径的 Attention 成本待补充" detail="需要量化元数据和转换方式；BF16、FP16 路径已可比较分项与融合。"/>;
 const profile=resolveAttentionHardwareProfile(ceiling);
 const matmul=ceiling.compute.find(c=>c.compute_class===segment.compute_class)?.flop_per_second??null;
 return <AttentionRooflinePanel key={`${detail.ref}|${scenario.precision_path.precision_path_id}`} input={{shape,
  bytes:{query:segment.activation.bits_per_value/8,key:segment.activation.bits_per_value/8,value:segment.activation.bits_per_value/8,score:segment.output.bits_per_value/8,probability:segment.activation.bits_per_value/8,output:segment.output.bits_per_value/8},
  mask:{kind:'none'},rates:{...profile.rates,matmulFlop:matmul,globalByte:bandwidth}}}
  precisionLabel={segment.activation.format.toUpperCase()} ceilingLabel={ceiling.operating_point.gpu_clock_hz?`${(ceiling.operating_point.gpu_clock_hz/1e6).toLocaleString('zh-CN')} MHz 理论频率`:'硬件频率待补充'}
  assumptions={profile.notes} sources={[...profile.sources,{label:'FlashAttention-3：资源重叠',url:'https://tridao.me/blog/2024/flash3/'},{label:'Triton：Softmax 读写模型',url:'https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html'}]}/>
}
export const supportsExecutionEstimate=(detail:OperatorDetail)=>['attention-core','concat','reshape'].includes(detail.definitionId);
