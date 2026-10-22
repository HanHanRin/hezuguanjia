// 值日周期：生成、结转、改派（把纯函数接到房间数据上）。
import { addDays, fmtShort, localDate } from './dates.js';
import { planCycle, reassignAbsence, carryOf } from './chores.js';
import { paramsOn, versionOn, clauseNoOf } from './pact.js';
import { nid, orderFn, nameOf } from './util.js';
import { notify } from './notify.js';

export const CYCLE_DAYS = 28;

export function cycleOn(room, date) {
  return room.cycles.find((c) => c.start <= date && date <= c.end) || null;
}

export function latestCycle(room) {
  return room.cycles.length ? room.cycles[room.cycles.length - 1] : null;
}

export function tasksOf(room, cycleId) {
  return room.tasks.filter((t) => t.cycleId === cycleId);
}

/** 本周期使用的家务模板：应用到期的修改、去掉已停用的 */
export function templatesFor(room, start) {
  for (const t of room.templates) {
    if (t.next && t.next.from <= start) {
      Object.assign(t, t.next.fields);
      if (t.next.fields.freq) t.anchor = start;
      t.next = null;
      t.version += 1;
    }
    if (t.retireFrom && t.retireFrom <= start) t.deleted = true;
  }
  const list = room.templates
    .filter((t) => !t.deleted && (!t.effectiveFrom || t.effectiveFrom <= start))
    .sort((a, b) => a.order - b.order);
  for (const t of list) if (!t.anchor) t.anchor = start;
  return list;
}

/** 当前还在排的周期（没结束、没关闭） */
export function openCycle(room, today) {
  const c = latestCycle(room);
  return c && !c.closed && c.end >= today ? c : null;
}

export function generateCycle(room, { start, planFrom = start, startVals = {}, now }) {
  const end = addDays(start, CYCLE_DAYS - 1);
  const params = paramsOn(room, start);
  const templates = templatesFor(room, start);
  if (!templates.length) return null;
  const participants = room.members
    .filter((m) => m.status === 'active' && m.moveIn <= end && (!m.moveOut || m.moveOut >= planFrom))
    .sort((a, b) => a.order - b.order);
  if (!participants.length) return null;
  const sv = {};
  for (const m of participants) sv[m.id] = startVals?.[m.id] || 0;
  const res = planCycle({
    start,
    end,
    planFrom,
    participants,
    aways: room.aways,
    templates,
    startVals: sv,
    awayMin: params.awayMinDays,
    orderOf: orderFn(room),
  });
  const cycle = {
    id: nid(room, 'c'),
    start,
    end,
    days: CYCLE_DAYS,
    planFrom,
    participants: participants.map((m) => m.id),
    startVals: sv,
    weights: res.weights,
    params: { awayMinDays: params.awayMinDays, choreCarry: params.choreCarry },
    pactVersion: versionOn(room, start)?.v ?? null,
    closed: false,
    carry: null,
    createdAt: now,
  };
  room.cycles.push(cycle);
  for (const t of res.tasks) {
    room.tasks.push({
      id: nid(room, 't'),
      cycleId: cycle.id,
      date: t.date,
      templateId: t.templateId,
      name: t.name,
      points: t.points,
      assigneeId: t.assigneeId,
      status: 'pending',
      doneBy: null,
      doneAt: null,
      late: false,
      photo: null,
    });
  }
  return cycle;
}

export function closeCycle(room, cycle) {
  cycle.carry = carryOf(cycle, tasksOf(room, cycle.id), cycle.params.choreCarry);
  cycle.closed = true;
}

/** 周期结束后自动结转并生成下一周期；长时间没人打开时，从今天所在周的周一重新开始 */
export function rollCycles(room, today, now) {
  let cur = latestCycle(room);
  let changed = false;
  let guard = 0;
  while (cur && cur.end < today && guard++ < 60) {
    if (!cur.closed) closeCycle(room, cur);
    changed = true;
    let start = addDays(cur.end, 1);
    let planFrom = start;
    if (addDays(start, CYCLE_DAYS - 1) < today) {
      start = mondayStart(today);
    }
    if (planFrom < today) planFrom = today > start ? today : start;
    if (planFrom < start) planFrom = start;
    const next = generateCycle(room, { start, planFrom, startVals: cur.carry, now });
    if (!next) break;
    for (const id of next.participants) {
      const mine = room.tasks.filter((t) => t.cycleId === next.id && t.assigneeId === id);
      const pts = mine.reduce((s, t) => s + t.points, 0);
      const sv = next.startVals[id] || 0;
      notify(room, {
        to: id,
        type: 'cycle_new',
        ref: next.id,
        key: next.id,
        once: true,
        now,
        text: `新的值日周期（${fmtShort(next.start, today)}–${fmtShort(next.end, today)}）已排好，你有 ${mine.length} 项、共 ${pts} 分。${
          sv ? `上期结转 ${sv > 0 ? '+' : ''}${sv} 分已计入。` : ''
        }`,
        reason: `按公约第 ${clauseNoOf('choreCarry')} 条处理结转`,
      });
    }
    cur = next;
  }
  return changed;
}

function mondayStart(today) {
  // 避免循环依赖，这里内联 mondayOf
  const d = new Date(today + 'T00:00:00Z').getUTCDay();
  const offset = d === 0 ? -6 : 1 - d;
  return addDays(today, offset);
}

/**
 * 某位成员从 fromDate 起不在（离家或退租）：改派 TA 还没做的任务，并通知接手的人。
 */
export function reassignFor(room, memberId, fromDate, now, why) {
  const cyc = latestCycle(room);
  if (!cyc || cyc.closed || !cyc.participants.includes(memberId)) return [];
  const tasks = tasksOf(room, cyc.id);
  const tplOrder = (id) => room.templates.find((t) => t.id === id)?.order ?? 0;
  const moved = reassignAbsence({
    cycle: cyc,
    tasks,
    members: room.members,
    aways: room.aways,
    memberId,
    fromDate,
    awayMin: cyc.params.awayMinDays,
    orderOf: orderFn(room),
    templateOrder: tplOrder,
  });
  const today = localDate(now);
  const byTo = new Map();
  for (const mv of moved) {
    if (!byTo.has(mv.to)) byTo.set(mv.to, []);
    byTo.get(mv.to).push(mv.task);
  }
  for (const [to, list] of byTo) {
    const desc = list.map((t) => `${fmtShort(t.date, today)}「${t.name}」`).join('、');
    notify(room, {
      to,
      type: 'chore_reassigned',
      ref: list[0].id,
      key: `${memberId}|${fromDate}|${list.map((t) => t.id).join(',')}`,
      once: true,
      now,
      text: `${nameOf(room, memberId)}${why}，${desc}改由你负责。`,
      reason: '按排班规则，改派给当天在家、积分占比最低的人',
    });
  }
  return moved;
}
