"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  FileText,
  Layers,
  Pencil,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  GitBranch,
  ChevronDown,
  CheckCircle2,
  Edit2,
  RotateCcw,
  Building2,
  Code2,
  Zap,
  Info,
} from "lucide-react";
import {
  api,
  type GitHubInfo,
  type GitHubIssue,
  type GitHubSource,
  type JDAnalysis,
  type JiraAnalysis,
  type JobSpec,
  type RecruiterContext,
  type RoleFamily,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Label, TextArea, TextInput } from "@/components/ui/Field";
import { cn } from "@/lib/utils";

// ── Constants ────────────────────────────────────────────────────────────────

const ROLE_FAMILIES: RoleFamily[] = [
  "backend", "frontend", "fullstack", "qa", "devops", "data", "pm", "design",
];
const SENIORITIES: JobSpec["seniority"][] = ["junior", "mid", "senior", "staff"];
const CHALLENGE_TYPES = ["coding", "sql", "theory", "objective"] as const;
const INDUSTRY_OPTIONS = [
  "Fintech", "E-commerce", "Healthtech", "SaaS / B2B", "EdTech",
  "Logistics", "Gaming", "AdTech", "Cybersecurity", "Other",
];

// ── Types ────────────────────────────────────────────────────────────────────

type WizardStep = "source" | "gather" | "review";
type InputSource = "jd" | "jira" | "manual";

type ExtractedData = {
  title: string;
  role_family: RoleFamily;
  seniority: JobSpec["seniority"];
  industry: string;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  jd_text: string;
  problem_summary: string;
  recruiter_context: RecruiterContext;
};

const DEFAULT_FORM: JobSpec = {
  title: "",
  role_family: "backend",
  seniority: "mid",
  industry: "SaaS / B2B",
  must_have_skills: [],
  nice_to_have_skills: [],
  jd_text: "",
  duration_minutes: 60,
  pm_tool: "none",
  codebase_source: "generated",
  challenge_count: 4,
  challenge_types: ["coding"],
};

const PAGE_TRANSITION = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function coerceRoleFamily(val: string): RoleFamily {
  return ROLE_FAMILIES.includes(val as RoleFamily) ? (val as RoleFamily) : "backend";
}
function coerceSeniority(val: string): JobSpec["seniority"] {
  return SENIORITIES.includes(val as any) ? (val as JobSpec["seniority"]) : "mid";
}

function analysisToExtracted(
  r: JDAnalysis | JiraAnalysis,
  fallbackJd = ""
): ExtractedData {
  return {
    title: r.suggested_title,
    role_family: coerceRoleFamily(r.suggested_role_family as string),
    seniority: coerceSeniority(r.suggested_seniority as string),
    industry: r.suggested_industry,
    must_have_skills: r.must_have_skills,
    nice_to_have_skills: r.nice_to_have_skills,
    jd_text: r.generated_jd || fallbackJd,
    problem_summary: r.problem_summary,
    recruiter_context: r.recruiter_context,
  };
}

// ── Shared sub-components ────────────────────────────────────────────────────

function StepHeader({
  label,
  step,
  total,
  onBack,
}: {
  label: string;
  step: number;
  total: number;
  onBack?: () => void;
}) {
  return (
    <div className="flex items-center gap-4 mb-8">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-bone/55 hover:text-bone transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      )}
      <div className="flex-1 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "rounded-full transition-all",
                i < step
                  ? "h-2 w-6 bg-accent"
                  : i === step - 1
                    ? "h-2 w-6 bg-accent"
                    : "h-2 w-2 bg-black/10"
              )}
            />
          ))}
        </div>
        <span className="text-xs text-bone/40 font-mono">
          Step {step} of {total}
        </span>
      </div>
      <span className="text-xs uppercase tracking-[0.22em] text-bone/35">{label}</span>
    </div>
  );
}

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-black/[0.06] bg-white/90 shadow-card p-6",
        className
      )}
    >
      {children}
    </div>
  );
}

function SkillChips({
  skills,
  tone = "default",
}: {
  skills: string[];
  tone?: "accent" | "amber" | "default";
}) {
  if (!skills.length) return <span className="text-xs text-bone/35 italic">none detected</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => (
        <span
          key={s}
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
            tone === "accent" && "border-accent/25 bg-accent/10 text-accent",
            tone === "amber" && "border-amber/25 bg-amber/10 text-amber",
            tone === "default" && "border-black/10 bg-black/5 text-bone/70"
          )}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

// ── Toggle Chips ─────────────────────────────────────────────────────────────

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  tone = "accent",
  capitalize = true,
  labels,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  tone?: "accent" | "sky" | "violet" | "amber";
  capitalize?: boolean;
  labels?: Record<string, string>;
}) {
  const toneStyles: Record<string, string> = {
    accent: "border-accent/60 bg-accent/15 text-accent",
    sky: "border-sky/60 bg-sky/15 text-sky",
    violet: "border-violet/60 bg-violet/10 text-violet",
    amber: "border-amber/60 bg-amber/15 text-amber",
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition",
            capitalize && "capitalize",
            value === o
              ? toneStyles[tone]
              : "border-black/[0.08] bg-white text-bone/65 hover:border-black/20"
          )}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function MultiChipGroup({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onToggle(o)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm capitalize transition",
            selected.includes(o)
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-black/[0.08] bg-white text-bone/65 hover:border-black/20"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// ── Assessment Config (shared for review + manual) ───────────────────────────

function AssessmentConfigSection({
  form,
  set,
  toggleChallengeType,
  codebaseSource,
  setCodebaseSource,
  ghUrl,
  setGhUrl,
  ghBranch,
  setGhBranch,
  ghInfo,
  setGhInfo,
  ghFetching,
  ghError,
  setGhError,
  ghSelectedIssue,
  setGhSelectedIssue,
  ghIssueOpen,
  setGhIssueOpen,
  onFetchGH,
}: {
  form: JobSpec;
  set: <K extends keyof JobSpec>(k: K, v: JobSpec[K]) => void;
  toggleChallengeType: (kind: typeof CHALLENGE_TYPES[number]) => void;
  codebaseSource: "generated" | "github";
  setCodebaseSource: (s: "generated" | "github") => void;
  ghUrl: string;
  setGhUrl: (v: string) => void;
  ghBranch: string;
  setGhBranch: (v: string) => void;
  ghInfo: GitHubInfo | null;
  setGhInfo: (v: GitHubInfo | null) => void;
  ghFetching: boolean;
  ghError: string;
  setGhError: (v: string) => void;
  ghSelectedIssue: GitHubIssue | null;
  setGhSelectedIssue: (v: GitHubIssue | null) => void;
  ghIssueOpen: boolean;
  setGhIssueOpen: (v: boolean) => void;
  onFetchGH: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Duration (minutes)</Label>
          <TextInput
            type="number"
            min={15}
            max={240}
            value={form.duration_minutes}
            onChange={(e) => set("duration_minutes", parseInt(e.target.value || "60", 10))}
          />
        </div>
        <div>
          <Label hint="Total challenges in the assessment">Challenge count</Label>
          <TextInput
            type="number"
            min={2}
            max={8}
            value={form.challenge_count || 4}
            onChange={(e) => set("challenge_count", parseInt(e.target.value || "4", 10))}
          />
        </div>
      </div>

      <div>
        <Label hint="Mix coding with judgment tasks">Challenge types</Label>
        <MultiChipGroup
          options={[...CHALLENGE_TYPES]}
          selected={form.challenge_types || []}
          onToggle={toggleChallengeType as (v: string) => void}
        />
      </div>

      <div>
        <Label>Codebase source</Label>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <button
            onClick={() => {
              setCodebaseSource("generated");
              set("codebase_source", "generated");
            }}
            className={cn(
              "rounded-xl border p-4 text-left transition",
              codebaseSource === "generated"
                ? "border-accent/50 bg-accent/[0.07] ring-1 ring-accent/30"
                : "border-black/[0.08] bg-white hover:border-black/20"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="text-sm font-semibold text-bone">AI-generated</span>
            </div>
            <p className="text-xs text-bone/55 leading-snug">
              Agents write a production-quality codebase tailored to the role, industry, and stack.
            </p>
          </button>
          <button
            onClick={() => {
              setCodebaseSource("github");
              set("codebase_source", "github");
            }}
            className={cn(
              "rounded-xl border p-4 text-left transition",
              codebaseSource === "github"
                ? "border-accent/50 bg-accent/[0.07] ring-1 ring-accent/30"
                : "border-black/[0.08] bg-white hover:border-black/20"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <GitBranch className="h-4 w-4 text-bone/60" />
              <span className="text-sm font-semibold text-bone">GitHub repo</span>
            </div>
            <p className="text-xs text-bone/55 leading-snug">
              Use a real public repo. Optionally pick an open issue as the candidate's task.
            </p>
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {codebaseSource === "github" && (
          <motion.div
            key="github"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-black/[0.08] bg-[#faf7f0] p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-bone">
                <GitBranch className="h-4 w-4 text-bone/50" />
                GitHub repository
              </div>
              <div className="flex gap-2">
                <TextInput
                  className="flex-1"
                  placeholder="https://github.com/owner/repo"
                  value={ghUrl}
                  onChange={(e) => {
                    setGhUrl(e.target.value);
                    setGhInfo(null);
                    setGhError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && onFetchGH()}
                />
                <Button size="sm" onClick={onFetchGH} disabled={ghFetching || !ghUrl.trim()}>
                  {ghFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate"}
                </Button>
              </div>
              {ghError && (
                <div className="flex items-center gap-2 text-sm text-coral">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {ghError}
                </div>
              )}
              {ghInfo && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  <div className="rounded-xl border border-mint/30 bg-mint/[0.07] p-3">
                    <div className="font-medium text-sm text-bone">{ghInfo.full_name}</div>
                    {ghInfo.description && (
                      <p className="text-xs text-bone/55 mt-0.5">{ghInfo.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {ghInfo.language && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-bone/10 text-bone/70">
                          {ghInfo.language}
                        </span>
                      )}
                      {ghInfo.topics.slice(0, 4).map((t) => (
                        <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Branch</Label>
                    <TextInput value={ghBranch} onChange={(e) => setGhBranch(e.target.value)} />
                  </div>
                  {ghInfo.issues.length > 0 && (
                    <div>
                      <Label hint="Optional">Pick a GitHub issue</Label>
                      <div className="relative">
                        <button
                          onClick={() => setGhIssueOpen(!ghIssueOpen)}
                          className="w-full flex items-center justify-between rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm text-left hover:border-black/20 transition"
                        >
                          <span className={ghSelectedIssue ? "text-bone" : "text-bone/40"}>
                            {ghSelectedIssue
                              ? `#${ghSelectedIssue.number} — ${ghSelectedIssue.title}`
                              : "Auto-generate from codebase"}
                          </span>
                          <ChevronDown className={cn("h-4 w-4 text-bone/40 transition-transform", ghIssueOpen && "rotate-180")} />
                        </button>
                        <AnimatePresence>
                          {ghIssueOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              className="absolute z-10 mt-1 w-full rounded-xl border border-black/[0.08] bg-white shadow-soft overflow-hidden"
                            >
                              <div className="max-h-52 overflow-y-auto scrollbar-thin">
                                <button
                                  className="w-full px-4 py-2.5 text-sm text-left text-bone/50 hover:bg-ink-100 border-b border-black/[0.04] transition"
                                  onClick={() => { setGhSelectedIssue(null); setGhIssueOpen(false); }}
                                >
                                  Auto-generate from codebase
                                </button>
                                {ghInfo.issues.map((issue: GitHubIssue) => (
                                  <button
                                    key={issue.number}
                                    className="w-full px-4 py-2.5 text-sm text-left hover:bg-ink-100 transition border-b border-black/[0.03] last:border-0"
                                    onClick={() => { setGhSelectedIssue(issue); setGhIssueOpen(false); }}
                                  >
                                    <span className="text-bone/40 font-mono text-xs mr-2">#{issue.number}</span>
                                    <span className="text-bone">{issue.title}</span>
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Step 1: Source selection ──────────────────────────────────────────────────

const SOURCE_CARDS = [
  {
    id: "jd" as InputSource,
    icon: FileText,
    iconBg: "bg-accent/10",
    iconColor: "text-accent",
    title: "Job Description",
    tag: "Fastest",
    tagColor: "bg-accent/15 text-accent",
    description:
      "Paste your JD and our AI agent extracts the role, tech stack, seniority, industry, and domain context — automatically.",
    border: "hover:border-accent/40 group-hover:border-accent/40",
    accent: "accent",
  },
  {
    id: "jira" as InputSource,
    icon: Layers,
    iconBg: "bg-amber/10",
    iconColor: "text-amber",
    title: "Jira Backlog",
    tag: "Most authentic",
    tagColor: "bg-amber/15 text-amber",
    description:
      "Connect your Jira to ground the assessment in real tickets your team has worked on. Produces the most realistic simulation.",
    border: "hover:border-amber/40",
    accent: "amber",
  },
  {
    id: "manual" as InputSource,
    icon: Pencil,
    iconBg: "bg-bone/10",
    iconColor: "text-bone/60",
    title: "Manual Setup",
    tag: "Full control",
    tagColor: "bg-bone/10 text-bone/55",
    description:
      "Fill in all fields yourself. Use this when you want precise control over every parameter of the assessment.",
    border: "hover:border-black/20",
    accent: "bone",
  },
];

function SourceStep({ onSelect }: { onSelect: (s: InputSource) => void }) {
  const [hovered, setHovered] = useState<InputSource | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-4xl"
    >
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.07] px-3.5 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-accent mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          New assessment
        </div>
        <h1 className="font-display text-4xl md:text-5xl font-semibold tracking-tight text-bone">
          How do you want to start?
        </h1>
        <p className="mt-3 text-base text-bone/55 max-w-lg mx-auto leading-relaxed">
          Choose how you'll provide context for this assessment. Our agents do the rest.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {SOURCE_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <motion.button
              key={card.id}
              onClick={() => onSelect(card.id)}
              onHoverStart={() => setHovered(card.id)}
              onHoverEnd={() => setHovered(null)}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "group relative text-left rounded-[28px] border border-black/[0.07] bg-white/95 p-6 shadow-card transition-all duration-200",
                hovered === card.id && "shadow-soft-lg border-black/[0.12]"
              )}
            >
              <div className={cn("inline-flex h-11 w-11 items-center justify-center rounded-2xl mb-5", card.iconBg)}>
                <Icon className={cn("h-5 w-5", card.iconColor)} />
              </div>

              <div className="flex items-start gap-2 flex-wrap mb-3">
                <span className="font-display text-xl font-semibold text-bone">{card.title}</span>
                <span className={cn("mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", card.tagColor)}>
                  {card.tag}
                </span>
              </div>

              <p className="text-sm text-bone/60 leading-relaxed">{card.description}</p>

              <div className="mt-6 flex items-center gap-1.5 text-sm font-medium text-bone/40 group-hover:text-bone/70 transition">
                Select <ArrowRight className="h-4 w-4" />
              </div>

              <motion.div
                className="absolute inset-0 rounded-[28px] border-2 border-accent/30 pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: hovered === card.id && card.id !== "manual" ? 1 : 0 }}
                transition={{ duration: 0.15 }}
              />
            </motion.button>
          );
        })}
      </div>

      <p className="text-center mt-8 text-xs text-bone/35">
        All paths lead to the same pipeline — you can edit extracted data before generating.
      </p>
    </motion.div>
  );
}

// ── Step 2a: JD input ─────────────────────────────────────────────────────────

const JD_LOADING_MESSAGES = [
  "Reading your job description…",
  "Identifying role and seniority…",
  "Extracting tech stack signals…",
  "Inferring domain context…",
  "Building recruiter profile…",
  "Almost done…",
];

function JDGatherStep({
  jdText,
  setJdText,
  busy,
  error,
  onAnalyze,
  onBack,
}: {
  jdText: string;
  setJdText: (v: string) => void;
  busy: boolean;
  error: string;
  onAnalyze: () => void;
  onBack: () => void;
}) {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!busy) { setMsgIdx(0); return; }
    const id = setInterval(() => {
      setMsgIdx((i) => Math.min(i + 1, JD_LOADING_MESSAGES.length - 1));
    }, 1800);
    return () => clearInterval(id);
  }, [busy]);

  const charCount = jdText.length;
  const ready = charCount >= 80 && !busy;

  return (
    <div className="mx-auto max-w-3xl">
      <StepHeader label="Job Description" step={2} total={3} onBack={onBack} />

      <SectionCard>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-2xl bg-accent/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-bone">
              Paste your job description
            </h2>
            <p className="text-sm text-bone/50 mt-0.5">
              Our AI agent will extract role, stack, seniority, industry, and domain context.
            </p>
          </div>
        </div>

        <div className="relative">
          <TextArea
            rows={12}
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder={`We're looking for a Senior Backend Engineer to own our checkout service...\n\nYou'll work with Python, FastAPI, PostgreSQL, and Redis. Experience with async patterns, high-throughput APIs, and production incident response required. Nice to have: Kubernetes, Stripe APIs, Celery.\n\nYou'll report to the Platform Lead and collaborate with QA and DevOps to ship multiple times per day.`}
            disabled={busy}
            className={cn("text-sm leading-relaxed", busy && "opacity-50 cursor-not-allowed")}
          />
          <div className="absolute bottom-3 right-3 text-[11px] text-bone/30 font-mono">
            {charCount} chars
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 flex items-center gap-2 text-sm text-coral"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-5 flex items-center justify-between gap-4">
          <AnimatePresence mode="wait">
            {busy ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm text-bone/55"
              >
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                <span className="transition-all">{JD_LOADING_MESSAGES[msgIdx]}</span>
              </motion.div>
            ) : (
              <motion.p
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-bone/40"
              >
                {charCount < 80
                  ? `Paste at least 80 characters to analyze (${80 - charCount} more needed)`
                  : "Looking good — hit analyze when ready."}
              </motion.p>
            )}
          </AnimatePresence>

          <Button
            onClick={onAnalyze}
            disabled={!ready}
            size="lg"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {busy ? "Analyzing…" : "Analyze with AI"}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </SectionCard>

      <div className="mt-4 rounded-2xl border border-black/[0.05] bg-[#fcfaf4] px-5 py-4">
        <div className="flex items-start gap-2.5 text-xs text-bone/50">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            The JD can be informal — bullet lists, raw copy-pastes, or partial drafts all work.
            You'll be able to edit everything the agent extracts before generating the assessment.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Step 2b: Jira input ───────────────────────────────────────────────────────

function JiraGatherStep({
  siteUrl, setSiteUrl,
  userEmail, setUserEmail,
  apiToken, setApiToken,
  projectKey, setProjectKey,
  jql, setJql,
  maxIssues, setMaxIssues,
  busy, error, onAnalyze, onBack,
}: {
  siteUrl: string; setSiteUrl: (v: string) => void;
  userEmail: string; setUserEmail: (v: string) => void;
  apiToken: string; setApiToken: (v: string) => void;
  projectKey: string; setProjectKey: (v: string) => void;
  jql: string; setJql: (v: string) => void;
  maxIssues: number; setMaxIssues: (v: number) => void;
  busy: boolean; error: string;
  onAnalyze: () => void; onBack: () => void;
}) {
  const ready = !!siteUrl.trim() && (!!projectKey.trim() || !!jql.trim()) && !busy;

  return (
    <div className="mx-auto max-w-3xl">
      <StepHeader label="Jira Backlog" step={2} total={3} onBack={onBack} />

      <SectionCard>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-2xl bg-amber/10 flex items-center justify-center">
            <Layers className="h-5 w-5 text-amber" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-bone">Connect your Jira</h2>
            <p className="text-sm text-bone/50 mt-0.5">
              We'll read a backlog slice and infer the role, stack, and real problems your team is solving.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Jira site URL</Label>
              <TextInput
                placeholder="https://your-team.atlassian.net"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <Label>Atlassian email</Label>
              <TextInput
                placeholder="you@company.com"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>API token</Label>
              <TextInput
                type="password"
                placeholder="Atlassian API token"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <Label hint="Or use JQL below">Project key</Label>
              <TextInput
                placeholder="PAY, OPS, WEB"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_100px] gap-4">
            <div>
              <Label hint="Optional override">JQL query</Label>
              <TextInput
                placeholder="project = PAY AND statusCategory != Done ORDER BY updated DESC"
                value={jql}
                onChange={(e) => setJql(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <Label>Max issues</Label>
              <TextInput
                type="number"
                min={3}
                max={25}
                value={maxIssues}
                onChange={(e) => setMaxIssues(parseInt(e.target.value || "12", 10))}
                disabled={busy}
              />
            </div>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 flex items-center gap-2 text-sm text-coral"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-bone/40">
            Credentials are used only for this analysis request and never stored.
          </p>
          <Button onClick={onAnalyze} disabled={!ready} size="lg">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            {busy ? "Analyzing backlog…" : "Analyze backlog"}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Step 2 (manual): Full form ────────────────────────────────────────────────

function ManualGatherStep({
  form, set, toggleChallengeType,
  codebaseSource, setCodebaseSource,
  ghUrl, setGhUrl, ghBranch, setGhBranch,
  ghInfo, setGhInfo, ghFetching, ghError, setGhError,
  ghSelectedIssue, setGhSelectedIssue, ghIssueOpen, setGhIssueOpen,
  onFetchGH, submitting, onSubmit, onBack,
}: {
  form: JobSpec;
  set: <K extends keyof JobSpec>(k: K, v: JobSpec[K]) => void;
  toggleChallengeType: (kind: typeof CHALLENGE_TYPES[number]) => void;
  codebaseSource: "generated" | "github";
  setCodebaseSource: (s: "generated" | "github") => void;
  ghUrl: string; setGhUrl: (v: string) => void;
  ghBranch: string; setGhBranch: (v: string) => void;
  ghInfo: GitHubInfo | null; setGhInfo: (v: GitHubInfo | null) => void;
  ghFetching: boolean;
  ghError: string; setGhError: (v: string) => void;
  ghSelectedIssue: GitHubIssue | null; setGhSelectedIssue: (v: GitHubIssue | null) => void;
  ghIssueOpen: boolean; setGhIssueOpen: (v: boolean) => void;
  onFetchGH: () => void;
  submitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const [customIndustry, setCustomIndustry] = useState("");
  const usesCustomIndustry = !!form.industry && !INDUSTRY_OPTIONS.includes(form.industry);

  return (
    <div className="mx-auto max-w-3xl">
      <StepHeader label="Manual Setup" step={2} total={2} onBack={onBack} />

      <div className="space-y-4">
        <SectionCard>
          <div className="flex items-center gap-2 mb-5">
            <div className="h-8 w-8 rounded-xl bg-bone/[0.08] flex items-center justify-center">
              <Building2 className="h-4 w-4 text-bone/50" />
            </div>
            <span className="font-semibold text-bone">Role details</span>
          </div>

          <div className="space-y-5">
            <div>
              <Label>Job title</Label>
              <TextInput
                value={form.title}
                placeholder="Senior Backend Engineer"
                onChange={(e) => set("title", e.target.value)}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <Label>Role family</Label>
                <ChipGroup
                  options={ROLE_FAMILIES}
                  value={form.role_family}
                  onChange={(v) => set("role_family", v)}
                  tone="accent"
                />
              </div>
              <div>
                <Label>Seniority</Label>
                <ChipGroup
                  options={SENIORITIES}
                  value={form.seniority}
                  onChange={(v) => set("seniority", v)}
                  tone="sky"
                />
              </div>
            </div>

            <div>
              <Label>Industry</Label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRY_OPTIONS.map((ind) => (
                  <button
                    key={ind}
                    onClick={() => {
                      if (ind === "Other") { set("industry", customIndustry || "Other"); return; }
                      setCustomIndustry("");
                      set("industry", ind);
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition",
                      (ind === "Other" ? (form.industry === "Other" || usesCustomIndustry) : form.industry === ind)
                        ? "border-violet/60 bg-violet/10 text-violet"
                        : "border-black/[0.08] bg-white text-bone/65 hover:border-black/20"
                    )}
                  >
                    {ind}
                  </button>
                ))}
              </div>
              {(form.industry === "Other" || usesCustomIndustry) && (
                <TextInput
                  className="mt-2"
                  placeholder="e.g. Real estate, Insurance"
                  value={usesCustomIndustry ? form.industry : customIndustry}
                  onChange={(e) => {
                    setCustomIndustry(e.target.value);
                    set("industry", e.target.value || "Other");
                  }}
                />
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="flex items-center gap-2 mb-5">
            <div className="h-8 w-8 rounded-xl bg-bone/[0.08] flex items-center justify-center">
              <Code2 className="h-4 w-4 text-bone/50" />
            </div>
            <span className="font-semibold text-bone">Skills & context</span>
          </div>

          <div className="space-y-4">
            <div>
              <Label hint="Comma-separated">Must-have skills</Label>
              <TextInput
                value={form.must_have_skills.join(", ")}
                placeholder="Python, FastAPI, PostgreSQL"
                onChange={(e) =>
                  set("must_have_skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                }
              />
            </div>
            <div>
              <Label hint="Comma-separated">Nice-to-have skills</Label>
              <TextInput
                value={form.nice_to_have_skills.join(", ")}
                placeholder="Redis, Docker, Kubernetes"
                onChange={(e) =>
                  set("nice_to_have_skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                }
              />
            </div>
            <div>
              <Label>Job description</Label>
              <TextArea
                value={form.jd_text}
                rows={4}
                placeholder="Brief description of the role and what the candidate will work on…"
                onChange={(e) => set("jd_text", e.target.value)}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="flex items-center gap-2 mb-5">
            <div className="h-8 w-8 rounded-xl bg-bone/[0.08] flex items-center justify-center">
              <Zap className="h-4 w-4 text-bone/50" />
            </div>
            <span className="font-semibold text-bone">Assessment configuration</span>
          </div>

          <AssessmentConfigSection
            form={form} set={set}
            toggleChallengeType={toggleChallengeType}
            codebaseSource={codebaseSource} setCodebaseSource={setCodebaseSource}
            ghUrl={ghUrl} setGhUrl={setGhUrl}
            ghBranch={ghBranch} setGhBranch={setGhBranch}
            ghInfo={ghInfo} setGhInfo={setGhInfo}
            ghFetching={ghFetching}
            ghError={ghError} setGhError={setGhError}
            ghSelectedIssue={ghSelectedIssue} setGhSelectedIssue={setGhSelectedIssue}
            ghIssueOpen={ghIssueOpen} setGhIssueOpen={setGhIssueOpen}
            onFetchGH={onFetchGH}
          />
        </SectionCard>

        <div className="flex items-center justify-end pt-2">
          <Button size="lg" onClick={onSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Spinning up agents…</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Generate assessment</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Review extracted data + configure ─────────────────────────────────

function ReviewStep({
  source, extracted, editing, setEditing,
  form, set, toggleChallengeType,
  codebaseSource, setCodebaseSource,
  ghUrl, setGhUrl, ghBranch, setGhBranch,
  ghInfo, setGhInfo, ghFetching, ghError, setGhError,
  ghSelectedIssue, setGhSelectedIssue, ghIssueOpen, setGhIssueOpen,
  onFetchGH, submitting, onSubmit, onBack,
}: {
  source: InputSource;
  extracted: ExtractedData;
  editing: boolean;
  setEditing: (v: boolean) => void;
  form: JobSpec;
  set: <K extends keyof JobSpec>(k: K, v: JobSpec[K]) => void;
  toggleChallengeType: (kind: typeof CHALLENGE_TYPES[number]) => void;
  codebaseSource: "generated" | "github";
  setCodebaseSource: (s: "generated" | "github") => void;
  ghUrl: string; setGhUrl: (v: string) => void;
  ghBranch: string; setGhBranch: (v: string) => void;
  ghInfo: GitHubInfo | null; setGhInfo: (v: GitHubInfo | null) => void;
  ghFetching: boolean;
  ghError: string; setGhError: (v: string) => void;
  ghSelectedIssue: GitHubIssue | null; setGhSelectedIssue: (v: GitHubIssue | null) => void;
  ghIssueOpen: boolean; setGhIssueOpen: (v: boolean) => void;
  onFetchGH: () => void;
  submitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const sourceLabel = source === "jd" ? "job description" : "Jira backlog";

  return (
    <div className="mx-auto max-w-3xl">
      <StepHeader label="Review & Configure" step={3} total={3} onBack={onBack} />

      <div className="space-y-4">
        {/* ── Extraction summary card ── */}
        <SectionCard>
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-mint/20 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-mint" />
              </div>
              <div>
                <h2 className="font-semibold text-bone">
                  AI extracted from your {sourceLabel}
                </h2>
                <p className="text-xs text-bone/45 mt-0.5">
                  Review the extracted data below — you can edit anything before generating.
                </p>
              </div>
            </div>
            <button
              onClick={() => setEditing(!editing)}
              className="flex items-center gap-1.5 text-xs text-bone/50 hover:text-bone transition border border-black/[0.08] rounded-lg px-2.5 py-1.5"
            >
              {editing ? (
                <><RotateCcw className="h-3.5 w-3.5" /> Done editing</>
              ) : (
                <><Edit2 className="h-3.5 w-3.5" /> Edit</>
              )}
            </button>
          </div>

          <AnimatePresence mode="wait">
            {!editing ? (
              <motion.div
                key="summary"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {/* Role summary row */}
                <div className="rounded-2xl border border-black/[0.05] bg-[#fdfbf6] p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-display text-xl font-semibold text-bone">{form.title || extracted.title}</span>
                    <span className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-accent capitalize">
                      {form.role_family}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-sky/25 bg-sky/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-sky capitalize">
                      {form.seniority}
                    </span>
                    {form.industry && (
                      <span className="inline-flex items-center rounded-full border border-violet/25 bg-violet/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-violet">
                        {form.industry}
                      </span>
                    )}
                  </div>
                  {extracted.problem_summary && (
                    <p className="text-sm text-bone/60 leading-relaxed">{extracted.problem_summary}</p>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-black/[0.05] bg-white p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-bone/35 mb-3">Must-have skills</div>
                    <SkillChips skills={form.must_have_skills} tone="accent" />
                  </div>
                  <div className="rounded-2xl border border-black/[0.05] bg-white p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-bone/35 mb-3">Nice-to-have skills</div>
                    <SkillChips skills={form.nice_to_have_skills} tone="amber" />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="edit-form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div>
                  <Label>Job title</Label>
                  <TextInput value={form.title} onChange={(e) => set("title", e.target.value)} />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Role family</Label>
                    <ChipGroup options={ROLE_FAMILIES} value={form.role_family} onChange={(v) => set("role_family", v)} tone="accent" />
                  </div>
                  <div>
                    <Label>Seniority</Label>
                    <ChipGroup options={SENIORITIES} value={form.seniority} onChange={(v) => set("seniority", v)} tone="sky" />
                  </div>
                </div>
                <div>
                  <Label>Industry</Label>
                  <div className="flex flex-wrap gap-2">
                    {INDUSTRY_OPTIONS.map((ind) => (
                      <button
                        key={ind}
                        onClick={() => {
                          if (ind !== "Other") set("industry", ind);
                        }}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-sm transition",
                          form.industry === ind
                            ? "border-violet/60 bg-violet/10 text-violet"
                            : "border-black/[0.08] bg-white text-bone/65 hover:border-black/20"
                        )}
                      >
                        {ind}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label hint="Comma-separated">Must-have skills</Label>
                  <TextInput
                    value={form.must_have_skills.join(", ")}
                    onChange={(e) =>
                      set("must_have_skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                    }
                  />
                </div>
                <div>
                  <Label hint="Comma-separated">Nice-to-have skills</Label>
                  <TextInput
                    value={form.nice_to_have_skills.join(", ")}
                    onChange={(e) =>
                      set("nice_to_have_skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                    }
                  />
                </div>
                <div>
                  <Label>Job description</Label>
                  <TextArea
                    value={form.jd_text}
                    rows={5}
                    onChange={(e) => set("jd_text", e.target.value)}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </SectionCard>

        {/* ── Assessment config card ── */}
        <SectionCard>
          <div className="flex items-center gap-2 mb-5">
            <div className="h-8 w-8 rounded-xl bg-bone/[0.08] flex items-center justify-center">
              <Zap className="h-4 w-4 text-bone/50" />
            </div>
            <span className="font-semibold text-bone">Configure your assessment</span>
          </div>

          <AssessmentConfigSection
            form={form} set={set}
            toggleChallengeType={toggleChallengeType}
            codebaseSource={codebaseSource} setCodebaseSource={setCodebaseSource}
            ghUrl={ghUrl} setGhUrl={setGhUrl}
            ghBranch={ghBranch} setGhBranch={setGhBranch}
            ghInfo={ghInfo} setGhInfo={setGhInfo}
            ghFetching={ghFetching}
            ghError={ghError} setGhError={setGhError}
            ghSelectedIssue={ghSelectedIssue} setGhSelectedIssue={setGhSelectedIssue}
            ghIssueOpen={ghIssueOpen} setGhIssueOpen={setGhIssueOpen}
            onFetchGH={onFetchGH}
          />
        </SectionCard>

        <div className="flex items-center justify-end pt-2">
          <Button size="lg" onClick={onSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Spinning up agents…</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Generate assessment</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function JobForm() {
  const router = useRouter();

  const [step, setStep] = useState<WizardStep>("source");
  const [source, setSource] = useState<InputSource | null>(null);

  // JD path
  const [jdText, setJdText] = useState("");
  const [jdBusy, setJdBusy] = useState(false);
  const [jdError, setJdError] = useState("");

  // Jira path
  const [jiraSiteUrl, setJiraSiteUrl] = useState("");
  const [jiraUserEmail, setJiraUserEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [jiraJql, setJiraJql] = useState("");
  const [jiraMaxIssues, setJiraMaxIssues] = useState(12);
  const [jiraFetching, setJiraFetching] = useState(false);
  const [jiraError, setJiraError] = useState("");

  // Extracted data (JD or Jira)
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [editing, setEditing] = useState(false);

  // Shared form state
  const [form, setForm] = useState<JobSpec>(DEFAULT_FORM);
  const [codebaseSource, setCodebaseSource] = useState<"generated" | "github">("generated");

  // GitHub state
  const [ghUrl, setGhUrl] = useState("");
  const [ghBranch, setGhBranch] = useState("main");
  const [ghInfo, setGhInfo] = useState<GitHubInfo | null>(null);
  const [ghFetching, setGhFetching] = useState(false);
  const [ghError, setGhError] = useState("");
  const [ghSelectedIssue, setGhSelectedIssue] = useState<GitHubIssue | null>(null);
  const [ghIssueOpen, setGhIssueOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof JobSpec>(k: K, v: JobSpec[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function toggleChallengeType(kind: typeof CHALLENGE_TYPES[number]) {
    setForm((prev) => {
      const current = prev.challenge_types || [];
      const next = current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind];
      return { ...prev, challenge_types: next.length ? next : ["coding"] };
    });
  }

  function applyExtracted(data: ExtractedData) {
    setExtracted(data);
    setForm((f) => ({
      ...f,
      title: data.title,
      role_family: data.role_family,
      seniority: data.seniority,
      industry: data.industry,
      must_have_skills: data.must_have_skills,
      nice_to_have_skills: data.nice_to_have_skills,
      jd_text: data.jd_text,
    }));
  }

  async function analyzeJD() {
    if (!jdText.trim() || jdText.trim().length < 80) {
      setJdError("Paste at least 80 characters to analyze.");
      return;
    }
    setJdBusy(true);
    setJdError("");
    try {
      const result = await api.analyzeJD(jdText.trim());
      applyExtracted(analysisToExtracted(result, jdText.trim()));
      setStep("review");
    } catch (e: any) {
      setJdError(e.message || "Analysis failed. Please try again.");
    } finally {
      setJdBusy(false);
    }
  }

  async function analyzeJira() {
    if (!jiraSiteUrl.trim()) {
      setJiraError("Enter the Jira site URL first.");
      return;
    }
    if (!jiraProjectKey.trim() && !jiraJql.trim()) {
      setJiraError("Provide a project key or a JQL query.");
      return;
    }
    setJiraFetching(true);
    setJiraError("");
    try {
      const result = await api.analyzeJira({
        base_url: jiraSiteUrl.trim(),
        user_email: jiraUserEmail.trim(),
        api_token: jiraApiToken.trim(),
        project_key: jiraProjectKey.trim(),
        jql: jiraJql.trim(),
        max_issues: jiraMaxIssues,
      });
      applyExtracted(analysisToExtracted(result));
      setStep("review");
    } catch (e: any) {
      setJiraError(e.message || "Analysis failed.");
    } finally {
      setJiraFetching(false);
    }
  }

  async function fetchGitHubInfo() {
    if (!ghUrl.trim()) return;
    setGhFetching(true);
    setGhError("");
    setGhInfo(null);
    setGhSelectedIssue(null);
    try {
      const info = await api.getGitHubInfo(ghUrl.trim());
      setGhInfo(info);
      setGhBranch(info.default_branch);
    } catch (e: any) {
      setGhError(e.message || "Failed to fetch repository info");
    } finally {
      setGhFetching(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    try {
      let github_source: GitHubSource | null = null;
      if (codebaseSource === "github") {
        if (!ghInfo) {
          alert("Please validate the GitHub URL first.");
          setSubmitting(false);
          return;
        }
        github_source = {
          repo_url: ghUrl.trim(),
          branch: ghBranch,
          issue_number: ghSelectedIssue?.number ?? null,
          issue_title: ghSelectedIssue?.title ?? "",
          issue_body: ghSelectedIssue?.body ?? "",
        };
      }

      const payload: JobSpec = {
        ...form,
        recruiter_context: extracted?.recruiter_context ?? null,
        codebase_source: codebaseSource,
        github_source,
      };

      const a = await api.createAssessment(payload);
      router.push(`/employer/${a.id}`);
    } catch (e: any) {
      alert("Failed: " + e.message);
      setSubmitting(false);
    }
  }

  const ghShared = {
    ghUrl, setGhUrl,
    ghBranch, setGhBranch,
    ghInfo, setGhInfo,
    ghFetching,
    ghError, setGhError,
    ghSelectedIssue, setGhSelectedIssue,
    ghIssueOpen, setGhIssueOpen,
    onFetchGH: fetchGitHubInfo,
  };

  return (
    <div className="pt-4">
      <AnimatePresence mode="wait">
        {step === "source" && (
          <motion.div key="source" {...PAGE_TRANSITION}>
            <SourceStep
              onSelect={(s) => {
                setSource(s);
                setStep("gather");
              }}
            />
          </motion.div>
        )}

        {step === "gather" && source === "jd" && (
          <motion.div key="gather-jd" {...PAGE_TRANSITION}>
            <JDGatherStep
              jdText={jdText}
              setJdText={setJdText}
              busy={jdBusy}
              error={jdError}
              onAnalyze={analyzeJD}
              onBack={() => setStep("source")}
            />
          </motion.div>
        )}

        {step === "gather" && source === "jira" && (
          <motion.div key="gather-jira" {...PAGE_TRANSITION}>
            <JiraGatherStep
              siteUrl={jiraSiteUrl} setSiteUrl={setJiraSiteUrl}
              userEmail={jiraUserEmail} setUserEmail={setJiraUserEmail}
              apiToken={jiraApiToken} setApiToken={setJiraApiToken}
              projectKey={jiraProjectKey} setProjectKey={setJiraProjectKey}
              jql={jiraJql} setJql={setJiraJql}
              maxIssues={jiraMaxIssues} setMaxIssues={setJiraMaxIssues}
              busy={jiraFetching}
              error={jiraError}
              onAnalyze={analyzeJira}
              onBack={() => setStep("source")}
            />
          </motion.div>
        )}

        {step === "gather" && source === "manual" && (
          <motion.div key="gather-manual" {...PAGE_TRANSITION}>
            <ManualGatherStep
              form={form} set={set}
              toggleChallengeType={toggleChallengeType}
              codebaseSource={codebaseSource} setCodebaseSource={setCodebaseSource}
              {...ghShared}
              submitting={submitting}
              onSubmit={submit}
              onBack={() => setStep("source")}
            />
          </motion.div>
        )}

        {step === "review" && extracted && (
          <motion.div key="review" {...PAGE_TRANSITION}>
            <ReviewStep
              source={source!}
              extracted={extracted}
              editing={editing} setEditing={setEditing}
              form={form} set={set}
              toggleChallengeType={toggleChallengeType}
              codebaseSource={codebaseSource} setCodebaseSource={setCodebaseSource}
              {...ghShared}
              submitting={submitting}
              onSubmit={submit}
              onBack={() => setStep("gather")}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
