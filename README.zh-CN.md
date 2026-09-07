# Embodied Inference Atlas

[English](README.md) | 简体中文

Embodied Inference Atlas 是一个具身模型推理分析工作台。以 Pi0 等视觉语言动作模型（VLA）为例，你可以从图像和提示词输入开始，沿着模型结构和 CPU/GPU 执行过程，查看动作如何生成。

你可以用它比较推理栈的延时、寻找主要耗时、查看热点背后的计算，并理解实现如何复用计算结果或执行计划。

## 可以看什么

- **模型理论**：浏览模型 DAG 和张量形状，通过分步图解理解矩阵乘法、Attention 与归一化计算。
- **性能比较**：选择输入形状、推理栈和精度路径，比较已有实测延时。
- **系统执行**：查看 CPU/GPU 处理流程和代表时间线，打开 Perfetto 深入查看线程、调用与 GPU 活动。
- **执行热点**：在执行 DAG 与已关联的 Kernel 记录之间定位，查看已有的 Nsight Compute 指标。
- **Roofline 与执行优化**：探索计算和访存上限，理解时间投影预计算、CUDA Graph 提交等实现机制。

目前的分析以 Pi0 为主，包含 vla.cpp、FlashRT 和 realtime-vla 三种推理栈的测量，同时提供 Pi0.5、SmolVLA 的模型结构与已有性能数据。

生成的站点在准备好依赖后可离线使用。浏览仓库已有数据无需 GPU 或模型权重。

## 快速开始

准备 Python 3、Node.js **22.12+** 和 npm。在仓库根目录运行：

```bash
npm ci
python3 tools/vendor_perfetto.py
python3 -m tools.build
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

打开 **http://127.0.0.1:8000/**。

准备命令会取得固定版本的 Perfetto 查看器；构建命令检查数据并生成可部署的 `site/` 目录。该目录由构建生成，已加入 Git 忽略列表。如果已有发行包，可用 `python3 tools/vendor_perfetto.py --archive perfetto-ui.zip` 准备查看器，详见 [Perfetto 离线配置](docs/offline-perfetto.md)。

## 开发或添加分析

前端使用 TypeScript、React 与 Vite；Python 工具负责解析报告、校验证据和生成站点。运行 `npm run dev` 即可启动开发服务器，直接查看 `data/` 中的当前数据。完成改动和相关测试后，运行 `python3 -m tools.build` 检查并生成离线页面，再用浏览器审阅。

- [完整分析流程](docs/single-inference-analysis.md)：从固定输入和性能问题出发，完成采集、分析、渲染与审阅。
- [组件目录与接入契约](docs/analysis-components.md)：添加模型、推理栈或硬件时，复用已有页面和组件。
- [方法与数据语义](docs/methodology.md)：了解计时边界、精度、建模流量与比较口径。
- [协作指南](AGENTS.md)：仓库工作流程和验证要求。

浏览器截图工具的用法见 `node tools/render_review.mjs --help`。相关测试可通过 `npm test -- <test-path>` 或 `python3 -m unittest <test-module>` 运行。
