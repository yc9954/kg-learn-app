"use client";

/**
 * Progress — thin wrapper over Radix Progress so every progress bar in the app
 * shares one accessible, animated primitive. Visual styling comes from the
 * shared --kg-* tokens in ui.module.css.
 */

import * as RadixProgress from "@radix-ui/react-progress";
import styles from "./ui.module.css";

export default function Progress({
  value,
  className,
  tone = "primary",
}: {
  value: number;
  className?: string;
  tone?: "primary" | "success";
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <RadixProgress.Root
      className={`${styles.progressRoot} ${className ?? ""}`}
      value={pct}
      data-tone={tone}
    >
      <RadixProgress.Indicator
        className={styles.progressIndicator}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </RadixProgress.Root>
  );
}
