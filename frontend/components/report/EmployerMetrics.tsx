"use client";

import { motion } from "framer-motion";
import { Card, CardBody } from "@/components/ui/Card";
import type { MetricScore } from "@/lib/report-types";

function Radar({ metrics }: { metrics: MetricScore[] }) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 90;
  const n = metrics.length;
  if (n < 3) return null;

  const angle = (i: number) => (-Math.PI / 2) + (i * 2 * Math.PI) / n;
  const point = (i: number, scale: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * radius * scale, cy + Math.sin(a) * radius * scale];
  };

  const polygon = metrics
    .map((m, i) => point(i, m.score / m.max))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const grid = [0.25, 0.5, 0.75, 1].map((s) =>
    metrics
      .map((_, i) => point(i, s))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" "),
  );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {grid.map((pts, idx) => (
        <polygon
          key={idx}
          points={pts}
          fill="none"
          stroke="rgba(15,15,23,0.08)"
          strokeWidth={1}
        />
      ))}
      {metrics.map((_, i) => {
        const [x, y] = point(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="rgba(15,15,23,0.06)"
            strokeWidth={1}
          />
        );
      })}
      <motion.polygon
        points={polygon}
        fill="rgba(124,58,237,0.18)"
        stroke="#7c3aed"
        strokeWidth={2}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      />
      {metrics.map((m, i) => {
        const [x, y] = point(i, 1.15);
        return (
          <text
            key={m.key}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-bone/65"
            style={{ fontSize: 10 }}
          >
            {m.label}
          </text>
        );
      })}
    </svg>
  );
}

export function EmployerMetrics({ metrics }: { metrics: MetricScore[] }) {
  if (metrics.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
            Employer metrics
          </div>
          <div className="text-sm text-bone/55">
            Metric scores require evaluator results — not yet available for this session.
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
          Employer-configured metrics
        </div>
        {metrics.length >= 3 ? (
          <Radar metrics={metrics} />
        ) : (
          <div className="space-y-3">
            {metrics.map((m) => {
              const pct = (m.score / m.max) * 100;
              return (
                <div key={m.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-bone/80">{m.label}</span>
                    <span className="font-mono text-xs text-bone/55">
                      {Math.round(pct)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-black/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-5 grid sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {metrics.map((m) => (
            <div
              key={m.key}
              className="rounded-lg border border-black/[0.06] bg-ink-100/60 px-3 py-2"
            >
              <div className="text-bone/55">{m.label}</div>
              <div className="font-mono text-bone/85 mt-0.5">
                {Math.round(m.score)} / {m.max}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
