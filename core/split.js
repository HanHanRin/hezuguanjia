// 费用分摊：最大余数法取整到分、在住人天。所有比例计算用整数（BigInt），避免浮点误差。
import { overlapDays, daysIncl, addDays } from './dates.js';

export const FAR = '9999-12-31';

export const SPLIT_METHODS = {
  equal: '均摊',
  weight: '按权重',
  fixed: '固定金额',
  personDays: '按在住人天',
};

/**
 * 最大余数法：每人 = 总额 × 权重 ÷ 权重合计，先向下取整到分，
 * 剩下的分逐个补给小数部分最大的人；小数部分相同时付款人优先，其次按加入顺序。
 * entries: [{ id, w }]，w 为非负整数。权重合计为 0 时返回 null。
 */
export function largestRemainder(total, entries, payerId, orderOf) {
  let W = 0n;
  for (const e of entries) W += BigInt(e.w);
  if (W === 0n) return null;
  const T = BigInt(total);
  const rows = entries.map((e) => {
    const num = T * BigInt(e.w);
    return {
      id: e.id,
      w: e.w,
      floor: Number(num / W),
      rem: num % W,
      extra: 0,
      raw4: (num * 100n) / W, // 元 × 10^4
      rawExact: (num * 100n) % W === 0n,
    };
  });
  const left = total - rows.reduce((s, r) => s + r.floor, 0);
  const rank = [...rows].sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    const pa = a.id === payerId ? 0 : 1;
    const pb = b.id === payerId ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return orderOf(a.id) - orderOf(b.id);
  });
  for (let i = 0; i < left; i++) rank[i].extra = 1;
  return rows.map((r) => ({
    id: r.id,
    w: r.w,
    W: Number(W),
    amount: r.floor + r.extra,
    extra: r.extra,
    raw: fmtRaw(r.raw4, r.rawExact),
  }));
}

/** 97.5757…：保留 4 位小数，除不尽时加省略号 */
function fmtRaw(raw4, exact) {
  const s = raw4.toString().padStart(5, '0');
  const int = s.slice(0, -4);
  const frac = s.slice(-4);
  let f = frac.replace(/0+$/, '');
  if (f.length < 2) f = frac.slice(0, 2);
  return `${int}.${f}${exact ? '' : '…'}`;
}

/**
 * 计费周期内每人的在住人天：
 * 人天 = max(0, 在住天数 − 离家扣除) + 访客加成
 */
export function personDays({ periodStart, periodEnd, members, aways, guests, awayMin, freeNights }) {
  const out = {};
  for (const m of members) {
    const mo = m.moveOut || FAR;
    const present = overlapDays(periodStart, periodEnd, m.moveIn, mo);
    let deduct = 0;
    const awayDetail = [];
    for (const a of aways) {
      if (a.memberId !== m.id) continue;
      const len = daysIncl(a.start, a.end);
      const s = a.start > m.moveIn ? a.start : m.moveIn;
      const e = a.end < mo ? a.end : mo;
      const inPeriod = overlapDays(periodStart, periodEnd, s, e);
      if (inPeriod <= 0) continue;
      const counted = len >= awayMin;
      if (counted) deduct += inPeriod;
      awayDetail.push({ start: a.start, end: a.end, len, inPeriod, counted });
    }
    let nights = 0;
    for (const g of guests) {
      if (g.memberId !== m.id) continue;
      for (let k = 0; k < g.nights; k++) {
        const d = addDays(g.date, k);
        if (d >= periodStart && d <= periodEnd) nights++;
      }
    }
    const extra = Math.max(0, nights - freeNights);
    out[m.id] = {
      present,
      deduct,
      awayDetail,
      nights,
      extra,
      awayMin,
      freeNights,
      pd: Math.max(0, present - deduct) + extra,
    };
  }
  return out;
}

/**
 * 按分摊方式计算每人应摊。
 * input: { amount, payerId, method, participants, weights, fixed, periodStart, periodEnd }
 * ctx:   { members, aways, guests, params: { awayMinDays, freeGuestNights }, orderOf }
 */
export function computeShares(input, ctx) {
  const { amount, payerId, method, participants } = input;
  if (method === 'fixed') {
    const sum = participants.reduce((s, id) => s + (input.fixed?.[id] ?? 0), 0);
    if (sum !== amount) return { error: 'fixed_mismatch', diff: amount - sum };
    return {
      note: null,
      shares: participants.map((id) => ({ memberId: id, amount: input.fixed[id], explain: { kind: 'fixed' } })),
    };
  }
  let entries;
  let note = null;
  let pdInfo = null;
  let kind = method;
  if (method === 'equal') {
    entries = participants.map((id) => ({ id, w: 1 }));
  } else if (method === 'weight') {
    entries = participants.map((id) => ({ id, w: input.weights?.[id] ?? 0 }));
  } else if (method === 'personDays') {
    pdInfo = personDays({
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      members: ctx.members.filter((m) => participants.includes(m.id)),
      aways: ctx.aways,
      guests: ctx.guests,
      awayMin: ctx.params.awayMinDays,
      freeNights: ctx.params.freeGuestNights,
    });
    entries = participants.map((id) => ({ id, w: pdInfo[id].pd }));
    if (entries.every((e) => e.w === 0)) {
      entries = participants.map((id) => ({ id, w: 1 }));
      note = '参与人的在住人天合计为 0，改为均摊。';
      kind = 'equal';
    }
  } else {
    return { error: 'bad_method' };
  }
  const rows = largestRemainder(amount, entries, payerId, ctx.orderOf);
  if (!rows) return { error: 'zero_weight' };
  return {
    note,
    shares: rows.map((r) => ({
      memberId: r.id,
      amount: r.amount,
      explain: { kind, w: r.w, W: r.W, raw: r.raw, extra: r.extra, pd: pdInfo && kind === 'personDays' ? pdInfo[r.id] : null },
    })),
  };
}
