// 每日任务（幂等）：逾期标记、周期结转、值日提醒、补货提醒、结算提醒、表决到期。
import { localDate, localISO, addDays, diffDays, fmtShort, fmtMoney } from './dates.js';
import { rollCycles } from './cycles.js';
import { notify } from './notify.js';
import { predictRunOut, purchasesOf, nextBuyer } from './items.js';
import { netMap, settlePlan } from './ledger.js';
import { currentParams, clauseNoOf, PARAM_TITLE } from './pact.js';
import { orderFn, nameOf } from './util.js';

export function runDaily(room, now) {
  const today = localDate(now);
  let changed = false;
  if (expireVotes(room, now)) changed = true;
  if (markOverdue(room, today, now)) changed = true;
  if (rollCycles(room, today, now)) changed = true;
  if (room.meta.lastDaily !== today) {
    choreReminders(room, today, now);
    itemReminders(room, today, now);
    settleReminders(room, today, now);
    cleanup(room, now);
    room.meta.lastDaily = today;
    changed = true;
  }
  return changed;
}

/** 当天 23:59 还没完成就标为已逾期，次日 9:00 提醒负责人一次 */
export function markOverdue(room, today, now) {
  let changed = false;
  const yesterday = addDays(today, -1);
  for (const t of room.tasks) {
    if (t.status !== 'pending' || t.date >= today) continue;
    t.status = 'overdue';
    changed = true;
    if (t.date !== yesterday) continue;
    notify(room, {
      to: t.assigneeId,
      type: 'chore_overdue',
      ref: t.id,
      key: t.id,
      once: true,
      at: localISO(addDays(t.date, 1), 9, 0),
      now,
      text: `${fmtShort(t.date, today)}的「${t.name}」还没完成。可以今天补做，也可以请室友代做。`,
      reason: `按公约第 ${clauseNoOf('choreCarry')} 条，代做的积分记给实际完成人`,
      actions: [
        { type: 'task.complete', label: '补做', id: t.id },
        { type: 'task.askHelp', label: '找人代做', id: t.id },
      ],
    });
  }
  return changed;
}

function choreReminders(room, today, now) {
  const byMember = new Map();
  for (const t of room.tasks) {
    if (t.date !== today || t.status !== 'pending') continue;
    if (!byMember.has(t.assigneeId)) byMember.set(t.assigneeId, []);
    byMember.get(t.assigneeId).push(t);
  }
  for (const [id, list] of byMember) {
    notify(room, {
      to: id,
      type: 'chore_today',
      ref: `chores|${today}|${id}`,
      key: `chores|${today}`,
      at: localISO(today, 9, 0),
      now,
      text: `今天轮到你：${list.map((t) => `「${t.name}」`).join('、')}。做完点一下“完成”就好，不方便可以找人代做。`,
      reason: '按本周期排班',
    });
  }
}

function itemReminders(room, today, now) {
  const D = currentParams(room).restockNoticeDays;
  for (const item of room.items) {
    if (item.deleted || item.status !== 'ok') continue;
    const p = predictRunOut(purchasesOf(room, item.id));
    if (!p) continue;
    if (today < addDays(p.date, -D)) continue;
    const nb = nextBuyer(room, item, today);
    if (!nb) continue;
    notify(room, {
      to: nb.id,
      type: 'item_predict',
      ref: item.id,
      key: `${item.id}|${p.date}`,
      once: true,
      at: localISO(today, 9, 0) > now ? localISO(today, 9, 0) : now,
      now,
      text: `「${item.name}」预计${fmtShort(p.date, today)}用完，轮到你补货。买完在物品页点“登记采购”，会自动记一笔账。`,
      reason: `按公约第 ${clauseNoOf('restockNoticeDays')} 条：预计用完前 ${D} 天提醒下一位采购人`,
    });
  }
}

/** 结算建议每月 1 日提醒（当月第一次运行时补发），之后同一笔按公约第 8 条间隔再提醒 */
function settleReminders(room, today, now) {
  const params = currentParams(room);
  const plan = settlePlan(netMap(room), orderFn(room));
  const month = today.slice(0, 7);
  const last = room.meta.settleLast || {};
  const keys = new Set();
  const firstOfMonth = room.meta.settleMonth !== month;
  for (const tx of plan) {
    const key = `${tx.from}|${tx.to}|${tx.amount}`;
    keys.add(key);
    const due = firstOfMonth || (last[key] && diffDays(last[key], today) >= params.settleRemindDays);
    if (!due) continue;
    const n = notify(room, {
      to: tx.from,
      type: 'settle',
      ref: key,
      key,
      at: localISO(today, 9, 0) > now ? localISO(today, 9, 0) : now,
      now,
      text: `结算建议：你转给${nameOf(room, tx.to)} ${fmtMoney(tx.amount)}。转完点“我已转账”，对方确认后余额更新。`,
      reason: `按公约第 ${clauseNoOf('settleRemindDays')} 条：同一笔至少间隔 ${params.settleRemindDays} 天才再次提醒`,
      actions: [{ type: 'transfer.create', label: '我已转账', to: tx.to, amount: tx.amount }],
    });
    if (n) last[key] = today;
  }
  for (const k of Object.keys(last)) if (!keys.has(k)) delete last[k];
  room.meta.settleLast = last;
  room.meta.settleMonth = month;
}

/** 到期的表决：公约修订到期未通过即不通过；采购申请到期同意人数不够即过期 */
export function expireVotes(room, now) {
  let changed = false;
  for (const p of room.pact.proposals) {
    if (p.status !== 'open' || p.deadline > now) continue;
    p.status = 'failed';
    p.closedAt = now;
    changed = true;
    const yes = Object.values(p.votes).filter((v) => v === 'yes').length;
    for (const m of room.members) {
      if (m.status !== 'active') continue;
      notify(room, {
        to: m.id,
        type: 'proposal_result',
        ref: p.id,
        key: `${p.id}|result`,
        once: true,
        now,
        text: `公约修订（${p.summary}）到期没有达到通过人数（${yes}/${p.threshold}），没有通过，公约保持不变。`,
        reason: '表决期 48 小时',
      });
    }
  }
  for (const r of room.requests) {
    if (r.status !== 'open' || r.deadline > now) continue;
    r.status = 'expired';
    r.closedAt = now;
    changed = true;
    notify(room, {
      to: r.by,
      type: 'request_result',
      ref: r.id,
      key: `${r.id}|result`,
      once: true,
      now,
      text: `采购申请「${r.itemName}」48 小时内同意人数不够，已过期。还需要的话可以重新发起。`,
      reason: `按公约第 ${clauseNoOf('purchaseApprovalCents')} 条`,
    });
  }
  return changed;
}

function cleanup(room, now) {
  const cutoff = new Date(new Date(now).getTime() - 60 * 86400000).toISOString();
  room.notifications = room.notifications.filter((n) => n.sendAt >= cutoff || !n.read);
  if (room.notifications.length > 400) room.notifications.splice(0, room.notifications.length - 400);
  // 只保留最近 12 个周期的任务明细
  if (room.cycles.length > 12) {
    const keep = new Set(room.cycles.slice(-12).map((c) => c.id));
    room.tasks = room.tasks.filter((t) => keep.has(t.cycleId));
  }
}

export { PARAM_TITLE };
