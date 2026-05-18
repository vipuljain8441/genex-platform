"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  Clock3,
  FileCode2,
  Gauge,
  MessageSquareText,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
  TimerReset,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ChallengePanel } from "@/components/candidate/ChallengePanel";
import { ChallengesTopBar } from "@/components/candidate/ChallengesTopBar";
import { api } from "@/lib/api";
import type {
  PlaybackChallenge,
  PlaybackChallengeResponse,
  PlaybackData,
  PlaybackFile,
  PlaybackLineRange,
  PlaybackStep,
} from "@/lib/report-types";
import { cn, shortId } from "@/lib/utils";

const BASE_STEP_INTERVAL_MS = 1200;
const SPEED_OPTIONS = [0.8, 1, 1.6] as const;

export default function PlaybackPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<PlaybackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);

  useEffect(() => {
    let cancelled = false;
    api.getPlayback(params.id)
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load playback");
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    if (!playing || !data || data.steps.length <= 1) return;
    if (index >= data.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIndex((current) => Math.min(current + 1, data.steps.length - 1));
    }, Math.round(BASE_STEP_INTERVAL_MS / speed));
    return () => window.clearTimeout(timer);
  }, [playing, data, index, speed]);

  const currentStep = data?.steps[index] ?? null;

  const activeChallengeId = useMemo(() => {
    if (!data) return null;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const candidate = data.steps[cursor]?.challenge_id;
      if (candidate) return candidate;
    }
    return data.initial_challenge_id;
  }, [data, index]);

  const activeChallenge = useMemo(
    () => data?.challenges.find((item) => item.id === activeChallengeId) ?? null,
    [data, activeChallengeId]
  );

  const currentPanel = useMemo(() => {
    if (!data) return null;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const panel = data.steps[cursor]?.panel;
      if (panel) return panel;
    }
    return null;
  }, [data, index]);

  const activeFile = useMemo(() => {
    if (!data) return null;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const path = data.steps[cursor]?.file_path;
      if (!path) continue;
      const file = data.files.find((item) => item.path === path);
      if (file) return file;
    }
    return data.files[0] ?? null;
  }, [data, index]);

  const recentSteps = useMemo(() => {
    if (!data) return [];
    return data.steps.slice(Math.max(0, index - 7), index + 1);
  }, [data, index]);

  const terminalSteps = useMemo(() => {
    if (!data) return [];
    return data.steps
      .filter((step) => (step.kind === "terminal_command" || step.kind === "run") && step.index <= index)
      .slice(-6);
  }, [data, index]);

  const visibleBuddy = useMemo(() => {
    if (!data || !currentStep) return [];
    const currentAt = new Date(currentStep.at).getTime();
    return data.buddy_transcript
      .filter((turn) => new Date(turn.at).getTime() <= currentAt)
      .slice(-8);
  }, [data, currentStep]);

  const topFiles = useMemo(() => {
    if (!data) return [];
    return [...data.files]
      .sort((left, right) => right.touched_count - left.touched_count)
      .slice(0, 5);
  }, [data]);

  const notableMoments = useMemo(() => {
    if (!data) return [];
    const moments: PlaybackStep[] = [];
    const seen = new Set<string>();

    for (const step of data.steps) {
      const challengeKey = step.challenge_id ? `challenge:${step.challenge_id}` : null;
      const fileKey = step.file_path ? `file:${step.file_path}` : null;

      if (step.kind === "run" || step.kind === "terminal_command") {
        moments.push(step);
        continue;
      }
      if (step.actor === "buddy") {
        moments.push(step);
        continue;
      }
      if (challengeKey && !seen.has(challengeKey)) {
        seen.add(challengeKey);
        moments.push(step);
        continue;
      }
      if (fileKey && !seen.has(fileKey) && moments.length < 8) {
        seen.add(fileKey);
        moments.push(step);
      }
    }

    return moments.slice(0, 8);
  }, [data]);

  if (error) {
    return (
      <>
        <Nav />
        <main className="pt-16 px-6">
          <div className="mx-auto max-w-4xl">
            <Card>
              <CardBody className="text-coral text-sm">{error}</CardBody>
            </Card>
          </div>
        </main>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Nav />
        <main className="pt-20 px-6">
          <div className="mx-auto max-w-4xl text-bone/45 text-sm">Loading reconstructed playback…</div>
        </main>
      </>
    );
  }

  const totalSteps = data.steps.length;
  const displayedStep = totalSteps === 0 ? 0 : Math.min(index + 1, totalSteps);

  return (
    <>
      <Nav />
      <main className="relative overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(248,214,168,0.18),_transparent_36%),radial-gradient(circle_at_right,_rgba(31,122,224,0.12),_transparent_28%),linear-gradient(180deg,_#f9f6ef_0%,_#f4efe4_24%,_#eef4f8_100%)] pt-8 pb-24 px-4 sm:px-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[linear-gradient(180deg,_rgba(255,255,255,0.34)_0%,_rgba(255,255,255,0)_100%)]" />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="relative mx-auto max-w-[1540px] space-y-5"
        >
          <ReplayHero
            data={data}
            currentStep={currentStep}
            currentPanel={currentPanel}
            displayedStep={displayedStep}
            totalSteps={totalSteps}
            playing={playing}
            speed={speed}
            onTogglePlay={() => setPlaying((current) => !current)}
            onReset={() => {
              setIndex(0);
              setPlaying(false);
            }}
            onSpeedChange={setSpeed}
          />

          <ReplayTimelineCard
            data={data}
            currentStep={currentStep}
            index={index}
            notableMoments={notableMoments}
            onSeek={(target) => {
              setPlaying(false);
              setIndex(target);
            }}
          />

          <section className="overflow-hidden rounded-[32px] border border-black/[0.07] bg-[linear-gradient(180deg,_rgba(255,255,255,0.84)_0%,_rgba(247,244,236,0.82)_10%,_rgba(21,24,30,0.97)_10.1%,_rgba(18,21,28,0.98)_100%)] shadow-[0_28px_90px_rgba(39,41,54,0.14)]">
            <div className="border-b border-white/8 px-4 py-4 text-white sm:px-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
                    Session Theater
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight">
                    Candidate workspace replay with Buddy, terminal, and task context
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <FocusPill label="Focus file" value={activeFile?.path ?? "Waiting for file activity"} />
                  <FocusPill label="Panel" value={currentPanel || "workspace"} />
                  <FocusPill label="Challenge" value={activeChallenge?.title ?? "Primary brief"} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 border-b border-white/8 bg-[linear-gradient(180deg,_rgba(18,21,28,0.86)_0%,_rgba(18,21,28,0.7)_100%)] px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <WorkspaceInsightStrip
                step={currentStep}
                activeChallenge={activeChallenge}
                activeFile={activeFile}
                terminalCount={terminalSteps.length}
                buddyCount={visibleBuddy.length}
              />
              <TouchedFilesShelf files={topFiles} activeFilePath={activeFile?.path ?? null} />
            </div>

            <div className="flex min-h-[980px] overflow-hidden">
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <ChallengesTopBar
                  challenges={data.challenges as any}
                  activeChallengeId={activeChallengeId}
                  responses={data.challenge_responses as any}
                  onSelectChallenge={() => {}}
                />

                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="h-[308px] flex-shrink-0 overflow-hidden bg-[linear-gradient(180deg,_#fbf7ee_0%,_#f4efe3_100%)]">
                      <ChallengePanel
                        challenges={data.challenges as any}
                        activeChallengeId={activeChallengeId}
                        responses={data.challenge_responses as any}
                        onSelectChallenge={() => {}}
                        onChangeStatus={() => {}}
                        onChangeAnswerText={() => {}}
                        onToggleObjectiveOption={() => {}}
                        showSelector={false}
                      />
                    </div>
                    <div className="h-1.5 flex-shrink-0 border-y border-[#decba9]/70 bg-[#e8d6b6]/40" />
                    <div className="min-h-0 flex-1 bg-[#171b22]">
                      <WorkspaceReplayPane file={activeFile} step={currentStep} />
                    </div>
                  </div>

                  <BuddyReplayDock visibleBuddy={visibleBuddy} currentStep={currentStep} />
                </div>

                <ReplayTerminalStrip
                  steps={terminalSteps}
                  recentSteps={recentSteps}
                  currentStep={currentStep}
                />
              </div>
            </div>
          </section>
        </motion.div>
      </main>
    </>
  );
}

function ReplayHero({
  data,
  currentStep,
  currentPanel,
  displayedStep,
  totalSteps,
  playing,
  speed,
  onTogglePlay,
  onReset,
  onSpeedChange,
}: {
  data: PlaybackData;
  currentStep: PlaybackStep | null;
  currentPanel: string | null;
  displayedStep: number;
  totalSteps: number;
  playing: boolean;
  speed: (typeof SPEED_OPTIONS)[number];
  onTogglePlay: () => void;
  onReset: () => void;
  onSpeedChange: (value: (typeof SPEED_OPTIONS)[number]) => void;
}) {
  return (
    <Card className="overflow-hidden rounded-[30px] border-black/[0.07] bg-[linear-gradient(135deg,_rgba(255,252,246,0.94)_0%,_rgba(246,242,233,0.94)_34%,_rgba(237,244,250,0.94)_100%)] shadow-[0_18px_60px_rgba(93,78,49,0.08)]">
      <CardHeader className="border-b border-black/[0.05] bg-[radial-gradient(circle_at_top_left,_rgba(248,214,168,0.24),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(31,122,224,0.14),_transparent_22%)]">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">Replay Theater</Badge>
              <Badge tone="violet">Employer view</Badge>
              <Badge>{formatDuration(data.duration_seconds)} captured</Badge>
            </div>
            <div className="mt-3 font-display text-[clamp(2rem,3.5vw,3.25rem)] font-semibold tracking-[-0.03em] text-bone">
              {data.candidate_name} on {data.assessment_title}
            </div>
            <div className="mt-3 max-w-4xl text-sm leading-7 text-bone/62 sm:text-[15px]">
              {data.workspace_note}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <HeroMetric
                icon={<Activity className="h-4 w-4" />}
                label="Session flow"
                value={`${data.stats.total_events} tracked events`}
                note={`${displayedStep}/${totalSteps} replayed`}
              />
              <HeroMetric
                icon={<Terminal className="h-4 w-4" />}
                label="Execution trail"
                value={`${data.stats.terminal_commands} run moments`}
                note={`${data.stats.files_touched} files touched`}
              />
              <HeroMetric
                icon={<MessageSquareText className="h-4 w-4" />}
                label="Buddy presence"
                value={`${data.stats.buddy_messages} messages`}
                note={`${data.stats.challenge_switches} challenge shifts`}
              />
            </div>
          </div>

          <div className="rounded-[28px] border border-black/[0.06] bg-white/76 p-4 shadow-[0_16px_40px_rgba(78,77,58,0.08)] backdrop-blur-sm sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40">
                  Live Replay State
                </div>
                <div className="mt-2 text-lg font-semibold text-bone">
                  {currentStep ? currentStep.title : "Waiting for activity"}
                </div>
                <div className="mt-1 text-sm text-bone/58">
                  {currentStep ? currentStep.summary : "The replay will surface the next recorded candidate action."}
                </div>
              </div>
              <div className="rounded-2xl border border-accent/20 bg-accent/8 px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-2 text-accent">
                  <span className={cn("h-2.5 w-2.5 rounded-full", playing ? "animate-pulse bg-accent" : "bg-bone/30")} />
                  <span className="text-[11px] font-medium uppercase tracking-[0.18em]">
                    {playing ? "Playing" : "Paused"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-bone/55">
                  {currentStep ? `${formatClock(currentStep.at)} · ${formatDuration(currentStep.offset_seconds)}` : "0:00"}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <MiniStat label="Session" value={shortId(data.session_id)} />
              <MiniStat label="Panel" value={currentPanel || "workspace"} />
              <MiniStat label="Started" value={formatShortDate(data.started_at)} />
              <MiniStat label="Checkpoint" value={currentStep?.actor || "system"} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={onTogglePlay} disabled={data.steps.length <= 1} className="min-w-[120px]">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? "Pause" : "Resume"}
              </Button>
              <Button variant="outline" onClick={onReset}>
                <TimerReset className="h-4 w-4" /> Reset
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-bone/40">Playback speed</span>
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSpeedChange(option)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    speed === option
                      ? "border-accent/35 bg-accent text-white shadow-glow"
                      : "border-black/10 bg-white text-bone/60 hover:border-accent/35 hover:text-bone"
                  )}
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function ReplayTimelineCard({
  data,
  currentStep,
  index,
  notableMoments,
  onSeek,
}: {
  data: PlaybackData;
  currentStep: PlaybackStep | null;
  index: number;
  notableMoments: PlaybackStep[];
  onSeek: (target: number) => void;
}) {
  return (
    <Card className="overflow-hidden rounded-[28px] border-black/[0.06] bg-white/88 backdrop-blur-sm">
      <CardBody className="space-y-4 sm:space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40">
              Timeline Control
            </div>
            <div className="mt-1 text-lg font-semibold text-bone">
              Move through the candidate session with context-aware checkpoints
            </div>
          </div>
          <div className="rounded-2xl border border-black/[0.06] bg-[#fcfbf7] px-4 py-3 text-sm text-bone/60">
            {currentStep ? `${currentStep.title} · ${formatClock(currentStep.at)}` : "No steps yet"}
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-black/[0.06] bg-[linear-gradient(180deg,_#fffdfa_0%,_#f6f2e8_100%)] p-4">
          <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-bone/42">
            <span>Replay heatline</span>
            <span>{data.steps.length} recorded moments</span>
          </div>
          <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-black/[0.05]">
            {data.steps.map((step, stepIndex) => (
              <button
                key={`${step.index}-${step.at}`}
                type="button"
                aria-label={`Jump to ${step.title}`}
                onClick={() => onSeek(stepIndex)}
                className={cn(
                  "relative h-full min-w-[2px] flex-1 transition-opacity hover:opacity-100",
                  timelineSegmentTone(step),
                  stepIndex <= index ? "opacity-100" : "opacity-38"
                )}
              >
                {stepIndex === index && <span className="absolute inset-y-[-2px] right-0 w-[2px] bg-white/90" />}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <input
              type="range"
              min={0}
              max={Math.max(data.steps.length - 1, 0)}
              value={Math.min(index, Math.max(data.steps.length - 1, 0))}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="w-full accent-[color:var(--accent)]"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {notableMoments.map((step) => (
              <button
                key={`${step.index}-${step.at}`}
                type="button"
                onClick={() => onSeek(step.index)}
                className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-bone/68 transition hover:border-accent/30 hover:text-bone"
              >
                {momentLabel(step)} · {formatDuration(step.offset_seconds)}
              </button>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function WorkspaceInsightStrip({
  step,
  activeChallenge,
  activeFile,
  terminalCount,
  buddyCount,
}: {
  step: PlaybackStep | null;
  activeChallenge: PlaybackChallenge | null;
  activeFile: PlaybackFile | null;
  terminalCount: number;
  buddyCount: number;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <InsightTile
        icon={<Sparkles className="h-4 w-4" />}
        label="Current moment"
        value={step?.title || "Awaiting step"}
        note={step?.summary || "The replay will surface the latest recorded action here."}
      />
      <InsightTile
        icon={<FileCode2 className="h-4 w-4" />}
        label="File focus"
        value={activeFile?.path || "No file focus yet"}
        note={activeFile ? `${activeFile.total_lines} lines in final snapshot` : "Open-file activity has not been captured yet."}
      />
      <InsightTile
        icon={<Gauge className="h-4 w-4" />}
        label="Task cue"
        value={activeChallenge?.title || "Main brief active"}
        note={activeChallenge?.instructions || "Candidate is still working within the primary ticket context."}
      />
      <InsightTile
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Interaction trail"
        value={`${terminalCount} terminal · ${buddyCount} Buddy`}
        note="Runtime checks and mentor interactions remain synced with the replay position."
      />
    </div>
  );
}

function TouchedFilesShelf({
  files,
  activeFilePath,
}: {
  files: PlaybackFile[];
  activeFilePath: string | null;
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4 text-white/85">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/36">
            Hot Files
          </div>
          <div className="mt-1 text-sm font-semibold text-white/92">
            Most touched workspace files
          </div>
        </div>
        <Badge className="border-white/10 bg-white/8 text-white/72">{files.length}</Badge>
      </div>
      <div className="mt-4 space-y-2">
        {files.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-4 text-sm text-white/50">
            No file activity has been captured yet.
          </div>
        ) : files.map((file) => (
          <div
            key={file.path}
            className={cn(
              "rounded-2xl border px-3 py-3 transition",
              file.path === activeFilePath
                ? "border-accent/35 bg-accent/12 shadow-[0_10px_32px_rgba(232,153,24,0.14)]"
                : "border-white/8 bg-white/[0.03]"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{file.path}</div>
                <div className="mt-1 text-[11px] text-white/46">
                  {file.language || "text"} · {file.total_lines} lines
                </div>
              </div>
              <Badge className="border-white/10 bg-white/10 text-white/72">
                {file.touched_count} touches
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FocusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-white/78">
      <span className="text-white/42">{label}:</span> {value}
    </div>
  );
}

function HeroMetric({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="min-w-[190px] rounded-[22px] border border-black/[0.06] bg-white/72 px-4 py-3 shadow-[0_14px_34px_rgba(92,84,62,0.05)]">
      <div className="flex items-center gap-2 text-accent">
        {icon}
        <div className="text-[10px] uppercase tracking-[0.18em] text-bone/40">{label}</div>
      </div>
      <div className="mt-2 text-sm font-semibold text-bone">{value}</div>
      <div className="mt-1 text-xs text-bone/48">{note}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-[#fbfaf6] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-bone/35">{label}</div>
      <div className="mt-1 text-sm font-medium text-bone">{value}</div>
    </div>
  );
}

function InsightTile({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-white/[0.05] p-4 text-white">
      <div className="flex items-center gap-2 text-white/76">
        <div className="grid h-8 w-8 place-items-center rounded-2xl bg-white/8">{icon}</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/38">{label}</div>
      </div>
      <div className="mt-3 line-clamp-2 text-sm font-semibold text-white/92">{value}</div>
      <div className="mt-2 line-clamp-3 text-xs leading-6 text-white/52">{note}</div>
    </div>
  );
}

function WorkspaceReplayPane({
  file,
  step,
}: {
  file: PlaybackFile | null;
  step: PlaybackStep | null;
}) {
  const highlights = file && step?.file_path === file.path ? step.line_ranges : [];
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 bg-[#12161d] px-4 py-2.5 text-[11px] text-white/56">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="ml-2 flex items-center gap-2">
            <FileCode2 className="h-3.5 w-3.5" />
            <span>{file?.path || "No active file yet"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step?.kind && <Badge tone={stepBadgeTone(step)}>{step.kind}</Badge>}
          {file?.language && <span>{file.language}</span>}
        </div>
      </div>

      {!file ? (
        <div className="px-6 py-10 text-sm text-white/50">No file activity has been recorded yet.</div>
      ) : (
        <CodePane file={file} highlights={highlights} />
      )}

      <div className="pointer-events-none absolute right-4 top-16 w-full max-w-sm">
        {step && (
          <div className="rounded-[22px] border border-white/10 bg-black/42 px-4 py-3 text-white/80 shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Current moment
                </div>
                <div className="mt-2 text-sm font-medium text-white">{step.title}</div>
              </div>
              <div className="text-[11px] text-white/42">{formatDuration(step.offset_seconds)}</div>
            </div>
            <div className="mt-2 text-sm leading-6 text-white/68">{step.summary}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function BuddyReplayDock({
  visibleBuddy,
  currentStep,
}: {
  visibleBuddy: PlaybackData["buddy_transcript"];
  currentStep: PlaybackStep | null;
}) {
  return (
    <aside className="relative z-10 flex w-[370px] min-h-0 flex-col border-l border-[#c8daf0]/80 bg-[linear-gradient(180deg,_rgba(251,254,255,0.97)_0%,_rgba(241,248,255,0.96)_52%,_rgba(236,245,255,0.94)_100%)] shadow-[-18px_0_50px_rgba(35,72,117,0.08)]">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#c8daf0]/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.94)_0%,_rgba(241,248,255,0.86)_100%)] px-4 py-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1f7ae0]/10 text-[#1f7ae0]">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-bone">Buddy replay</div>
          <div className="text-[11px] text-bone/50">
            Coaching trail synced with the workspace timeline
          </div>
        </div>
        <div className="ml-auto">
          <Badge tone="accent">{visibleBuddy.length}</Badge>
        </div>
      </div>

      <div className="border-b border-[#d9e7f5] px-4 py-3">
        <div className="rounded-2xl border border-[#d6e6f7] bg-white/72 p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-bone/40">Buddy posture</div>
          <div className="mt-2 text-sm text-bone/72">
            The employer sees the same mentor thread progressively unfold, instead of reading the full transcript upfront.
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {visibleBuddy.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[#cbdcef] bg-white/72 px-5 py-10 text-center text-sm text-bone/45">
            Buddy has not appeared yet at this point in the replay.
          </div>
        ) : visibleBuddy.map((turn, turnIndex) => (
          <div
            key={`${turn.at}-${turnIndex}`}
            className={cn(
              "max-w-[94%] rounded-[22px] px-3.5 py-3 text-sm break-words [overflow-wrap:anywhere]",
              turn.role === "user"
                ? "ml-auto border border-accent/25 bg-[linear-gradient(180deg,_rgba(248,214,168,0.64)_0%,_rgba(255,243,224,0.92)_100%)] text-bone"
                : "border border-[#d7e5f4] bg-white/96 text-bone/85 shadow-[0_10px_22px_rgba(42,81,126,0.06)]"
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-3">
              <Badge tone={turn.role === "buddy" ? "accent" : "default"}>{turn.role}</Badge>
              <div className="text-[11px] text-bone/40">{formatClock(turn.at)}</div>
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{turn.content}</div>
            {(turn.open_file || turn.challenge_id) && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-mono text-bone/45">
                {turn.open_file && <span>{turn.open_file}</span>}
                {turn.challenge_id && <span>{turn.challenge_id}</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {currentStep && (
        <div className="border-t border-[#cadef3] bg-white/72 p-3">
          <div className="rounded-xl border border-[#d5e3f2] bg-[#f7fbff] px-3 py-2 text-sm text-bone/70">
            Buddy state follows the replay timeline and only shows messages up to the current step.
          </div>
        </div>
      )}
    </aside>
  );
}

function ReplayTerminalStrip({
  steps,
  recentSteps,
  currentStep,
}: {
  steps: PlaybackStep[];
  recentSteps: PlaybackStep[];
  currentStep: PlaybackStep | null;
}) {
  return (
    <div className="grid h-[290px] flex-shrink-0 grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] border-t border-white/8 bg-[linear-gradient(180deg,_rgba(246,243,236,0.98)_0%,_rgba(252,250,245,0.95)_100%)]">
      <div className="min-w-0 border-r border-black/[0.06]">
        <div className="flex items-center justify-between border-b border-black/[0.05] bg-white/70 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-bone/70">
            <Terminal className="h-3.5 w-3.5 text-accent" />
            Runtime checks
          </div>
          <Badge>{steps.length}</Badge>
        </div>
        <div className="h-[230px] space-y-3 overflow-y-auto bg-[#fbfaf6] p-3 font-mono text-[12.5px]">
          {steps.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white px-4 py-6 text-bone/40">
              No terminal moments have appeared yet at this point in the replay.
            </div>
          ) : steps.map((step) => (
            <div key={`${step.index}-${step.at}`} className="overflow-hidden rounded-[20px] border border-black/[0.06] bg-white">
              <div className="flex items-center justify-between border-b border-black/[0.05] px-3 py-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-accent" />
                  <span className="uppercase tracking-wider text-bone/45">
                    {step.kind === "run" ? "Run file" : "Terminal"}
                  </span>
                </div>
                <span className="text-bone/35">{formatDuration(step.offset_seconds)}</span>
              </div>
              <div className="space-y-2 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wider text-bone/40">
                  $ {step.command || step.summary}
                </div>
                <div className="text-bone/70">{step.summary}</div>
                {step.stdout_preview && (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-[#f7f4ee] px-3 py-2 text-bone/80">{step.stdout_preview}</pre>
                )}
                {step.stderr_preview && (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-[#fff2ef] px-3 py-2 text-coral">{step.stderr_preview}</pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-black/[0.05] bg-white/70 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-bone/70">
            <Clock3 className="h-3.5 w-3.5 text-accent" />
            Activity rhythm
          </div>
          {currentStep && <Badge tone={stepBadgeTone(currentStep)}>{currentStep.actor}</Badge>}
        </div>
        <div className="h-[230px] space-y-2 overflow-y-auto bg-[#fbfaf6] p-3">
          {recentSteps.map((step) => (
            <div
              key={`${step.index}-${step.at}`}
              className={cn(
                "rounded-[18px] border px-3 py-3",
                step.index === currentStep?.index
                  ? "border-accent/35 bg-accent/8"
                  : "border-black/[0.06] bg-white"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-bone">{step.title}</div>
                <div className="text-[11px] text-bone/40">{formatClock(step.at)}</div>
              </div>
              <div className="mt-1 text-xs leading-5 text-bone/60">{step.summary}</div>
              {(step.file_path || step.challenge_id) && (
                <div className="mt-2 text-[11px] font-mono text-bone/42">
                  {[step.file_path, step.challenge_id].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CodePane({
  file,
  highlights,
}: {
  file: PlaybackFile;
  highlights: PlaybackLineRange[];
}) {
  const lines = file.content.split("\n");

  return (
    <div className="flex h-full flex-col bg-[#171a20] text-[#d8dee9]">
      <div className="flex items-center justify-between border-b border-white/6 bg-[#0f1318] px-4 py-2 text-[11px] text-white/42">
        <div className="flex items-center gap-4">
          <span>Read-only reconstructed editor</span>
          <span>{file.total_lines} lines</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-emerald-300/70">insert</span>
          <span className="text-amber-200/75">edit</span>
          <span className="text-coral/80">delete</span>
        </div>
      </div>
      <div className="max-h-full overflow-auto px-0 py-2 font-mono text-[12px] leading-6">
        {lines.map((line, lineIndex) => {
          const lineNo = lineIndex + 1;
          const highlight = highlights.find(
            (range) => lineNo >= range.start_line && lineNo <= range.end_line
          );

          return (
            <div
              key={lineIndex}
              className={cn(
                "grid grid-cols-[64px_minmax(0,1fr)] px-4",
                highlight && highlightTone(highlight.change_type)
              )}
            >
              <div className="select-none pr-4 text-right text-white/25">{lineNo}</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-left">{line || " "}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function momentLabel(step: PlaybackStep) {
  if (step.kind === "run") return "Run";
  if (step.kind === "terminal_command") return "Terminal";
  if (step.actor === "buddy") return "Buddy";
  if (step.challenge_id) return "Challenge";
  if (step.file_path) return "File";
  return "Moment";
}

function timelineSegmentTone(step: PlaybackStep) {
  if (step.kind === "run") return "bg-emerald-500/90";
  if (step.kind === "terminal_command") return "bg-accent/90";
  if (step.actor === "buddy") return "bg-[#63a9ff]";
  if (step.kind.includes("blur")) return "bg-coral/80";
  if (step.challenge_id) return "bg-violet/80";
  return "bg-black/25";
}

function stepBadgeTone(step: PlaybackStep): "default" | "accent" | "violet" | "coral" | "amber" {
  if (step.kind === "run") return "amber";
  if (step.kind === "terminal_command") return "accent";
  if (step.actor === "buddy") return "violet";
  if (step.kind.includes("blur")) return "coral";
  return "default";
}

function highlightTone(changeType: string) {
  if (changeType === "insert") return "bg-emerald-500/10";
  if (changeType === "delete") return "bg-coral/10";
  return "bg-amber/10";
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatClock(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
