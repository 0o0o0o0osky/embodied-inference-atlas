import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ConcatCostPanel} from './ConcatCostPanel';
it('renders two conditional storage paths without claiming measured removal',()=>{
 const markup=renderToStaticMarkup(<ConcatCostPanel operation="concat" inputBytes={1024} outputBytes={1024} precisionLabel="BF16" bandwidthBytesPerSecond={1e9}/>);
 expect(markup).toContain('0 B 额外拷贝');expect(markup).toContain('2.048 μs');
 expect(markup).toContain('生产者直接写目标分区');expect(markup).toContain('两个源 buffer 经拷贝写入目标');
 expect(markup).toContain('生产者写入与消费者读取仍归各自算子');expect(markup).not.toContain('当前实现已消除');
 const unknown=renderToStaticMarkup(<ConcatCostPanel operation="reshape" inputBytes={null} outputBytes={null} precisionLabel="BF16" bandwidthBytesPerSecond={null}/>);
 expect(unknown).toContain('兼容步幅时只改视图');expect(unknown).toContain('尺寸待解析');expect(unknown).not.toContain('0.000');
});
