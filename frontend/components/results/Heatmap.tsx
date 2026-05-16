"use client";

import { motion } from "framer-motion";

type Cell = {
  file_path: string;
  bucket: number;
  intensity: number;
  events: number;
};

type HeatmapData = {
  buckets: number;
  bucket_seconds: number;
  files: string[];
  cells: Cell[];
  started_at: string;
  ended_at: string;
  totals_by_kind: Record<string, number>;
};

function colorForIntensity(v: number, max: number) {
  if (max <= 0 || v <= 0) return "rgba(15,15,23,0.05)";
  const t = Math.min(v / max, 1);
  // Lerp between violet (low) and accent-green (high) via amber midtone
  // Light-theme palette: sky (cool low) → violet (mid) → mint (high)
  if (t < 0.5) {
    // sky #0ea5e9 → violet #7c3aed
    const k = t * 2;
    const r = Math.round(14 + (124 - 14) * k);
    const g = Math.round(165 + (58 - 165) * k);
    const b = Math.round(233 + (237 - 233) * k);
    return `rgba(${r},${g},${b},${0.18 + 0.55 * t})`;
  }
  // violet → mint #10b981
  const k = (t - 0.5) * 2;
  const r = Math.round(124 + (16 - 124) * k);
  const g = Math.round(58 + (185 - 58) * k);
  const b = Math.round(237 + (129 - 237) * k);
  return `rgba(${r},${g},${b},${0.55 + 0.40 * k})`;
}

export function Heatmap({ data }: { data: HeatmapData }) {
  const max = data.cells.reduce((m, c) => Math.max(m, c.intensity), 0);
  const grid: Record<string, Cell> = {};
  for (const c of data.cells) grid[`${c.file_path}__${c.bucket}`] = c;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-wider text-bone/40 px-2 py-1 sticky left-0 bg-ink/95 backdrop-blur z-10">
                File
              </th>
              {Array.from({ length: data.buckets }).map((_, b) => (
                <th key={b} className="px-0.5 py-1 text-[9px] text-bone/30 font-mono">
                  {b * data.bucket_seconds}s
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.files.map((f) => (
              <tr key={f}>
                <td className="px-2 py-1 font-mono text-[11px] text-bone/65 whitespace-nowrap sticky left-0 bg-ink/95 backdrop-blur z-10">
                  {f}
                </td>
                {Array.from({ length: data.buckets }).map((_, b) => {
                  const cell = grid[`${f}__${b}`];
                  const v = cell?.intensity || 0;
                  return (
                    <td key={b} className="px-0.5 py-0.5">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: b * 0.01 }}
                        title={cell ? `${cell.events} events · intensity ${v}` : ""}
                        className="h-5 w-5 rounded-[3px]"
                        style={{ background: colorForIntensity(v, max) }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-bone/45">
        <span>Low</span>
        <div className="h-2 w-40 rounded-full"
             style={{
               background:
                 "linear-gradient(90deg, rgba(14,165,233,0.35), rgba(124,58,237,0.7), rgba(16,185,129,0.95))",
             }}
        />
        <span>High activity</span>
      </div>
    </div>
  );
}
