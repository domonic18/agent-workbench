export interface LogoIconProps {
  size?: number;
}

/**
 * 控制台标识：一个中枢协调多个 Agent。
 *
 * 全用 currentColor，随主题取色；不引外部素材。
 */
export function LogoIcon({ size = 28 }: LogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M16 16 16 8.4M16 16 9.2 20M16 16 22.8 20"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" />
      <circle cx="16" cy="8.4" r="2.2" fill="currentColor" />
      <circle cx="9.2" cy="20" r="2.2" fill="currentColor" />
      <circle cx="22.8" cy="20" r="2.2" fill="currentColor" />
    </svg>
  );
}
