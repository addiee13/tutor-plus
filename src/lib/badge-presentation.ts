import type { FactualTutorBadge } from "@/domains/marketplace/types";
const names = {
  completed_sessions: "completed platform sessions",
  visible_reviews: "visible eligible reviews",
  rating_average: "visible review average out of 5",
  recommendations: "visible learner recommendations",
};
export function describeTutorBadge(badge: FactualTutorBadge): string {
  return `${badge.value} ${names[badge.fact]}; minimum ${badge.threshold}. Badge policy version ${badge.policyVersion}.`;
}
