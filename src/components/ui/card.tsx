import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]", className)} {...props} />;
}
