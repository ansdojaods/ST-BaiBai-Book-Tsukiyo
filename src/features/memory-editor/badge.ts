/**
 * 【1.4.2】魔杖菜单「剧情剪辑台」条目的角标（待确认草稿数）。
 *
 * 为什么单独一个文件：菜单在 menu.ts 里注入、数量由 host.ts 在引擎变化时更新，
 * 两边直接互相 import 会成环；这里放一个极小的订阅点，谁都能用。
 */
let badgeCount = 0;
const listeners = new Set<(count: number) => void>();

/** 更新角标数量（0 = 不显示角标）。同值直接返回，不会反复触发订阅者。 */
export function setEditorBadge(next: number): void {
  const count = Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
  if (count === badgeCount) return;
  badgeCount = count;
  for (const listener of listeners) {
    try {
      listener(count);
    } catch {
      /* 单个订阅者异常不影响其它 */
    }
  }
}

export function getEditorBadge(): number {
  return badgeCount;
}

/** 订阅角标变化（菜单注入后注册；返回取消函数）。 */
export function onEditorBadge(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
