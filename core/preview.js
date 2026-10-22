// 公约修订的影响预览：用新参数重算“上一个已结束的水电计费周期”和“当前值日周期”。
import { localDate, fmtShort } from './dates.js';
import { computeShares } from './split.js';
import { planCycle } from './chores.js';
import { activeVersion, applyChanges, paramsOf, paramsOn } from './pact.js';
import { latestCycle, templatesFor } from './cycles.js';
import { orderFn } from './util.js';

const MONEY_KEYS = ['utilitiesMethod', 'awayMinDays', 'freeGuestNights'];

export function lastEndedUtilityBill(room, today) {
  const list = room.bills
    .filter((b) => b.status === 'normal' && b.category === 'utilities' && b.periodEnd && b.periodEnd < today)
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  return list[0] || null;
}

export function proposalPreview(room, changes, now) {
  const today = localDate(now);
  const active = activeVersion(room);
  const { clauses, diff } = applyChanges(active.clauses, changes);
  const oldP = paramsOf(active.clauses);
  const newP = paramsOf(clauses);
  const keys = diff.filter((d) => d.key).map((d) => d.key);
  const out = { utilities: null, chores: null, notes: [], simulated: true };
  const orderOf = orderFn(room);

  if (keys.some((k) => MONEY_KEYS.includes(k))) {
    const bill = lastEndedUtilityBill(room, today);
    if (!bill) {
      out.notes.push('还没有已结束的水电计费周期，暂时没法模拟金额变化。');
    } else if (bill.method !== 'personDays' && !keys.includes('utilitiesMethod')) {
      out.notes.push('上一期水电不是按在住人天分摊的，离家和访客规则不影响它的金额。');
    } else {
      const basis = paramsOn(room, bill.periodStart);
      const awayMin = keys.includes('awayMinDays') ? newP.awayMinDays : basis.awayMinDays;
      const freeNights = keys.includes('freeGuestNights') ? newP.freeGuestNights : basis.freeGuestNights;
      const method = keys.includes('utilitiesMethod') ? newP.utilitiesMethod : bill.method;
      const res = computeShares(
        {
          amount: bill.amount,
          payerId: bill.payerId,
          method,
          participants: bill.participants,
          weights: bill.weights,
          fixed: bill.fixed,
          periodStart: bill.periodStart,
          periodEnd: bill.periodEnd,
        },
        { members: room.members, aways: room.aways, guests: room.guests, params: { awayMinDays: awayMin, freeGuestNights: freeNights }, orderOf },
      );
      if (res.error) {
        out.notes.push('上一期水电账单没法用新规则模拟。');
      } else {
        const rows = bill.shares.map((s) => {
          const n = res.shares.find((x) => x.memberId === s.memberId);
          const after = n ? n.amount : 0;
          return { memberId: s.memberId, before: s.amount, after, delta: after - s.amount };
        });
        out.utilities = {
          billId: bill.id,
          title: bill.title,
          period: `${fmtShort(bill.periodStart, today)}–${fmtShort(bill.periodEnd, today)}`,
          amount: bill.amount,
          rows,
          total: rows.reduce((s, r) => s + r.delta, 0),
        };
      }
    }
  }

  if (keys.includes('awayMinDays')) {
    const cyc = latestCycle(room);
    if (!cyc || cyc.closed || cyc.end < today) {
      out.notes.push('当前没有值日周期，暂时没法模拟积分变化。');
    } else {
      const participants = room.members.filter((m) => cyc.participants.includes(m.id));
      const templates = templatesFor(room, cyc.start);
      const sim = (awayMin) =>
        planCycle({
          start: cyc.start,
          end: cyc.end,
          planFrom: cyc.planFrom,
          participants,
          aways: room.aways,
          templates,
          startVals: cyc.startVals,
          awayMin,
          orderOf,
        }).assigned;
      const a = sim(oldP.awayMinDays);
      const b = sim(newP.awayMinDays);
      const rows = participants.map((m) => ({ memberId: m.id, before: a[m.id] || 0, after: b[m.id] || 0, delta: (b[m.id] || 0) - (a[m.id] || 0) }));
      out.chores = {
        cycleId: cyc.id,
        period: `${fmtShort(cyc.start, today)}–${fmtShort(cyc.end, today)}`,
        rows,
        unchanged: rows.every((r) => r.delta === 0),
      };
      if (out.chores.unchanged) out.notes.push('当前值日周期里没有受影响的离家记录，积分不变。');
    }
  }

  if (keys.includes('choreCarry')) out.notes.push('结转方式只影响下个周期的起始积分。');
  if (keys.some((k) => ['purchaseApprovalCents', 'restockNoticeDays', 'quietHours', 'settleRemindDays'].includes(k)))
    out.notes.push('这类条款只改变提醒和预审规则，不影响已有金额和积分。');
  if (diff.some((d) => !d.key)) out.notes.push('文字条款只作约定，不参与计算，通过后立即生效。');
  return out;
}
