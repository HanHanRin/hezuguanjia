// 值日、公共物品、采购预审、公约修订与表决、提醒；以及统一入口 applyAction。
import { localDate, addDays, addHours, fmtShort, fmtMoney, mondayOf } from './dates.js';
import { activeVersion, draftVersion, currentParams, newVersion, activate, applyChanges, pactThreshold, purchaseThreshold, clauseNoOf, diffText } from './pact.js';
import { notify, lastBeforeQuiet } from './notify.js';
import { generateCycle, latestCycle, openCycle } from './cycles.js';
import { nextBuyer } from './items.js';
import { availableOn } from './chores.js';
import { proposalPreview } from './preview.js';
import { fail, nid, memberOf, nameOf, residents } from './util.js';
import {
  H1,
  text,
  money,
  dateIn,
  activeMember,
  uniq,
  find,
  requireAdmin,
  checkVersion,
  log,
  notifyAll,
  createBill,
  notifyBill,
  sanitizeClauses,
  maybeActivateDraft,
} from './actions-money.js';

export * from './actions-money.js';

export const VOTE_HOURS = 48;

export const RECOMMENDED_CHORES = [
  { name: '卫生间深度清洁', area: '卫生间', freq: { type: 'weekly', days: [1] }, points: 3, standard: '马桶、洗手台、地面、镜子都清洁到位' },
  { name: '厨房台面与水槽', area: '厨房', freq: { type: 'everyN', n: 2 }, points: 2, standard: '台面无油污，水槽无残渣' },
  { name: '客厅拖地', area: '客厅', freq: { type: 'weekly', days: [1] }, points: 2, standard: '先扫后拖，角落也要顾到' },
  { name: '倒垃圾', area: '公共区域', freq: { type: 'daily' }, points: 1, standard: '厨余和其他垃圾分开，换上新垃圾袋' },
];

// ---------- 值日 ----------

export function templateFields(a) {
  const name = text(a.name, '家务名称', 20);
  const area = text(a.area ?? '', '区域', 12, 0);
  const points = Number(a.points);
  if (!Number.isInteger(points) || points < 1 || points > 5) fail('积分要在 1–5 之间');
  const standard = text(a.standard ?? '', '完成标准', 60, 0);
  const f = a.freq || {};
  let freq;
  if (f.type === 'daily') freq = { type: 'daily' };
  else if (f.type === 'everyN') {
    const n = Number(f.n);
    if (!Number.isInteger(n) || n < 2 || n > 14) fail('间隔天数要在 2–14 之间');
    freq = { type: 'everyN', n };
  } else if (f.type === 'weekly') {
    const days = uniq((f.days || []).map(Number)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    if (!days.length) fail('请至少选一天');
    freq = { type: 'weekly', days: days.sort((x, y) => x - y) };
  } else fail('请选择频率');
  return { name, area, points, standard, freq };
}

function nextCycleStart(room, today) {
  const c = openCycle(room, today);
  return c ? addDays(c.end, 1) : null;
}

export function addTemplate(ctx, fields) {
  const { room, me, now, today } = ctx;
  if (room.templates.some((t) => !t.deleted && !t.retireFrom && t.name === fields.name)) fail('已经有同名的家务了');
  const tpl = {
    id: nid(room, 'h'),
    ...fields,
    order: room.templates.reduce((x, t) => Math.max(x, t.order), 0) + 1,
    effectiveFrom: nextCycleStart(room, today),
    anchor: null,
    next: null,
    retireFrom: null,
    deleted: false,
    version: 1,
    createdBy: me.id,
    createdAt: now,
    updatedBy: me.id,
    updatedAt: now,
  };
  room.templates.push(tpl);
  return tpl;
}

function taskOpen(room, t) {
  const c = room.cycles.find((x) => x.id === t.cycleId);
  return c && !c.closed;
}

// ---------- 表决 ----------

function scheduleVoteReminders(ctx, { ref, eligible, deadline, label }) {
  const { room, now } = ctx;
  const at = lastBeforeQuiet(addHours(deadline, -6), currentParams(room).quietHours);
  if (at <= now) return;
  for (const id of eligible) {
    notify(room, { to: id, type: 'vote_soon', ref, key: `${ref}|6h`, once: true, at, now, text: `${label}快截止了，你还没有表决。`, reason: '表决截止前 6 小时提醒一次' });
  }
}

function retractFor(room, ref, to, now) {
  room.notifications = room.notifications.filter((n) => !(n.ref === ref && n.to === to && n.sendAt > now && n.type === 'vote_soon'));
}

function yesCount(votes) {
  return Object.values(votes).filter((v) => v === 'yes').length;
}

function passProposal(ctx, p) {
  const { room, now } = ctx;
  const base = activeVersion(room);
  const { clauses } = applyChanges(base.clauses, p.changes);
  const ver = newVersion(room, { clauses, status: 'draft', now, by: p.by, fromProposal: p.id, diff: p.diff });
  for (const [id, v] of Object.entries(p.votes)) if (v === 'yes') ver.signatures[id] = now;
  activate(room, ver, now);
  p.status = 'passed';
  p.closedAt = now;
  p.resultVersion = ver.v;
  room.notifications = room.notifications.filter((n) => !(n.ref === p.id && n.sendAt > now));
  for (const m of room.members) {
    if (m.status !== 'active') continue;
    notify(room, {
      to: m.id,
      type: 'pact_active',
      ref: p.id,
      key: `${p.id}|passed`,
      once: true,
      now,
      text: `公约第 ${ver.v} 版生效：${p.summary}。参数条款从下一个计费周期和值日周期开始执行，文字条款立即生效。`,
      reason: `同意 ${yesCount(p.votes)} 人，达到通过人数 ${p.threshold}`,
    });
  }
  log(room, p.by, now, 'pact.version', `公约第 ${ver.v} 版生效：${p.summary}`);
}

function checkRequest(ctx, r) {
  const { room, now } = ctx;
  const yes = yesCount(r.votes);
  const no = Object.values(r.votes).filter((v) => v === 'no').length;
  if (no > 0) {
    r.status = 'rejected';
    r.closedAt = now;
    notify(room, { to: r.by, type: 'request_result', ref: r.id, key: `${r.id}|result`, once: true, now, text: `采购申请「${r.itemName}」有人不同意，这次先不买。可以商量后再发起。`, reason: '采购预审有人反对即不通过' });
  } else if (yes >= r.threshold) {
    r.status = 'approved';
    r.closedAt = now;
    notify(room, { to: r.by, type: 'request_result', ref: r.id, key: `${r.id}|result`, once: true, now, text: `采购申请「${r.itemName}」已通过，可以买了。登记采购时会自动关联这次申请。`, reason: `除你之外 ${yes} 人同意，达到 ${r.threshold} 人` });
  } else return;
  room.notifications = room.notifications.filter((n) => !(n.ref === r.id && n.sendAt > now && n.type === 'vote_soon'));
}

function itemFields(room, a) {
  const category = ['cleaning', 'kitchen', 'bath', 'paper', 'other'].includes(a.category) ? a.category : 'other';
  const location = text(a.location ?? '', '存放位置', 20, 0);
  const restock = a.restock === 'fixed' ? 'fixed' : 'rotate';
  let fixedMemberId = null;
  if (restock === 'fixed') fixedMemberId = activeMember(room, a.fixedMemberId, '补货人').id;
  return { category, location, restock, fixedMemberId };
}

const H2 = {
  // 家务模板与排班
  'template.create'(ctx, a) {
    const { room, me, now, today } = ctx;
    const tpl = addTemplate(ctx, templateFields(a));
    notifyAll(ctx, {
      type: 'template',
      ref: tpl.id,
      key: `${tpl.id}|new`,
      once: true,
      text: `${me.name}新增了家务「${tpl.name}」${tpl.effectiveFrom ? `，从下个周期（${fmtShort(tpl.effectiveFrom, today)}）开始排班` : ''}。`,
      reason: '家务模板修改从下一个周期生效',
    });
    log(room, me.id, now, 'template.create', `新增家务「${tpl.name}」`, { ref: tpl.id });
    return { templateId: tpl.id };
  },
  'template.addRecommended'(ctx) {
    const { room, me, now } = ctx;
    let n = 0;
    for (const r of RECOMMENDED_CHORES) {
      if (room.templates.some((t) => !t.deleted && t.name === r.name)) continue;
      addTemplate(ctx, templateFields(r));
      n++;
    }
    if (!n) fail('推荐家务已经都加过了');
    log(room, me.id, now, 'template.create', `添加了 ${n} 项推荐家务`);
    return { added: n };
  },
  'template.update'(ctx, a) {
    const { room, me, now, today } = ctx;
    const tpl = find(room.templates, a.id, '家务');
    checkVersion(tpl, a.baseVersion, room);
    const fields = templateFields({ ...tpl, ...a });
    if (room.templates.some((t) => t.id !== tpl.id && !t.deleted && t.name === fields.name)) fail('已经有同名的家务了');
    const nx = nextCycleStart(room, today);
    const inUse = room.tasks.some((t) => t.templateId === tpl.id && taskOpen(room, t));
    if (nx && inUse) {
      tpl.next = { from: nx, fields };
    } else {
      const freqChanged = JSON.stringify(tpl.freq) !== JSON.stringify(fields.freq);
      Object.assign(tpl, fields);
      if (freqChanged) tpl.anchor = null;
    }
    tpl.version += 1;
    tpl.updatedBy = me.id;
    tpl.updatedAt = now;
    notifyAll(ctx, { type: 'template', ref: tpl.id, key: `${tpl.id}|v${tpl.version}`, once: true, text: `${me.name}修改了家务「${fields.name}」${nx && inUse ? `，从下个周期（${fmtShort(nx, today)}）开始生效` : ''}。`, reason: '家务模板修改从下一个周期生效' });
    log(room, me.id, now, 'template.update', `修改了家务「${fields.name}」`, { ref: tpl.id });
  },
  'template.delete'(ctx, a) {
    const { room, me, now, today } = ctx;
    const tpl = find(room.templates, a.id, '家务');
    const nx = nextCycleStart(room, today);
    const inUse = room.tasks.some((t) => t.templateId === tpl.id && taskOpen(room, t));
    if (nx && inUse) tpl.retireFrom = nx;
    else tpl.deleted = true;
    tpl.version += 1;
    notifyAll(ctx, { type: 'template', ref: tpl.id, key: `${tpl.id}|del`, once: true, text: `${me.name}停用了家务「${tpl.name}」${nx && inUse ? `，从下个周期（${fmtShort(nx, today)}）起不再排班` : ''}。`, reason: '家务模板修改从下一个周期生效' });
    log(room, me.id, now, 'template.delete', `停用了家务「${tpl.name}」`, { ref: tpl.id });
  },
  'cycle.generate'(ctx) {
    const { room, me, now, today } = ctx;
    if (openCycle(room, today)) fail('本周期还没结束，结束后会自动生成下一周期');
    if (!room.templates.some((t) => !t.deleted && !t.retireFrom)) fail('先添加几项家务吧');
    const last = latestCycle(room);
    const start = mondayOf(today);
    const startVals = last && last.closed && last.end === addDays(start, -1) ? last.carry : {};
    const cyc = generateCycle(room, { start, planFrom: today, startVals, now });
    if (!cyc) fail('现在没有在住的成员可以排班');
    for (const id of cyc.participants) {
      const n = room.tasks.filter((t) => t.cycleId === cyc.id && t.assigneeId === id).length;
      notify(room, { to: id, from: me.id, type: 'cycle_new', ref: cyc.id, key: cyc.id, once: true, now, text: `值日排好了（${fmtShort(cyc.start, today)}–${fmtShort(cyc.end, today)}），你有 ${n} 项。`, reason: '按家务积分均衡排班' });
    }
    log(room, me.id, now, 'cycle.generate', `生成了值日周期 ${fmtShort(cyc.start, today)}–${fmtShort(cyc.end, today)}`);
    return { cycleId: cyc.id };
  },
  'task.complete'(ctx, a) {
    const { room, me, now, today } = ctx;
    const t = find(room.tasks, a.id, '值日任务');
    if (!taskOpen(room, t)) fail('这个周期已经结束了');
    if (t.status === 'done') fail('这项已经完成了');
    if (t.date > today) fail('还没到这一天');
    const late = t.status === 'overdue';
    t.status = 'done';
    t.doneBy = me.id;
    t.doneAt = now;
    t.late = late;
    if (a.photoId) t.photo = String(a.photoId).slice(0, 120);
    room.notifications = room.notifications.filter((n) => !(n.ref === t.id && n.sendAt > now));
    if (t.assigneeId !== me.id) {
      notify(room, { to: t.assigneeId, from: me.id, type: 'chore_proxy', ref: t.id, key: `${t.id}|proxy`, once: true, now, text: `${me.name}帮你完成了${fmtShort(t.date, today)}的「${t.name}」，这 ${t.points} 分记给 TA。`, reason: `按公约第 ${clauseNoOf('choreCarry')} 条：代做积分记给实际完成人` });
    }
    log(room, me.id, now, 'task.complete', `${t.assigneeId === me.id ? '完成了' : `代${nameOf(room, t.assigneeId)}完成了`}${fmtShort(t.date, today)}的「${t.name}」${late ? '（逾期补做）' : ''}`, { ref: t.id });
  },
  'task.undo'(ctx, a) {
    const { room, me, now, today } = ctx;
    const t = find(room.tasks, a.id, '值日任务');
    if (t.status !== 'done' || t.doneBy !== me.id || localDate(t.doneAt) !== today || !taskOpen(room, t)) fail('只能撤销自己今天点的完成');
    t.status = t.date < today ? 'overdue' : 'pending';
    t.doneBy = null;
    t.doneAt = null;
    t.late = false;
    log(room, me.id, now, 'task.undo', `撤销了「${t.name}」的完成`, { ref: t.id });
  },
  'task.askHelp'(ctx, a) {
    const { room, me, now, today } = ctx;
    const t = find(room.tasks, a.id, '值日任务');
    if (t.assigneeId !== me.id) fail('只能为自己的任务找人代做');
    if (t.status === 'done' || !taskOpen(room, t)) fail('这项已经不需要代做了');
    let n = 0;
    for (const m of room.members) {
      if (m.id === me.id || !availableOn(m, today, room.aways)) continue;
      const r = notify(room, { to: m.id, from: me.id, type: 'chore_help', ref: t.id, key: t.id, now, text: `${me.name}${fmtShort(t.date, today)}的「${t.name}」需要人代做，方便的话点“我来代做”，积分记给你。`, reason: `${me.name}请室友帮忙`, actions: [{ type: 'task.complete', label: '我来代做', id: t.id }] });
      if (r) n++;
    }
    if (!n) fail('今天已经问过了，或者没有其他人在家');
    log(room, me.id, now, 'task.askHelp', `为「${t.name}」找人代做`, { ref: t.id });
    return { asked: n };
  },
  'swap.request'(ctx, a) {
    const { room, me, now, today } = ctx;
    const mine = find(room.tasks, a.myTaskId, '我的任务');
    const theirs = find(room.tasks, a.theirTaskId, '对方的任务');
    if (mine.assigneeId !== me.id) fail('只能用自己的任务换班');
    if (theirs.assigneeId === me.id) fail('请选一项别人的任务');
    for (const t of [mine, theirs]) if (t.status !== 'pending' || t.date < today || !taskOpen(room, t)) fail('只能换今天及以后、还没完成的任务');
    if (room.swaps.some((s) => s.status === 'pending' && [s.myTaskId, s.theirTaskId].some((id) => id === mine.id || id === theirs.id))) fail('这两项里已经有在等回复的换班了');
    const s = { id: nid(room, 's'), from: me.id, to: theirs.assigneeId, myTaskId: mine.id, theirTaskId: theirs.id, status: 'pending', createdAt: now, closedAt: null };
    room.swaps.push(s);
    notify(room, { to: s.to, from: me.id, type: 'swap', ref: s.id, key: s.id, once: true, now, text: `${me.name}想用${fmtShort(mine.date, today)}的「${mine.name}」换你${fmtShort(theirs.date, today)}的「${theirs.name}」。`, reason: '换班需要对方同意' });
    log(room, me.id, now, 'swap.request', `向${nameOf(room, s.to)}发起换班`, { ref: s.id });
    return { swapId: s.id };
  },
  'swap.respond'(ctx, a) {
    const { room, me, now, today } = ctx;
    const s = find(room.swaps, a.id, '换班请求');
    if (s.to !== me.id) fail('只有被请求的人可以回复', 'forbidden');
    if (s.status !== 'pending') fail('这条换班已经处理过了');
    const mine = room.tasks.find((t) => t.id === s.myTaskId);
    const theirs = room.tasks.find((t) => t.id === s.theirTaskId);
    if (a.accept) {
      const ok = mine && theirs && mine.status === 'pending' && theirs.status === 'pending' && mine.assigneeId === s.from && theirs.assigneeId === s.to && mine.date >= today && theirs.date >= today;
      if (!ok) {
        s.status = 'expired';
        s.closedAt = now;
        return { expired: true };
      }
      mine.assigneeId = s.to;
      theirs.assigneeId = s.from;
      s.status = 'accepted';
    } else s.status = 'declined';
    s.closedAt = now;
    notify(room, { to: s.from, from: me.id, type: 'swap_result', ref: s.id, key: `${s.id}|r`, once: true, now, text: a.accept ? `${me.name}同意换班，你改做${fmtShort(theirs.date, today)}的「${theirs.name}」。` : `${me.name}这次不方便换班。`, reason: '你发起的换班有了回复' });
    log(room, me.id, now, 'swap.respond', `${a.accept ? '同意' : '没有同意'}${nameOf(room, s.from)}的换班`, { ref: s.id });
  },
  'swap.cancel'(ctx, a) {
    const { room, me, now } = ctx;
    const s = find(room.swaps, a.id, '换班请求');
    if (s.from !== me.id || s.status !== 'pending') fail('只能撤回自己发起、还没回复的换班');
    s.status = 'cancelled';
    s.closedAt = now;
    log(room, me.id, now, 'swap.cancel', '撤回了换班请求', { ref: s.id });
  },

  // 公共物品
  'item.create'(ctx, a) {
    const { room, me, now } = ctx;
    const name = text(a.name, '物品名称', 20);
    if (room.items.some((i) => !i.deleted && i.name === name)) fail('已经有这件物品了');
    const item = { id: nid(room, 'i'), name, ...itemFields(room, a), status: ['ok', 'low', 'out'].includes(a.status) ? a.status : 'ok', deleted: false, version: 1, createdBy: me.id, createdAt: now, updatedBy: me.id, updatedAt: now };
    room.items.push(item);
    log(room, me.id, now, 'item.create', `登记了公共物品「${name}」`, { ref: item.id });
    return { itemId: item.id };
  },
  'item.update'(ctx, a) {
    const { room, me, now } = ctx;
    const item = find(room.items, a.id, '物品');
    checkVersion(item, a.baseVersion, room);
    const name = text(a.name ?? item.name, '物品名称', 20);
    if (room.items.some((i) => i.id !== item.id && !i.deleted && i.name === name)) fail('已经有同名的物品了');
    const before = `${item.name}｜${item.location || '未填位置'}`;
    Object.assign(item, { name, ...itemFields(room, { ...item, ...a }) }, { version: item.version + 1, updatedBy: me.id, updatedAt: now });
    log(room, me.id, now, 'item.update', `修改了物品「${name}」`, { ref: item.id, before, after: `${item.name}｜${item.location || '未填位置'}` });
  },
  'item.delete'(ctx, a) {
    const { room, me, now } = ctx;
    const item = find(room.items, a.id, '物品');
    item.deleted = true;
    item.version += 1;
    log(room, me.id, now, 'item.delete', `删除了物品「${item.name}」（采购记录保留）`, { ref: item.id });
  },
  'item.setStatus'(ctx, a) {
    const { room, me, now, today } = ctx;
    const item = find(room.items, a.id, '物品');
    if (!['ok', 'low', 'out'].includes(a.status)) fail('状态不对');
    if (item.status === a.status) return { unchanged: true };
    item.status = a.status;
    item.updatedBy = me.id;
    item.updatedAt = now;
    let notified = null;
    if (a.status !== 'ok') {
      const nb = nextBuyer(room, item, today);
      if (nb && nb.id !== me.id) {
        notify(room, { to: nb.id, from: me.id, type: 'item_low', ref: item.id, key: `${item.id}|${a.status}`, now, text: `「${item.name}」${a.status === 'out' ? '已经用完了' : '快用完了'}，轮到你补货。买完在物品页点“登记采购”，会自动记一笔账。`, reason: nb.why });
        notified = nb.id;
      }
    }
    log(room, me.id, now, 'item.status', `把「${item.name}」标记为${{ ok: '充足', low: '快用完', out: '已用完' }[a.status]}`, { ref: item.id });
    return { notified };
  },
  'purchase.create'(ctx, a) {
    const { room, me, now, today } = ctx;
    const item = find(room.items, a.itemId, '物品');
    const qty = Number(a.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) fail('数量要在 1–999 之间');
    const amount = money(a.amount);
    const d = a.date ? dateIn(a.date, '采购日期') : today;
    if (d > today || d < addDays(today, -60)) fail('采购日期要在最近两个月内，且不能晚于今天');
    const params = currentParams(room);
    let req = null;
    if (a.requestId) {
      req = room.requests.find((r) => r.id === a.requestId);
      if (!req || req.status !== 'approved') fail('这次采购申请还没通过');
    } else {
      req = room.requests.find((r) => r.status === 'approved' && r.itemId === item.id && !r.usedBy) || null;
    }
    const unapproved = amount >= params.purchaseApprovalCents && !req;
    const bill = createBill(ctx, { title: `${item.name}${qty > 1 ? ` ×${qty}` : ''}`, amount, category: 'supplies', payerId: a.payerId ?? me.id, method: a.method || 'equal', participants: a.participants, weights: a.weights, fixed: a.fixed, note: a.note }, { unapproved });
    const p = { id: nid(room, 'u'), itemId: item.id, qty, amount, payerId: bill.payerId, date: d, billId: bill.id, requestId: req?.id ?? null, unapproved, voided: false, createdBy: me.id, createdAt: now };
    room.purchases.push(p);
    bill.purchaseId = p.id;
    if (req) {
      req.usedBy = p.id;
      req.status = 'used';
    }
    item.status = 'ok';
    item.updatedAt = now;
    room.notifications = room.notifications.filter((n) => !(n.ref === item.id && n.sendAt > now));
    notifyBill(ctx, bill, unapproved ? `这笔达到了公约第 ${clauseNoOf('purchaseApprovalCents')} 条的预审金额，但没有预审，有疑问可以提出异议。` : '');
    log(room, me.id, now, 'purchase.create', `登记采购「${item.name}」${qty > 1 ? ` ×${qty}` : ''} ${fmtMoney(amount)}${unapproved ? '（未预审）' : ''}`, { ref: p.id });
    return { purchaseId: p.id, billId: bill.id, unapproved };
  },
  'request.create'(ctx, a) {
    const { room, me, now, today } = ctx;
    const item = a.itemId ? find(room.items, a.itemId, '物品') : null;
    const itemName = item ? item.name : text(a.itemName, '要买的东西', 20);
    const amount = money(a.amount, '预计金额');
    const reason = text(a.reason, '理由', 100);
    const res = residents(room, today);
    const eligible = res.filter((m) => m.id !== me.id).map((m) => m.id);
    const r = { id: nid(room, 'r'), itemId: item?.id ?? null, itemName, amount, reason, by: me.id, votes: {}, eligible, threshold: purchaseThreshold(res.length), status: 'open', deadline: addHours(now, VOTE_HOURS), createdAt: now, closedAt: null, usedBy: null };
    room.requests.push(r);
    if (r.threshold === 0) {
      r.status = 'approved';
      r.closedAt = now;
    } else {
      for (const id of eligible) {
        notify(room, { to: id, from: me.id, type: 'request_new', ref: r.id, key: r.id, once: true, now, text: `${me.name}想买「${itemName}」，预计 ${fmtMoney(amount)}。理由：${reason}。48 小时内表决。`, reason: `按公约第 ${clauseNoOf('purchaseApprovalCents')} 条：大额采购先预审` });
      }
      scheduleVoteReminders(ctx, { ref: r.id, eligible, deadline: r.deadline, label: `采购申请「${itemName}」` });
    }
    log(room, me.id, now, 'request.create', `发起采购申请「${itemName}」${fmtMoney(amount)}`, { ref: r.id });
    return { requestId: r.id, status: r.status };
  },
  'request.vote'(ctx, a) {
    const { room, me, now } = ctx;
    const r = find(room.requests, a.id, '采购申请');
    if (r.status !== 'open') fail('这次表决已经结束了');
    if (r.deadline <= now) fail('表决已经截止了');
    if (!r.eligible.includes(me.id)) fail('你不在这次表决的名单里');
    if (!['yes', 'no'].includes(a.vote)) fail('请选择同意或反对');
    r.votes[me.id] = a.vote;
    retractFor(room, r.id, me.id, now);
    log(room, me.id, now, 'request.vote', `对采购申请「${r.itemName}」投了${a.vote === 'yes' ? '同意' : '反对'}`, { ref: r.id });
    checkRequest(ctx, r);
    return { status: r.status };
  },
  'request.cancel'(ctx, a) {
    const { room, me, now } = ctx;
    const r = find(room.requests, a.id, '采购申请');
    if (r.by !== me.id || !['open', 'approved'].includes(r.status)) fail('只能撤回自己发起、还没用掉的申请');
    r.status = 'cancelled';
    r.closedAt = now;
    room.notifications = room.notifications.filter((n) => !(n.ref === r.id && n.sendAt > now));
    log(room, me.id, now, 'request.cancel', `撤回了采购申请「${r.itemName}」`, { ref: r.id });
  },

  // 公约
  'pact.sign'(ctx) {
    const { room, me, now } = ctx;
    const d = draftVersion(room);
    if (!d) fail('没有需要签署的公约');
    if (d.signatures[me.id]) fail('你已经签过了');
    d.signatures[me.id] = now;
    log(room, me.id, now, 'pact.sign', `签署了公约第 ${d.v} 版`);
    return { activated: maybeActivateDraft(room, now, me.id) };
  },
  'pact.activateNow'(ctx) {
    const { room, me, now } = ctx;
    requireAdmin(ctx);
    const d = draftVersion(room);
    if (!d) fail('没有草案');
    d.signatures[me.id] = d.signatures[me.id] || now;
    activate(room, d, now);
    notifyAll(ctx, { type: 'pact_active', ref: `v${d.v}`, key: `v${d.v}`, once: true, text: `${me.name}让公约第 ${d.v} 版立即生效了，可以在公约页查看。`, reason: '管理员选择了立即生效' });
    log(room, me.id, now, 'pact.active', `让公约第 ${d.v} 版立即生效`);
  },
  'pact.editDraft'(ctx, a) {
    const { room, me, now } = ctx;
    requireAdmin(ctx);
    const d = draftVersion(room);
    if (!d) fail('公约已经生效，修改请发起修订');
    d.clauses = sanitizeClauses(a.clauses);
    d.signatures = { [me.id]: now };
    notifyAll(ctx, { type: 'pact_draft', ref: `v${d.v}`, key: `v${d.v}|edit|${now}`, once: true, text: `${me.name}修改了公约草案，需要大家重新签署。`, reason: '首版公约需要全体在住成员签署' });
    log(room, me.id, now, 'pact.draft', '修改了公约草案，签署重新开始');
  },
  'proposal.create'(ctx, a) {
    const { room, me, now, today } = ctx;
    const base = activeVersion(room);
    if (!base) fail('公约还没生效，请先完成首版签署');
    if (room.pact.proposals.some((p) => p.status === 'open')) fail('已经有一项修订在表决中，等它结束后再发起');
    const reason = text(a.reason, '修订理由', 100);
    const { diff } = applyChanges(base.clauses, a.changes);
    const preview = proposalPreview(room, a.changes, now);
    const res = residents(room, today);
    const p = {
      id: nid(room, 'q'),
      by: me.id,
      reason,
      changes: JSON.parse(JSON.stringify(a.changes)),
      diff,
      summary: diff.map(diffText).join('；'),
      preview,
      baseVersion: base.v,
      votes: { [me.id]: 'yes' },
      eligible: res.map((m) => m.id),
      threshold: pactThreshold(res.length),
      status: 'open',
      deadline: addHours(now, VOTE_HOURS),
      createdAt: now,
      closedAt: null,
      resultVersion: null,
    };
    room.pact.proposals.push(p);
    log(room, me.id, now, 'proposal.create', `发起公约修订：${p.summary}`, { ref: p.id });
    if (yesCount(p.votes) >= p.threshold) {
      passProposal(ctx, p);
      return { proposalId: p.id, status: p.status };
    }
    const others = p.eligible.filter((id) => id !== me.id);
    for (const id of others) {
      notify(room, { to: id, from: me.id, type: 'proposal_new', ref: p.id, key: p.id, once: true, now, text: `${me.name}发起公约修订：${p.summary}。理由：${reason}。48 小时内表决，可以先看“影响预览”。`, reason: `需要 ${p.threshold} 人同意（含发起人）` });
    }
    scheduleVoteReminders(ctx, { ref: p.id, eligible: others, deadline: p.deadline, label: '公约修订' });
    return { proposalId: p.id, status: p.status };
  },
  'proposal.vote'(ctx, a) {
    const { room, me, now } = ctx;
    const p = find(room.pact.proposals, a.id, '修订');
    if (p.status !== 'open') fail('这次表决已经结束了');
    if (p.deadline <= now) fail('表决已经截止了');
    if (!p.eligible.includes(me.id)) fail('你不在这次表决的名单里');
    if (p.by === me.id) fail('发起人默认同意；不想改了可以撤回');
    if (!['yes', 'no'].includes(a.vote)) fail('请选择同意或反对');
    const changed = p.votes[me.id] && p.votes[me.id] !== a.vote;
    p.votes[me.id] = a.vote;
    retractFor(room, p.id, me.id, now);
    log(room, me.id, now, 'proposal.vote', `${changed ? '改票为' : '投了'}${a.vote === 'yes' ? '同意' : '反对'}：${p.summary}`, { ref: p.id });
    if (yesCount(p.votes) >= p.threshold) passProposal(ctx, p);
    return { status: p.status };
  },
  'proposal.withdraw'(ctx, a) {
    const { room, me, now } = ctx;
    const p = find(room.pact.proposals, a.id, '修订');
    if (p.by !== me.id || p.status !== 'open') fail('只能撤回自己发起、还在表决中的修订');
    p.status = 'withdrawn';
    p.closedAt = now;
    room.notifications = room.notifications.filter((n) => !(n.ref === p.id && n.sendAt > now));
    log(room, me.id, now, 'proposal.withdraw', `撤回了公约修订：${p.summary}`, { ref: p.id });
  },

  // 提醒与通知
  'message.send'(ctx, a) {
    const { room, me, now } = ctx;
    const to = activeMember(room, a.to, '对方');
    if (to.id === me.id) fail('不能提醒自己');
    const body = text(a.text, '提醒内容', 200);
    const ref = a.ref ? String(a.ref).slice(0, 40) : `msg:${body.slice(0, 24)}`;
    const n = notify(room, { to: to.id, from: me.id, type: 'message', ref, key: `msg|${me.id}|${ref}`, now, text: body, reason: `${me.name}发来的提醒` });
    if (!n) fail('今天已经就这件事提醒过 TA 了，明天再说吧');
    log(room, me.id, now, 'message.send', `提醒了${to.name}`);
    return { sendAt: n.sendAt, delayed: n.sendAt > now };
  },
  'notif.read'(ctx, a) {
    const { room, me, now } = ctx;
    const ids = Array.isArray(a.ids) ? new Set(a.ids) : null;
    for (const n of room.notifications) if (n.to === me.id && n.sendAt <= now && (!ids || ids.has(n.id))) n.read = true;
  },
};

const H = { ...H1, ...H2 };

export const ACTION_TYPES = Object.keys(H);

/** 读操作：不修改数据 */
export const READ_ONLY = new Set(['notif.read']);

export function applyAction(room, actorId, action, now) {
  const fn = H[action?.type];
  if (!fn) fail('不支持的操作');
  const me = memberOf(room, actorId);
  if (!me || me.status !== 'active') fail('你已经不在这个房间里了', 'forbidden');
  const ctx = { room, me, now, today: localDate(now) };
  return fn(ctx, action) ?? {};
}

/** 给某位成员看的房间数据：只带 TA 自己的、已到发送时间的通知 */
export function viewRoom(room, memberId, now) {
  const v = JSON.parse(JSON.stringify(room));
  v.notifications = v.notifications
    .filter((n) => n.to === memberId && n.sendAt <= now)
    .map(({ dedupe, ...n }) => n)
    .sort((a, b) => (a.sendAt < b.sendAt ? 1 : -1));
  delete v.meta.settleLast;
  return v;
}

export { proposalPreview };
