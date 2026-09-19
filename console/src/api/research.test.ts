import { describe, expect, it } from "vitest";
import { candidateToFavorite, nextPollStatus, parsePriceMin } from "./research";

describe("research helpers", () => {
  it("parsePriceMin 兼容 ¥29-59 / $12.99 / 9-25 USD / 空", () => {
    expect(parsePriceMin("¥29-59")).toBe(29);
    expect(parsePriceMin("$12.99")).toBe(12.99);
    expect(parsePriceMin("9-25 USD")).toBe(9);
    expect(parsePriceMin("")).toBe(0);
  });
  it("nextPollStatus 终态判定", () => {
    expect(nextPollStatus({ status: "running" } as never)).toBe("pending");
    for (const s of ["succeeded", "partial", "failed"]) {
      expect(nextPollStatus({ status: s } as never)).toBe("done");
    }
  });
  it("candidateToFavorite 映射形状", () => {
    const f = candidateToFavorite({
      rank: 1, name: "磁吸手机支架", heat: 82, price: "¥29-59", platform: "抖音",
      run_id: "rsr_abcdef12345",
    } as never);
    expect(f).toMatchObject({ name: "磁吸手机支架", heat: 82 });
    expect(f.source).toContain("rsr abcdef"); // run_id 进 source 便于溯源
    expect(f.source).toContain("抖音");
    expect(f.price).toBe(29);
  });
});
