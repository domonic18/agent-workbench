import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LogoIcon } from "./LogoIcon.js";

afterEach(() => {
  cleanup();
});

describe("LogoIcon", () => {
  it("纯装饰图形，对读屏隐藏", () => {
    const { container } = render(<LogoIcon />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("默认尺寸 28，可按位置指定", () => {
    const { container } = render(<LogoIcon size={32} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 32 32");
  });
});
