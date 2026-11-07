import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, ThemeProvider, useTheme, type ThemePreference } from "./theme.js";

function stubMatchMedia(dark: boolean): {
  setDark: (next: boolean) => void;
} {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return {
    setDark(next: boolean): void {
      media.matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

function Probe(): React.ReactElement {
  const { preference, resolved, setPreference, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button
        type="button"
        onClick={() => setPreference("dark" as ThemePreference)}
        data-testid="to-dark"
      >
        深色
      </button>
      <button type="button" onClick={toggleTheme} data-testid="toggle">
        切换
      </button>
    </div>
  );
}

describe("主题机制", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("未存偏好时跟随系统并落到 data-theme", () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("手动选择深色会持久化并覆盖系统偏好", () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId("to-dark"));

    expect(screen.getByTestId("preference").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("系统主题变化时,跟随系统的用户会同步切到深色", () => {
    const media = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => {
      media.setDark(true);
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("已存偏好优先于系统设置", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("preference").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("切换开关在明亮与暗黑之间直接来回", () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(screen.getByTestId("preference").textContent).toBe("dark");

    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(screen.getByTestId("preference").textContent).toBe("light");
  });
});
