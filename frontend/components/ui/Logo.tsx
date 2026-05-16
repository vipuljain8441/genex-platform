import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <div className="relative h-7 w-7">
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent to-sky opacity-90" />
        <div className="absolute inset-[3px] rounded-md bg-white grid place-items-center font-display font-bold text-accent">
          G
        </div>
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-display text-base font-semibold tracking-tight">GenEx</span>
        <span className="text-[9px] text-bone/40 tracking-[0.22em] uppercase">by Skillbrew</span>
      </div>
    </div>
  );
}
