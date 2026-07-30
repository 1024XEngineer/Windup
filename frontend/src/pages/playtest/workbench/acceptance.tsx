import type { PlaytestInspectionStatus } from "@/entities/playtest-inspection";

import { StatusPanel } from "./status-panel";

export interface AcceptanceProps {
  inspectionMode: "demo" | "persisted";
  inspectionStatus: PlaytestInspectionStatus | null;
  saving?: boolean;
  saveError?: string | null;
  onRecordStatus(status: PlaytestInspectionStatus): void;
}

function statusText(status: PlaytestInspectionStatus | null): string {
  if (status === "passed") return "通过";
  if (status === "issues_found") return "发现问题";
  return "尚未核验";
}

export function Acceptance({
  inspectionMode,
  inspectionStatus,
  saving = false,
  saveError = null,
  onRecordStatus,
}: AcceptanceProps) {
  const isDemo = inspectionMode === "demo";

  return (
    <section
      aria-label="核验状态"
      aria-busy={saving}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header>
        <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">ACCEPTANCE</p>
        <h2 className="mt-1 text-sm font-semibold text-slate-900">核验状态</h2>
      </header>
      <StatusPanel
        title={isDemo ? "Demo 核验" : "持久化核验"}
        tone={inspectionStatus === "issues_found" ? "warning" : "neutral"}
      >
        {isDemo ? (
          <>
            <p>本地核验：{statusText(inspectionStatus)}</p>
            <p className="mt-1 text-xs">未提交后端</p>
          </>
        ) : (
          <p>
            {inspectionStatus === null
              ? "尚无已保存核验"
              : `已保存：${statusText(inspectionStatus)}`}
          </p>
        )}
      </StatusPanel>
      {saving ? (
        <p role="status" aria-live="polite" className="text-xs text-slate-500">
          正在保存核验结论
        </p>
      ) : null}
      {saveError !== null ? (
        <div role="alert" aria-live="assertive">
          <StatusPanel title="保存失败" tone="danger">
            {saveError}
          </StatusPanel>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => onRecordStatus("passed")}
          className="rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          核验通过
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onRecordStatus("issues_found")}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          发现问题
        </button>
      </div>
    </section>
  );
}
