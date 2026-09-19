import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type ApiErr } from "../api/client";
import { currentUserId } from "../auth/session";
import {
  backendAuditToProto,
  backendTaskToProto,
  backendTicketToProto,
  connectorStatus,
  fmtTime,
  riskLabel,
  type BackendTask,
} from "../api/mappers";
import {
  seedEditingTasks,
  platformMeta,
  nowLabel,
  uid,
  type Store, type Product, type Draft, type Asset, type Connector, type Audit, type Task,
  type TaskResult, type ResearchCandidate, type Favorite, type StoreStatus,
  type EditingTask, type AfterSalesTicket,
} from "../data/ecom";

interface EcomCtx {
  stores: Store[];
  products: Product[];
  drafts: Draft[];
  favorites: Favorite[];
  assets: Asset[];
  connectors: Connector[];
  audits: Audit[];
  tasks: Task[];
  editingTasks: EditingTask[];
  tickets: AfterSalesTicket[];
  addStore: (platformId: string, failOnce?: boolean) => Promise<boolean>;
  setStoreStatus: (id: string, status: StoreStatus) => Promise<void>;
  removeStore: (id: string) => Promise<void>;
  toggleFavorite: (c: ResearchCandidate) => Promise<void>;
  addDraft: (d: Omit<Draft, "id" | "createdAt">) => Promise<string>;
  addAsset: (name: string, type: Asset["type"], tags: string[]) => Promise<void>;
  enableConnector: (id: string) => Promise<void>;
  disableConnector: (id: string) => Promise<void>;
  submitPublish: (draftId: string, platforms: string[]) => Promise<string>;
  approvePublish: (taskId: string) => Promise<void>;
  approveTask: (taskId: string) => Promise<void>;
  finishPublish: (taskId: string, results: TaskResult[]) => Promise<void>;
  retryFailedPlatform: (taskId: string, platformId: string) => Promise<void>;
  rerunTask: (taskId: string) => Promise<void>;
  stopTask: (taskId: string) => void;
  audit: (a: Omit<Audit, "id" | "time">) => void;
  createEditingTask: (title: string, assetNames: string[], provider: "OpenCut" | "OpenMontage", template: string) => string;
  approveEditingVideo: (taskId: string) => void;
  rejectEditingVideo: (taskId: string, reason: string) => void;
  analyzeTickets: () => Promise<void>;
  approveReply: (ticketId: string) => Promise<void>;
  rejectReply: (ticketId: string, reason: string, feedback: string) => Promise<void>;
}

const Ctx = createContext<EcomCtx | null>(null);

function reportError(e: unknown) {
  const detail = (e as ApiErr)?.detail ?? String(e);
  if (typeof window !== "undefined") window.alert(`操作失败：${detail}`);
}

async function getAll<T>(url: string, key: string): Promise<T[]> {
  try {
    const r = (await api.get<Record<string, T[]>>(url)) ?? {};
    return r[key] ?? [];
  } catch {
    return [];
  }
}

const toKind = (p: string) => (p.endsWith("-shop") ? p : `${p}-shop`);
const parsePrice = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const RISK_ORDER = { 低: 0, 中: 1, 高: 2 } as const;

interface RawInstance { id: string; kind: string; status: string }
interface RawCatalogEntry {
  kind: string; name: string; category: string; description: string;
  auth_kind: string; mcp_mode: string;
  tools: { name: string; scope: string; risk: string; description: string }[];
}

function buildConnectors(catalog: RawCatalogEntry[], instances: RawInstance[]): Connector[] {
  return catalog.map((entry) => {
    const inst = instances.find((i) => i.kind === entry.kind && i.status !== "revoked");
    const writeTools = entry.tools.filter((t) => t.scope !== "read");
    const readTools = entry.tools.filter((t) => t.scope === "read");
    const risk = writeTools.reduce(
      (acc, t) => {
        const label = riskLabel(t.risk);
        return (RISK_ORDER[label as keyof typeof RISK_ORDER] ?? 0) > (RISK_ORDER[acc] ?? 0) ? (label as Connector["risk"]) : acc;
      },
      "低" as Connector["risk"],
    );
    return {
      id: entry.kind,
      name: entry.name,
      category: entry.category as Connector["category"],
      status: (inst ? connectorStatus(inst.status) : "未安装") as Connector["status"],
      read: readTools.map((t) => t.description || t.name),
      write: writeTools.map((t) => t.description || t.name),
      risk,
      desc: entry.description,
      note: `${entry.auth_kind} · ${entry.mcp_mode}`,
    };
  });
}

export function EcomProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tickets, setTickets] = useState<AfterSalesTicket[]>([]);
  const [editingTasks, setEditingTasks] = useState<EditingTask[]>(seedEditingTasks);
  const rawTasksRef = useRef<Map<string, BackendTask>>(new Map());
  const instancesRef = useRef<RawInstance[]>([]);

  const refreshTasksAndAudits = useCallback(async () => {
    const [taskRows, auditRows] = await Promise.all([
      getAll<BackendTask>("/api/tasks", "tasks"),
      getAll<Parameters<typeof backendAuditToProto>[0]>("/api/audit?limit=40", "entries"),
    ]);
    rawTasksRef.current = new Map(taskRows.map((t) => [t.id, t]));
    setTasks(taskRows.map(backendTaskToProto));
    setAudits(auditRows.map(backendAuditToProto));
  }, []);

  const refreshAll = useCallback(async () => {
    const [storeRows, productRows, draftRows, favRows, assetRows, ticketRows, catalog, instances] = await Promise.all([
      getAll<Record<string, unknown>>("/api/commerce/stores", "stores"),
      getAll<Record<string, unknown>>("/api/commerce/products", "products"),
      getAll<Record<string, unknown>>("/api/commerce/drafts", "drafts"),
      getAll<Record<string, unknown>>("/api/commerce/favorites", "favorites"),
      getAll<Record<string, unknown>>("/api/commerce/assets", "assets"),
      getAll<Record<string, unknown>>("/api/commerce/tickets", "tickets"),
      getAll<RawCatalogEntry>("/api/connectors/catalog", "connectors"),
      getAll<RawInstance>("/api/connectors/instances", "instances"),
    ]);
    instancesRef.current = instances;
    const storeProto = storeRows.map((row) => ({
      id: String(row.id),
      platformId: String(row.platform ?? ""),
      name: String(row.name ?? ""),
      status: (row.status as Store["status"]) ?? "connected",
      addedAt: fmtTime(row.created_at as string | null),
      products: Number(row.products ?? 0),
      orders7d: Number(row.orders_7d ?? 0),
    }));
    const platformOf = new Map(storeProto.map((s) => [s.id, s.platformId]));
    setStores(storeProto);
    setProducts(productRows.map((row) => ({
      id: String(row.id),
      name: String(row.title ?? ""),
      price: Number(row.price ?? 0),
      platformId: platformOf.get(String(row.store_id)) ?? "",
      storeId: String(row.store_id ?? ""),
      category: String(row.category ?? ""),
      sales7d: Number(row.sales_7d ?? 0),
      trend: (row.trend as Product["trend"]) ?? "flat",
      conv: Number(row.conv ?? 0),
      rating: Number(row.rating ?? 0),
      reviewNote: String(row.review_note ?? ""),
    })));
    setDrafts(draftRows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      price: Number(row.price ?? 0),
      sellingPoints: (row.selling_points as string[]) ?? [],
      imageLabel: String(row.image_label ?? ""),
      source: String(row.source ?? ""),
      createdAt: fmtTime(row.created_at as string | null),
    })));
    setFavorites(favRows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      source: String(row.source ?? ""),
      heat: Number(row.heat ?? 0),
      price: String(row.price ?? ""),
    })));
    setAssets(assetRows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      type: row.type as Asset["type"],
      tags: (row.tags as string[]) ?? [],
      size: String(row.size ?? ""),
      versions: (row.versions as Asset["versions"]) ?? [],
      refs: (row.refs as Asset["refs"]) ?? [],
      letter: String(row.name ?? "").slice(0, 1),
    })));
    setTickets(ticketRows.map((row) => backendTicketToProto(row as unknown as Parameters<typeof backendTicketToProto>[0])));
    setConnectors(buildConnectors(catalog, instances));
    await refreshTasksAndAudits();
  }, [refreshTasksAndAudits]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const hasActive = tasks.some((t) => t.status === "运行中" || t.status === "排队中");
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void refreshTasksAndAudits(), 1500);
    return () => window.clearInterval(timer);
  }, [hasActive, refreshTasksAndAudits]);

  const value = useMemo<EcomCtx>(() => {
    const addStore: EcomCtx["addStore"] = async (platformId) => {
      try {
        const meta = platformMeta[platformId];
        await api.post("/api/commerce/stores", {
          platform: platformId,
          name: `蓝海优品 · ${meta?.short ?? platformId}`,
        });
        await refreshAll();
        return true;
      } catch (e) {
        reportError(e);
        return false;
      }
    };
    const setStoreStatus: EcomCtx["setStoreStatus"] = async (id, status) => {
      try {
        await api.patch(`/api/commerce/stores/${id}`, { status });
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const removeStore: EcomCtx["removeStore"] = async (id) => {
      try {
        await api.del(`/api/commerce/stores/${id}`);
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const toggleFavorite: EcomCtx["toggleFavorite"] = async (c) => {
      const hit = favorites.find((f) => f.name === c.name);
      try {
        if (hit) await api.del(`/api/commerce/favorites/${hit.id}`);
        else {
          await api.post("/api/commerce/favorites", {
            ref_id: c.id, name: c.name, source: c.platform, heat: c.heat, price: parsePrice(c.price),
          });
        }
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const addDraft: EcomCtx["addDraft"] = async (d) => {
      try {
        const r = await api.post<{ draft: { id: string } }>("/api/commerce/drafts", {
          title: d.title,
          price: d.price,
          selling_points: d.sellingPoints,
          image_label: d.imageLabel,
          source: d.source,
        });
        await refreshAll();
        return r.draft.id;
      } catch (e) {
        reportError(e);
        return "";
      }
    };
    const addAsset: EcomCtx["addAsset"] = async (name, type, tags) => {
      try {
        await api.post("/api/commerce/assets", { name, type, tags });
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const enableConnector: EcomCtx["enableConnector"] = async (kind) => {
      try {
        await api.post("/api/connectors/install", { kind, credentials: { access_token: "sandbox" } });
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const disableConnector: EcomCtx["disableConnector"] = async (kind) => {
      const inst = instancesRef.current.find((i) => i.kind === kind && i.status === "active");
      if (!inst) return;
      try {
        await api.post(`/api/connectors/instances/${inst.id}/revoke`, {});
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const submitPublish: EcomCtx["submitPublish"] = async (draftId, platforms) => {
      try {
        const r = await api.post<{ task: BackendTask }>(`/api/commerce/drafts/${draftId}/publish`, {
          platforms: platforms.map(toKind),
        });
        await refreshAll();
        return r.task.id;
      } catch (e) {
        reportError(e);
        return "";
      }
    };
    const approveTask: EcomCtx["approveTask"] = async (taskId) => {
      try {
        const raw = rawTasksRef.current.get(taskId);
        const approvalId = raw?.approval?.id;
        if (approvalId && raw?.approval?.status !== "approved") {
          await api.post(`/api/approvals/${approvalId}/decide`, {
            approver: currentUserId() ?? "当前用户", decision: "approve", note: "控制台批准",
          });
        }
        if (!raw || raw.status !== "running") await api.post(`/api/tasks/${taskId}/run`, {});
        await refreshTasksAndAudits();
      } catch (e) {
        reportError(e);
      }
    };
    const finishPublish: EcomCtx["finishPublish"] = async () => {
      await refreshTasksAndAudits();
    };
    const retryFailedPlatform: EcomCtx["retryFailedPlatform"] = async (taskId) => {
      try {
        await api.post(`/api/tasks/${taskId}/retry`, {});
        await refreshTasksAndAudits();
      } catch (e) {
        reportError(e);
      }
    };
    const rerunTask: EcomCtx["rerunTask"] = async (taskId) => {
      try {
        const raw = rawTasksRef.current.get(taskId);
        const path = raw?.status === "partial_failed" || raw?.status === "failed"
          ? `/api/tasks/${taskId}/retry`
          : `/api/tasks/${taskId}/run`;
        await api.post(path, {});
        await refreshTasksAndAudits();
      } catch (e) {
        reportError(e);
      }
    };
    const stopTask: EcomCtx["stopTask"] = () => {
      window.alert("服务端任务引擎不提供中断执行中的写任务（红线：写操作不可半途而废），等待执行完成后按需重跑。");
    };
    const audit: EcomCtx["audit"] = () => {
      /* 换底后审计全部由服务端产生；保留签名兼容内容域 mock 页面调用 */
    };

    const createEditingTask: EcomCtx["createEditingTask"] = (title, assetNames, provider, template) => {
      const id = uid("ed");
      const task: EditingTask = {
        id, title, assetNames, provider, template, status: "排队中",
        adaptations: [
          { platformId: "douyin", aspectRatio: "9:16", duration: "—", copy: "", ready: false },
          { platformId: "xiaohongshu", aspectRatio: "1:1", duration: "—", copy: "", ready: false },
        ],
        createdAt: nowLabel(), queuePosition: 1, queueEta: "约 5 分钟",
      };
      setEditingTasks((prev) => [task, ...prev]);
      window.setTimeout(() => {
        setEditingTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "剪辑中", queuePosition: undefined, queueEta: undefined } : t)));
      }, 2000);
      window.setTimeout(() => {
        setEditingTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          return {
            ...t, status: "待审核" as const, completedAt: nowLabel(),
            adaptations: t.adaptations.map((a) => ({
              ...a, ready: true,
              duration: a.platformId === "douyin" ? "18s" : "20s",
              copy: a.platformId === "douyin" ? `${title.slice(0, 8)} | 新品推荐` : `${title.slice(0, 6)} · 种草分享`,
            })),
          };
        }));
      }, 5000);
      return id;
    };
    const approveEditingVideo: EcomCtx["approveEditingVideo"] = (taskId) => {
      setEditingTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: "已发布", approver: "林芳" } : t)));
    };
    const rejectEditingVideo: EcomCtx["rejectEditingVideo"] = (taskId, reason) => {
      setEditingTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: "已驳回", rejectReason: reason } : t)));
    };

    const analyzeTickets: EcomCtx["analyzeTickets"] = async () => {
      try {
        await api.post("/api/ai/tickets/triage", {});
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const reviewTicket = async (ticketId: string, body: Record<string, string>) => {
      try {
        await api.patch(`/api/commerce/tickets/${ticketId}/review`, body);
        await refreshAll();
      } catch (e) {
        reportError(e);
      }
    };
    const approveReply: EcomCtx["approveReply"] = (ticketId) => reviewTicket(ticketId, { decision: "approve" });
    const rejectReply: EcomCtx["rejectReply"] = (ticketId, reason, feedback) =>
      reviewTicket(ticketId, { decision: "reject", reason, feedback });

    return {
      stores, products, drafts, favorites, assets, connectors, audits, tasks, editingTasks, tickets,
      addStore, setStoreStatus, removeStore, toggleFavorite, addDraft, addAsset,
      enableConnector, disableConnector, submitPublish, approvePublish: approveTask, approveTask, finishPublish,
      retryFailedPlatform, rerunTask, stopTask, audit,
      createEditingTask, approveEditingVideo, rejectEditingVideo,
      analyzeTickets, approveReply, rejectReply,
    };
  }, [stores, products, drafts, favorites, assets, connectors, audits, tasks, tickets, editingTasks, refreshAll, refreshTasksAndAudits]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEcom(): EcomCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useEcom 必须在 EcomProvider 内使用");
  return ctx;
}
