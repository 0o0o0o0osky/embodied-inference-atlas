# Embodied Inference Atlas

[English](README.md) | 简体中文

面向视觉语言动作模型（VLA）、世界模型与世界动作模型的离线推理分析工作台，以可追溯证据解释执行行为。

项目维护的是一套小而可重复的流程：解析证据、呈现执行过程、辅助判断瓶颈。
仓库中的规范数据 `data/` 为每个需要分析的场景保留一个代表 trace、稳定性摘要和必要测量；
其他样本、原始报告与审阅产物留在被 Git 忽略的 `.local/` 中。
额外精度和形状下的理论点由公式按需生成，避免保存大量重复快照。
本仓库不下载模型，也不安装推理运行环境。

## 本地运行

准备 Node.js/npm 与 Python 3，然后在仓库根目录执行：

```bash
npm ci
python3 tools/vendor_perfetto.py
npm run typecheck
python3 -m tools.validate --all
python3 -m tools.build
```

Perfetto 查看器只需预先准备一次。若准备环境无法联网，可使用已取得的固定版本发行包：

```bash
python3 tools/vendor_perfetto.py --archive perfetto-ui.zip
```

安装器核验固定的发行包哈希。第三方二进制保留在本地、不进入 Git；构建时复制到离线站点 `site/`。
前端依赖与 Perfetto 就绪后，常规构建不下载资产。

Python 构建器会校验规范 JSON、生成确定性的前端数据、使用锁定依赖执行 Vite 构建，
并以采用相对路径的离线资产替换 `site/`。
仅验证构建、不替换现有站点时使用：

```bash
python3 -m tools.build --check
```

通过只监听本机的 HTTP 服务查看生成的应用：

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

随后打开 `http://127.0.0.1:8000/`。应用运行时不请求互联网资产。
`file://` 直接打开不属于支持的发布方式，因为浏览器可能阻止读取生成的 JSON。
完全离线使用需要提前准备好依赖，而不是依赖浏览器曾经联网留下的缓存。

按改动范围运行相关测试：

```bash
npm test -- <test-path>
python3 -m unittest <test-module>
```

## 导入与精简证据

导入器读取本机报告，将脱敏后的候选数据写入 `.local/staging/`。
不同导入器的输入参数不同，应先查询对应的 `--help`，例如：

```bash
python3 -m extractors.fixed_case --help
python3 -m extractors.fixed_case_ncu --help
```

固定场景导入使用结果、运行模板及可选的 Nsys SQLite；NCU 导入还需独立回放报告与关联证据。
具体源文件路径、完整 Kernel 符号、输入哈希和原始样本留在本机。
发布前需核验脱敏与引用关系；形状和 DAG 归属不能仅根据 Kernel 名称或 launch 网格推断。

先查看提升差异，再写入规范数据：

```bash
python3 -m tools.promote .local/staging/<bundle>.json
python3 -m tools.promote .local/staging/<bundle>.json --apply
```

提升工具用于导入已审阅证据。若已有数据积累了重复或被替代的采集，用归档工具精简：

```bash
python3 -m tools.archive_analysis
python3 -m tools.archive_analysis --apply
```

默认命令先校验并预览保留范围和体积变化；`--apply` 在 `.local/archive/` 备份原始文件及清单后，
写入精简数据。保留一个经检查的代表 trace 和小型统计摘要，其余采集可在本机追溯。
总体延时中位数、代表 trace 内的调用时间与 NCU 独立回放指标各有自己的采集身份，不混为同一次执行。

## 工作流与组件

- [单次推理分析完整流程](docs/single-inference-analysis.md)：环境能力、稳态采集、代表选择、Nsys/NCU、证据导入、agent 分析与渲染。
- [组件目录与页面接入契约](docs/analysis-components.md)：共享组件、模板边界，以及新增模型、推理栈或硬件需要填写的结构化内容。
- [方法与数据语义](docs/methodology.md)：计时、精度、流量和比较口径。
- [仓库协作规则](AGENTS.md)：工作范围、证据保留与验证要求。

使用共享浏览器脚本检查实际页面：

```bash
node tools/render_review.mjs --help
```

脚本使用已安装的 Playwright 与 Chromium，不自动下载浏览器或依赖。
它检查页面仅加载本地资产，并把截图和报告保存到 `.local/`。
截图用于检查当前输入、所选对象和页面布局；选择与返回行为还需要在浏览器中实际核验。
