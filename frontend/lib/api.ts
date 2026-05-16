import type { ReportData } from "./report-types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export type CommandResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  command: string;
  timed_out: boolean;
  unsupported: boolean;
};

export type ActivityEventInput = {
  session_id: string;
  kind: string;
  file_path?: string | null;
  payload?: Record<string, unknown>;
};

// ── Employer ────────────────────────────────────────────────────────────────
export type RoleFamily =
  | "backend" | "frontend" | "fullstack"
  | "qa" | "devops" | "data" | "pm" | "design";
export type ChallengeKind = "coding" | "sql" | "objective" | "theory";

export type RecruiterContext = {
  domain_summary: string;
  sample_ticket_titles: string[];
  common_bug_patterns: string;
  additional_tech_notes: string;
};

export type GitHubSource = {
  repo_url: string;
  branch: string;
  issue_number?: number | null;
  issue_title?: string;
  issue_body?: string;
};

export type JobSpec = {
  title: string;
  role_family: RoleFamily;
  seniority: "junior" | "mid" | "senior" | "staff";
  industry?: string;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  jd_text: string;
  duration_minutes: number;
  pm_tool: "jira" | "linear" | "github" | "none";
  recruiter_context?: RecruiterContext | null;
  codebase_source?: "generated" | "github";
  github_source?: GitHubSource | null;
  challenge_count?: number;
  challenge_types?: ChallengeKind[];
};

export type ObjectiveOption = {
  id: string;
  text: string;
};

export type ObjectiveQuestion = {
  id: string;
  prompt: string;
  options: ObjectiveOption[];
  multi_select: boolean;
  correct_option_ids: string[];
  explanation: string;
};

export type CandidateChallenge = {
  id: string;
  kind: ChallengeKind;
  title: string;
  description: string;
  instructions: string;
  acceptance_criteria: string[];
  issues: {
    id: string;
    title: string;
    description: string;
    severity: "low" | "medium" | "high";
  }[];
  priority: "low" | "medium" | "high" | "critical";
  labels: string[];
  reporter: string;
  assignee: string;
  estimated_minutes: number;
  related_files: string[];
  workspace_enabled: boolean;
  allow_buddy: boolean;
  objective_questions: ObjectiveQuestion[];
  expected_response_format: string;
  editor_language: string;
  starter_content: string;
};

export type ChallengeResponse = {
  challenge_id: string;
  challenge_kind: ChallengeKind;
  status: "pending" | "in_progress" | "completed";
  answer_text: string;
  selected_option_ids: Record<string, string[]>;
  updated_at: string;
};

export type CandidateSessionView = {
  id: string;
  assessment_id: string;
  candidate_name: string;
  started_at: string;
  submitted_at: string | null;
  current_challenge_id: string | null;
  current_files: Record<string, string>;
  challenge_responses: Record<string, ChallengeResponse>;
};

export type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
};

export type GitHubInfo = {
  full_name: string;
  description: string;
  default_branch: string;
  language: string;
  topics: string[];
  issues: GitHubIssue[];
};

export type JiraIssue = {
  key: string;
  title: string;
  summary: string;
  status: string;
  issue_type: string;
  priority: string;
  labels: string[];
  components: string[];
  project: string;
  updated: string;
};

export type JiraAnalysis = {
  suggested_title: string;
  suggested_role_family: RoleFamily | string;
  suggested_seniority: JobSpec["seniority"] | string;
  suggested_industry: string;
  problem_summary: string;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  generated_jd: string;
  recruiter_context: RecruiterContext;
  issues: JiraIssue[];
  source_summary: string;
};

export type JDAnalysis = {
  suggested_title: string;
  suggested_role_family: RoleFamily | string;
  suggested_seniority: JobSpec["seniority"] | string;
  suggested_industry: string;
  problem_summary: string;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  generated_jd: string;
  recruiter_context: RecruiterContext;
};

export type PipelineStage =
  | "pending" | "fetching" | "extracting" | "authoring"
  | "challenging"
  | "ticketing" | "injecting" | "ready" | "failed";

export type Assessment = {
  id: string;
  job: JobSpec;
  status: { stage: PipelineStage; detail: string; updated_at: string };
  context: any;
  golden_codebase: any;
  buggy_codebase: {
    artifact_kind: string;
    entry_point: string | null;
    setup_instructions: string;
    files: { path: string; language: string; content: string }[];
  } | null;
  candidate_ticket: {
    id: string;
    title: string;
    description: string;
    acceptance_criteria: string[];
    priority: string;
    labels: string[];
    reporter: string;
    assignee: string;
  } | null;
  candidate_challenges: CandidateChallenge[];
  bug_brief: any;
  created_at: string;
};

export const api = {
  createAssessment: (job: JobSpec) =>
    http<Assessment>("/api/employer/assessments", {
      method: "POST",
      body: JSON.stringify(job),
    }),
  getAssessment: (id: string) =>
    http<Assessment>(`/api/employer/assessments/${id}`),
  listAssessments: () =>
    http<Assessment[]>("/api/employer/assessments"),

  startSession: (assessment_id: string, candidate_name: string) =>
    http<{ session: CandidateSessionView; assessment: Assessment }>(
      "/api/candidate/sessions",
      { method: "POST", body: JSON.stringify({ assessment_id, candidate_name }) }
    ),
  getSession: (sid: string) =>
    http<{ session: CandidateSessionView; assessment: Assessment }>(`/api/candidate/sessions/${sid}`),
  saveFile: (sid: string, path: string, content: string) =>
    http<CandidateSessionView>(`/api/candidate/sessions/${sid}/files`, {
      method: "PUT", body: JSON.stringify({ path, content }),
    }),
  setCurrentChallenge: (sid: string, challenge_id: string) =>
    http<CandidateSessionView>(`/api/candidate/sessions/${sid}/current-challenge`, {
      method: "PUT",
      body: JSON.stringify({ challenge_id }),
    }),
  saveChallengeResponse: (
    sid: string,
    challenge_id: string,
    body: {
      status?: "pending" | "in_progress" | "completed";
      answer_text?: string;
      selected_option_ids?: Record<string, string[]>;
    }
  ) =>
    http<CandidateSessionView>(`/api/candidate/sessions/${sid}/challenges/${challenge_id}/response`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  submit: (sid: string) =>
    http<{ session_id: string; status: string }>(
      `/api/candidate/sessions/${sid}/submit`, { method: "POST" }
    ),

  run: (sid: string, file_path: string) =>
    http<CommandResult>(`/api/candidate/sessions/${sid}/run`, {
      method: "POST",
      body: JSON.stringify({ file_path }),
    }),
  terminal: (sid: string, command: string) =>
    http<CommandResult>(`/api/candidate/sessions/${sid}/terminal`, {
      method: "POST",
      body: JSON.stringify({ command }),
    }),

  askBuddy: (body: {
    session_id: string;
    question: string;
    challenge_id?: string | null;
    open_file?: string | null;
    selection?: string | null;
    workspace?: Record<string, string>;
  }) =>
    http<{
      hint: string;
      hint_level: string;
      blocked: boolean;
      edits: { file_path: string; new_content: string; rationale: string }[];
    }>("/api/buddy/ask", { method: "POST", body: JSON.stringify(body) }),
  buddyHistory: (sid: string) =>
    http<{ role: string; content: string; at: string }[]>(`/api/buddy/history/${sid}`),

  recordEvent: (body: ActivityEventInput) =>
    http<any>("/api/monitor/events", { method: "POST", body: JSON.stringify(body) }),
  recordEvents: (events: ActivityEventInput[]) =>
    http<any>("/api/monitor/events/batch", {
      method: "POST",
      body: JSON.stringify({ events }),
    }),

  getResults: (sid: string) =>
    http<{
      evaluation: any | null;
      heatmap: any;
    }>(`/api/results/${sid}`),
  getReport: (sid: string) =>
    http<ReportData>(`/api/results/${sid}/report`),

  // ── GitHub ──────────────────────────────────────────────────────────────
  getGitHubInfo: (repo_url: string) =>
    http<GitHubInfo>("/api/employer/github/info", {
      method: "POST",
      body: JSON.stringify({ repo_url }),
    }),

  analyzeJD: (jd_text: string) =>
    http<JDAnalysis>("/api/employer/jd/analyze", {
      method: "POST",
      body: JSON.stringify({ jd_text }),
    }),

  analyzeJira: (body: {
    base_url: string;
    user_email: string;
    api_token: string;
    project_key?: string;
    jql?: string;
    max_issues?: number;
    title?: string;
    jd_text?: string;
    industry?: string;
    role_family_hint?: string;
    seniority_hint?: string;
  }) =>
    http<JiraAnalysis>("/api/employer/jira/analyze", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Invites ─────────────────────────────────────────────────────────────
  createInvites: (
    aid: string,
    emails: string[],
    candidate_name = ""
  ) =>
    http<InviteOut[]>(`/api/employer/assessments/${aid}/invites`, {
      method: "POST",
      body: JSON.stringify({ emails, candidate_name }),
    }),
  listInvites: (aid: string) =>
    http<InviteOut[]>(`/api/employer/assessments/${aid}/invites`),
  getInvite: (token: string) =>
    http<InviteView>(`/api/invites/${token}`),
  acceptInvite: (token: string, candidate_name = "") =>
    http<{ session_id: string; assessment_id: string }>(
      `/api/invites/${token}/accept`,
      { method: "POST", body: JSON.stringify({ candidate_name }) }
    ),
};

export type InviteOut = {
  id: string;
  assessment_id: string;
  candidate_email: string;
  candidate_name: string;
  token: string;
  invite_url: string;
  invited_at: string;
  accepted_at: string | null;
  status: "pending" | "accepted" | "expired";
  email_sent: boolean;
  email_error: string | null;
  session_id: string | null;
};

export type InviteView = {
  token: string;
  status: "pending" | "accepted" | "expired";
  candidate_email: string;
  candidate_name: string;
  session_id: string | null;
  assessment: {
    id: string;
    title: string;
    role_family: string;
    duration_minutes: number;
    ready: boolean;
  };
};

export function streamAssessment(
  id: string,
  onMessage: (a: Assessment) => void
): () => void {
  const ws = new WebSocket(`${WS}/api/employer/assessments/${id}/stream`);
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  };
  return () => ws.close();
}
