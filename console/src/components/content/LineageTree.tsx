// 二创血缘树（/editing 页底）：parent→children 一次建表，rootId 若为子孙则先沿 sourceTaskId 回溯到链首，
// 再纯递归展开 <ul>/<li> 横向缩进；节点 = 标题 + 状态徽章 + 引擎徽章（fallback 时带"保底"角标）。
import { Badge } from "../ui";
import type { EditingStatus, EditingTask } from "../../data/ecom";
import { EngineBadge } from "./kit";

const statusTone: Record<EditingStatus, "neon" | "accent" | "warn" | "danger" | "mute"> = {
  排队中: "mute", 剪辑中: "accent", 待审核: "warn", 已发布: "neon", 已驳回: "danger", 失败: "danger",
};

export function LineageTree({ jobs, rootId }: { jobs: EditingTask[]; rootId: string }) {
  const byId = new Map<string, EditingTask>();
  const childrenOf = new Map<string, EditingTask[]>();
  for (const job of jobs) {
    byId.set(job.id, job);
    if (!job.sourceTaskId) continue;
    const list = childrenOf.get(job.sourceTaskId);
    if (list) list.push(job);
    else childrenOf.set(job.sourceTaskId, [job]);
  }

  const start = byId.get(rootId);
  if (!start) return <p className="text-sm text-mute">该任务暂无血缘记录</p>;

  // rootId 允许传链上任一节点：向上回溯到根（遇断链或脏数据成环即就地止步）
  const up = new Set<string>([start.id]);
  let root = start;
  while (root.sourceTaskId) {
    const parent = byId.get(root.sourceTaskId);
    if (!parent || up.has(parent.id)) break;
    up.add(parent.id);
    root = parent;
  }

  return (
    <ul className="space-y-2 text-sm">
      <Node task={root} depth={0} childrenOf={childrenOf} visited={new Set<string>()} />
    </ul>
  );
}

function Node({
  task, depth, childrenOf, visited,
}: {
  task: EditingTask; depth: number; childrenOf: Map<string, EditingTask[]>; visited: Set<string>;
}) {
  if (visited.has(task.id)) return null; // 同一任务在一条链上只出现一次，防脏数据无限递归
  // 渲染期不写共享集合：往下传"含本节点的新 Set"，去重作用域是这条分支
  const seen = new Set([...visited, task.id]);
  const children = childrenOf.get(task.id) ?? [];

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-mute/50">{depth === 0 ? "●" : "└─"}</span>
        <span className="font-medium text-ink">{task.title}</span>
        <Badge tone={statusTone[task.status]}>{task.status}</Badge>
        <EngineBadge engine={task.engine ?? task.provider} fallback={task.fallbackUsed} />
        {depth === 0 && <span className="text-[10px] text-mute">源任务</span>}
      </div>
      {children.length > 0 && (
        <ul className="ml-1.5 mt-2 space-y-2 border-l border-line pl-4">
          {children.map((child) => (
            <Node key={child.id} task={child} depth={depth + 1} childrenOf={childrenOf} visited={seen} />
          ))}
        </ul>
      )}
    </li>
  );
}
