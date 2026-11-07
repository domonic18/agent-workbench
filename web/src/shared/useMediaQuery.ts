import { useEffect, useState } from "react";

/** 与 arch/03 §8 的移动适配一致：768px 以下走卡片布局 */
export const NARROW_QUERY = "(max-width: 767px)";

/** 依媒体查询切换布局；服务端与测试环境统一按宽屏渲染 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // 老浏览器与部分测试环境没有 matchMedia，退回宽屏布局
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(query);
    setMatches(list.matches);
    function handleChange(event: MediaQueryListEvent): void {
      setMatches(event.matches);
    }
    list.addEventListener("change", handleChange);
    return () => list.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
