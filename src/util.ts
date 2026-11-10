/** 小工具集（实现性文件） */

export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

export function dedupeStrings(xs: string[]): string[] {
  return [...new Set(xs.map((s) => s.trim()).filter(Boolean))];
}

export function unionStrings(a: string[], b: string[]): string[] {
  return dedupeStrings([...a, ...b]);
}

/** 归一化比较文本：去首尾、小写、压空白 */
export function normalizeText(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}
