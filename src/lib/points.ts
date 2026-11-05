// Quote points (#488, #491): the tradies' in-game currency. The office sets the levels in Settings → Rates;
// these are the launch defaults (Matt, 5 Nov): start with 3, +1 for every job quoted, 5 to claim a job.
export type PointLevels = { starter: number; quote: number; claim: number };
export const DEFAULT_POINT_LEVELS: PointLevels = { starter: 3, quote: 1, claim: 5 };
export const QUOTE_POINTS = DEFAULT_POINT_LEVELS.quote;
export const CLAIM_POINTS = DEFAULT_POINT_LEVELS.claim;
export const pointsLabel = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;
