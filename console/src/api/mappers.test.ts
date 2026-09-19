import { describe, expect, it } from "vitest";
import {
  backendAuditToProto,
  backendTaskToProto,
  backendTicketToProto,
  connectorStatus,
  fmtTime,
  levelLabel,
  resultLabel,
  riskLabel,
  taskKindLabel,
  taskStatus,
  ticketStatus,
} from "./mappers";

describe("mappers 枚举全对照", () => {
  it("taskStatus 覆盖后端全部状态", () => {
    expect(taskStatus("created")).toBe("排队中");
    expect(taskStatus("pending_approval")).toBe("待审批");
    expect(taskStatus("running")).toBe("运行中");
    expect(taskStatus("succeeded")).toBe("成功");
    expect(taskStatus("partial_failed")).toBe("部分失败");
    expect(taskStatus("failed")).toBe("失败");
    expect(taskStatus("rejected")).toBe("已驳回");
    expect(taskStatus("weird")).toBe("weird");
  });

  it("level/result/risk/connector 状态映射", () => {
    expect(levelLabel("read")).toBe("只读");
    expect(levelLabel("write")).toBe("写入");
    expect(levelLabel("high_risk")).toBe("高危");
    expect(levelLabel("system")).toBe("系统");
    expect(resultLabel("ok")).toBe("成功");
    expect(resultLabel("denied")).toBe("已拒绝");
    expect(resultLabel("failed")).toBe("失败");
    expect(riskLabel("low")).toBe("低");
    expect(riskLabel("medium")).toBe("中");
    expect(riskLabel("high")).toBe("高");
    expect(connectorStatus("active")).toBe("已安装");
    expect(connectorStatus("revoked")).toBe("未安装");
    expect(connectorStatus("expired")).toBe("授权过期");
  });

  it("ticketStatus：后端 已转执行 归一为原型的 已发出", () => {
    expect(ticketStatus("待分析")).toBe("待分析");
    expect(ticketStatus("待审批")).toBe("待审批");
    expect(ticketStatus("已驳回")).toBe("已驳回");
    expect(ticketStatus("已发出")).toBe("已发出");
    expect(ticketStatus("已转执行")).toBe("已发出");
  });

  it("taskKindLabel 与 fmtTime", () => {
    expect(taskKindLabel("publish")).toBe("商品上架");
    expect(taskKindLabel("after_sales")).toBe("售后处理");
    expect(taskKindLabel("custom")).toBe("custom");
    expect(fmtTime("2026-09-03T12:00:00")).toBe("09-03 12:00");
    expect(fmtTime(null)).toBe("");
  });
});

describe("backendTaskToProto", () => {
  const base = {
    id: "tsk-1",
    type: "publish",
    title: "上架 · 快充数据线",
    status: "partial_failed",
    payload: { platforms: ["taobao-shop", "douyin-shop"] },
    created_at: "2026-09-03T12:00:00",
    steps: [
      { seq: 1, name: "淘宝", tool: "taobao-shop:publish_product", status: "succeeded", error: null },
      { seq: 2, name: "抖音", tool: "douyin-shop:publish_product", status: "failed", error: "平台合规打回：价格异常" },
    ],
    approval: { decided_by: "approver-1" },
  };

  it("partial_failed → 部分失败 + 打回结果带原因", () => {
    const t = backendTaskToProto(base);
    expect(t.id).toBe("tsk-1");
    expect(t.kind).toBe("商品上架");
    expect(t.status).toBe("部分失败");
    expect(t.stepIndex).toBe(1);
    expect(t.steps).toEqual(["淘宝", "抖音"]);
    expect(t.target).toBe("淘宝、抖音");
    expect(t.startedAt).toBe("09-03 12:00");
    expect(t.approver).toBe("approver-1");
    expect(t.results).toEqual([
      { platformId: "taobao", status: "成功" },
      { platformId: "douyin", status: "打回", reason: "平台合规打回：价格异常" },
    ]);
  });

  it("运行中任务不产出 results", () => {
    const t = backendTaskToProto({ ...base, status: "running", approval: null });
    expect(t.status).toBe("运行中");
    expect(t.results).toBeUndefined();
    expect(t.approver).toBeUndefined();
  });

  it("售后任务 target 兜底为工单标题片段", () => {
    const t = backendTaskToProto({
      ...base,
      type: "after_sales",
      status: "succeeded",
      payload: { ticket_id: "tk-9" },
      steps: [{ seq: 1, name: "推送回复", tool: "pdd-shop:push_reply", status: "succeeded", error: null }],
    });
    expect(t.kind).toBe("售后处理");
    expect(t.status).toBe("成功");
    expect(t.stepIndex).toBe(1);
    expect(t.target).toBe("拼多多 · tk-9");
    expect(t.results).toEqual([{ platformId: "pdd", status: "成功" }]);
  });
});

describe("backendAuditToProto / backendTicketToProto", () => {
  it("审计行映射", () => {
    const a = backendAuditToProto({
      id: "au-1",
      at: "2026-09-03T12:00:00",
      user_id: "u1",
      actor: "user:陈晨",
      action: "commerce.publish",
      target_type: "task",
      target_id: "tsk-1",
      level: "write",
      result: "ok",
      detail: null,
    });
    expect(a).toEqual({
      id: "au-1",
      time: "09-03 12:00",
      user: "陈晨",
      action: "commerce.publish",
      target: "tsk-1",
      level: "写入",
      result: "成功",
    });
  });

  it("actor 非 user: 前缀时原样展示", () => {
    const a = backendAuditToProto({
      id: "au-2", at: "2026-09-03T12:00:00", user_id: "", actor: "system",
      action: "auth.denied", target_type: "request", target_id: "/api/x", level: "system", result: "denied", detail: null,
    });
    expect(a.user).toBe("system");
    expect(a.target).toBe("/api/x");
    expect(a.result).toBe("已拒绝");
  });

  it("工单行映射（snake_case → 原型 camelCase）", () => {
    const t = backendTicketToProto({
      id: "tk-1",
      order_ref: "DD2026090201",
      customer: "王小明",
      platform: "taobao",
      product_name: "快充数据线",
      complaint: "充电线收到后磁吸端松动",
      attribution: "质量",
      confidence: 92,
      suggestion: "回复草稿",
      reply_draft: "亲，抱歉…",
      refund_amount: null,
      status: "待审批",
      created_at: "2026-09-02T10:00:00",
      approved_at: null,
      reject_reason: null,
      reject_feedback: null,
    });
    expect(t).toEqual({
      id: "tk-1",
      orderId: "DD2026090201",
      customer: "王小明",
      platformId: "taobao",
      productName: "快充数据线",
      complaint: "充电线收到后磁吸端松动",
      attribution: "质量",
      confidence: 92,
      suggestion: "回复草稿",
      replyDraft: "亲，抱歉…",
      status: "待审批",
      createdAt: "09-02 10:00",
    });
  });
});
