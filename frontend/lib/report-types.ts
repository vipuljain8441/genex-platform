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

export type FileLineRange = {
  start_line: number;
  end_line: number;
  change_type: string;
};

export type FileActivitySummary = {
  file_path: string;
  active_seconds: number;
  total_events: number;
  edit_events: number;
  line_ranges: FileLineRange[];
  first_at: string | null;
  last_at: string | null;
};

export type ActivityTraceEntry = {
  at: string;
  kind: string;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  summary: string;
};

export type ActivityForensics = {
  total_events: number;
  tracked_files: number;
  file_summaries: FileActivitySummary[];
  recent_entries: ActivityTraceEntry[];
};

export type BuddyTranscriptEntry = {
  at: string;
  role: string;
  content: string;
  challenge_id: string | null;
  open_file: string | null;
  blocked: boolean;
  hint_level: string | null;
  edit_targets: string[];
};

export type BuddyEditAction = {
  at: string;
  action: string;
  file_path: string | null;
  challenge_id: string | null;
  rationale: string;
};

export type BuddyAudit = {
  total_messages: number;
  blocked_messages: number;
  proposed_edits: number;
  applied_edits: number;
  dismissed_edits: number;
  transcript: BuddyTranscriptEntry[];
  actions: BuddyEditAction[];
};

export type FeedbackEntry = {
  id: string;
  category: string;
  message: string;
  challenge_id: string | null;
  status: string;
  created_at: string;
};

// ── Section 7a–7f: Behavioural analytics ────────────────────────────────────
// Mirrors backend services/behaviour.py.

export type TicketTimeSummary = {
  ticket_id: string;
  ticket_title: string;
  story_points: number;
  total_seconds: number;
  active_seconds: number;
  idle_seconds: number;
  ai_seconds: number;
  focus_periods: number;
  stuck_flag: boolean;
};

export type IdleTier = "think_pause" | "extended_idle" | "inactive";

export type IdleEpisode = {
  at: string;
  duration_seconds: number;
  tier: IdleTier;
  preceding_activity: string;
  following_activity: string;
  note: string;
};

export type IdleSummary = {
  total_idle_seconds: number;
  idle_percentage: number;
  think_pause_count: number;
  extended_idle_count: number;
  inactive_count: number;
  longest_episode: IdleEpisode | null;
  idle_after_ai_suggestion: number;
  episodes: IdleEpisode[];
};

export type KeystrokePattern =
  | "fluent"
  | "think-then-type"
  | "paste-dominant"
  | "uncertain"
  | "insufficient_data";

export type KeystrokePatternSummary = {
  total_keystrokes: number;
  average_wpm: number;
  peak_wpm: number;
  undo_count: number;
  paste_vs_type_ratio: number;
  delete_ratio: number;
  dominant_pattern: KeystrokePattern;
  wpm_sparkline: number[];
};

export type FileAttribution = {
  file_path: string;
  total_lines: number;
  manual_pct: number;
  ai_patch_pct: number;
  pasted_pct: number;
  unchanged_pct: number;
};

export type ContentAttributionSummary = {
  files: FileAttribution[];
  overall_manual_pct: number;
  overall_ai_patch_pct: number;
  overall_pasted_pct: number;
  overall_unchanged_pct: number;
};

export type PanelTransition = { from: string; to: string; count: number };

export type FocusPatternSummary = {
  panel_time: Record<string, number>;
  ticket_rereads: number;
  longest_editor_stretch_seconds: number;
  window_blur_count: number;
  window_blur_total_seconds: number;
  most_edited_file: string;
  file_visit_order: string[];
  transitions: PanelTransition[];
};

export type PhaseLabel = "exploration" | "planning" | "execution" | "verification";

export type SessionPhase = {
  phase: PhaseLabel;
  start_at: string;
  end_at: string;
  duration_seconds: number;
  confidence: number;
  signals: string[];
};

export type PhaseSummary = {
  phases: SessionPhase[];
  time_in_exploration: number;
  time_in_planning: number;
  time_in_execution: number;
  time_in_verification: number;
  phase_sequence: string;
  has_verification_phase: boolean;
  exploration_before_execution: boolean;
};

export type BehaviourAnalytics = {
  per_ticket: TicketTimeSummary[];
  idle: IdleSummary;
  keystrokes: KeystrokePatternSummary;
  content_attribution: ContentAttributionSummary;
  focus: FocusPatternSummary;
  phases: PhaseSummary;
};

export type ReportData = {
  available: boolean;
  header: CandidateHeader;
  cq: CQOverview | null;
  metrics: MetricScore[];
  bug_exposure: BugExposure;
  ai: AIInteraction;
  behaviour: BehaviourPattern;
  behaviour_analytics: BehaviourAnalytics;
  integrity: IntegritySignals;
  strategy: StrategyAnswer[];
  code_review: CodeReview | null;
  activity_forensics: ActivityForensics;
  buddy_audit: BuddyAudit;
  feedback_log: FeedbackEntry[];
  playback_url: string;
  heatmap: Heatmap;
};

export type ReportPreviewSnapshot = {
  fixed_bugs: number;
  total_bugs: number;
  ai_prompt_count: number;
  files_touched: number;
  terminal_commands: number;
  highlights: string[];
};

export type ReportPreviewData = {
  available: boolean;
  header: CandidateHeader;
  cq: CQOverview | null;
  metrics: MetricScore[];
  snapshot: ReportPreviewSnapshot;
  lock_reason: string;
  unlock_label: string;
};

export type ReportEvidence = {
  label: string;
  detail: string;
};

export type ReportAnalysis = {
  session_id: string;
  summary: string;
  recommendation: "strong_yes" | "lean_yes" | "mixed" | "lean_no";
  confidence: number;
  highlights: string[];
  risks: string[];
  interview_focus: string[];
  evidence: ReportEvidence[];
  generated_at: string;
};
