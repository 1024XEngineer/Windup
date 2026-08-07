import type { CreateWorkflowRunInput, WorkflowRun } from "./index";

/**
 * WorkflowRun 持久化契约。
 *
 * 持久化走服务端 API，所有方法均为异步。前端不保留 localStorage 副本，
 * 也不提供 subscribe / subscribeAll——状态变更由前端逻辑自身驱动。
 *
 * 后端 API 契约（对齐 commit 4246389b）
 * --------------------------------
 * POST   /workflow-runs       创建执行记录
 * GET    /workflow-runs/{id}   获取执行记录（含 nodes JSONB）
 * PATCH  /workflow-runs/{id}   全量更新（含 nodes）
 * DELETE /workflow-runs/{id}   软删除
 *
 * 后端只做存储，不感知节点结构。前端 WorkflowRun 的完整状态（除 id / projectId 外）
 * 序列化到后端 nodes 字段。id/projectId 映射为后端顶层 id/project_id。
 */
export interface WorkflowRunStore {
  /** 创建一条新的 WorkflowRun，返回服务端持久化后的完整快照。 */
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>;
  /** 按 ID 读取 WorkflowRun 最新快照；不存在时返回 null。 */
  get(runId: WorkflowRun["id"]): Promise<WorkflowRun | null>;
  /** 按已关联的 Character ID 查找唯一绑定的 WorkflowRun（客户端过滤）。 */
  getByCharacter(characterId: string): Promise<WorkflowRun | null>;
  /** 列出当前项目下的全部 WorkflowRun。 */
  list(projectId?: string): Promise<WorkflowRun[]>;
  /** 保存 WorkflowRun 最新状态到服务端。 */
  save(run: WorkflowRun): Promise<void>;
}

export interface CreateWorkflowRunStoreOptions {
  /**
   * HTTP 客户端，提供 fetch 方法。
   * 不传时使用仅内存存储（测试友好）。
   */
  api?: { fetch(input: RequestInfo, init?: RequestInit): Promise<unknown> };
}

// ── 序列化 ─────────────────────────────────────────────────────────────────

/** 后端 WorkflowRun 响应形状（nodes JSONB 透传）。 */
interface BackendWorkflowRun {
  id: number;
  project_id: number;
  nodes: Record<string, unknown>[];
  status: string;
  version: number;
}

/** 把前端 WorkflowRun 的丰富字段序列化到后端 nodes 载荷中。 */
function _toNodePayload(run: WorkflowRun): Record<string, unknown> {
  return {
    // projectId 同时写进 nodes：后端 project_id 是整数，前端用 string ID，
    // 读取时优先从 nodes 还原以保持原始值。
    projectId: run.projectId,
    characterId: run.characterId,
    outfitId: run.outfitId,
    purpose: run.purpose,
    status: run.status,
    nodes: run.nodes,
    generationStatus: run.generationStatus,
    exportStatus: run.exportStatus,
    prompt: run.prompt,
    createdAt: run.createdAt,
  };
}

/** 从后端响应重建前端 WorkflowRun。 */
function _fromBackend(b: BackendWorkflowRun): WorkflowRun {
  const node = b.nodes[0] ?? {};
  return {
    id: String(b.id),
    // 优先从 nodes 取 projectId（保持前端原始 string 值），
    // 不存时回退到后端 project_id。
    projectId:
      (node.projectId as string) ?? String(b.project_id),
    characterId: (node.characterId as string) ?? null,
    outfitId: (node.outfitId as string) ?? null,
    purpose: (node.purpose as WorkflowRun["purpose"]) ?? "create_character",
    status: (node.status as WorkflowRun["status"]) ?? "active",
    nodes: (node.nodes as WorkflowRun["nodes"]) ?? [],
    generationStatus:
      (node.generationStatus as WorkflowRun["generationStatus"]) ??
      "not_started",
    exportStatus:
      (node.exportStatus as WorkflowRun["exportStatus"]) ?? "not_exported",
    prompt: (node.prompt as string | null) ?? null,
    createdAt: (node.createdAt as string) ?? new Date().toISOString(),
  };
}

// ── 内存存储（测试/过渡期） ──────────────────────────────────────────────────

function createInMemoryStore(): WorkflowRunStore {
  const runs = new Map<string, WorkflowRun>();

  return {
    async create(input) {
      const run: WorkflowRun = {
        id: `run-${runs.size + 1}`,
        projectId: input.projectId,
        characterId:
          "characterId" in input ? (input.characterId as string) : null,
        outfitId: "outfitId" in input ? (input.outfitId as string) : null,
        purpose: input.purpose,
        status: "active",
        nodes: [],
        generationStatus: "not_started",
        exportStatus: "not_exported",
        prompt: input.prompt ?? null,
        createdAt: new Date().toISOString(),
      };
      runs.set(run.id, structuredClone(run));
      return structuredClone(run);
    },

    async get(runId) {
      const run = runs.get(runId);
      return run ? structuredClone(run) : null;
    },

    async getByCharacter(characterId) {
      for (const run of runs.values()) {
        if (run.characterId === characterId) return structuredClone(run);
      }
      return null;
    },

    async list(projectId) {
      return [...runs.values()]
        .filter((run) => !projectId || run.projectId === projectId)
        .map((run) => structuredClone(run));
    },

    async save(run) {
      runs.set(run.id, structuredClone(run));
    },
  };
}

// ── HTTP 存储 ──────────────────────────────────────────────────────────────

function isNotFoundError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "status" in cause &&
    cause.status === 404
  );
}

/**
 * 创建 WorkflowRunStore。
 * 传入 api 时走 HTTP 持久化（对齐后端 /workflow-runs 接口），
 * 否则使用仅内存存储（用于测试和过渡期）。
 */
export function createWorkflowRunStore(
  options: CreateWorkflowRunStoreOptions = {},
): WorkflowRunStore {
  const api = options.api;
  if (!api) return createInMemoryStore();

  /** 后端通用响应包装：Response<T> { code, message, data: T } */
  function _unwrap<T>(response: unknown): T {
    const r = response as { data?: T };
    if (r.data !== undefined) return r.data;
    return response as T;
  }

  return {
    async create(input) {
      const response = await api.fetch("/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: Number(input.projectId),
          nodes: [
            {
              // 创建时前端 WorkflowRun 字段（除 id）全部进入 nodes
              projectId: input.projectId,
              characterId:
                "characterId" in input ? input.characterId : null,
              outfitId: "outfitId" in input ? input.outfitId : null,
              purpose: input.purpose,
              status: "active",
              nodes: [],
              generationStatus: "not_started",
              exportStatus: "not_exported",
              prompt: input.prompt ?? null,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
      return _fromBackend(_unwrap(response) as BackendWorkflowRun);
    },

    async get(runId) {
      try {
        const response = await api.fetch(`/workflow-runs/${runId}`);
        return _fromBackend(_unwrap(response) as BackendWorkflowRun);
      } catch (cause) {
        if (isNotFoundError(cause)) return null;
        throw cause;
      }
    },

    async getByCharacter(characterId) {
      try {
        // 后端无 characterId 查询参数，先全量拉取再客户端过滤。
        const runs = await api.fetch("/workflow-runs");
        const all = (_unwrap(runs) as BackendWorkflowRun[]).map(_fromBackend);
        return all.find((r) => r.characterId === characterId) ?? null;
      } catch (cause) {
        if (isNotFoundError(cause)) return null;
        throw cause;
      }
    },

    async list(projectId) {
      const query = projectId
        ? `?project_id=${encodeURIComponent(projectId)}`
        : "";
      const response = await api.fetch(`/workflow-runs${query}`);
      const items = _unwrap(response) as BackendWorkflowRun[];
      return items.map(_fromBackend);
    },

    async save(run) {
      await api.fetch(`/workflow-runs/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: [_toNodePayload(run)],
        }),
      });
    },
  };
}
