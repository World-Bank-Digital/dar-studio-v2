import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  children,
}: {
  className?: string;
  tone?: "neutral" | "forest" | "warn" | "danger" | "ok";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-moss/60 text-ink",
    forest: "bg-forest text-forest-fg",
    warn: "bg-amber-100 text-warn",
    danger: "bg-red-100 text-danger",
    ok: "bg-emerald-100 text-ok",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
