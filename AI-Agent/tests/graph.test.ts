/**
 * graph.new.ts 单元测试
 *
 * 测试范围：
 * 1. Graph 初始化和配置
 * 2. getRecommendedRecursionLimit 辅助函数
 * 3. Graph 基本功能验证
 *
 * 注意：这是轻量级单元测试，主要测试辅助函数和配置
 * 完整的集成测试在 graph.new.integration.test.ts 中
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { getRecommendedRecursionLimit } from "../src/agent/graph.ts";

describe("Graph.new.ts - 单元测试", () => {
  describe("辅助函数测试", () => {
    it("getRecommendedRecursionLimit - 应该根据任务数量计算递归限制", () => {
      expect(getRecommendedRecursionLimit(0)).toBe(20); // 基础限制
      expect(getRecommendedRecursionLimit(1)).toBe(35); // 20 + 15*1
      expect(getRecommendedRecursionLimit(5)).toBe(95); // 20 + 15*5
      expect(getRecommendedRecursionLimit(10)).toBe(170); // 20 + 15*10
    });

    it("getRecommendedRecursionLimit - 应该处理负数输入", () => {
      expect(getRecommendedRecursionLimit(-1)).toBe(5); // 20 + 15*(-1)
      expect(getRecommendedRecursionLimit(-5)).toBe(-55); // 20 + 15*(-5)
    });

    it("getRecommendedRecursionLimit - 应该处理大数值", () => {
      expect(getRecommendedRecursionLimit(100)).toBe(1520); // 20 + 15*100
      expect(getRecommendedRecursionLimit(1000)).toBe(15020); // 20 + 15*1000
    });

    it("getRecommendedRecursionLimit - 应该处理小数", () => {
      // 虽然任务数应该是整数，但函数应该能处理小数
      expect(getRecommendedRecursionLimit(2.5)).toBe(57.5); // 20 + 15*2.5
    });
  });
});
