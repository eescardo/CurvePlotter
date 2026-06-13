export function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toFixed(1) : Number(value.toFixed(3)).toString();
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function niceStep(rawStep: number) {
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / power;

  if (normalized >= 5) return 5 * power;
  if (normalized >= 2) return 2 * power;
  return power;
}
