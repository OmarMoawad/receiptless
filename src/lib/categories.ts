export const CATEGORIES = [
  "GROCERIES",
  "DINING",
  "TRANSPORT",
  "UTILITIES",
  "HEALTH",
  "SHOPPING",
  "ENTERTAINMENT",
  "TRAVEL",
  "EDUCATION",
  "OTHER",
] as const;

export type CategoryName = (typeof CATEGORIES)[number];
