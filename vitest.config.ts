import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "collector/**/*.test.ts", "e2e/**/*.test.ts"],
    // 每跑批前回收陈旧测试库，避免残留膨胀拖垮 CREATE DATABASE（src/store/test-db-gc.ts）
    globalSetup: ["src/store/test-db-gc.ts"],
  },
});
