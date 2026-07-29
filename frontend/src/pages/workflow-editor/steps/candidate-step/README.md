# Candidate Step

候选选择阶段页面：接收 Generation 产出的候选，并把后端系统质检结果作为候选质量信息或过滤依据。
手动 Workflow 在这里由用户选择；Quick Start 复用同一选择边界，由 AI 自动选择并隐藏该页面。

该阶段只产出所选候选的身份或引用，不等于人工审核。Review 继续负责检查已经选定的结果。
正式候选选择 UI、系统质检和 HTTP Adapter 尚未接入；Preview 组合会自动确认第一张 Mock 候选，
只用于验证与 Quick Start 共用的 WorkflowController 和 Character 整树更新链路。

