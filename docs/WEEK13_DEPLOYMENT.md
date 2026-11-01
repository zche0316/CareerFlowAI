# Week 13 Docker deployment playbook

演示当天必须从 Canvas 下载已提交源码，在现场从该源码构建并启动。这个流程使用本机 Docker；网页、API、PostgreSQL 和 LangGraph 都在本机容器运行。AI、招聘查询及可选 S3 需要网络。操作与结果记录在 Jira，不在此文档维护提交进度。

## 1. 选定要提交的源码

推荐以 GitHub `main` 上已验证的固定提交为准，在干净副本里运行本地打包工具。这样既有 Git 提交记录，又有源码筛选和逐文件 SHA-256 清单。

```sh
git clone --branch main --single-branch https://github.com/zche0316/CareerFlowAI.git CareerFlowAI-submit
cd CareerFlowAI-submit
git rev-parse HEAD
python3 scripts/package-source.py
```

记录输出的 commit、ZIP 路径和 SHA-256。打包后若修改源码，生成新包并重新演练。不要把正在开发的脏目录直接压缩成最终提交包。GitHub Download ZIP 也属于源码，但不包含本工具生成的交付清单；本流程优先使用上面的干净副本打包方式。

提交 ZIP 应包含源码、锁文件、Prisma migrations、Dockerfile、`compose.yaml`、可选 `compose.aws.yaml`、`infra/`、必要文档及 `.env.example`。不包含 `.env`、真实密钥、AWS 登录缓存、个人简历、已有数据库、node_modules、dist、测试输出或 Docker 镜像。`.env.example` 是空密钥配置模板，可以提交。

## 2. 提前准备演示电脑

- 安装并启动 Docker Desktop，确认 `docker version` 和 `docker compose version` 可用。
- 准备模型/招聘服务的私有配置，独立保管在提交包之外。S3 演示另需宿主机 AWS CLI 和有效登录会话。
- 预先缓存 Docker 基础镜像和构建依赖，并验证学校网络/热点。现场仍须对 Canvas 下载的源码执行构建，不能仅运行旧镜像或旧目录来代替。
- Docker 构建通常需要访问 Docker Registry、Debian 软件源和 npm。已有完整缓存可能减少网络依赖，但不要假定一台新电脑可以完全离线构建。
- 现场默认使用 8787/55432；停止本项目旧实例或在私有 `.env` 设置 `APP_PORT`/`DB_PORT`。不要删除原有数据库来腾端口。

## 3. 从 ZIP 做一次干净演练

先解压候选 ZIP 到新目录，进入其中的 `CareerFlowAI` 文件夹。使用新的 Compose project 名可以隔离测试数据卷。

```sh
cp .env.example .env
# 编辑私有 .env：选择演示模式并填写必要配置，不把该文件重新打入源码包。
docker compose -p careerflow-rehearsal up -d --build --wait
docker compose -p careerflow-rehearsal ps
```

打开 http://localhost:8787，创建虚构演示账号。镜像构建会执行锁定依赖安装、Prisma Client 生成和前端构建；启动会迁移 PostgreSQL 数据库。无需在宿主机额外安装 Node.js/npm 或 PostgreSQL。

验证：注册/登录 → 资料草稿与批准 → 职业分析 → 岗位选择 → 简历审核与批准 → PDF/DOCX 下载 → 面试回答与反馈。刷新页面并重启容器，确认已批准内容仍存在。按 [English user journey](english-user-journey.md) 操作；真实模型问题和真实岗位可能变化，不应背诵固定输出。

```sh
docker compose -p careerflow-rehearsal restart app
docker compose -p careerflow-rehearsal down
```

`down` 保留数据卷，`down -v` 会删除该 project 的数据库。新电脑/新 project 不包含旧电脑上的账号或已批准简历；不要把旧数据库或个人资料打进源码包。

## 4. 明确两种演示配置

可重复验证：在私有 `.env` 设置 `PROVIDER_MODE=fixture` 和 `JOB_SOURCE=fixtures`，明确说明是虚构资料和确定性输出，不能当成真实 AI 调用证据。

真实演示：设置 `PROVIDER_MODE=openai`，填写所选模型的私有配置。原生 OpenAI 使用 `OPENAI_NATIVE_*`，兼容服务使用 `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_MODEL`。Compose 会传入这些设置。招聘默认 `JOB_SOURCE=auto`；Tavily/Adzuna 仅在配置有效时使用，不需要为每次演示更换 provider。

更改 `.env` 后重新执行 `docker compose ... up -d` 以更新容器配置；仅 `restart` 不会重新读取环境设置。服务失败应展示实际错误及保留的数据，另建明确标注的 fixture 演示，不把失败的 live mission 静默替换为样例结果。

## 5. 可选：在 Docker 中使用已有 S3 桶

S3 是辅助云存储，可以复用预先创建的私有桶；无需现场重新创建桶、重新部署 AWS infrastructure 或公开桶。按课程额外要求判断是否允许云端辅助服务；如果要求完全离线，关闭该功能。

在你自己的 macOS 演示电脑上，私有 `.env` 中一次性设置（桶名沿用已创建的实际名称）：

```dotenv
S3_BACKUP_BUCKET=<existing-bucket-name>
AWS_REGION=ap-southeast-2
AWS_PROFILE=careerflow
COMPOSE_FILE=compose.yaml:compose.aws-profile.yaml
```

已有有效的 careerflow 浏览器登录时，直接执行普通启动命令：

```sh
docker compose -p careerflow-demo up -d --build --wait
```

无需 Python helper 或 PATH 前缀。可选 override 只读挂载宿主机 AWS config、读写挂载 login cache，让 SDK 使用并刷新短期会话；不挂载静态 credentials 文件，凭证不进入源码 ZIP 或镜像。仅在自己的可信电脑启用，因为应用可以访问挂载的登录缓存。完整会话过期后仍需重新浏览器登录。路径默认使用宿主机 HOME，可通过 AWS_HOST_CONFIG / AWS_HOST_LOGIN_CACHE 指定绝对路径。冒号分隔的 COMPOSE_FILE 适用于 macOS/Linux。

旧 scripts/docker-aws-session.py 与 compose.aws.yaml 保留为替代方案，不要同时选择两个 AWS override。未演示 S3 时，不设置 COMPOSE_FILE 并将 S3_BACKUP_BUCKET 留空。

在 **My documents** 中选择已批准简历，点击 **Back up approved PDF to cloud**，查看成功提示、展开备份列表并下载一次。备份只在用户主动操作时上传。S3 不可用时，本地 PDF/DOCX 下载和主流程仍可用。日常使用应配置仅能访问指定桶的应用身份；root 登录不是最小权限配置。桶、对象版本及访问日志会继续产生相应存储和请求费用。

不展示 AWS 时，保持 `S3_BACKUP_BUCKET` 为空，只运行标准 `compose.yaml`。

## 6. Canvas 往返核对与现场部署

上传前确认候选 ZIP 的干净部署通过。上传后从 Canvas 再下载同一个 ZIP，核对 SHA-256，并从新目录再执行上述构建/启动流程。只有这一步才能证明 Canvas 上的包就是演练过的包。

现场再次从 Canvas 下载，解压到新目录，独立恢复私有 `.env`，然后执行 `docker compose up -d --build --wait`。S3 登录和私有 API 配置留在演示电脑上，不交给源码 ZIP。保留下载记录、包校验值、构建/启动结果和已披露的 fixture/live 边界到对应 Jira 任务；实际上传和下载由提交人完成。


## 空数据库现场演示

最终演示需要空库时，不要复用开发时的 `careerflow-demo` project。解压 Canvas 包、恢复私有 `.env` 后，停止旧实例以释放端口，再用一个尚未使用过的新名字：

```sh
docker compose -p careerflow-demo stop
docker compose -p careerflow-canvas-final up -d --build --wait
```

第一次使用这个名字时，Compose 会创建独立空数据库，现场注册虚构账号后开始旅程。不要提前用同一个名字演练；若它已有数据，换成 `careerflow-canvas-final-2` 等新名字。仅重新下载或解压 ZIP 不会清空已有数据卷。旧项目数据保留。S3 桶可以复用，但新账号的备份列表按新用户身份隔离。
