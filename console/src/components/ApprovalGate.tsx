import { ShieldCheck } from "lucide-react";
import { Badge, Button, Modal } from "./ui";

interface Props {
  open: boolean;
  title: string;
  action: string;
  scope: string;
  approver: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ApprovalGate({ open, title, action, scope, approver, onCancel, onConfirm }: Props) {
  return (
    <Modal open={open} onClose={onCancel} title="审批闸门 · 跨平台写操作">
      <div className="rounded-2xl border border-warn/25 bg-warn/5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warn/15 text-warn">
            <ShieldCheck size={20} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold">{title}</div>
            <div className="mt-0.5 text-xs text-mute">{action}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="danger">写入</Badge>
          <span className="text-mute">将向平台执行写操作，执行后进入审计记录，可回看批准人 / 时间 / 改动对象。</span>
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-mute">目标平台</dt>
          <dd className="text-right font-medium">{scope}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-mute">审批人</dt>
          <dd className="font-medium">{approver}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-mute">审批规则</dt>
          <dd className="text-right text-mute">人工确认后才执行 · 不可跳过</dd>
        </div>
      </dl>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>驳回</Button>
        <Button onClick={onConfirm}>批准并执行</Button>
      </div>
    </Modal>
  );
}
