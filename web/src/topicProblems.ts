import type { DraftTopic, TopicLimits } from "./contract";

export function topicProblems(topics: DraftTopic[], limits: TopicLimits): string[] {
  const problems: string[] = [];
  if (topics.length < limits.min || topics.length > limits.max) problems.push(`ต้องมี ${limits.min}–${limits.max} หัวข้อ`);
  if (topics.some((topic) => !topic.title.trim())) problems.push("ชื่อหัวข้อต้องไม่ว่าง");
  const keys = topics.map((topic) => topic.title.replace(/\s+/g, "").toLowerCase()).filter(Boolean);
  if (new Set(keys).size !== keys.length) problems.push("มีชื่อหัวข้อซ้ำกัน");
  return problems;
}
