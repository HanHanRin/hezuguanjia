// 值日排班：积分均衡分配、离家改派、结转。
import { addDays, dayNum, weekday, overlapDays, daysIncl } from './dates.js';
import { FAR } from './split.js';
import { inResidence } from './util.js';

export const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function freqText(f) {
  if (f.type === 'daily') return '每天';
  if (f.type === 'everyN') return `每 ${f.n} 天`;
  if (f.type === 'weekly') return '每' + f.days.map((d) => WEEKDAY_NAMES[d]).join('、');
  return '';
}

/** 某天这项家务是否要做 */
export function isDue(tpl, date) {
  const f = tpl.freq;
  if (f.type === 'daily') return true;
  if (f.type === 'everyN') {
    const k = dayNum(date) - dayNum(tpl.anchor);
    return ((k % f.n) + f.n) % f.n === 0;
  }
  if (f.type === 'weekly') return f.days.includes(weekday(date));
  return false;
}

export function isAwayOn(aways, memberId, date) {
  return aways.some((a) => a.memberId === memberId && a.start <= date && date <= a.end);
}

/** 当天在住且不在离家期间 */
export function availableOn(m, date, aways) {
  return inResidence(m, date) && !isAwayOn(aways, m.id, date);
}

/**
 * 在住权重 w = 周期内在住天数 − 属于“满 N 天离家”的天数
 * 返回 { [memberId]: { w, present, longAway } }
 */
export function choreWeights({ start, end, members, aways, awayMin }) {
  const out = {};
  for (const m of members) {
    const mo = m.moveOut || FAR;
    const present = overlapDays(start, end, m.moveIn, mo);
    const long = new Set();
    for (const a of aways) {
      if (a.memberId !== m.id || daysIncl(a.start, a.end) < awayMin) continue;
      let s = a.start;
      if (s < start) s = start;
      if (s < m.moveIn) s = m.moveIn;
      let e = a.end;
      if (e > end) e = end;
      if (e > mo) e = mo;
      for (let d = s; d <= e; d = addDays(d, 1)) long.add(d);
    }
    out[m.id] = { w: Math.max(0, present - long.size), present, longAway: long.size };
  }
  return out;
}

function better(a, b, sv, asg, w, same, tplId, orderOf) {
  // (sv + asg) ÷ w 更小的优先：交叉相乘比较，避免浮点
  const la = (sv[a] + asg[a]) * w[b];
  const lb = (sv[b] + asg[b]) * w[a];
  if (la !== lb) return la < lb;
  const sa = same.get(`${a}|${tplId}`) || 0;
  const sb = same.get(`${b}|${tplId}`) || 0;
  if (sa !== sb) return sa < sb;
  return orderOf(a) < orderOf(b);
}

function pick(cands, sv, asg, w, same, tplId, orderOf) {
  let best = cands[0];
  for (let i = 1; i < cands.length; i++) if (better(cands[i], best, sv, asg, w, same, tplId, orderOf)) best = cands[i];
  return best;
}

/** 某天要做的家务，积分高的在前，积分相同按模板顺序 */
export function dueOn(templates, date) {
  return templates.filter((t) => isDue(t, date)).sort((a, b) => b.points - a.points || a.order - b.order);
}

/**
 * 生成一个周期的排班。
 * participants: 成员对象（含 id、moveIn、moveOut、status）
 * 返回 { tasks: [{date, templateId, name, points, assigneeId}], weights, assigned }
 */
export function planCycle({ start, end, planFrom = start, participants, aways, templates, startVals = {}, awayMin, orderOf }) {
  const wInfo = choreWeights({ start: planFrom, end, members: participants, aways, awayMin });
  const w = {};
  const sv = {};
  const asg = {};
  for (const m of participants) {
    w[m.id] = wInfo[m.id].w;
    sv[m.id] = startVals[m.id] || 0;
    asg[m.id] = 0;
  }
  const same = new Map();
  const tasks = [];
  for (let d = planFrom; d <= end; d = addDays(d, 1)) {
    for (const t of dueOn(templates, d)) {
      const cands = participants.filter((m) => w[m.id] > 0 && availableOn(m, d, aways)).map((m) => m.id);
      if (!cands.length) continue; // 当天没人在家，这项不用做
      const id = pick(cands, sv, asg, w, same, t.id, orderOf);
      asg[id] += t.points;
      same.set(`${id}|${t.id}`, (same.get(`${id}|${t.id}`) || 0) + 1);
      tasks.push({ date: d, templateId: t.id, name: t.name, points: t.points, assigneeId: id });
    }
  }
  return { tasks, weights: wInfo, assigned: asg };
}

/**
 * 排班生成后再登记离家（或退租）：只改派该成员在不可用日期里、还没做的任务。
 * 按日期顺序（同一天先排积分高的）逐个分给当天可用、(起始值 + 本周期已分配的全部积分) ÷ 新的 w 最小的人。
 * 直接修改 tasks 里的 assigneeId，返回被改派的任务列表 [{ task, from, to }]。
 */
export function reassignAbsence({ cycle, tasks, members, aways, memberId, fromDate, awayMin, orderOf, templateOrder }) {
  const participants = members.filter((m) => cycle.participants.includes(m.id));
  const wInfo = choreWeights({ start: cycle.planFrom, end: cycle.end, members: participants, aways, awayMin });
  const w = {};
  const sv = {};
  const asg = {};
  for (const m of participants) {
    w[m.id] = wInfo[m.id].w;
    sv[m.id] = cycle.startVals[m.id] || 0;
    asg[m.id] = 0;
  }
  const same = new Map();
  for (const t of tasks) {
    if (t.assigneeId in asg) asg[t.assigneeId] += t.points;
    same.set(`${t.assigneeId}|${t.templateId}`, (same.get(`${t.assigneeId}|${t.templateId}`) || 0) + 1);
  }
  const me = participants.find((m) => m.id === memberId);
  const affected = tasks
    .filter((t) => t.assigneeId === memberId && t.status === 'pending' && t.date >= fromDate && !availableOn(me, t.date, aways))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.points - a.points || templateOrder(a.templateId) - templateOrder(b.templateId)));
  const moved = [];
  for (const t of affected) {
    asg[memberId] -= t.points;
    same.set(`${memberId}|${t.templateId}`, (same.get(`${memberId}|${t.templateId}`) || 0) - 1);
    const cands = participants.filter((m) => m.id !== memberId && w[m.id] > 0 && availableOn(m, t.date, aways)).map((m) => m.id);
    if (!cands.length) {
      // 当天没有其他人在家：保留原负责人，交给当事人自己处理
      asg[memberId] += t.points;
      same.set(`${memberId}|${t.templateId}`, (same.get(`${memberId}|${t.templateId}`) || 0) + 1);
      continue;
    }
    const to = pick(cands, sv, asg, w, same, t.templateId, orderOf);
    asg[to] += t.points;
    same.set(`${to}|${t.templateId}`, (same.get(`${to}|${t.templateId}`) || 0) + 1);
    t.assigneeId = to;
    moved.push({ task: t, from: memberId, to });
  }
  cycle.weights = wInfo;
  return moved;
}

/** 周期统计：每人被分配积分、实际完成积分、代做、漏做 */
export function cycleStats(cycle, tasks, today) {
  const s = {};
  for (const id of cycle.participants) s[id] = { assigned: 0, done: 0, proxyFor: 0, missed: 0, pending: 0 };
  for (const t of tasks) {
    if (s[t.assigneeId]) {
      s[t.assigneeId].assigned += t.points;
      if (t.status === 'done' && t.doneBy !== t.assigneeId) s[t.assigneeId].missed += t.points;
      if (t.status === 'overdue') s[t.assigneeId].missed += t.points;
      if (t.status === 'pending') s[t.assigneeId].pending += t.points;
    }
    if (t.status === 'done') {
      if (!s[t.doneBy]) s[t.doneBy] = { assigned: 0, done: 0, proxyFor: 0, missed: 0, pending: 0 };
      s[t.doneBy].done += t.points;
      if (t.doneBy !== t.assigneeId) s[t.doneBy].proxyFor += t.points;
    }
  }
  return s;
}

/** 结转值 = 本周期实际完成积分 − 本周期被分配积分（漏做为负，代做为正） */
export function carryOf(cycle, tasks, enabled) {
  const st = cycleStats(cycle, tasks);
  const out = {};
  for (const id of Object.keys(st)) out[id] = enabled ? st[id].done - st[id].assigned : 0;
  return out;
}

/** 按在住权重计算的公平份额（用于展示和验收） */
export function fairShares(cycle, tasks) {
  const total = tasks.reduce((s, t) => s + t.points, 0);
  const W = cycle.participants.reduce((s, id) => s + (cycle.weights[id]?.w || 0), 0);
  const out = {};
  for (const id of cycle.participants) out[id] = W ? (total * (cycle.weights[id]?.w || 0)) / W : 0;
  return { total, W, shares: out };
}
