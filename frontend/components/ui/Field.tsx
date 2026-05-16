import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full bg-ink-100 text-bone placeholder:text-bone/35 border border-black/[0.08] rounded-xl px-4 py-3 outline-none transition focus:bg-white focus:border-accent/60 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.14)]";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, className)} {...props} />
  )
);
TextInput.displayName = "TextInput";

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(base, "min-h-[120px] resize-y", className)} {...props} />
  )
);
TextArea.displayName = "TextArea";

export function Label({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block mb-1.5 text-xs font-medium tracking-wider text-bone/60 uppercase">
      {children}
      {hint && <span className="ml-2 normal-case tracking-normal text-bone/40">— {hint}</span>}
    </label>
  );
}
