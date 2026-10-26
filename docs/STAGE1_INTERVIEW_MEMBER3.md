# Stage 1 Interview Preparation for Aitong Lyu

准备日期：2026-10-23（中国时间）。按老师最新通知准备 Q&A，不重新做报告演讲。重点材料是桌面 `5620/Mon_10-12_Group_2_Project_Stage_1.pdf`：UC3 在实际 PDF 第 22–26 页，类图在第 39 页。下面的英文答案是练习用的自拟表达，不是报告原句，也不是老师公布的题库。

## 先练这五件事

1. 不看稿，用 30 秒说明 UC3 的目标、输入、输出和三个异常。
2. 指着第 24 页，走一遍主流程；再分别走 profile/source/no-matches 分支。
3. 指着第 25 页，说清七个参与者及 alt、loop、opt。
4. 指着第 26 页，解释状态、事件与 guard，并指出自己会改进的符号和结束路径。
5. 指着第 39 页，说清 Agent 继承、业务对象、服务接口、关联端的 multiplicity；能解释图中遗留的 ApplicationManagerAgent。

回答顺序：先直接回答问题 → 指向本项目具体元素 → 解释原因/取舍 → 必要时指出限制。通常 20–45 秒；追问时再展开。不要把 Stage 2 后来增加的 API、数据库或分数公式说成 Stage 1 原文已规定的内容。

## 个人部分 高频问答

### 1 What did you contribute

**答题要点：**R3 Job Matching、UC3 Search and Match Jobs、对应 Activity / Sequence / State Machine，以及 group class model 的实际贡献。不要用工具生成的全部代码推断自己的独立贡献。

**English:** My individual work covers R3 and UC3, Search and Match Jobs, together with its activity, sequence and state-machine models. I also contributed to the class model. I can explain how approved profile data, job sources and matching responsibilities fit together, and which parts of the implementation I personally reviewed and developed.

### 2 What problem does UC3 solve

把用户职业资料与支持的岗位信息比较，给出可解释排名，帮助用户决定下一步。不是保证被录用，也不是自动替用户提交申请。

**English:** UC3 helps a job seeker identify suitable opportunities using their career profile. Its output is a ranked list with explanations of matches, gaps and limitations. The user remains responsible for choosing a target job.

### 3 What are its precondition and success condition

第 22 页：有效 career profile，且 supported source 有岗位信息。成功条件是展示可解释的排名及 guiding link。第 23 页第 11 步是用户“may select”，选岗不应被表述成推荐列表产生的唯一成功条件。实现中进一步加入 approved version 和 consent 是 Stage 2 的具体化。

**English:** The use case assumes a valid career profile and an available supported job source. Success means presenting ranked, explainable opportunities with a guiding link. Target selection is an optional user decision after reviewing the recommendations.

### 4 Walk through the main scenario

**English:** The user requests recommendations. The agent loads the profile, retrieves jobs and analyses requirements. It compares each job with the profile, calculates suitability and generates explanations. The system ranks and presents the results, and the user may select a target for later activities.

追问：分析提取的是岗位需求；比较阶段用的是候选人已有证据，不能把岗位写着的技能变成候选人的技能。

### 5 What are the three extension scenarios

2a profile unavailable：提示建立/更新资料后结束。3a source unavailable：清楚报错，允许稍后重试。8a no suitable jobs：说明无匹配，建议调整偏好或扩大范围。无结果是有效查询结果，与 API 故障不同。

**English:** Missing profile, unavailable job source, and no suitable jobs are separate outcomes. They need different recovery actions: update the profile, retry the source, or broaden the search criteria.

### 6 Why do you need three behaviour diagrams

**English:** The activity diagram explains the flow and alternative paths. The sequence diagram allocates messages and responsibilities across participants over time. The state machine constrains the lifecycle of the matching process. They are complementary views of the same requirement, not three copies of one flowchart.

### 7 Explain the activity diagram on page 24

指 requests → retrieves profile → Valid profile? → retrieves jobs → source available? → analyse → compare → score → explain → rank → suitable jobs? → present → review → optional select。菱形是 decision；本图没有表达真正并行的 fork/join，不要把多个错误箭头说成并发。若进一步改善，可用 swimlanes 标出 User / Agent / Data Service 的职责。

### 8 Explain the sequence participants on page 25

Job Seeker → CareerFlow UI → Agent Orchestrator → Job Matching Agent。Matching Agent 向 Career Data Service 读取资料，向 Job Source 取职位，并与 LLM Service 交换解释/需求分析数据。Data Service 保存 selected target，为后续用例共享。不是 UI 直接调用数据库或把每个 agent 都做成一个浏览器页。

**English:** The UI receives the request, the orchestrator delegates it, and the matching agent coordinates the domain task. Data and external services are separate lifelines so that responsibilities and dependencies remain visible.

### 9 What do alt loop and opt mean in your sequence diagram

**English:** Alt expresses mutually exclusive guarded alternatives, such as a missing profile. Loop repeats the analysis for relevant jobs. Opt represents optional behaviour, specifically selecting a target job after the recommendations are shown.

注意：同步调用表示调用方等待结果；返回消息通常用虚线。异步请求不代表随意省略失败处理。

### 10 What object does the state machine describe

这里建模的是一次 job-matching process 的生命周期，不是用户、单个岗位或整套系统的全部状态。Created → Profile Loaded → Jobs Retrieved → Analysing → Scored → Ranked → Presented → Target Job Selected → Completed；另有 profile、source、confidence、no-match 异常路径。

**English:** It describes one matching process instance. States capture meaningful lifecycle conditions, while events and guards determine which transitions are allowed.

### 11 What is a guard and how is it different from an event

**English:** An event triggers consideration of a transition, while a guard is a Boolean condition that must be true for it to occur. For example, a retrieval response is an event and “jobs are available” is a guard on the successful path.

规范形式可写 `event [guard] / effect`。状态不是函数调用，动作不是必须长时间停留的状态。

### 12 Why do you have Low Confidence

输入不完整或解释可信度不足时，不应把分数当确定事实。图中 Low Confidence 是异常结果，不等于“分低所以申请一定失败”。Stage 2 目前用规则提取和限制说明，尚不能把 confidence 当作已校准概率。

### 13 Can you explain the score

Stage 1 规定比较技能、经验、资格和偏好，但没有要求面试时背 Stage 2 公式。如果被问实现：当前规则采用技能 45%、经验 15%、教育 10%、偏好 15%、TF-IDF 文本相似度 15%。这些是实现层启发式权重，需验证、可调整，不是录用概率。对未知信息应保留 unknown，不能凭空给出真实资历。

**English:** Suitability is an explainable heuristic, not a calibrated probability of hiring. The design specifies comparison dimensions; the prototype makes those dimensions concrete with reproducible weights and explicit limitations.

### 14 Is TF IDF an embedding model

**English:** No. Our current baseline measures lexical overlap using TF-IDF. It is not a pretrained semantic embedding model. A future semantic model could improve synonym handling, but would require separate evaluation and a fallback strategy.

### 15 Why is an LLM not responsible for everything

**English:** An LLM can help interpret descriptions or propose explanations, but deterministic services are useful for validation, ranking, data ownership and approval. Candidate facts must remain grounded in approved evidence, and external text is treated as untrusted data.

当前实现的 R3 没有真实 LLM 调用；不要声称“所有排名由 Groq 算出”。旧原型的三角色 Groq 记录也不是当前小组版本的完整 live AI 验收。

### 16 What does the class diagram contribute

它提供设计时的类型和职责：AgentOrchestrator / Agent / ContextManager / SharedContext；CareerProfile、JobPosting、Resume 等领域对象；JobRepositoryGateway、LLMGateway、Tool 等边界。行为图里的职责应能在结构模型中找到承担者。

**English:** The class model defines responsibilities and dependencies at design time. It separates coordination, specialist behaviour, domain information and service interfaces so that the behavioural interactions have a structural basis.

### 17 Generalization versus association versus dependency

**English:** Generalization is an “is-a” relationship, such as a specialist agent extending an abstract Agent. An association represents a structural connection between instances. A dependency means one element uses another; it does not imply inheritance or ownership.

空心三角指向更一般类型；虚线 realization 的空心三角指向接口，不能倒读。

### 18 Aggregation versus composition

**English:** Aggregation models a weak whole–part relationship. Composition expresses strong ownership of a part, normally with its lifecycle tied to its composite. Neither relationship means inheritance.

本图要结合具体图形说，不要只背术语。外部招聘职位不是平台创建或销毁的对象；如果 SharedContext 对 JobPosting 使用 composition，合理含义只能是平台拥有“本地职位快照”，不能说它拥有并删除招聘网站上的真实岗位。

### 19 How do multiplicities work

**English:** Multiplicity is read at the association end: it constrains how many instances at that end may relate to one instance at the other end. A user may have no saved job applications, so zero can be a valid lower bound. Versioned profiles in the implementation refine a conceptual current profile into multiple historical snapshots.

练习时逐一指出原图的 `1`、`0..*`、`0..1`，不要在图上没有的地方编数字。

### 20 Why use service interfaces

**English:** The matching logic should depend on a job-source abstraction rather than one vendor's response format. An adapter translates external data into our domain representation. This reduces coupling and lets us test failures or change providers without rewriting the core comparison logic.

接口不是数据库表；同一个 UML class 不要求实现为单独一个微服务或文件。

### 21 What is the difference between class and object diagrams

**English:** A class diagram describes classifiers and allowed relationships. An object diagram shows a snapshot of specific instances and links at a particular time. It should instantiate the class model rather than introduce unrelated runtime types.

Structured class/ports 讲内部 parts、角色和连接；sequence 讲交互时间顺序，不要混为同一图。

### 22 Where is human control

**English:** Recommendations are advisory. The user reviews candidate facts, chooses a target and approves an exact resume version. Selecting a job is not an application submission. These decisions prevent unsupported facts or unintended external actions.

### 23 How do you keep the models consistent

**English:** I trace R3 to UC3, then to actions, messages, lifecycle states and structural responsibilities. I check that every alternative in the use case has an appropriate behavioural path, and that named services and saved information agree across views.

### 24 What would you improve in your submitted models

这是高价值回答，不要坚持图完全正确：

- 第 39 页仍有 ApplicationManagerAgent，而五角色主线包括 Career Coach。说明这是版本同步残留，提出统一命名/职责，Application tracking 保留为 optional service，不临时声称它就是 Career Coach。
- 当前 activity 的 Start/End 使用椭圆、state 图初始/终止符号也非标准画法；严格 UML 应使用正确初始和终止伪状态/节点，并给 guard 清楚命名。
- UC3 允许只看推荐、不选择目标，但 state 图的正常 Completed 路径主要经选岗；应补明确的“不选择而结束”或取消路径，并区分推荐成功和后续任务等待选岗。
- 如果 orchestration 聚合关系的菱形落在错误一端，应承认需要修正 whole/part 端，不硬背成正确图。
- 类图中的 User 示例操作和 JobApplication 占位操作应进一步具体化；implementation 要记录这些 refinement。

**English:** I would improve cross-view consistency and notation. In particular, the class model contains an older application-management role that needs alignment with the five-role requirements. I would also make optional target selection and the end states more precise. These are model-quality improvements, not evidence that the implemented system already satisfies every original design detail.

## 全组共同部分 必须能答

| 主题 | 本项目回答抓手 |
| --- | --- |
| 系统目标和边界 | 五角色职业支持；外部招聘/模型服务在边界外；没有雇佣结果保证。 |
| 五个需求如何衔接 | Profile → Career analysis → Job matching/selection → reviewed resume → interview feedback。不能漏掉 UC2。 |
| Viewpoint 和 view | Viewpoint 规定关注点和建模约定，view 是按其形成的具体表示；报告选择 use-case/logical/process 等视角。 |
| 功能和质量属性 | 排名是功能；可解释、隐私、可靠、响应时间是质量要求，应给可验证场景。 |
| Feature 与 use case | feature 表达能力选择/依赖；use case 表达参与者达成目标的交互。 |
| include 和 extend | include 为被复用的包含行为；extend 为满足条件的可选扩展；不可仅因先后顺序就画 include。 |
| Activity 与 state machine | 工作流/控制流，与一个实例的生命周期约束，关注点不同。 |
| Decision 和 fork | 条件选择与并发分支不同；没有并行需求不要硬加 fork。 |
| Coupling 和 cohesion | 用适配接口减少对具体招聘供应商耦合；把同一责任放在同一组件。 |
| Model based 与 model driven | 用模型支持沟通、分析、验证；model-driven 进一步强调模型到实现的自动变换，不等于“画过 UML 就自动生成了代码”。 |
| 元模型 | 模型遵循其元模型；领域类图中的 CareerProfile 不是 UML 元模型里的 Class 元类本身。 |
| Agile | 实际迭代目标、验收、反馈和改动证据；Jira 列表/自动评论本身不足以证明真实团队 review/retro。 |

## 一次 20 分钟模拟面试

0–3 分钟：随机问 1、2、3、5。3–8 分钟：指着三张行为图，追问 alt/loop/opt、guard 和异常。8–13 分钟：类图关系、接口、multiplicity、生命周期。13–17 分钟：随机问架构视角、质量属性、Agile。17–20 分钟：用“发现的问题 → 影响 → 修正方式”回答模型不足。

自评：能否不看稿回答；能否指到原图；是否解释取舍；是否把 Stage 1 设计、当前实现、未来计划分开。不会时可以说：*I need to verify the exact multiplicity in our submitted diagram. The intended invariant is …*，不要临场编造。

## 复习依据

- 小组提交版 PDF：第 22–26 页 UC3，第 39 页类图；本次已实际读取并查看图像。
- Stage 1 marking criteria：个人 requirement/use case/三张行为图；全组结构模型共同理解；interview 10 marks。
- 本地 Canvas 讲义提取文本：3 Requirement Model；4 Architectural Design and Modeling；5 Modeling Structure parts 1/2；6 Modeling Behavior；7 Model Organisation；8 Agile Model Practice；10 Meta-Modeling。
- 老师本次通知：Q&A，不重讲报告；全组部分人人会，个人部分由负责人回答。题目列表和练习时长为自拟建议。
