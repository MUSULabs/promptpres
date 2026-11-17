// TypeScript mirror of contracts/result.schema.json (contract_version 1.3, Spec v2.3, D-046 + D-050: 8 criteria, thesis codes).
export type CriterionCode = "C1" | "C2" | "S1" | "S2" | "S3" | "N1" | "N2" | "T1";
export type Skill = "content" | "speech" | "body" | "time";
export type SessionStatus = "queued" | "processing" | "done" | "failed";

export interface Evidence { start_s: number; end_s: number; note: string | null; label?: string | null }

export interface Criterion {
  code: CriterionCode;
  skill: Skill;
  status: "ok" | "unanalyzable";
  level: 1 | 2 | 3 | 4 | null;
  values: Record<string, number | null>;
  evidence: Evidence[];
  feedback_id: string | null;
  reason: string | null;
}

export interface Topic {
  id: string; title: string; order: number;
  coverage: "clear" | "brief" | "not_mentioned";
  first_mention_s: number | null; evidence_quote: string | null;
}

export type CoachKind = "strength" | "focus" | "plan";
export interface CoachItem { kind: CoachKind; code: CriterionCode | null; text: string; cite_s: number[] }

/** Evidence-grounded AI coach (D-046): summarises the cards, never changes a level. */
export interface Coach {
  status: "ok" | "skipped" | "failed";
  items: CoachItem[];
  hidden_count: number;
}

export interface Result {
  contract_version: "1.3";
  session_id: string;
  status: SessionStatus;
  created_at: string;
  duration_s: number | null;
  target_duration_s: number | null;
  video_url: string | null;
  versions: Record<"rubric" | "asr" | "llm" | "prompt" | "config", string | null>;
  criteria: Criterion[];
  topics: Topic[];
  coach: Coach | null;
  error: string | null;
}

/** Plain-language reading of a card (config/feedback-*.yaml `interpret`, D-046). */
export interface Interpret {
  explain: string;
  levels: Record<string, string>;
  range?: { below: string; within: string; above: string };
  sign?: { key: string; above: string; below: string };
}

/** GET /api/criteria — keys that determine the level (any other key in values is supporting info),
 * band direction and bounds from the thresholds yaml, and the reading. The web never computes a level. */
export interface CriterionMeta {
  scored_values: string[];
  direction?: "higher" | "lower" | "range" | null;
  levels?: Record<string, Record<string, number | number[]>>;
  interpret?: Interpret | null;
}
export type CriteriaMeta = Partial<Record<CriterionCode, CriterionMeta>>;

// ---- API types for the practice-session flow (not part of the Result contract) ----
/** Session status in the database: "created" = waiting for topics / video (never appears in a Result). */
export type FlowStatus = "created" | SessionStatus;

/** GET /api/sessions row. */
export interface SessionRow {
  session_id: string; status: FlowStatus; created_at: string;
  duration_s: number | null; target_duration_s: number | null; topics_count: number;
  source: "mock" | "session";
  /** Finished sessions only (D-046 trend): level per criterion (null = unanalyzable). Never a total score. */
  levels: Partial<Record<CriterionCode, number | null>> | null;
  primary_values: Partial<Record<CriterionCode, Record<string, number | null>>> | null;
  rubric_version: string | null;
}

/** GET /api/sessions/{id}/transcript item (D-046): a timed phrase, a filler (S3) or not, a long pause (S2) after it. */
export interface TranscriptItem { start_s: number; end_s: number; text: string; is_filler: boolean; pause_after_s: number | null }

/** A topic as the user edits it; ids and order are assigned by the API on confirm. */
export interface DraftTopic { id?: string; title: string; key_point: string; order?: number; expected_order?: number }

/** GET /api/sessions/{id}. */
export interface TopicLimits { min: number; max: number }

export interface SessionInfo {
  topic_limits: TopicLimits;
  pdf_enabled: boolean;
  session_id: string; status: FlowStatus; target_duration_s: number; created_at: string;
  queued_at: string | null; started_at: string | null; finished_at: string | null;
  error_message: string | null; has_pdf: boolean; has_video: boolean;
  confirmed_topics: DraftTopic[] | null; suggested_topics: DraftTopic[] | null;
}

// Display metadata (labels/units only — no thresholds here; those live in config/).

export interface ResultMetadata { criteria: CriteriaMeta | null; feedback: Record<string, string> | null }
