import { describe, expect, it } from "vitest";
import { describeCron } from "./cron.js";

describe("cron 频率人话化", () => {
  it("每天多时刻", () => {
    expect(describeCron("0 9,15,19 * * *")).toEqual({ text: "每天 09:00 / 15:00 / 19:00", parsed: true });
  });

  it("工作日与每周单日", () => {
    expect(describeCron("0 19 * * 1-5").text).toBe("工作日 19:00");
    expect(describeCron("43 9 * * 6").text).toBe("每周六 09:43");
    expect(describeCron("0 8 * * 1").text).toBe("每周一 08:00");
  });

  it("每小时与步长", () => {
    expect(describeCron("17 * * * *").text).toBe("每小时 17 分");
    expect(describeCron("*/15 * * * *").text).toBe("每 15 分钟");
    expect(describeCron("* * * * *").text).toBe("每分钟");
  });

  it("每月与每年", () => {
    expect(describeCron("0 0 1 * *").text).toBe("每月 1 日 00:00");
    expect(describeCron("30 2 15 3 *").text).toBe("每年 3 月 15 日 02:30");
  });

  it("解析不了就原样给出表达式并标注", () => {
    expect(describeCron("不是 cron")).toEqual({ text: "不是 cron", parsed: false });
    expect(describeCron("60 * * * *").parsed).toBe(false);
  });
});
