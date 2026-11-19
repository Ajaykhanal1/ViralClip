/** Pure limit math shared by the enforcement gate and the usage dashboard. */

export function limitExceeded(used: number, increment: number, limit: number | null): boolean {
  return limit !== null && used + increment > limit;
}

export function usagePercentage(used: number, limit: number | null): number | null {
  return limit === null || limit === 0 ? null : Math.round((used / limit) * 100);
}
