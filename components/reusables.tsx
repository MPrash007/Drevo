import type { ReactNode } from "react";

export const GrayTitle = ({ children }: { children: ReactNode }) => (
  <span className="text-foreground">{children}</span>
);

// Gradient stops are theme-specific so the lightest stop still clears 4.5:1
// on white and on the dark card (#111). Projects and chat titles share this.
export const BrandTitle = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={`bg-linear-to-br bg-clip-text font-serif text-transparent from-violet-800 via-violet-700 to-indigo-800 dark:from-violet-200 dark:via-violet-300 dark:to-indigo-200 ${className}`}
  >
    {children}
  </span>
);

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-800 dark:text-violet-200">
    <span className="h-px w-4 bg-violet-800 dark:bg-violet-200" />
    {children}
    <span className="h-px w-4 bg-violet-800 dark:bg-violet-200" />
  </p>
);

export const SectionHeading = ({
  gray,
  brand,
}: {
  gray: string;
  brand: string;
}) => (
  <h2 className="font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-tight">
    <GrayTitle>{gray}</GrayTitle>
    <br />
    <BrandTitle>{brand}</BrandTitle>
  </h2>
);
