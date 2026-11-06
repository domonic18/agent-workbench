import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatCard } from "./StatCard.js";

afterEach(() => {
  cleanup();
});

describe("StatCard", () => {
  it("标签、数值与补充说明都在", () => {
    render(<StatCard label="今日 Token" value="1.2M" sub="较昨日 +8%" />);

    expect(screen.getByText("今日 Token")).toBeTruthy();
    expect(screen.getByText("1.2M")).toBeTruthy();
    expect(screen.getByText("较昨日 +8%")).toBeTruthy();
  });

  it("数值不做截断，精确值走悬停提示", () => {
    const { container } = render(
      <StatCard label="Agent 在线" value="12" title="在线 12 / 登记 15" />,
    );

    expect(screen.getByText("12")).toBeTruthy();
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe("在线 12 / 登记 15");
  });
});
