# Stage 1 Interview Quick Review

Aitong Lyu · 2026-10-23 · Q&A 速查，不是重新演讲稿。

## 开口就能答的 30 秒

My individual focus is R3 and UC3, Search and Match Jobs. The system loads a valid career profile, retrieves supported job information, compares requirements with candidate evidence and presents ranked, explainable recommendations. Missing profiles, unavailable sources and no suitable matches have different recovery paths. The user may select a target for later activities. My structural contribution explains how specialist agents, shared context and service interfaces support this behaviour.

贡献措辞以自己的实际工作为准；不要把 AI 辅助和团队成果说成独立完成。

## 看图顺序

| 报告实际 PDF 页 | 你要指出什么 |
| --- | --- |
| 22–23 UC3 | goal/actor/precondition/success；主流程 11 步；2a/3a/8a；选岗是 may select。 |
| 24 Activity | 控制流；三个 decision；异常汇合结束；本图没有 fork/join 并发。 |
| 25 Sequence | 7 个参与者；orchestrator 委派；data/job/LLM service；alt/loop/opt；保存 target。 |
| 26 State | 一次 matching process 的生命周期；事件/guard；Low Confidence 不等于低录用概率。 |
| 39 Class | 抽象 Agent、specialists、context、domain objects、gateway；关系方向和端点 multiplicity。 |

## 六个容易答错的点

- Activity = 做事流程；sequence = 谁给谁发什么消息；state = 一个实例允许经历哪些状态。
- Composition 的实心菱形在整体端；外部岗位只能拥有本地快照，不拥有招聘网站上的岗位生命周期。
- Generalization 空心三角指向父类型；realization 是实现接口，不是数据流。
- Suitability score 不是 confidence，也不是录用概率。Stage 2 当前 TF-IDF 是词汇相似度，不是 pretrained embeddings。
- 展示推荐可以完成 UC3 的主要用户目标；target selection 是可选后续。整个 mission 等待选岗不意味着推荐没有成功。
- 工作源码里存在一个角色/页面，不自动证明其 Stage 1 用例和真实 AI 已完成验收。

## 主动承认的模型改进

第 39 页仍有 ApplicationManagerAgent，未清楚对应正文的 Career Coach；这是模型版本同步问题。不要把两个职责临时说成同一角色。提出统一五角色、保留申请跟踪为 optional service，并核对所有视图。

第 24/26 页的初始/结束节点是流程图风格，严格 UML 符号需要规范化；状态图还应更清楚表达不选岗/取消的正常结束和恢复路径。

## 最后自测

不看稿回答：为什么这三个图都必要？为什么通过 gateway 获取岗位？0..* 在哪一端？API 失败与空结果怎么区分？LLM 提出一个不在 profile 中的技能怎么办？Career Coach 与 Job Matcher 有什么区别？你会如何验证图和代码一致？

详细问答和逐图解释见 `docs/STAGE1_INTERVIEW_MEMBER3.md`。
