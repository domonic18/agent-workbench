import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ThemeProvider } from "./shared/theme.js";
import "./global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // 实时性由 SSE 失效驱动,不靠窗口聚焦或轮询(03 §5)
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root 不存在");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
