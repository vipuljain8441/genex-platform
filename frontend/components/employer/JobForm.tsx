"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Info, GitBranch, Sparkles, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import {
  api,
  type GitHubInfo,
  type GitHubIssue,
  type GitHubSource,
  type JiraAnalysis,
  type JobSpec,
  type RecruiterContext,
  type RoleFamily,
} from "@/lib/api";

import { Button } from "@/components/ui/Button";
import { Label, TextArea, TextInput } from "@/components/ui/Field";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const ROLE_FAMILIES: RoleFamily[] = [
  "backend", "frontend", "fullstack", "qa", "devops", "data", "pm", "design",
];
const SENIORITIES: JobSpec["seniority"][] = ["junior", "mid", "senior", "staff"];
const TOOLS: JobSpec["pm_tool"][] = ["jira", "linear", "github", "none"];

const INDUSTRY_OPTIONS = [
  "Fintech", "E-commerce", "Healthtech", "SaaS / B2B", "EdTech",
  "Logistics", "Gaming", "AdTech", "Cybersecurity", "Other",
];

type RcDraft = {
  domain_summary: string;
  sample_ticket_titles: string;
  common_bug_patterns: string;
  additional_tech_notes: string;
};

const DEFAULT_RC: RcDraft = {
  domain_summary:
    "We own the checkout & payments service for an e-commerce platform. ~150 RPS, Postgres + Redis, Stripe + Razorpay.",
  sample_ticket_titles: [
    "Fix discount calculation on bulk orders",
    "Add idempotency key to refund endpoint",
    "Retry failed webhook deliveries with exponential backoff",
  ].join("\n"),
  common_bug_patterns:
    "Forgetting to handle pagination on list endpoints, missing null checks on optional foreign keys, off-by-one in time windows.",
  additional_tech_notes:
    "We use Celery for async jobs, Redis for caching, Stripe webhooks. Codebase is async FastAPI.",
};

export function JobForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [codebaseSource, setCodebaseSource] = useState<"generated" | "github">("generated");
  const [customIndustry, setCustomIndustry] = useState("");

  const [form, setForm] = useState<JobSpec>({
    title: "Senior Backend Engineer",
    role_family: "backend",
    seniority: "senior",
    industry: "E-commerce",
    must_have_skills: ["Python", "FastAPI", "PostgreSQL"],
    nice_to_have_skills: ["Async", "Redis"],
    jd_text:
      "We're hiring a backend engineer to own our checkout service. Strong Python + FastAPI, comfortable with PostgreSQL, async, and writing production-grade APIs. You'll work alongside QA and DevOps and ship multiple times a day.",
    duration_minutes: 60,
    pm_tool: "none",
    codebase_source: "generated",
  });
  const [rc, setRc] = useState<RcDraft>(DEFAULT_RC);

  // GitHub state
  const [ghUrl, setGhUrl] = useState("");
  const [ghBranch, setGhBranch] = useState("main");
  const [ghInfo, setGhInfo] = useState<GitHubInfo | null>(null);
  const [ghFetching, setGhFetching] = useState(false);
  const [ghError, setGhError] = useState("");
  const [ghSelectedIssue, setGhSelectedIssue] = useState<GitHubIssue | null>(null);
  const [ghIssueOpen, setGhIssueOpen] = useState(false);
  const [jiraSiteUrl, setJiraSiteUrl] = useState("");
  const [jiraUserEmail, setJiraUserEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [jiraJql, setJiraJql] = useState("");
  const [jiraMaxIssues, setJiraMaxIssues] = useState(12);
  const [jiraAnalysis, setJiraAnalysis] = useState<JiraAnalysis | null>(null);
  const [jiraFetching, setJiraFetching] = useState(false);
  const [jiraError, setJiraError] = useState("");

  const set = <K extends keyof JobSpec>(k: K, v: JobSpec[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const needsRecruiterContext = form.pm_tool === "none" && codebaseSource === "generated";
  const usesJiraAnalysis = form.pm_tool === "jira" && codebaseSource === "generated";
  const usesCustomIndustry = !!form.industry && !INDUSTRY_OPTIONS.includes(form.industry);

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

  async function fetchJiraAnalysis() {
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
      const analysis = await api.analyzeJira({
        base_url: jiraSiteUrl.trim(),
        user_email: jiraUserEmail.trim(),
        api_token: jiraApiToken.trim(),
        project_key: jiraProjectKey.trim(),
        jql: jiraJql.trim(),
        max_issues: jiraMaxIssues,
        title: form.title,
        jd_text: form.jd_text,
        industry: form.industry,
        role_family_hint: form.role_family,
        seniority_hint: form.seniority,
      });
      setJiraAnalysis(analysis);
    } catch (e: any) {
      setJiraError(e.message || "Failed to analyze Jira backlog");
      setJiraAnalysis(null);
    } finally {
      setJiraFetching(false);
    }
  }

  function applyJiraSuggestions(analysis: JiraAnalysis) {
    const roleSuggestion = analysis.suggested_role_family as RoleFamily;
    const senioritySuggestion = analysis.suggested_seniority as JobSpec["seniority"];

    setForm((f) => ({
      ...f,
      title: analysis.suggested_title || f.title,
      role_family: ROLE_FAMILIES.includes(roleSuggestion) ? roleSuggestion : f.role_family,
      seniority: SENIORITIES.includes(senioritySuggestion) ? senioritySuggestion : f.seniority,
      industry: analysis.suggested_industry || f.industry,
      jd_text: analysis.generated_jd || f.jd_text,
      must_have_skills: analysis.must_have_skills.length ? analysis.must_have_skills : f.must_have_skills,
      nice_to_have_skills: analysis.nice_to_have_skills.length ? analysis.nice_to_have_skills : f.nice_to_have_skills,
    }));
    setCustomIndustry(
      analysis.suggested_industry && !INDUSTRY_OPTIONS.includes(analysis.suggested_industry)
        ? analysis.suggested_industry
        : ""
    );

    setRc({
      domain_summary: analysis.recruiter_context.domain_summary,
      sample_ticket_titles: analysis.recruiter_context.sample_ticket_titles.join("\n"),
      common_bug_patterns: analysis.recruiter_context.common_bug_patterns,
      additional_tech_notes: analysis.recruiter_context.additional_tech_notes,
    });
  }

  async function submit() {
    setSubmitting(true);
    try {
      if (usesJiraAnalysis && !jiraAnalysis) {
        alert("Run Jira backlog analysis first so we can ground the assessment in real work.");
        setSubmitting(false);
        return;
      }

      const recruiter_context: RecruiterContext | null = usesJiraAnalysis
        ? jiraAnalysis!.recruiter_context
        : needsRecruiterContext
          ? {
              domain_summary: rc.domain_summary.trim(),
              sample_ticket_titles: rc.sample_ticket_titles
                .split("\n").map((s) => s.trim()).filter(Boolean),
              common_bug_patterns: rc.common_bug_patterns.trim(),
              additional_tech_notes: rc.additional_tech_notes.trim(),
            }
          : null;

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
        recruiter_context,
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mx-auto max-w-3xl"
    >
      <Card>
        <CardHeader>
          <div className="text-xs uppercase tracking-[0.25em] text-accent">
            New assessment
          </div>
          <h1 className="mt-2 font-display text-3xl md:text-4xl font-semibold tracking-tight">
            Tell us about the role.
          </h1>
          <p className="mt-2 text-sm text-bone/55">
            Our agents will read this, ground the test in your real work, and build the rest.
          </p>
        </CardHeader>

        <CardBody className="space-y-6">
          {/* Job title */}
          <div>
            <Label>Job title</Label>
            <TextInput value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>

          {/* Role family + Seniority */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Role family</Label>
              <div className="flex flex-wrap gap-2">
                {ROLE_FAMILIES.map((r) => (
                  <button
                    key={r}
                    onClick={() => set("role_family", r)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm capitalize transition",
                      form.role_family === r
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-black/[0.08] bg-white text-bone/65 hover:border-black/20"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Seniority</Label>
              <div className="flex flex-wrap gap-2">
                {SENIORITIES.map((s) => (
                  <button
                    key={s}
                    onClick={() => set("seniority", s)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm capitalize transition",
                      form.seniority === s
                        ? "border-sky/60 bg-sky/15 text-sky"
                        : "border-black/[0.08] bg-white text-bone/65 hover:border-black/20"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Industry */}
          <div>
            <Label hint="Grounds the generated codebase in your domain">Industry</Label>
            <div className="flex flex-wrap gap-2">
              {INDUSTRY_OPTIONS.map((ind) => (
                <button
                  key={ind}
                  onClick={() => {
                    if (ind === "Other") {
                      set("industry", customIndustry || "Other");
                      return;
                    }
                    setCustomIndustry("");
                    set("industry", ind);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition",
                    (ind === "Other"
                      ? (form.industry === "Other" || usesCustomIndustry)
                      : form.industry === ind
                    )
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
                placeholder="e.g. Real estate, Insurance, Government"
                value={usesCustomIndustry ? form.industry : customIndustry}
                onChange={(e) => {
                  const value = e.target.value;
                  setCustomIndustry(value);
                  set("industry", value || "Other");
                }}
              />
            )}
          </div>

          {/* Skills */}
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

          {/* JD */}
          <div>
            <Label>Job description</Label>
            <TextArea value={form.jd_text} onChange={(e) => set("jd_text", e.target.value)} rows={5} />
          </div>

          {/* Duration + PM tool */}
          <div className="grid md:grid-cols-2 gap-4">
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
              <Label>PM tool</Label>
              <div className="flex flex-wrap gap-2">
                {TOOLS.map((t) => (
                  <button
                    key={t}
                    onClick={() => set("pm_tool", t)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm capitalize transition",
                      form.pm_tool === t
                        ? "border-amber/60 bg-amber/15 text-amber"
                        : "border-black/[0.08] bg-white text-bone/65 hover:border-black/20"
                    )}
                  >
                    {t === "none" ? "No PM tool" : t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Codebase source toggle ───────────────────────────────────── */}
          <div>
            <Label>Codebase source</Label>
            <p className="text-xs text-bone/50 mb-3">
              Choose how the candidate's working codebase is created.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setCodebaseSource("generated"); set("codebase_source", "generated"); }}
                className={cn(
                  "rounded-xl border p-4 text-left transition",
                  codebaseSource === "generated"
                    ? "border-accent/50 bg-accent/10 ring-1 ring-accent/30"
                    : "border-black/[0.08] bg-white hover:border-black/20"
                )}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles className="h-4 w-4 text-accent" />
                  <span className="text-sm font-semibold text-bone">AI-generated</span>
                </div>
                <p className="text-xs text-bone/55 leading-snug">
                  Our agents write a production-quality codebase tailored to the role, industry, and tech stack.
                </p>
              </button>

              <button
                onClick={() => { setCodebaseSource("github"); set("codebase_source", "github"); }}
                className={cn(
                  "rounded-xl border p-4 text-left transition",
                  codebaseSource === "github"
                    ? "border-accent/50 bg-accent/10 ring-1 ring-accent/30"
                    : "border-black/[0.08] bg-white hover:border-black/20"
                )}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <GitBranch className="h-4 w-4 text-bone/70" />
                  <span className="text-sm font-semibold text-bone">GitHub repo</span>
                </div>
                <p className="text-xs text-bone/55 leading-snug">
                  Provide a public GitHub repo URL. Optionally pick an open issue for the candidate to resolve.
                </p>
              </button>
            </div>
          </div>

          {/* ── GitHub section ───────────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {codebaseSource === "github" && (
              <motion.div
                key="github"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="rounded-2xl border border-black/[0.08] bg-ink-100/50 p-5 space-y-4">
                  <div className="flex items-start gap-2.5">
                    <GitBranch className="h-5 w-5 mt-0.5 text-bone/60 shrink-0" />
                    <div>
                      <div className="text-sm font-semibold">Public GitHub repository</div>
                      <p className="text-xs text-bone/55 mt-0.5">
                        We'll fetch the repo's files and open issues. The candidate will work on a version with injected defects.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <TextInput
                      className="flex-1"
                      placeholder="https://github.com/owner/repo"
                      value={ghUrl}
                      onChange={(e) => { setGhUrl(e.target.value); setGhInfo(null); setGhError(""); }}
                      onKeyDown={(e) => e.key === "Enter" && fetchGitHubInfo()}
                    />
                    <Button
                      size="sm"
                      onClick={fetchGitHubInfo}
                      disabled={ghFetching || !ghUrl.trim()}
                    >
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
                      className="space-y-4"
                    >
                      {/* Repo info card */}
                      <div className="rounded-xl border border-mint/30 bg-mint/[0.07] p-4">
                        <div className="font-semibold text-sm text-bone">{ghInfo.full_name}</div>
                        {ghInfo.description && (
                          <p className="text-xs text-bone/60 mt-1">{ghInfo.description}</p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2">
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

                      {/* Branch */}
                      <div>
                        <Label hint="Branch to fetch from">Branch</Label>
                        <TextInput
                          value={ghBranch}
                          onChange={(e) => setGhBranch(e.target.value)}
                          placeholder="main"
                        />
                      </div>

                      {/* Issue selector */}
                      {ghInfo.issues.length > 0 && (
                        <div>
                          <Label hint="Optional — the candidate will resolve this issue">
                            Pick a GitHub issue (optional)
                          </Label>
                          <div className="relative">
                            <button
                              onClick={() => setGhIssueOpen((v) => !v)}
                              className="w-full flex items-center justify-between rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm text-left hover:border-black/20 transition"
                            >
                              <span className={ghSelectedIssue ? "text-bone" : "text-bone/40"}>
                                {ghSelectedIssue
                                  ? `#${ghSelectedIssue.number} — ${ghSelectedIssue.title}`
                                  : "Auto-generate ticket from codebase"}
                              </span>
                              <ChevronDown className={cn("h-4 w-4 text-bone/40 transition-transform", ghIssueOpen && "rotate-180")} />
                            </button>
                            <AnimatePresence>
                              {ghIssueOpen && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  transition={{ duration: 0.15 }}
                                  className="absolute z-10 mt-1 w-full rounded-xl border border-black/[0.08] bg-white shadow-soft overflow-hidden"
                                >
                                  <div className="max-h-56 overflow-y-auto scrollbar-thin">
                                    <button
                                      className="w-full px-4 py-2.5 text-sm text-left text-bone/50 hover:bg-ink-100 border-b border-black/[0.04] transition"
                                      onClick={() => { setGhSelectedIssue(null); setGhIssueOpen(false); }}
                                    >
                                      Auto-generate from codebase
                                    </button>
                                    {ghInfo.issues.map((issue) => (
                                      <button
                                        key={issue.number}
                                        className="w-full px-4 py-2.5 text-sm text-left hover:bg-ink-100 transition border-b border-black/[0.03] last:border-0"
                                        onClick={() => { setGhSelectedIssue(issue); setGhIssueOpen(false); }}
                                      >
                                        <div className="flex items-baseline gap-2">
                                          <span className="text-bone/40 font-mono text-xs shrink-0">
                                            #{issue.number}
                                          </span>
                                          <span className="text-bone truncate">{issue.title}</span>
                                        </div>
                                        {issue.labels.length > 0 && (
                                          <div className="flex gap-1 mt-1 ml-7">
                                            {issue.labels.slice(0, 3).map((l) => (
                                              <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                                                {l}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          {ghSelectedIssue?.body && (
                            <div className="mt-2 rounded-lg border border-black/[0.06] bg-ink-100/60 p-3 text-xs text-bone/60 max-h-28 overflow-y-auto scrollbar-thin">
                              {ghSelectedIssue.body}
                            </div>
                          )}
                        </div>
                      )}

                      {ghInfo.issues.length === 0 && (
                        <p className="text-xs text-bone/50 italic">
                          No open issues found — a ticket will be generated from the codebase.
                        </p>
                      )}
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Jira section ─────────────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {usesJiraAnalysis && (
              <motion.div
                key="jira"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="rounded-2xl border border-black/[0.08] bg-ink-100/50 p-5 space-y-4">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 grid place-items-center h-6 w-6 rounded-md bg-amber text-white shrink-0">
                      <Info className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">Analyze Jira backlog</div>
                      <p className="text-xs text-bone/55 mt-0.5">
                        We will inspect a small backlog slice, infer the role and tech stack, and feed that structured context into the assessment pipeline. Jira credentials are only used for this analysis request.
                      </p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>Jira site URL</Label>
                      <TextInput
                        placeholder="https://your-team.atlassian.net"
                        value={jiraSiteUrl}
                        onChange={(e) => {
                          setJiraSiteUrl(e.target.value);
                          setJiraAnalysis(null);
                          setJiraError("");
                        }}
                      />
                    </div>
                    <div>
                      <Label>Atlassian email</Label>
                      <TextInput
                        placeholder="you@company.com"
                        value={jiraUserEmail}
                        onChange={(e) => {
                          setJiraUserEmail(e.target.value);
                          setJiraAnalysis(null);
                          setJiraError("");
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>API token</Label>
                      <TextInput
                        type="password"
                        placeholder="Atlassian API token"
                        value={jiraApiToken}
                        onChange={(e) => {
                          setJiraApiToken(e.target.value);
                          setJiraAnalysis(null);
                          setJiraError("");
                        }}
                      />
                    </div>
                    <div>
                      <Label hint="Optional if you provide JQL">Project key</Label>
                      <TextInput
                        placeholder="PAY, OPS, WEB"
                        value={jiraProjectKey}
                        onChange={(e) => {
                          setJiraProjectKey(e.target.value);
                          setJiraAnalysis(null);
                          setJiraError("");
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-[1fr_120px] gap-4">
                    <div>
                      <Label hint="Optional override">JQL query</Label>
                      <TextInput
                        placeholder='project = PAY AND statusCategory != Done ORDER BY updated DESC'
                        value={jiraJql}
                        onChange={(e) => {
                          setJiraJql(e.target.value);
                          setJiraAnalysis(null);
                          setJiraError("");
                        }}
                      />
                    </div>
                    <div>
                      <Label>Max issues</Label>
                      <TextInput
                        type="number"
                        min={3}
                        max={25}
                        value={jiraMaxIssues}
                        onChange={(e) => {
                          setJiraMaxIssues(parseInt(e.target.value || "12", 10));
                          setJiraAnalysis(null);
                          setJiraError("");
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-bone/50">
                      Tip: project key is enough for a quick first pass. Use JQL when you want to target a specific backlog slice.
                    </p>
                    <Button
                      size="sm"
                      onClick={fetchJiraAnalysis}
                      disabled={jiraFetching || !jiraSiteUrl.trim()}
                    >
                      {jiraFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze backlog"}
                    </Button>
                  </div>

                  {jiraError && (
                    <div className="flex items-center gap-2 text-sm text-coral">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {jiraError}
                    </div>
                  )}

                  {jiraAnalysis && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-4"
                    >
                      <div className="rounded-xl border border-mint/30 bg-mint/[0.07] p-4 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-bone">
                            {jiraAnalysis.suggested_title}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent capitalize">
                            {jiraAnalysis.suggested_role_family}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky/10 text-sky capitalize">
                            {jiraAnalysis.suggested_seniority}
                          </span>
                          {jiraAnalysis.suggested_industry && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet/10 text-violet">
                              {jiraAnalysis.suggested_industry}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-bone/60">{jiraAnalysis.problem_summary}</p>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-bone/35">
                          {jiraAnalysis.source_summary}
                        </p>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-bone/45">
                            Must-have skills
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {jiraAnalysis.must_have_skills.map((skill) => (
                              <span key={skill} className="text-[11px] px-2 py-1 rounded-full bg-bone/10 text-bone/75">
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-bone/45">
                            Nice-to-have skills
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {jiraAnalysis.nice_to_have_skills.map((skill) => (
                              <span key={skill} className="text-[11px] px-2 py-1 rounded-full bg-amber/10 text-amber">
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-bone">Backlog signals</div>
                            <p className="text-xs text-bone/55 mt-0.5">
                              These are the real tickets we used to infer the role, problems, and tech stack.
                            </p>
                          </div>
                          <Button size="sm" onClick={() => applyJiraSuggestions(jiraAnalysis)}>
                            Apply suggestions
                          </Button>
                        </div>
                        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                          {jiraAnalysis.issues.map((issue) => (
                            <div key={issue.key} className="rounded-lg border border-black/[0.05] bg-ink-100/60 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-mono text-bone/40">{issue.key}</span>
                                <span className="text-sm font-medium text-bone">{issue.title}</span>
                                {issue.issue_type && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bone/10 text-bone/65">
                                    {issue.issue_type}
                                  </span>
                                )}
                                {issue.priority && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-coral/10 text-coral">
                                    {issue.priority}
                                  </span>
                                )}
                              </div>
                              {issue.summary && (
                                <p className="mt-1 text-xs text-bone/60 leading-relaxed">
                                  {issue.summary}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-1">
                                {issue.labels.slice(0, 4).map((label) => (
                                  <span key={label} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                                    {label}
                                  </span>
                                ))}
                                {issue.components.slice(0, 3).map((component) => (
                                  <span key={component} className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky/10 text-sky">
                                    {component}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Recruiter context (generated path + no PM tool) ──────────── */}
          <AnimatePresence initial={false}>
            {needsRecruiterContext && (
              <motion.div
                key="rc"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="rounded-2xl border border-accent/25 bg-accent-soft p-5 space-y-4">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 grid place-items-center h-6 w-6 rounded-md bg-accent text-white shrink-0">
                      <Info className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">
                        Since you haven't connected a PM tool — tell us about the team.
                      </div>
                      <p className="text-xs text-bone/60 mt-0.5">
                        We'll use this to ground the assessment in your actual work instead of generic puzzles.
                      </p>
                    </div>
                  </div>

                  <div>
                    <Label>What does your team build?</Label>
                    <TextArea
                      rows={2}
                      value={rc.domain_summary}
                      onChange={(e) => setRc({ ...rc, domain_summary: e.target.value })}
                      placeholder="e.g. We own the checkout & payments service for an e-commerce platform."
                    />
                  </div>

                  <div>
                    <Label hint="One per line">Sample real ticket titles from the last quarter</Label>
                    <TextArea
                      rows={4}
                      value={rc.sample_ticket_titles}
                      onChange={(e) => setRc({ ...rc, sample_ticket_titles: e.target.value })}
                      placeholder={"Fix discount calculation on bulk orders\nAdd idempotency key to refund endpoint"}
                    />
                  </div>

                  <div>
                    <Label>Common bug patterns in your codebase</Label>
                    <TextArea
                      rows={2}
                      value={rc.common_bug_patterns}
                      onChange={(e) => setRc({ ...rc, common_bug_patterns: e.target.value })}
                      placeholder="e.g. Missing null checks on optional FKs, off-by-one in time windows."
                    />
                  </div>

                  <div>
                    <Label>Anything else about your tech stack</Label>
                    <TextArea
                      rows={2}
                      value={rc.additional_tech_notes}
                      onChange={(e) => setRc({ ...rc, additional_tech_notes: e.target.value })}
                      placeholder="e.g. Celery for async jobs, Redis for caching, Stripe webhooks."
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button size="lg" onClick={submit} disabled={submitting}>
              {submitting ? "Spinning up agents…" : "Generate assessment"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
