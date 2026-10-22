// 从房间数据派生展示信息：余额、结算建议、算式、值日积分、物品预测、今日待办。
import { balances, settlePlan } from '../core/ledger.js';
import { purchasesOf, predictRunOut, nextBuyer, ITEM_CATEGORIES, ITEM_STATUS } from '../core/items.js';
import { cycleStats, fairShares } from '../core/chores.js';
import { latestCycle, cycleOn, tasksOf } from '../core/cycles.js';
import { currentClauses, clauseText, activeVersion, draftVersion, currentParams } from '../core/pact.js';
import { localDate, fmtYuan, fmtMoney, fmtShort, fmtDate, addDays, daysIncl } from '../core/dates.js';
import { SPLIT_METHODS } from '../core/split.js';
import { nameOf as nameById, orderFn } from '../core/util.js';
import { CATEGORIES } from '../core/actions.js';

export { CATEGORIES, ITEM_CATEGORIES, ITEM_STATUS, SPLIT_METHODS };

export const todayOf = (serverNow) => localDate(serverNow || new Date().toISOString());

export function byId(room) {
  return new Map(room.members.map((m) => [m.id, m]));
}

export const activeMembers = (room) => room.members.filter((m) => m.status === 'active').sort((a, b) => a.order - b.order);

export function nameOf(room, id) {
  return nameById(room, id);
}

export function memberColor(room, id) {
  return byId(room).get(id)?.color || '#c8ccd0';
}

export const netMap = (room) => Object.fromEntries(Object.entries(balances(room)).map(([id, r]) => [id, r.net]));

export function settleSuggestions(room) {
  return settlePlan(netMap(room), orderFn(room));
}

export function pendingTransfers(room, me) {
  return room.transfers.filter((t) => t.status === 'pending' && (t.from === me || t.to === me));
}

// ---------- 算式 ----------

function rawYuan(totalCents, w, W) {
  const v = (w * totalCents) / W / 100;
  return `${fmtYuan(Math.round(v * 10000))}`.replace(/(\.\d*?[0-9])0+$/, '$1');
}

export function shareFormula(room, bill, memberId) {
  const s = bill.shares.find((x) => x.memberId === memberId);
  if (!s) return '';
  const total = fmtYuan(bill.amount);
  const name = nameOf(room, memberId);
  if (bill.method === 'fixed') return `${name}：记的人选了固定金额 ${fmtYuan(s.amount)} 元。`;
  const lines = [];
  if (s.explain?.kind === 'personDays' && s.explain.pd) {
    const p = s.explain.pd;
    const expr = [`在住 ${p.present} 天`];
    if (p.deduct) expr.push(`− 离家扣 ${p.deduct} 天（满 ${p.awayMin} 天才扣）`);
    if (p.extra) expr.push(`+ 访客超免费 ${p.extra} 晚`);
    const pd = expr.join(' ');
    lines.push(`${name}：${pd} = ${p.pd} 人天`);
    lines.push(`${total} × ${p.pd} ÷ ${s.explain.W} = ${s.explain.raw}`);
  } else if (bill.method === 'weight') {
    lines.push(`${name}：${total} × ${s.explain.w} ÷ ${s.explain.W} = ${s.explain.raw}`);
  } else {
    const each = (bill.amount / s.explain.W) / 100;
    lines.push(`${name}：${total} ÷ ${s.explain.W} 人 = ${(Math.floor(bill.amount / s.explain.W) / 100).toFixed(2).replace(/\.?0+$/, '')}${!Number.isInteger(each) ? '…' : ''}`);
  }
  if (s.explain?.extra) lines.push(`小数部分偏大的先拿 1 分尾差（平局付款人优先）→ ${fmtYuan(s.amount)}`);
  else lines.push(`→ ${fmtYuan(s.amount)}`);
  if (bill.pactVersion) lines.push(`依据：公约第 1、2、3 条（第 ${bill.pactVersion} 版）`);
  return lines.join('\n');
}

export function balanceFormula(room, memberId) {
  const b = balances(room)[memberId];
  return [`我付出 ${fmtMoney(b.paid)}`, `− 我应摊 ${fmtMoney(b.owed)}`, `+ 已确认转出 ${fmtMoney(b.sent)}`, `− 已确认收到 ${fmtMoney(b.recv)}`, `= ${b.net > 0 ? '应收 ' : b.net < 0 ? '应付 ' : ''}${fmtMoney(Math.abs(b.net))}`].join('\n');
}

// ---------- 值日 ----------

export function currentCycle(room, today) {
  return cycleOn(room, today) || latestCycle(room);
}

export function cycleMembers(room, cycle) {
  if (!cycle) return [];
  return cycle.participants.map((id) => room.members.find((m) => m.id === id)).filter(Boolean).sort((a, b) => a.order - b.order);
}

export function memberChore(room, cycle, memberId) {
  if (!cycle) return null;
  const tasks = tasksOf(room, cycle.id);
  const st = cycleStats(cycle, tasks)[memberId] || { assigned: 0, done: 0, proxyFor: 0, missed: 0, pending: 0 };
  const fair = fairShares(cycle, tasks).shares[memberId] || 0;
  const startVal = cycle.startVals?.[memberId] || 0;
  return {
    assigned: st.assigned,
    done: st.done,
    pending: st.pending,
    missed: st.missed,
    proxyFor: st.proxyFor,
    fair: Math.round(fair * 100) / 100,
    w: cycle.weights[memberId]?.w || 0,
    startVal,
  };
}

export function choreFairFormula(room, cycle, memberId) {
  const c = memberChore(room, cycle, memberId);
  const fair = fairShares(cycle, tasksOf(room, cycle.id));
  const lines = [`在住权重 = ${c.w} 天（${cycle.params.awayMinDays} 天以下的短离家不扣份额）`, `应得 = 总分 ${fair.total} × ${c.w} ÷ ${fair.W} = ${c.fair} 分`];
  if (c.startVal) lines.push(`上期结转起始值 ${c.startVal > 0 ? '+' : ''}${c.startVal} 分，本周期分配 ${c.assigned} 分`);
  return lines.join('\n');
}

export function weekTasks(room, cycle, weekStart) {
  const out = {};
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    out[d] = tasksOf(room, cycle?.id).filter((t) => t.date === d);
  }
  return out;
}

// ---------- 物品 ----------

export function itemInfo(room, item, today) {
  const purchases = purchasesOf(room, item);
  const prediction = predictRunOut(purchases);
  const buyer = nextBuyer(room, item, today);
  const noticeDays = currentParams(room).restockNoticeDays;
  let due = null;
  if (prediction) due = addDays(prediction.date, -noticeDays);
  return { purchases, prediction, buyer, due, noticeDays };
}

export function itemFormula(info) {
  if (!info.prediction) return '至少登记 2 次采购后，才能按采购间隔预测用完时间。';
  const { intervals, avg, rounded, last, date } = info.prediction;
  return [`最近 ${intervals.length} 次间隔：${intervals.join('、')} 天`, `平均 ${avg} 天，0.5 进 1 → ${rounded} 天`, `${fmtShort(last)} + ${rounded} 天 = 预计 ${fmtShort(date)} 用完`, `提前 ${info.noticeDays} 天 → ${fmtShort(info.due)} 提醒下一位采购人`].join('\n');
}

// ---------- 公约 ----------

export const clauses = (room) => currentClauses(room);
export const clauseByNo = (room, no) => clauses(room).find((c) => c.no === Number(no));
export const clauseDisplay = (c) => clauseText(c);

export function pactStatus(room) {
  const active = activeVersion(room);
  const draft = draftVersion(room);
  return {
    active,
    draft: active ? null : draft,
    unsigned: draft ? room.members.filter((m) => m.status === 'active' && !draft.signatures[m.id]) : [],
  };
}

export function voteCount(p) {
  const yes = Object.values(p.votes).filter((v) => v === 'yes').length;
  const no = Object.values(p.votes).filter((v) => v === 'no').length;
  return { yes, no, pending: (p.eligible?.length || 0) - yes - no };
}

export function openProposal(room) {
  return room.pact.proposals.find((p) => p.status === 'open') || null;
}

// ---------- 本月公共支出 ----------

export function monthSpend(room, month) {
  return room.bills.filter((b) => b.status === 'normal' && b.createdAt.slice(0, 7) === month).reduce((s, b) => s + b.amount, 0);
}

// ---------- 我的今天 ----------

export function myTodos(room, me, today) {
  const out = [];
  const cycle = currentCycle(room, today);
  if (cycle) {
    for (const t of tasksOf(room, cycle.id)) {
      if (t.assigneeId === me && (t.status === 'pending' || t.status === 'overdue') && t.date <= today) {
        out.push({ kind: 'chore', key: 'chore:' + t.id, date: t.date, overdue: t.status === 'overdue', text: `${t.overdue ? '补做' : '今天轮到你'}：${t.name}`, task: t });
      }
    }
  }
  for (const b of room.bills) {
    if (b.participants.includes(me) && b.createdBy !== me && b.status === 'normal' && daysIncl(b.createdAt.slice(0, 10), today) <= 3) {
      out.push({ kind: 'bill', key: 'bill:' + b.id, text: `${nameOf(room, b.payerId)}记了「${b.title}」，你应摊 ${fmtMoney(b.shares.find((s) => s.memberId === me)?.amount || 0)}`, bill: b });
    }
    if (b.status === 'disputed' && b.createdBy === me) {
      out.push({ kind: 'dispute', key: 'dispute:' + b.id, text: `「${b.title}」被提出异议：${b.dispute.reason}`, bill: b });
    }
  }
  for (const item of room.items) {
    if (item.deleted || item.status === 'ok') continue;
    const info = itemInfo(room, item, today);
    if (info.buyer?.id === me) out.push({ kind: 'item', key: 'item:' + item.id, text: `「${item.name}」${item.status === 'out' ? '已用完' : '快用完'}，轮到你补货`, item });
  }
  const p = openProposal(room);
  if (p && p.eligible.includes(me) && !(me in p.votes)) out.push({ kind: 'vote', key: 'pact:' + p.id, text: `待表决：${p.summary}`, proposal: p });
  for (const r of room.requests) {
    if (r.status === 'open' && r.eligible.includes(me) && !(me in r.votes)) out.push({ kind: 'request', key: 'req:' + r.id, text: `${nameOf(room, r.by)}申请买「${r.itemName}」，预计 ${fmtMoney(r.amount)}`, request: r });
  }
  for (const t of room.transfers) {
    if (t.status === 'pending' && t.to === me) out.push({ kind: 'transfer', key: 'pay:' + t.id, text: `${nameOf(room, t.from)}说已转给你 ${fmtMoney(t.amount)}，待确认`, transfer: t });
  }
  for (const s of room.swaps) {
    if (s.status === 'pending' && s.to === me) {
      const mine = room.tasks.find((t) => t.id === s.myTaskId);
      const theirs = room.tasks.find((t) => t.id === s.theirTaskId);
      if (mine && theirs) out.push({ kind: 'swap', key: 'swap:' + s.id, text: `${nameOf(room, s.from)}想用「${mine.name}」换你的「${theirs.name}」`, swap: s });
    }
  }
  const order = { chore: 0, bill: 1, dispute: 1, item: 2, vote: 3, request: 3, transfer: 4, swap: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.date || '').localeCompare(b.date || ''));
}

export function fmtDateCN(s, today) {
  return fmtDate(s, today);
}
