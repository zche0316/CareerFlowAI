# Integration note — 26 October 2026

This document preserves the desktop prototype preparation record from 23 October. It is not a current assessment of the group main branch. The integration onto main commit 110a309 preserves the team's later Profile Builder, career-analysis feedback, quality tests and salary-negotiation work. See STAGE2_INTEGRATION_20261026.md for checks run on the merged version. Historical limitations in this document must be rechecked rather than treated as current defects.

# Agile会议工作包（2026-10-23）

用户确认会议尚未举行。以下为准备材料，不是历史纪要或已达成的团队决定。

## 已直接写入Jira

- CFS-11：四种会议模板、三轮会议任务索引、DoD与证据填写规则。
- CFS-10：统一入口和补齐安排。
- CFS-46：Sprint1 review议程：演示profile/analysis/matching/target，核实验收与未完成项，记录真实反馈。
- CFS-47：retro候选讨论：估算缺失、评审积压、日志未记录；待团队选择改进owner及复查日期。
- CFS-51：当前planning建议：五用例主链、真实AI、失败恢复与独立部署优先；Adzuna及职位比较为可选，估算待团队讨论。

## 建议35分钟会议

0–12分钟：Review，展示成果、逐项验收、记录未完成项和反馈。
12–20分钟：Retro，选择1–2项协作改进，填写owner、日期、后续issue。
20–35分钟：Planning，核实容量、优先级、依赖及估算，决定旧Sprint未完成项去向与当前范围。

记录真实会议时间与参与者。一次会议可有三个环节，不能将议程伪写成过去三场会议。

每份记录填写：实际时间/时区、出席者、关联任务和commit/PR、演示或阻塞证据、反馈、决定及理由、行动owner/日期、复查结果。Stand-up逐人写完成/下一步/阻塞。

## 燃尽图已启用

已通过Jira UI添加Reports，并打开原生Sprint burndown：
https://careerflow-elec5620-group2.atlassian.net/jira/software/projects/CFS/boards/2/reports/burndown?source=overview

Sprint1当前仍无Story Points估算、无完成项。页面可打开不等于进度数据充分。不得为美化曲线批量Done或回填历史估算；团队应对未来承诺在当前日期做估算，并在真实验收后更新状态。

现场顺序：backlog→Sprint目标与范围→燃尽图→实际Review/Retro→反馈到任务/代码/测试的闭环。

## 提供评审的现有证据

CFS-41记录独立源码安装、迁移、44项测试、构建及fixture服务启动。它不证明真实AI成功或团队已验收。CFS-20/21有早期个人交付及原CF链接；历史活动以原项目为准。

## 仍待真实执行

团队实际开会、同意估算和承诺、独立review和验收、按结果更新Sprint与状态。上述工作未被助手代写为已完成。不要把本工作包作为完成的会议日志提交。
