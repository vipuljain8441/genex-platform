"use client";

import { Card, CardBody } from "@/components/ui/Card";
import type {
  KeystrokePattern,
  KeystrokePatternSummary,
} from "@/lib/report-types";

const PATTERN_LABEL: Record<KeystrokePattern, string> = {
  fluent: "Fluent coder",
  "think-then-type": "Think-then-type",
  "paste-dominant": "Paste-dominant",
  uncertain: "Uncertain",
  insufficient_data: "Not enough typing data",
};

const PATTERN_BADGE: Record<KeystrokePattern, string> = {
  fluent: "bg-mint/15 text-mint",
  "think-then-type": "bg-accent-fade text-accent",
  "paste-dominant": "bg-amber/15 text-amber",
  uncertain: "bg-coral/15 text-coral",
  insufficient_data: "bg-bone/10 text-bone/55",
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) {
    return <div className="h-12 text-xs text-bone/45">No keystroke buckets recorded.</div>;
  }
  const max = Math.max(...values, 1);
  const w = 100;
  const h = 40;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(h - (v / max) * h).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="#7c3aed"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/[0.06] bg-ink-100/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-bone/45">{label}</div>
      <div className="font-display text-lg text-bone mt-0.5">{value}</div>
    </div>
  );
}

export function CodingRhythm({ data }: { data: KeystrokePatternSummary }) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
            7c · Coding rhythm
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${PATTERN_BADGE[data.dominant_pattern]}`}
          >
            {PATTERN_LABEL[data.dominant_pattern]}
          </span>
        </div>

        <div>
          <div className="text-xs text-bone/55 mb-1">WPM over session</div>
          <Sparkline values={data.wpm_sparkline} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Stat label="Avg WPM" value={data.average_wpm} />
          <Stat label="Peak WPM" value={data.peak_wpm} />
          <Stat label="Total keys" value={data.total_keystrokes} />
          <Stat label="Undo" value={data.undo_count} />
          <Stat
            label="Paste/type"
            value={`${Math.round(data.paste_vs_type_ratio * 100)}%`}
          />
        </div>

        <details className="text-[11px] text-bone/55">
          <summary className="cursor-pointer select-none text-bone/65">
            How to read this
          </summary>
          <div className="mt-2 leading-relaxed">
            Keystroke values and content are <strong>never recorded</strong> — only timing,
            counts, and a category for special keys (Ctrl+Z / Ctrl+V / Backspace). Patterns:
            <strong> Fluent</strong> = steady WPM with natural pauses. <strong>Think-then-type</strong>
            = long pauses followed by confident bursts (senior pattern). <strong>Paste-dominant</strong>
            = &gt;30% of input came from paste events. <strong>Uncertain</strong> = high delete/undo rate.
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
