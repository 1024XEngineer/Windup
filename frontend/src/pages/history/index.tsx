/**
 * 历史记录页面 — 读取 WorkflowRunStore 展示已完成的工作流。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import type { WorkflowRun, WorkflowRunStore } from "@/entities";

export function HistoryPage({ store }: { store: WorkflowRunStore }) {
  const { projectId } = useParams();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  useEffect(() => {
    let active = true;
    void store.list(projectId).then((items) => {
      if (active) setRuns(items);
    });
    return () => {
      active = false;
    };
  }, [projectId, store]);

  const completedRuns = runs.filter((r) => r.status === "completed");
  const activeRuns = runs.filter(
    (r) => r.status === "active" || r.status === "interrupted",
  );

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[#747973]">
          HISTORY
        </p>
        <h1 className="mt-2 font-serif text-3xl font-medium tracking-[-0.03em]">
          历史记录
        </h1>
        <p className="mt-2 text-sm text-[#666b64]">
          已完成和进行中的创作记录。
        </p>
      </header>

      {activeRuns.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-sm font-semibold text-[#1d1d1f]">进行中</h2>
          <div className="grid gap-3">
            {activeRuns.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        </div>
      )}

      {completedRuns.length > 0 && (
        <div>
          <h2 className="mb-4 text-sm font-semibold text-[#1d1d1f]">已完成</h2>
          <div className="grid gap-3">
            {completedRuns.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        </div>
      )}

      {runs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#c9d0ca] bg-[#f3f5f1] p-12 text-center">
          <p className="text-sm text-[#687069]">还没有创作记录。</p>
          <Link
            to="/workflow-editor"
            className="mt-4 inline-block rounded-xl bg-[#263f2d] px-4 py-2 text-sm font-semibold text-white"
          >
            开始创作
          </Link>
        </div>
      )}
    </section>
  );
}

function RunCard({ run }: { run: WorkflowRun }) {
  const passedCount = run.nodes.filter(
    (node) => node.status === "passed",
  ).length;
  const totalCount = run.nodes.length;

  const statusLabel =
    run.status === "completed"
      ? "已完成"
      : run.status === "failed"
        ? "失败"
        : run.status === "interrupted"
          ? "已中断"
          : "进行中";

  const statusColor =
    run.status === "completed"
      ? "text-[#3d6b4a]"
      : run.status === "failed"
        ? "text-[#8b332a]"
        : "text-[#687069]";

  return (
    <Link
      to={`/workflow-editor/${run.id}`}
      className="flex items-center justify-between rounded-xl border border-[#e2e3de] bg-white p-4 transition-colors hover:border-[#8fa092]"
    >
      <div>
        <p className="font-mono text-[9px] font-bold tracking-[0.12em] text-[#747973]">
          RUN {run.id.slice(0, 8)}
        </p>
        <p className="mt-1 text-sm font-semibold text-[#1d1d1f]">
          {run.prompt || `项目 ${run.projectId.slice(0, 8)}`}
        </p>
        <p className="mt-1 text-[10px] text-[#747973]">
          {passedCount} / {totalCount} 节点完成
        </p>
      </div>
      <span className={`text-xs font-semibold ${statusColor}`}>
        {statusLabel}
      </span>
    </Link>
  );
}
