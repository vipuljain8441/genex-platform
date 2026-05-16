"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";
import { api, type JobSpec, type RecruiterContext, type RoleFamily } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Label, TextArea, TextInput } from "@/components/ui/Field";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const ROLE_FAMILIES: RoleFamily[] = [
  "backend", "frontend", "fullstack", "qa", "devops", "data", "pm", "design",
];

const SENIORITIES: JobSpec["seniority"][] = ["junior", "mid", "senior", "staff"];
const TOOLS: JobSpec["pm_tool"][] = ["jira", "linear", "github", "none"];

type RcDraft = {
  domain_summary: string;
  sample_ticket_titles: string; // newline-separated in the textarea
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
  const [form, setForm] = useState<JobSpec>({
    title: "Senior Backend Engineer",
    role_family: "backend",
    seniority: "senior",
    must_have_skills: ["Python", "FastAPI", "PostgreSQL"],
    nice_to_have_skills: ["Async", "Redis"],
    jd_text:
      "We're hiring a backend engineer to own our checkout service. Strong Python + FastAPI, comfortable with PostgreSQL, async, and writing production-grade APIs. You'll work alongside QA and DevOps and ship multiple times a day.",
    duration_minutes: 60,
    pm_tool: "none",
  });
  const [rc, setRc] = useState<RcDraft>(DEFAULT_RC);

  const set = <K extends keyof JobSpec>(k: K, v: JobSpec[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const needsRecruiterContext = form.pm_tool === "none";

  async function submit() {
    setSubmitting(true);
    try {
      const recruiter_context: RecruiterContext | null = needsRecruiterContext
        ? {
            domain_summary: rc.domain_summary.trim(),
            sample_ticket_titles: rc.sample_ticket_titles
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            common_bug_patterns: rc.common_bug_patterns.trim(),
            additional_tech_notes: rc.additional_tech_notes.trim(),
          }
        : null;
      const a = await api.createAssessment({ ...form, recruiter_context });
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
          <div>
            <Label>Job title</Label>
            <TextInput
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>

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

          <div>
            <Label hint="Comma-separated">Must-have skills</Label>
            <TextInput
              value={form.must_have_skills.join(", ")}
              onChange={(e) =>
                set(
                  "must_have_skills",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
            />
          </div>

          <div>
            <Label hint="Comma-separated">Nice-to-have skills</Label>
            <TextInput
              value={form.nice_to_have_skills.join(", ")}
              onChange={(e) =>
                set(
                  "nice_to_have_skills",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
            />
          </div>

          <div>
            <Label>Job description</Label>
            <TextArea
              value={form.jd_text}
              onChange={(e) => set("jd_text", e.target.value)}
              rows={6}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Duration (minutes)</Label>
              <TextInput
                type="number"
                min={15}
                max={240}
                value={form.duration_minutes}
                onChange={(e) =>
                  set("duration_minutes", parseInt(e.target.value || "60", 10))
                }
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
