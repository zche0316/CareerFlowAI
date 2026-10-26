# Integration note — 26 October 2026

This document preserves the desktop prototype preparation record from 23 October. It is not a current assessment of the group main branch. The integration onto main commit 110a309 preserves the team's later Profile Builder, career-analysis feedback, quality tests and salary-negotiation work. See STAGE2_INTEGRATION_20261026.md for checks run on the merged version. Historical limitations in this document must be rechecked rather than treated as current defects.

# Week 13 交付审查（2026-10-23）

结论：源码候选包已通过独立解压、安装、数据库初始化、测试、构建及服务启动；尚未满足最终提交与小组验收全部条件。没有上传 Canvas，也没有宣称完成现场演示。

## 已取得的证据

- 从源码候选 ZIP 解压到全新目录，没有沿用 node_modules、dist、数据库或 .env。
- 从 .env.example 建立无密钥配置；使用本机已准备的 npm 缓存，npm ci --offline 成功安装 328 个依赖。
- 独立数据库端口 55442、应用端口 8788，未占用原应用数据库。
- npm run verify:local：类型检查、6 项原始测试、38 项 Vitest 测试、生产构建通过，共 44 项。
- npm run start:local：新数据库迁移成功，/api/health 返回 status=ok、mode=fixture，列出五个 Agent。
- 以上证明本机源码重建能力，不等于从 Canvas 下载验证、第二台电脑部署或真实 AI 调用。完整浏览器人工验收仍需小组复核。
- 核验的首个候选包 SHA256：5d702480594a92eecc1d063705fd54e3638245dff104ecb555bdbf1b5411e0cf。后续 r2 包仅补充文档；交付时以包外校验记录为准。

## 展示前必须补齐

| 优先级 | 项目 | 验收证据 | 建议负责角色 |
|---|---|---|---|
| P0 | 小组项目真实 AI 调用配置与验证 | 使用合法服务凭据，记录模型、成功响应、结构化结果与失败路径；不能把 fixture 当成真实推理 | AI/后端负责人及各 Agent 作者 |
| P0 | 冻结源码并完成 Canvas 上传、重新下载、部署 | 下载包哈希、命令记录、数据库初始化、完整工作流；不是运行原工作目录 | 发布负责人及另一位组员 |
| P0 | 五人贡献声明 | 姓名/SID/真实证据齐全，四个评分维度每行五人百分比合计 100%，全员确认 | 全组 |
| P1 | UC1 与 Stage 1 的一致性 | Stage 1 正常流程含 LLM 整理与追问，当前手工表单更接近备用路径；补齐或明确解释设计调整 | R1 负责人 |
| P1 | R3 设计与实现差异 | 原时序含 LLM 解释；当前确定性提取、加权评分与 TF-IDF。说明调整理由及限制，或补齐经验证的模型分析 | Member 3 |
| P1 | 独立组员复核与现场讲解 | 第二位成员从候选包启动并走完 UC1–UC5，检查用户批准、失败重试、选中职位传递和重启持久化 | 全组交叉复核 |
| P1 | Agile 过程证据 | 实际 Sprint 目标、故事验收、review 反馈与 retro 改进，链接到提交/测试/演示；不要补造或倒填会议 | Scrum/组长与全组 |

小组 .env 当前未配置 AI 和 Adzuna 凭据。旧原型曾调用 Groq，不代表本仓库已经联调。不要复制其他项目密钥。

Adzuna 凭据尚未申请属于可选增强，不应阻塞现有公开公司职位源的验收。真实职位源仍需在演示当天核对可访问性、来源、获取时间和官方链接；不能保证每条职位始终开放。SEEK/Indeed 自动投递不是本次现场部署的必要条件，也不能宣称已实现。

## 四个评分维度如何演示

| 评分项 | 展示内容 | 当前限制与补充 |
|---|---|---|
| Stage 1 实现（7） | 批准 profile → career analysis → 真实/明确标注的样例职位 → 匹配选择 → 简历批准 → 面试反馈 | 核对 UC1 LLM 正常路径、R3 时序差异；不要把五个页面等同五个用例验收 |
| AI Agent（4） | 输入/上下文、工具调用、决策、结构化输出、失败处理、人工批准；展示 Activity 证据 | 当前 clean-room 使用 fixture，仍需真实 provider 联调和输出质量审查 |
| Agile（4） | Jira Sprint、故事验收、团队 review/retro、反馈后修改 | 2026-10-23 读取：CFS-41/42 为 Review & Test；CFS-43–48 为 To Do。状态不能证明会议未举行或已验收，应补链接 |
| Advanced Technologies（5） | React/TypeScript UI、LangGraph 持久化编排、Prisma/Postgres、外部职位适配器的具体价值 | TF-IDF 不是预训练 embeddings；不要把技术名称数量当质量。远程 CI、Docker 路径本次未实测 |

便携 PGlite 模式共享单连接，只运行一个应用进程；不要在同一数据库运行测试与应用。它适合本地演示，不是生产并发方案。Docker/云部署不是老师这封通知的强制要求。

R3 当前评分为技能45%、经验15%、教育10%、偏好15%、TF-IDF15%，属于原型启发式，不能解释为录用概率。未给出的经验/薪资信息应保持未知；匹配解释需区分已知证据与推测。

## 建议冻结节奏（计划，不是已完成记录）

- 10月23–26日：完成 AI 配置、设计差异说明、关键错误处理及真实数据验证。
- 10月27–28日：另一名组员独立部署，交叉完成全链路验收及 review/retro。
- 10月29–30日：冻结候选版本，核对贡献声明、README、包内容和密钥排除。
- 10月31日：提前上传 Canvas，再下载到新目录重新部署。
- 原评分 PDF 标注 2026年11月1日 23:59，未明确时区；以 Canvas 实际截止时间/时区为准。

操作步骤见 WEEK13_DEPLOYMENT.md；面试准备见 STAGE1_INTERVIEW_MEMBER3.md。源码打包使用 npm run package:source；包含相关未跟踪源码，排除环境密钥、依赖、构建产物和本地数据库，但仍需人工检查内容。
