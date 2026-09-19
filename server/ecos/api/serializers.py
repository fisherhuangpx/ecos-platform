"""出参序列化：凭据明文绝不进入任何响应。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..connectors.catalog import ConnectorEntry
from ..models import (
    Approval,
    AuditLog,
    ConnectorInstance,
    ResearchCandidate,
    ResearchRun,
    ResearchStep,
    Task,
)


def entry_out(entry: ConnectorEntry) -> dict[str, Any]:
    return {
        "kind": entry.kind,
        "name": entry.name,
        "category": entry.category,
        "auth_kind": entry.auth_kind.value,
        "mcp_mode": entry.mcp_mode.value,
        "description": entry.description,
        "credential_fields": list(entry.credential_fields),
        "tools": [
            {
                "name": decl.name,
                "scope": decl.scope.value,
                "risk": decl.risk.value,
                "description": decl.description,
                "requires_approval": decl.requires_approval,
                "params": dict(decl.params),
                "required": list(decl.required),
            }
            for decl in entry.tools
        ],
    }


def instance_out(instance: ConnectorInstance) -> dict[str, Any]:
    return {
        "id": instance.id,
        "kind": instance.kind,
        "status": instance.status,
        "shared": instance.shared,
        "mcp_server_name": instance.mcp_server_name,
        "credential_expires_at": _dt(instance.credential_expires_at),
        "created_at": _dt(instance.created_at),
    }


def approval_out(approval: Approval) -> dict[str, Any]:
    return {
        "id": approval.id,
        "task_id": approval.task_id,
        "status": approval.status,
        "requested_by": approval.requested_by,
        "decided_by": approval.decided_by,
        "note": approval.note,
        "decided_at": _dt(approval.decided_at),
        "created_at": _dt(approval.created_at),
    }


def task_out(task: Task, approval: Approval | None = None) -> dict[str, Any]:
    return {
        "id": task.id,
        "user_id": task.user_id,
        "type": task.type,
        "title": task.title,
        "status": task.status,
        "payload": dict(task.payload or {}),
        "result": task.result,
        "created_at": _dt(task.created_at),
        "steps": [
            {
                "id": step.id,
                "seq": step.seq,
                "name": step.name,
                "tool": step.tool,
                "args": dict(step.args or {}),
                "scope": step.scope,
                "risk": step.risk,
                "requires_approval": step.requires_approval,
                "status": step.status,
                "attempt": step.attempt,
                "output": step.output,
                "error": step.error,
            }
            for step in task.steps
        ],
        "approval": approval_out(approval) if approval is not None else None,
    }


def audit_out(row: AuditLog) -> dict[str, Any]:
    return {
        "id": row.id,
        "at": _dt(row.at),
        "user_id": row.user_id,
        "actor": row.actor,
        "action": row.action,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "level": row.level,
        "result": row.result,
        "detail": row.detail,
    }


def principal_out(principal) -> dict[str, Any]:
    return {
        "user_id": principal.user_id,
        "display_name": principal.display_name,
        "roles": list(principal.roles),
        "permissions": sorted(principal.permissions),
    }


def research_step_out(step: ResearchStep) -> dict[str, Any]:
    return {
        "id": step.id,
        "seq": step.seq,
        "kind": step.kind,
        "source_id": step.source_id,
        "args_digest": step.args_digest,
        "summary": step.summary,
        "status": step.status,
        "seconds": step.seconds,
        "error": step.error,
    }


def research_candidate_out(cand: ResearchCandidate) -> dict[str, Any]:
    return {
        "id": cand.id,
        "rank": cand.rank,
        "name": cand.name,
        "platform": cand.platform,
        "board": cand.board,
        "price": cand.price,
        "sales_signal": cand.sales_signal,
        "heat": cand.heat,
        "keywords": list(cand.keywords or []),
        "score": cand.score,
        "score_basis": dict(cand.score_basis or {}),
        "evidence": list(cand.evidence or []),
    }


def research_run_out(
    run: ResearchRun,
    steps: list[ResearchStep] | None = None,
    candidates: list[ResearchCandidate] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": run.id,
        "user_id": run.user_id,
        "category": run.category,
        "boards": list(run.boards or []),
        "status": run.status,
        "mode": run.mode,
        "signal_count": run.signal_count,
        "error": run.error,
        "narrative": run.narrative,
        "tokens_in": run.tokens_in,
        "tokens_out": run.tokens_out,
        "started_at": _dt(run.started_at),
        "finished_at": _dt(run.finished_at),
        "created_at": _dt(run.created_at),
    }
    if steps is not None:
        out["steps"] = [research_step_out(st) for st in steps]
    if candidates is not None:
        out["candidates"] = [research_candidate_out(c) for c in candidates]
    return out


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
