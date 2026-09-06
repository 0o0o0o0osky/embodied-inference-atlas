# 离线深度时间线

## 要回答的问题

查看同一次 canonical 采集中的线程、CUDA API、Graph、Kernel 和拷贝区间；在工作台选择时间范围，再交由 Perfetto 深入查看。

## 最小使用方法

运行本机 HTTP 服务并打开离线构建的工作台。在系统耗时页打开「离线 Perfetto」，等待就绪；加载当前分析的唯一代表 trace；「定位所选范围」缩放到工作台给出的范围。工具菜单使用英文。

固定版本为 v58.2，实际资源与许可证见 `public/perfetto/README.md`。资源随离线构建分发。不得用联网后的 service worker 缓存代替首次断网验证。

## 输出解释

`timelineToChromeTrace` 只接受单个 canonical timeline。每个事件保留事件、采集、run、source、lane 与 Kernel signature 身份，覆盖率、原始 count、bytes 与区间语义均在 args 中；缺失保留 null。线程和 stream 使用脱敏逻辑轨道，Chrome Trace 的 pid/tid 是导出内部编号，不表示原始 OS 身份。同一 lane 的交叠事件放到额外的「交叠显示行」，避免 Chrome 完整区间被误解为调用栈嵌套；这些行不表示新增线程或 stream。

canonical 事件起点已相对目标时间窗，不重复加 `window.startNs`。Chrome Trace 的 `ts`、`dur` 使用微秒（ns ÷ 1000），Perfetto 范围消息使用导出时间坐标中的秒（ns ÷ 1e9）。原始窗口起点在 metadata 中保留，供审计，不能与其他独立采集对齐为同一次执行。

宿主按窗口身份及同源 origin 验证 PONG；先持续 PING，收到 PONG 再发送 ArrayBuffer。`keepApiOpen: true` 支持同一 iframe 切换采集；`localOnly: true` 禁止共享/下载入口。Perfetto 没有 trace-loaded 回执，因此宿主状态仅表示已发送，解析进度由 Perfetto 自身呈现。范围消息使用上游内置加载重试；超慢设备上可在解析结束后再次点击定位。

## 不能推断的结论

空白没有已记录活动，不等于 CPU/GPU 空闲。聚合区间不证明连续执行，CUDA Graph span 不等于 Kernel 活动并集。图中没有新造调用栈、CPU 核归属、launch flow 或跨采集因果关联。Chrome Trace slices 是区间展示格式，不将函数采样变成精确运行时间。

## 验证

针对性测试：`npm test -- src/features/timeline/perfetto/perfetto.test.ts`。

浏览器采用新 context、禁用 service worker，在首次打开前拦截所有非本机 origin。检查实际记录的轨道、当前代表 capture 身份、定位后的可见范围和零外网请求；截图与网络日志留在 `.local/`。不要把只出现 PONG 当成 trace 完成解析。

接口依据：[官方嵌入文档](https://perfetto.dev/docs/visualization/embedding-the-ui)；版本行为另以固定发行包中的 `postMessageHandler`、`scrollToTimeRange` 及资源启动代码核对。
