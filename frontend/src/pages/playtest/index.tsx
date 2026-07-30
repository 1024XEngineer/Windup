import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import type { Character, CharacterAPIs } from "@/entities/character";
import type {
  PlaytestInspection,
  PlaytestInspectionAPIs,
  PlaytestInspectionStatus,
} from "@/entities/playtest-inspection";

import { PlaytestWorkbench } from "./workbench";

export interface PlaytestPageAPIs {
  characters: Pick<CharacterAPIs, "get">;
  inspections: Pick<PlaytestInspectionAPIs, "getLatest" | "record">;
}

export interface PlaytestPageProps {
  apis?: PlaytestPageAPIs;
}

interface PageData {
  character: Character | null;
  inspection: PlaytestInspection | null;
  error: string | null;
  loading: boolean;
}

const initialPageData: PageData = {
  character: null,
  inspection: null,
  error: null,
  loading: false,
};

interface PageIdentity {
  apis: PlaytestPageAPIs | undefined;
  characterId: string | undefined;
  outfitId: string | undefined;
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const identifiable = error as { code?: unknown; status?: unknown };
  return (
    identifiable.code === 404 ||
    identifiable.code === "404" ||
    identifiable.status === 404 ||
    identifiable.status === "404"
  );
}

export function PlaytestPage({ apis }: PlaytestPageProps) {
  const { characterId, outfitId } = useParams();
  const [searchParams] = useSearchParams();
  const initialActionId = searchParams.get("actionId");
  const [data, setData] = useState<PageData>(initialPageData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pageIdentityRef = useRef<PageIdentity>({
    apis,
    characterId,
    outfitId,
  });
  const saveRequestVersionRef = useRef(0);

  useEffect(() => {
    pageIdentityRef.current = { apis, characterId, outfitId };
    saveRequestVersionRef.current += 1;

    if (apis === undefined) {
      setData({ ...initialPageData, error: "Playtest 后端接口尚未配置" });
      setSaving(false);
      setSaveError(null);
      return;
    }

    if (characterId === undefined || outfitId === undefined) {
      setData({ ...initialPageData, error: "Playtest 路由参数不完整" });
      setSaving(false);
      setSaveError(null);
      return;
    }

    let cancelled = false;
    setData({ ...initialPageData, loading: true });
    setSaving(false);
    setSaveError(null);

    void (async () => {
      let character: Character;
      try {
        character = await apis.characters.get(characterId);
      } catch (error) {
        if (!cancelled) {
          setData({
            ...initialPageData,
            error: isNotFoundError(error) ? "角色不存在" : "角色读取失败",
            loading: false,
          });
        }
        return;
      }

      if (cancelled) return;

      try {
        const inspection = await apis.inspections.getLatest({ characterId, outfitId });
        if (!cancelled) setData({ character, inspection, error: null, loading: false });
      } catch {
        if (!cancelled) {
          setData({
            character,
            inspection: null,
            error: "核验记录读取失败",
            loading: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apis, characterId, outfitId]);

  const recordStatus = (status: PlaytestInspectionStatus) => {
    if (apis === undefined || characterId === undefined || outfitId === undefined) return;

    const requestIdentity = pageIdentityRef.current;
    const requestVersion = saveRequestVersionRef.current + 1;
    saveRequestVersionRef.current = requestVersion;
    setSaving(true);
    setSaveError(null);
    void apis.inspections.record({ characterId, outfitId, status }).then(
      (inspection) => {
        if (
          pageIdentityRef.current !== requestIdentity ||
          saveRequestVersionRef.current !== requestVersion
        )
          return;
        setData((current) => ({ ...current, inspection }));
        setSaving(false);
      },
      () => {
        if (
          pageIdentityRef.current !== requestIdentity ||
          saveRequestVersionRef.current !== requestVersion
        )
          return;
        setSaving(false);
        setSaveError("Playtest 核验结论保存失败");
      },
    );
  };

  if (data.error !== null) return <PlaytestPageMessage>{data.error}</PlaytestPageMessage>;
  if (data.loading || data.character === null)
    return <PlaytestPageMessage>加载 Playtest 数据中</PlaytestPageMessage>;

  return (
    <PlaytestWorkbench
      key={initialActionId ?? ""}
      character={data.character}
      outfitId={outfitId ?? ""}
      initialActionId={initialActionId}
      source={data.inspection?.source ?? null}
      inspectionStatus={data.inspection?.status ?? null}
      inspectionMode="persisted"
      saving={saving}
      saveError={saveError}
      onRecordStatus={recordStatus}
    />
  );
}

function PlaytestPageMessage({ children }: { children: string }) {
  return (
    <main aria-label="Playtest" className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <p className="text-sm font-medium text-slate-700">{children}</p>
    </main>
  );
}
