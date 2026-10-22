// 公共物品：下一位采购人、用完预测。
import { addDays, diffDays } from './dates.js';
import { residents } from './util.js';
import { isAwayOn } from './chores.js';

export const ITEM_CATEGORIES = { cleaning: '清洁', kitchen: '厨房', bath: '卫浴', paper: '纸品', other: '其他' };
export const ITEM_STATUS = { ok: '充足', low: '快用完', out: '已用完' };

export function purchasesOf(room, itemId) {
  return room.purchases.filter((p) => p.itemId === itemId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 下一位采购人：轮流时取在住且不在离家期间、这件物品采购次数最少的人，平局按加入顺序；指定时取指定成员。
 */
export function nextBuyer(room, item, date) {
  if (item.restock === 'fixed') {
    const m = room.members.find((x) => x.id === item.fixedMemberId && x.status === 'active');
    if (m) return { id: m.id, why: '指定由 TA 补货' };
  }
  const cands = residents(room, date).filter((m) => !isAwayOn(room.aways, m.id, date));
  if (!cands.length) return null;
  const counts = {};
  for (const m of cands) counts[m.id] = 0;
  for (const p of room.purchases) if (p.itemId === item.id && p.payerId in counts) counts[p.payerId] += 1;
  const best = [...cands].sort((a, b) => counts[a.id] - counts[b.id] || a.order - b.order)[0];
  return { id: best.id, count: counts[best.id], counts, why: '轮流补货：这件物品采购次数最少' };
}

/**
 * 用完预测：至少 2 次采购记录时，预计用完日期 = 最近一次采购日期 + 最近不超过 3 个采购间隔的平均天数（四舍五入，0.5 进 1）。
 */
export function predictRunOut(purchases) {
  const ds = purchases.map((p) => p.date).sort();
  if (ds.length < 2) return null;
  const all = [];
  for (let i = 1; i < ds.length; i++) all.push(diffDays(ds[i - 1], ds[i]));
  const iv = all.slice(-3);
  const sum = iv.reduce((s, x) => s + x, 0);
  const len = iv.length;
  const rounded = Math.floor((2 * sum + len) / (2 * len)); // floor(sum/len + 1/2)
  const last = ds[ds.length - 1];
  return { last, intervals: iv, sum, len, avg: sum / len, rounded, date: addDays(last, rounded) };
}
