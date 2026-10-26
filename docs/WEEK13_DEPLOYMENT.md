# Week 13 Source Deployment Runbook

依据老师最新通知：可以使用自己的电脑、提前装工具和依赖、使用热点，并有额外部署时间；但演示必须从 Canvas 下载的已提交源码现场构建/部署。以下是准备和演练步骤，不是已经完成 Canvas 上传/下载的证明。

## 提交前冻结候选版本

1. 组员 review 全部本地修改和新增文件，记录实际 commit/PR。当前工作区包含大量未提交内容，不能仅 `git archive HEAD`，否则新模块可能丢失。
2. 在小组仓库运行 `npm run package:source`。打包脚本会包含约定源码目录下的相关未跟踪文件，并生成逐文件 SHA-256 清单。发布前人工检查包内容，不把自动打包当作安全审查。
3. 候选 ZIP 应包含 `CareerFlowAI/` 顶层目录、package/lock、apps、packages、prisma migrations、scripts、tests、docs、`.env.example`。不含 `.env`、`.git`、`.runtime`、旧数据库、node_modules、dist、个人简历、测试截图/日志或私钥文件。
4. 用该 ZIP 在新目录演练安装。小组确认后上传 Canvas，再下载一份，核对 ZIP SHA-256 与内容清单，重新走部署流程。这里不代替实际 Canvas 操作。
5. 截止日期以 Canvas 为准。已保存的评分文件写 2026-11-01 23:59，但该 PDF 未写时区；现场务必确认 Canvas 显示的课程时区和实际截止时间，不自行按北京时间换算。

## 可以提前准备

- Node.js 22.12+；建议与当前验证环境一致的 Node 24 和 npm。终端确认 `node -v`、`npm -v`。
- VS Code 和熟悉的浏览器。源码部署不要求必须 Docker；项目内开发数据库避免现场临时安装系统 PostgreSQL。
- 按锁文件预热 npm 缓存，保存缓存位置；可以先安装依赖，但不能用旧目录/旧编译产物冒充从提交源码构建。
- 准备热点并测试学校网络、模型 endpoint、招聘源域名。带好电源和热点设备。
- 将模型/招聘凭据独立保存在安全的本机配置位置；现场手动填入新下载目录的 `.env`，不上传 ZIP、Canvas、Jira，不在投影屏上展示密钥。
- 事先核对端口 8787 和 55432，不要杀未知进程；停掉本项目旧实例后再启动。

## 现场标准流程

从 Canvas 下载并解压源码，进入**本次新目录**。不要打开旧的 8791 原型。

```sh
node -v
npm -v
cp .env.example .env
npm ci
npm run start:local
```

先复制 `.env.example` 再安装：Prisma 的 postinstall/generate 需要读取配置。已有 `.env` 时不要重复覆盖。启动流程会创建 `.runtime/pglite`、部署 Prisma migrations、从源码构建 Vite 客户端并启动原有 API/后台 worker。打开 http://localhost:8787 。VS Code F5 的 `CareerFlow: database + app` 等价于 `start:local`，但首次依赖安装仍需完成。

若现场没有 npm 网络但缓存已充分准备，可在该新目录运行 `npm ci --offline --cache /path/to/prepared-cache`。仅当锁文件对应的包和平台依赖都已缓存才可行；提前验证，不能临场假定成功。真实招聘和远程 AI 仍需要网络。

## 配置两个独立的展示路径

### 可重复的离线主链

`.env`：`PROVIDER_MODE=fixture`，`JOB_SOURCE=fixtures`。使用明确标注的虚构资料和样例职位，展示 profile 审批、UC2、排名、选岗、简历精确版本审批、面试回答和反馈。目的是证明系统连通与恢复能力，**不宣称这是实际模型调用或真实岗位**。

### 真实 AI 与真实岗位

`.env`：`PROVIDER_MODE=openai`，填写本组当前 adapter 支持的 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`。Groq 的 base URL 可使用兼容配置，但必须用当前小组版本实测工具调用和 structured output；旧原型的成功日志不能替代当前版本验收。配置后重启，在新 mission/activity 中核对实际 mode、工具交互、调用次数和输出质量。

招聘源可选 `JOB_SOURCE=employers`（公开公司 API）或 `adzuna`（需独立 app ID/key）。空结果/源失败正常演示恢复；不要偷偷切回 fixtures。Adzuna 尚未申请凭据时，它不是现场必需路径，更不是已经验收的真实来源。

如果某模型/招聘服务故障：展示清楚的错误和保留的已批准数据，说明依赖失败；再明确新建一个离线演示 mission。当前版本不会把失败 live mission 静默变成成功 AI 输出。

## 建议演示脚本

顺序按实际时长由组长分配，以下不代表老师规定的时长。

1. 指出新下载源码目录、锁文件、构建与健康检查成功；区分系统/API/招聘源。
2. 01：虚构候选人的草稿、验证、授权、批准；说明未批准内容不能被下游当成证据。
3. 02：展示 strengths、gaps、career directions/actions 与 evidence IDs。
4. 03：检索澳洲岗位，展示来源/时间/缺失薪资、分数和局限；复查并选择目标。解释评分不是录用概率。
5. 04：用选中岗位和批准事实生成草稿；展示不支持的事实不会插入，明确批准才保存。
6. 05：回答一题并保存，结束练习展示反馈；练习答案不自动成为 career profile 的事实。
7. 一个真实失败/恢复：比如无结果或用户取消/重试；展示资料/已批准简历仍保留。
8. Activity 展示可观察的工具调用和状态，不宣称展示模型隐藏思考。说明哪些是 real API、哪些是 fixture。
9. 展示真实 Jira review/feedback/retrospective 和对应代码改动；展示技术选型的理由与限制。
10. 重启应用并确认任务/批准文档仍存在。无需把自动投递、邮件、更多招聘源临时塞进核心 demo。

## 交付闸门

- [ ] 全部 UC1–UC5 的需求到操作和证据映射由每位负责人核对。
- [ ] 当前小组版本的真实 AI 工具/结构化输出与质量验收通过，或清楚标记风险并准备已披露演示方案。
- [ ] 从最终上传包下载、干净目录安装、构建、启动并完成浏览器主链；记录机器、工具版本、耗时和 ZIP hash。
- [ ] 另一位组员独立重做并记录发现的问题和修复。
- [ ] 全组 contribution statement：5 人姓名/SID；每项评分行合计 100%，由全组确认而非按 Jira assignee 自动分配。
- [ ] 实际 Sprint review/retro/用户反馈及处理记录，不能预填会议和验收。
- [ ] Canvas 上传和重新下载核对，确认正确 ZIP 与贡献说明。

源码包能启动只是交付条件之一；测试通过不等于评分类别自动满分。
