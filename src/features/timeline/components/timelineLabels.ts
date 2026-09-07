import type { TimelineEvent, TimelineLane } from "../../profiler/domain/types";

export function timeLabel(ns: number) {
  return ns >= 1e6 ? `${(ns / 1e6).toFixed(3)} ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(2)} µs` : `${ns.toFixed(0)} ns`;
}

export function eventTitle(event: TimelineEvent) {
  const calls: Record<string, string> = {
    poll: 'poll · 等待 I/O 事件', ppoll: 'ppoll · 等待 I/O 事件',
    ioctl: 'ioctl · 设备控制',
    cudaGraphLaunch: 'Graph 提交 · cudaGraphLaunch',
    cudaLaunchKernel: 'Kernel 提交 · cudaLaunchKernel',
    cudaDeviceSynchronize: '等待 GPU 完成 · cudaDeviceSynchronize',
    cudaStreamSynchronize: '等待 Stream 完成 · cudaStreamSynchronize',
  };
  if (event.apiName) return calls[event.apiName] ?? event.apiName;
  if (event.eventKind === "scheduler") return "线程调度运行";
  const names: Record<string, string> = {
    "vision-graph": "视觉编码", "encoder-action-graph": "前缀编码 + 动作生成",
    "cuda-graph-launch": "cudaGraphLaunch", "cuda-device-synchronize": "cudaDeviceSynchronize",
    "cuda-stream-synchronize": "cudaStreamSynchronize", "cuda-sync":"CUDA 同步记录", "cuda-api-call":"CUDA API 调用", "osrt-call":"CPU 系统调用", memcpy: "数据拷贝", kernel: "Kernel 执行",
  };
  return names[event.label] ?? event.label;
}

export function laneTitle(lane: TimelineLane) {
  if (lane.role === 'profiler-excluded') return 'Nsys 采集线程';
  if (lane.kind==='cuda_api') return lane.role==='target-main' ? '主线程 · GPU 调用' : 'GPU 调用线程';
  if (lane.kind==='osrt') return lane.role==='target-main' ? '主线程 · 系统调用'
    : lane.role==='cuda-event-handler' ? 'CUDA 事件处理线程' : '后台线程 · 系统调用';
  if (lane.kind === "cpu_thread") return lane.role === "target-main" ? "主线程 · CPU 运行" : lane.role === "target-worker" ? "辅助线程 · CPU 运行" : "CUDA 事件处理线程";
  const names: Record<string, string> = { cpu_aggregate: "非采集器线程汇总", cuda_sync:"GPU 同步", cuda_graph: "CUDA Graph", gpu_memcpy: "GPU 拷贝", gpu_kernel: "已记录 Kernel", profiler_overhead: "采集器活动" };
  return names[lane.kind] ?? lane.kind;
}

export function laneActivity(lane: TimelineLane, events: readonly TimelineEvent[]): string {
  if (lane.role === 'profiler-excluded') return '采集过程中的 CPU 工作';
  if (lane.kind === 'osrt') {
    if (events.length && events.every(event => ['poll','ppoll'].includes(event.apiName ?? ''))) return 'poll：等待 I/O 事件';
    if (events.length && events.every(event => event.apiName === 'ioctl')) return 'ioctl：设备驱动调用';
    return '线程发起的系统调用';
  }
  if (lane.kind === 'cuda_api') {
    const names = events.map(event => event.apiName ?? '');
    return [names.includes('cudaGraphLaunch') ? 'Graph 提交' : '', names.some(name => name.includes('Memcpy')) ? '数据拷贝' : '', names.some(name => name.includes('Synchronize')) ? '等待 GPU' : ''].filter(Boolean).join('、') || '主机发起的 GPU 调用';
  }
  if (lane.kind === 'cpu_thread') return 'CPU 上实际运行的时间片';
  if (lane.coverage === 'partial') return '部分记录';
  return '点击区间查看详情';
}
