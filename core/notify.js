// 站内通知：只发当事人、同一事项同一天只生成 1 条、静默时段顺延。
import { localDate, localMinutes, localISO, addDays } from './dates.js';
import { nid } from './util.js';
import { currentParams } from './pact.js';

export function parseHM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function inQuiet(iso, quiet) {
  const qs = parseHM(quiet.start);
  const qe = parseHM(quiet.end);
  const min = localMinutes(iso);
  return qs > qe ? min >= qs || min < qe : min >= qs && min < qe;
}

/** 静默时段内产生的提醒，推迟到时段结束时发送 */
export function shiftQuiet(iso, quiet) {
  if (!inQuiet(iso, quiet)) return iso;
  const qs = parseHM(quiet.start);
  const qe = parseHM(quiet.end);
  const date = localDate(iso);
  const min = localMinutes(iso);
  const day = qs > qe && min >= qs ? addDays(date, 1) : date;
  return localISO(day, Math.floor(qe / 60), qe % 60);
}

/** 落在静默时段里的时刻，提前到静默开始前 1 分钟（用于截止前提醒，避免顺延到截止之后） */
export function lastBeforeQuiet(iso, quiet) {
  if (!inQuiet(iso, quiet)) return iso;
  const qs = parseHM(quiet.start);
  const qe = parseHM(quiet.end);
  const date = localDate(iso);
  const min = localMinutes(iso);
  const day = qs > qe && min < qe ? addDays(date, -1) : date;
  const t = qs - 1;
  return localISO(day, Math.floor(t / 60), t % 60);
}

/**
 * 生成一条通知。
 * key：事项去重键（同一收件人、同一事项、同一天只生成 1 条）；once=true 时不分日期，只生成一次。
 * at：计划时间（默认现在），落在静默时段会顺延。
 * 返回生成的通知；被去重时返回 null。
 */
export function notify(room, { to, from = 'system', type, ref = null, text, reason = '', key, at, once = false, actions = null, now }) {
  if (!to) return null;
  const member = room.members.find((m) => m.id === to);
  if (!member || member.status !== 'active') return null;
  const planned = at || now;
  const dedupe = once ? `${type}|${key ?? ref}|${to}` : `${type}|${key ?? ref}|${to}|${localDate(planned)}`;
  if (room.notifications.some((n) => n.dedupe === dedupe)) return null;
  const quiet = currentParams(room).quietHours;
  const n = {
    id: nid(room, 'n'),
    to,
    from,
    type,
    ref,
    text,
    reason,
    actions,
    dedupe,
    createdAt: now,
    sendAt: shiftQuiet(planned, quiet),
    read: false,
  };
  room.notifications.push(n);
  if (room.notifications.length > 400) room.notifications.splice(0, room.notifications.length - 400);
  return n;
}

/** 事项已经处理：撤回还没发出的提醒 */
export function retract(room, ref, now) {
  room.notifications = room.notifications.filter((n) => !(n.ref === ref && n.sendAt > now && n.from === 'system'));
}

export function visibleNotifs(room, memberId, now) {
  return room.notifications.filter((n) => n.to === memberId && n.sendAt <= now).sort((a, b) => (a.sendAt < b.sendAt ? 1 : -1));
}
