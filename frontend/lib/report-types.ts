// Mirror of backend ReportData (app/services/report.py).
// Kept hand-written so we don't pull in OpenAPI codegen.

export type BugStatus = "missed" | "encountered" | "noticed" | "fixed";

export type TrapOutcome = "passed" | "failed" | "not_triggered";

export type Severity = "critical" | "warning" | "info";

export type HeatmapCell = {
  file_path: string;
  bucket: number;
  intensity: number;
  events: number;
};

export type Heatmap = {
  buckets: number;
  bucket_seconds: number;
  files: string[];
  cells: HeatmapCell[];
  started_at: string;
  ended_at: string;
  totals_by_kind: Record<string, number>;
};

export type CandidateHeader = {
  candidate_name: string;
  assessment_title: string;
  role_title: string;
  tech_stack: string[];
  seniority: string;
  duration_used_min: number | null;
  duration_allotted_min: number;
  started_at: string;
  submitted_at: string | null;
  finished_early: boolean;
};

export type CQComponent = {
  key: string;
  label: string;
  score: number;
  max: number;
  note: string;
};

export type CQBreakdown = {
  total: number;
  components: CQComponent[];
};

export type CQOverview = {
  score: number; // 0..100
  summary: string;
  breakdown: CQBreakdown;
};

export type MetricScore = {
  key: string;
  label: string;
  score: number;
  max: number;
};

export type BugRow = {
  id: string;
  bug_type: string;
  description: string;
  status: BugStatus;
};

export type BugExposure = {
  rows: BugRow[];
  fixed_count: number;
  missed_count: number;
  total: number;
};

export type PromptEntry = {
  at: string;
  content: string;
  file_context: string | null;
  tags: string[];
};

export type TrapDetail = {
  configured: boolean;
  bad_suggestion: string;
  trigger: string;
  outcome: TrapOutcome;
};

export type AIInteraction = {
  prompts: PromptEntry[];
  prompt_count: number;
  proposed: number;
  accepted: number;
  rejected: number;
  blind_paste_rate: number;
  edits_after_accept: number;
  trap: TrapDetail;
  model_used: string;
};

export type TimelineMarker = {
  label: string;
  at: string;
  offset_pct: number;
};

export type HeatmapMix = {
  editor: number;
  ai: number;
  terminal: number;
};

export type Verification = {
  ran_tests: boolean;
  verified_ai_patches: boolean;
  small_commits: boolean;
};

export type BehaviourPattern = {
  timeline: TimelineMarker[];
  files_before_first_edit: number;
  time_to_first_edit_min: number | null;
  total_files_opened: number;
  investigation_note: string;
  heatmap_mix: HeatmapMix;
  verification: Verification;
};

export type IntegrityFlag = {
  type: string;
  label: string;
  count: number;
  total_duration_seconds: number | null;
  details: string;
};

export type IntegritySignals = {
  score: number;
  flags: IntegrityFlag[];
  disclaimer: string;
};

export type StrategyAnswer = {
  question: string;
  answer: string;
  score: number;
  max: number;
  note: string;
  tags: string[];
};

export type CodeReviewFinding = {
  severity: Severity;
  file: string;
  line: number | null;
  message: string;
  is_ai_generated_error: boolean;
};

export type CodeReview = {
  summary: string;
  findings: CodeReviewFinding[];
  critical_count: number;
  warning_count: number;
  info_count: number;
};

export type ReportData = {
  available: boolean;
  header: CandidateHeader;
  cq: CQOverview | null;
  metrics: MetricScore[];
  bug_exposure: BugExposure;
  ai: AIInteraction;
  behaviour: BehaviourPattern;
  integrity: IntegritySignals;
  strategy: StrategyAnswer[];
  code_review: CodeReview | null;
  playback_url: string;
  heatmap: Heatmap;
};
