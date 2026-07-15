"""批量跑统一用例 + 记录表（非 agent 框架，Proposal §2.6）。MS1 桩：占位统计。"""
from __future__ import annotations


class BatchEvaluator:
    def run(self, pipeline, cases: list[dict]) -> dict:
        # MS2 填实：逐用例跑 pipeline，统计端到端流程跑通率。
        return {"total": len(cases), "passed": 0, "note": "MS2 填实"}
