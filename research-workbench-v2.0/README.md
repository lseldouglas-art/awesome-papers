# 科研工作台第二版

人类主导的科研连续性工作台。第二版已进入本地 Demo 体验与修订阶段，包含领域认识、专题建库、研究大纲、正文初稿、全文模板精读与图像工作区。当前验证仍以本地单研究者使用为边界。

本轮基于 Demo v0.25.1 的结果阅读优化见[轻量审查](../docs/research-workbench-v2-results-review-2026-09-12.md)；原281项与优化后282项工程测试通过，生产构建通过。此数字不代表科研结论正确、外部用户效果或期刊认可。

## 核心原则

先看懂结果与意义，再核对依据和边界，最后由研究者决定如何继续。领域理解按综述内容和具体缺口规划材料；文献对照复用同次访问的逐篇记录；图稿从正文、依据和真实输入数据出发。

[结果导向设计](../docs/research-workbench-results-first-design-2026-09-12.md) · [底层逻辑](../docs/research-workbench-foundational-logic.md)

## 安装与运行

需要 Node 22.23.1 或更新的兼容版本。在本目录运行：

```sh
npm ci
npm test
npm run build
npm start
```

没有 `.env` 时默认地址为 `http://127.0.0.1:4318`。可参考 `.env.example` 设置本机端口、数据目录及代理。模型在本机设置页配置；源码不含密钥、现有研究数据库或用户上传材料。未配置模型时，可以查看已有记录及手工编辑图稿，不会具备自动论文理解能力。

已有工作区使用者按当前运行配置接续，不另开进程写入同一数据目录。开发模式用 `npm run dev`；研究后台只绑定本机，个人网站只展示项目，不托管这个数据库服务。

## 实现与边界

- `demo-api/src/kernel.mjs`：研究对象、引用、人工决定和合法状态变化。
- `demo-api/src/research-application.mjs`、`workflows.mjs`：有限任务编排、批次处理与恢复；不是任意动态研究流程。
- `demo-api/src/sqlite-store.mjs`：事务、幂等、不可变版本、恢复与精确导出。
- `shared/research-language.mjs`：共用科研表达与结果导向规则，不追加润色调用。
- `demo-app/src/TopicLibrary.jsx`：综合论证与逐篇研究对照；只读取原访问快照。
- `demo-app/src/TemplateReader.jsx`：全文文字与页码定位；图像像素仍须人工核查。
- `demo-app/src/FigureWorkspace.jsx`：素材、可编辑关系、手工排版与草稿导出。

科学素材的作者、许可与生成来源逐项记录在 `scientific-assets/manifest.json`，不由仓库代码许可替代。图稿不是研究原图，也不代表实验已执行。完整科研质量、多用户托管、图文依赖失效检查与期刊规格自动核验需要后续独立验证。

`v2.0` 表示本地第二代产品目录，`0.25.x` 表示 Demo 包版本；旧公开 `v0.2` 是2026-09-04方向计划，不是已经发布的第二代生产版本。旧 v0.1.4 单独保留。
