# 科研工作台 v2.0 本机 API

当前状态只看 [当前断点](../断点续作.md)，安装与数据恢复见 [Demo 说明](../demo-app/README.md)。在 v2.0 根目录执行 `npm ci`、`npm test`、`npm run build`、`npm start`。

## 服务与数据边界

仅回环地址；校验 Host、Origin、Sec-Fetch-Site。JSON 请求体防护为 1 MiB，与材料总数或模型上下文额度不同。密钥独立保存，接收方变更必须明确配置新密钥。

SQLite 是当前主存储；旧 JSON 保留并无损迁移。旧 LocalStore 仅作兼容与迁移基准测试，不是另一套活动产品。业务修改、不可变版本、事件与幂等回执同事务保存；备份和故障恢复见 SqliteStore 及其测试。

## 当前接口

| 路径 | 用途 |
|---|---|
| GET/POST /api/projects | 列表、创建 |
| GET /api/projects/:id | 完整工作区及复合研究状态 |
| GET /api/projects/:id/research-state | 当前问题、探索、材料、成果、取舍与影响 |
| GET /api/projects/:id/artifacts[/:artifactId] | 成果列表、具体成果 |
| POST /api/projects/:id/commands/:command | 有版本前提的领域修改与个人记录 |
| POST /api/projects/:id/research-tasks | 接受本步任务并返回持久 taskId |
| GET /api/projects/:id/research-tasks/:taskId | 运行状态、尝试与覆盖 |
| POST /api/projects/:id/research-tasks/:taskId/stop | 幂等停止，保留真实调用记录 |
| POST /api/projects/:id/research-tasks/:taskId/revalidate | 明确触发本地恢复，复用原响应而不调用模型 |
| GET /api/projects/:id/artifacts/:artifactId/revisions/:revisionId[/export] | 指定版本及精确导出 |

写命令使用 `X-Request-Id`；冲突返回明确错误，重复同一请求返回原回执。`save-notes` 只能写四项个人记录，旧任意正文保存入口要求升级客户端。

研究命令含 create-question、revise-question、decide-question、compose-brief、resolve-impact、set-position。研究状态改变要求 baseStateVersion，问题定位到 itemId 与具体版本。自然表达仅在明确动作及明确目标时确定性映射，疑问、假设与否定不会变成采用。

`attach-existing-materials` 只把同课题已有访问快照关联到指定成果；先检查全部身份和草稿版本，再一次提交。重复关联不增加草稿版本，不复制或改写访问文本。

本地恢复创建独立任务、尝试及回执；旧失败任务、原始响应和计费用量不变。默认仅处理外层格式标记；页面明确触发的 `extractLeadingJson: true` 可提取一个完整首部对象，附加说明单独保存，不写入成果。正文损坏、第二个结构对象、缺材料或非法引用仍拒绝。恢复结果继承旧输入版本；已有新草稿时作为待查看结果保存，不能静默替换。

## 任务与材料契约

- clarify、retrieve、landscape、ask、revise 保留既有能力；deepen、compare、brief 增加深入、候选比较和课题简报。用户可以停在任一步，未决可生成简报。
- retrieve 检索后停止等待阅读；landscape 使用原 query、reuseSearchId 和显式 accessIds 分析已存材料，不重新检索或并入取消选择的材料。
- 当前输入使用所选成果、实际材料、当时的问题／取舍、个人认识及相关讨论；不持续拼接所有历史回答。
- 相同 PMID／文本复用来源；不同访问快照保留。引用以稳定 R 编号和无损 P 片段定位，生成正文不拥有科学采纳权限。
- 七维领域理解与逐篇五字段由 shared/domain-landscape.mjs 定义。直接报告与有依据的综合解释都须有实际引用，unknown 与 suggestion 清楚表达边界。
- 服务商明确输入额度才触发完整分批，所有材料、片段覆盖与成功提取均保留。最后综合无法容纳全部提取也会明确失败，不丢掉尾部文章。
- retryTaskId 只可指向本项目未完成的同一任务；研究输入变更须新任务。重试由用户触发，已完成提取可复用；结果未知的计费请求不自动再发。
- 新运行记录提示版本、输入指纹、任务尝试、工具、调用、用量和未知费用。原始生成响应标为未验证，只有通过结构、覆盖及来源校验才成为研究成果。

BigModel GLM-5.3-Flash 使用已验证的 provider profile、流式接收和结构化 JSON 输出；实际选项与等待期限记入 provenance。其他服务不注入未验证的供应商参数。来源：[BigModel 结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)。这仍不能替代科学判断的人工核查。

程序测试使用工程夹具。公开材料真实体验的调用、失败与边界另记；不把本机测试通过称为多人部署或科研结论成立。
