# 离线 Perfetto v58.2

来源：[官方 v58.2 UI 发行包](https://github.com/google/perfetto/releases/tag/v58.2)。
保留完整发行包资源，构建标识 `v58.2-add693d8b`。`atlas-manifest.json` 记录下载包 SHA-256、离线补丁版本和每个发行资源的 SHA-256。

重建资源（联网维护步骤，页面运行不需要联网）：

```sh
python3 tools/vendor_perfetto.py
# 或使用已下载的固定版本发行包
python3 tools/vendor_perfetto.py --archive /path/to/perfetto-ui.zip
```

普通 `npm run build` 将 `public/perfetto/` 原样复制到离线构建目录。通过本机 HTTP 服务打开；不支持 `file://`。服务端须将 `.wasm` 作为 `application/wasm` 返回，不能用 SPA fallback 将缺失资源改写为 HTML。

## 离线修改

官方包在 localhost 即使使用 embedded 模式也会尝试加载 Google 内部扩展。`tools/vendor_perfetto.py` 使用固定上下文、单次替换作以下修改：

- 使用上游第三方 `DefaultEmbedder`，关闭分析统计默认配置。
- 不注册 `dev.perfetto.ExtensionServers` 核心插件，避免内部扩展、旧 userscript 和已保存远端扩展自动访问网络。
- 固定内置 WASM 引擎，并跳过本机 native RPC 自动探测。
- 将运行期 CSP 限定为同源 JS/WASM/数据与本地 blob/data；外部分享、扩展功能不在离线工作台范围。
- 更新上游资源 manifest 中被修改的 JS 校验值。其内嵌 source map 保留上游源码，调试上述几个补丁位置时以生成 JS 为准。

补丁不修改 trace processor、轨道计算、渲染和 postMessage API。子目录部署不注册 service worker；断网首次访问依赖随构建携带的资源，不依赖历史浏览器缓存。

## 许可

Perfetto 采用 Apache-2.0，完整文本位于 `licenses/Perfetto-LICENSE.txt`。上游 JavaScript 中的版权声明原样保留。`licenses/npm/` 保存依据 v58.2 `ui/pnpm-lock.yaml` 运行依赖闭包取得的 npm 许可和 NOTICE，`index.json` 记录精确包版本及来源；TypeScript 类型声明本身不进入运行包。`licenses/sources.json` 与对应文件保存 WASM 相关依赖、字体和 Catapult 的许可来源。字体来源仓库的许可证按其声明保留；不得将第三方资源声明为本项目原创。
