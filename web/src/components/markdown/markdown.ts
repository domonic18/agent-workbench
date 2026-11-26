/**
 * Markdown 正文排版（知识正文与 Agent 手册共用）：
 * react-markdown 渲染的是任意元素标签，无法逐元素挂 className，
 * 因此在容器上用任意变体统一排版；行长限在 --content-prose。
 */
export const MARKDOWN_CLASS = [
  "max-w-content-prose text-sm leading-[1.7] text-foreground [overflow-wrap:anywhere]",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:leading-[1.35] [&_h1]:text-xl",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:leading-[1.35] [&_h2]:text-lg",
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:leading-[1.35] [&_h3]:text-md",
  "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:leading-[1.35] [&_h4]:text-sm",
  "[&>:first-child]:mt-0",
  "[&_p]:mt-0 [&_p]:mb-3",
  "[&_ul]:mt-0 [&_ul]:mb-3 [&_ul]:pl-5",
  "[&_ol]:mt-0 [&_ol]:mb-3 [&_ol]:pl-5",
  "[&_blockquote]:mt-0 [&_blockquote]:mb-3 [&_blockquote]:pl-3 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:text-text-secondary",
  "[&_pre]:mt-0 [&_pre]:mb-3 [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-line-soft [&_pre]:rounded-md [&_pre]:bg-surface-2",
  "[&_pre_code]:p-0 [&_pre_code]:bg-transparent",
  "[&_table]:mt-0 [&_table]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:px-3 [&_th]:py-2 [&_th]:border [&_th]:border-line-soft [&_th]:text-left [&_th]:bg-surface-2",
  "[&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-line-soft [&_td]:text-left",
  "[&_a]:text-accent [&_a]:[text-underline-offset:4px]",
  "[&_code]:px-1 [&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:font-mono [&_code]:text-xs",
].join(" ");
