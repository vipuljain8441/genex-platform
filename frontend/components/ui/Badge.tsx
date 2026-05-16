import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "accent" | "violet" | "coral" | "amber";

const tones: Record<Tone, string> = {
  default: "bg-black/5 text-bone/70 border-black/10",
  accent: "bg-accent/15 text-accent border-accent/30",
  violet: "bg-violet/15 text-violet border-violet/30",
  coral: "bg-coral/15 text-coral border-coral/30",
  amber: "bg-amber/15 text-amber border-amber/30",
};

export function Badge({
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
