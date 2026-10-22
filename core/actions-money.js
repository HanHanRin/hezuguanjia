// 房间、成员、账单、还款、离家与访客的写操作。
import { isDate, addDays, daysIncl, fmtShort, fmtMoney } from './dates.js';
import { computeShares, SPLIT_METHODS } from './split.js';
import { netMap } from './ledger.js';
import { activeVersion, draftVersion, currentParams, paramsOn, versionOn, recommendedClauses, basicClauses, newVersion, activate, normalizeParam, normalizeText, PARAM_ORDER, DEFAULT_PARAMS } from './pact.js';
import { notify } from './notify.js';
import { reassignFor } from './cycles.js';
import { fail, nid, memberOf, nameOf, orderFn, residents } from './util.js';

export const CATEGORIES = { rent: '房租', utilities: '水电燃气', internet: '网费', supplies: '日用品', repair: '维修', other: '其他' };
export const COLORS = ['#7FA7E8', '#E59C7E', '#8CC2A5', '#E8C77B', '#D89BB0', '#82C4D4'];
export const MAX_MEMBERS = 6;

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomCode(len = 6) {
  const buf = new Uint8Array(len);
  globalThis.crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

export function emptyRoom({ id, name = '', now }) {
  return {
    id,
    name,
    inviteCode: '',
    tz: 'Asia/Shanghai',
    currency: 'CNY',
    demo: false,
    aiEnabled: true,
    createdAt: now,
    seq: 0,
    members: [],
    bills: [],
    transfers: [],
    aways: [],
    guests: [],
    templates: [],
    cycles: [],
    tasks: [],
    swaps: [],
    items: [],
    purchases: [],
    requests: [],
    pact: { versions: [], proposals: [] },
    notifications: [],
    activity: [],
    meta: { lastDaily: null, settleMonth: null, settleLast: {} },
  };
}

// ---------- 通用校验 ----------

export function text(v, label, max, min = 1) {
  const s = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < min) fail(`请填写${label}`);
  if (s.length > max) fail(`${label}最多 ${max} 个字`);
  return s;
}

export function money(v, label = '金额', min = 1) {
  const n = Number(v);
  if (!Number.isInteger(n)) fail(`${label}格式不对`);
  if (n < min) fail(min > 0 ? `${label}要大于 0` : `${label}不能是负数`);
  if (n > 100000000) fail(`${label}最多 ¥1,000,000.00`);
  return n;
}

export function dateIn(v, label) {
  if (!isDate(v)) fail(`请填写正确的${label}`);
  return v;
}

export function activeMember(room, id, label = '成员') {
  const m = memberOf(room, id);
  if (!m || m.status !== 'active') fail(`${label}不在这个房间里`);
  return m;
}

export function uniq(a) {
  return [...new Set(a)];
}

export function find(list, id, label) {
  const x = list.find((i) => i.id === id && !i.deleted);
  if (!x) fail(`${label}不存在或已删除`, 'not_found');
  return x;
}

export function requireAdmin(ctx) {
  if (ctx.me.role !== 'admin') fail('只有管理员可以这样做', 'forbidden');
}

export function checkVersion(rec, base, room) {
  if (base !== undefined && base !== null && Number(base) !== rec.version) {
    fail(`内容已被${nameOf(room, rec.updatedBy)}修改，请刷新后再改`, 'conflict');
  }
}

export function log(room, by, now, type, textStr, extra) {
  room.activity.push({ id: nid(room, 'a'), at: now, by, type, text: textStr, ...(extra || {}) });
  if (room.activity.length > 500) room.activity.splice(0, room.activity.length - 500);
}

export function notifyAll(ctx, payload, exceptMe = true) {
  const { room, me, now } = ctx;
  for (const m of room.members) {
    if (m.status !== 'active' || (exceptMe && m.id === me.id)) continue;
    notify(room, { now, from: me.id, ...payload, to: m.id });
  }
}

// ---------- 房间与成员 ----------

function pickColor(room) {
  const used = new Set(room.members.filter((m) => m.status === 'active').map((m) => m.color));
  const n = room.members.length;
  for (let i = 0; i < COLORS.length; i++) {
    const c = COLORS[(n + i) % COLORS.length];
    if (!used.has(c)) return c;
  }
  return COLORS[n % COLORS.length];
}

export function addMember(room, { name, moveIn, role = 'member', now }) {
  const nm = text(name, '昵称', 12);
  if (room.members.filter((m) => m.status === 'active').length >= MAX_MEMBERS) fail(`一个房间最多 ${MAX_MEMBERS} 人`);
  if (room.members.some((m) => m.status === 'active' && m.name === nm)) fail('这个昵称已经有人用了，换一个吧');
  const mi = dateIn(moveIn, '入住日期');
  const order = room.members.reduce((x, m) => Math.max(x, m.order), 0) + 1;
  const m = { id: nid(room, 'm'), name: nm, color: pickColor(room), role, order, moveIn: mi, moveOut: null, status: 'active', joinedAt: now, leftAt: null };
  room.members.push(m);
  return m;
}

export function sanitizeClauses(input) {
  if (!Array.isArray(input)) fail('公约条款格式不对');
  const params = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
  const texts = [];
  for (const c of input) {
    if (c && c.kind === 'param' && PARAM_ORDER.includes(c.key)) params[c.key] = normalizeParam(c.key, c.value);
    else if (c && c.kind === 'text') texts.push(normalizeText(c.text));
  }
  if (texts.length > 20) fail('文字条款最多 20 条');
  const out = PARAM_ORDER.map((key, i) => ({ no: i + 1, kind: 'param', key, value: params[key] }));
  texts.forEach((t, i) => out.push({ no: PARAM_ORDER.length + 1 + i, kind: 'text', text: t }));
  return out;
}

export function createRoom({ id, name, myName, moveIn, template = 'recommended', clauses = null, activateNow = true, now }) {
  const room = emptyRoom({ id, now });
  room.name = text(name, '房间名', 20);
  room.inviteCode = randomCode(6);
  const me = addMember(room, { name: myName, moveIn, role: 'admin', now });
  const cl = template === 'basic' ? basicClauses() : template === 'custom' && clauses ? sanitizeClauses(clauses) : recommendedClauses();
  const ver = newVersion(room, { clauses: cl, status: 'draft', now, by: me.id });
  ver.signatures[me.id] = now;
  if (activateNow) activate(room, ver, now);
  log(room, me.id, now, 'room.create', `创建了房间「${room.name}」${activateNow ? '，公约第 1 版立即生效' : '，公约第 1 版等室友加入后一起签署'}`);
  return { room, memberId: me.id };
}

export function maybeActivateDraft(room, now, by) {
  const d = draftVersion(room);
  if (!d) return false;
  const act = room.members.filter((m) => m.status === 'active');
  if (!act.every((m) => d.signatures[m.id])) return false;
  activate(room, d, now);
  for (const m of act) {
    notify(room, { to: m.id, type: 'pact_active', ref: `v${d.v}`, key: `v${d.v}`, once: true, now, text: `全员已签署，公约第 ${d.v} 版正式生效。`, reason: '首版公约需要全体在住成员签署' });
  }
  log(room, by, now, 'pact.active', `公约第 ${d.v} 版全员签署，正式生效`);
  return true;
}

export function joinRoom(room, { name, moveIn, agree }, now) {
  if (!agree) fail('请先阅读并签署公约');
  const m = addMember(room, { name, moveIn, role: 'member', now });
  const v = activeVersion(room) || draftVersion(room);
  if (v) v.signatures[m.id] = now;
  for (const o of room.members) {
    if (o.id === m.id || o.status !== 'active') continue;
    notify(room, { to: o.id, from: m.id, type: 'member_join', ref: m.id, key: m.id, once: true, now, text: `${m.name} 加入了房间，从下个值日周期开始参与排班。`, reason: '房间成员有变化' });
  }
  log(room, m.id, now, 'member.join', `${m.name} 加入了房间，签署了公约第 ${v?.v ?? 1} 版`);
  maybeActivateDraft(room, now, m.id);
  return m;
}

export function hasRecords(room, id) {
  return (
    room.bills.some((b) => b.payerId === id || b.createdBy === id || b.participants.includes(id)) ||
    room.transfers.some((t) => t.from === id || t.to === id) ||
    room.aways.some((a) => a.memberId === id) ||
    room.guests.some((g) => g.memberId === id) ||
    room.tasks.some((t) => t.assigneeId === id || t.doneBy === id) ||
    room.purchases.some((p) => p.payerId === id) ||
    room.requests.some((r) => r.by === id) ||
    room.pact.proposals.some((p) => p.by === id || p.votes[id])
  );
}

// ---------- 账单 ----------

function defaultParticipants(room, today, ps, pe) {
  const list = ps ? room.members.filter((m) => m.status === 'active' && m.moveIn <= pe && (!m.moveOut || m.moveOut >= ps)) : residents(room, today);
  return list.sort((a, b) => a.order - b.order).map((m) => m.id);
}

export function billInput(ctx, a, existing) {
  const { room, today, me } = ctx;
  const title = text(a.title, '标题', 30);
  const amount = money(a.amount);
  if (!(a.category in CATEGORIES)) fail('请选择类别');
  const category = a.category;
  const payer = activeMember(room, a.payerId ?? existing?.payerId ?? me.id, '付款人');
  let ps = null;
  let pe = null;
  const needPeriod = category === 'utilities' || a.method === 'personDays';
  if (needPeriod) {
    ps = dateIn(a.periodStart, '计费周期开始日');
    pe = dateIn(a.periodEnd, '计费周期结束日');
    if (pe < ps) fail('计费周期的结束日不能早于开始日');
    if (daysIncl(ps, pe) > 366) fail('计费周期最长一年');
  }
  const params = paramsOn(room, ps || today);
  const method = a.method || (category === 'utilities' ? params.utilitiesMethod : 'equal');
  if (!(method in SPLIT_METHODS)) fail('请选择分摊方式');
  const participants = uniq(Array.isArray(a.participants) && a.participants.length ? a.participants : defaultParticipants(room, today, ps, pe));
  if (!participants.length) fail('至少选择一位参与人');
  if (participants.length > MAX_MEMBERS) fail('参与人太多了');
  for (const id of participants) activeMember(room, id, '参与人');
  const o = orderFn(room);
  participants.sort((x, y) => o(x) - o(y));
  let weights = null;
  let fixed = null;
  if (method === 'weight') {
    weights = {};
    for (const id of participants) {
      const w = Math.round(Number(a.weights?.[id]) * 100);
      if (!Number.isFinite(w) || w <= 0 || w > 10000000) fail(`请给${nameOf(room, id)}填一个大于 0 的权重`);
      weights[id] = w;
    }
  }
  if (method === 'fixed') {
    fixed = {};
    for (const id of participants) fixed[id] = money(a.fixed?.[id] ?? 0, `${nameOf(room, id)}的金额`, 0);
  }
  const res = computeShares(
    { amount, payerId: payer.id, method, participants, weights, fixed, periodStart: ps, periodEnd: pe },
    { members: room.members, aways: room.aways, guests: room.guests, params, orderOf: o },
  );
  if (res.error === 'fixed_mismatch') fail(res.diff > 0 ? `还差 ${fmtMoney(res.diff)}` : `多出 ${fmtMoney(-res.diff)}`, 'fixed_mismatch');
  if (res.error) fail('没法按这个方式分摊');
  return {
    title,
    amount,
    category,
    payerId: payer.id,
    method,
    participants,
    weights,
    fixed,
    periodStart: ps,
    periodEnd: pe,
    shares: res.shares,
    splitNote: res.note,
    pactVersion: versionOn(room, ps || today)?.v ?? null,
    photoId: a.photoId !== undefined ? (a.photoId ? String(a.photoId).slice(0, 120) : null) : existing?.photoId ?? null,
    note: text(a.note ?? existing?.note ?? '', '备注', 100, 0),
  };
}

export function shareOf(bill, id) {
  return bill.shares.find((s) => s.memberId === id)?.amount ?? 0;
}

function billLine(room, b) {
  return `「${b.title}」${fmtMoney(b.amount)}，${nameOf(room, b.payerId)}付，${SPLIT_METHODS[b.method]}`;
}

function billReason(b) {
  if (b.method === 'personDays') return `按公约第 1、2、3 条计算在住人天（第 ${b.pactVersion ?? 1} 版）`;
  return '你是这笔账的参与人';
}

export function createBill(ctx, a, extra = {}) {
  const { room, me, now } = ctx;
  const fields = billInput(ctx, a);
  const bill = { id: nid(room, 'b'), ...fields, status: 'normal', dispute: null, voidReason: null, unapproved: false, purchaseId: null, createdBy: me.id, createdAt: now, updatedBy: me.id, updatedAt: now, version: 1, ...extra };
  room.bills.push(bill);
  return bill;
}

export function notifyBill(ctx, bill, extraText = '') {
  const { room, me, now } = ctx;
  for (const id of bill.participants) {
    if (id === me.id) continue;
    notify(room, {
      to: id,
      from: me.id,
      type: 'bill_new',
      ref: bill.id,
      key: `${bill.id}|new`,
      once: true,
      now,
      text: `${me.name}记了一笔「${bill.title}」${fmtMoney(bill.amount)}，你应摊 ${fmtMoney(shareOf(bill, id))}。${extraText}`,
      reason: billReason(bill),
    });
  }
}

export const H1 = {
  'room.update'(ctx, a) {
    requireAdmin(ctx);
    const before = ctx.room.name;
    ctx.room.name = text(a.name, '房间名', 20);
    log(ctx.room, ctx.me.id, ctx.now, 'room.update', `把房间名改为「${ctx.room.name}」`, { before, after: ctx.room.name });
  },
  'room.resetInvite'(ctx) {
    requireAdmin(ctx);
    ctx.room.inviteCode = randomCode(6);
    log(ctx.room, ctx.me.id, ctx.now, 'room.invite', '重置了邀请码，旧的邀请链接失效');
  },
  'room.setAI'(ctx, a) {
    requireAdmin(ctx);
    ctx.room.aiEnabled = !!a.enabled;
    log(ctx.room, ctx.me.id, ctx.now, 'room.ai', a.enabled ? '打开了 AI 功能' : '关闭了 AI 功能');
  },

  'member.update'(ctx, a) {
    const { room, me } = ctx;
    const before = me.name;
    if (a.name !== undefined) {
      const nm = text(a.name, '昵称', 12);
      if (room.members.some((m) => m.id !== me.id && m.status === 'active' && m.name === nm)) fail('这个昵称已经有人用了');
      me.name = nm;
    }
    if (a.color !== undefined) {
      if (!COLORS.includes(a.color)) fail('请从 6 个成员色里选');
      me.color = a.color;
    }
    log(room, me.id, ctx.now, 'member.update', '更新了个人资料', { before, after: me.name });
  },
  'member.setMoveOut'(ctx, a) {
    const { room, me, now, today } = ctx;
    const m = activeMember(room, a.memberId ?? me.id);
    if (m.id !== me.id) requireAdmin(ctx);
    const d = dateIn(a.date, '退租日期');
    if (d < m.moveIn) fail('退租日期不能早于入住日期');
    m.moveOut = d;
    const from = addDays(d, 1) > today ? addDays(d, 1) : today;
    const moved = reassignFor(room, m.id, from, now, `将在${fmtShort(d, today)}退租`);
    log(room, me.id, now, 'member.moveOut', `把${m.name}的退租日期设为${fmtShort(d, today)}`);
    for (const o of room.members) {
      if (o.id === m.id || o.status !== 'active') continue;
      notify(room, { to: o.id, from: me.id, type: 'member_out', ref: m.id, key: `${m.id}|out|${d}`, once: true, now, text: `${m.name}将在${fmtShort(d, today)}退租。结清余额后会变为“已退租”，历史记录保留。`, reason: '房间成员有变化' });
    }
    return { moved: moved.length };
  },
  'member.cancelMoveOut'(ctx, a) {
    const { room, me } = ctx;
    const m = activeMember(room, a.memberId ?? me.id);
    if (m.id !== me.id) requireAdmin(ctx);
    m.moveOut = null;
    log(room, me.id, ctx.now, 'member.moveOut', `取消了${m.name}的退租`);
  },
  'member.finalize'(ctx, a) {
    const { room, me, now, today } = ctx;
    const m = activeMember(room, a.memberId ?? me.id);
    if (m.id !== me.id) requireAdmin(ctx);
    if (!m.moveOut) fail('请先设置退租日期');
    if (m.moveOut > today) fail(`退租日（${fmtShort(m.moveOut, today)}）之后才能办理`);
    const net = netMap(room)[m.id] || 0;
    if (net !== 0) fail(`还有 ${fmtMoney(Math.abs(net))} 没结清（${net > 0 ? '应收' : '应付'}），结清后再办理`);
    if (room.transfers.some((t) => t.status === 'pending' && (t.from === m.id || t.to === m.id))) fail('还有待确认的转账，处理完再办理');
    if (room.members.filter((x) => x.status === 'active').length === 1) fail('房间里只剩你一个人了，不能办理退租');
    m.status = 'left';
    m.leftAt = now;
    if (m.role === 'admin' && !room.members.some((x) => x.status === 'active' && x.role === 'admin')) {
      const next = room.members.filter((x) => x.status === 'active').sort((x, y) => x.order - y.order)[0];
      if (next) next.role = 'admin';
    }
    room.notifications = room.notifications.filter((n) => n.to !== m.id);
    log(room, me.id, now, 'member.left', `${m.name}已结清并退租，历史记录保留只读`);
  },
  'member.remove'(ctx, a) {
    const { room, me, now } = ctx;
    requireAdmin(ctx);
    const m = activeMember(room, a.memberId);
    if (m.id === me.id) fail('不能移除自己');
    if (hasRecords(room, m.id)) fail('TA 已经有账单、值日或表决记录，不能移除；可以设置退租');
    room.members = room.members.filter((x) => x.id !== m.id);
    for (const v of room.pact.versions) delete v.signatures[m.id];
    room.notifications = room.notifications.filter((n) => n.to !== m.id);
    for (const c of room.cycles) c.participants = c.participants.filter((id) => id !== m.id);
    log(room, me.id, now, 'member.remove', `移除了成员${m.name}`);
  },

  'bill.create'(ctx, a) {
    const bill = createBill(ctx, a);
    notifyBill(ctx, bill);
    log(ctx.room, ctx.me.id, ctx.now, 'bill.create', `记了一笔${billLine(ctx.room, bill)}`, { ref: bill.id });
    return { billId: bill.id };
  },
  'bill.update'(ctx, a) {
    const { room, me, now } = ctx;
    const bill = find(room.bills, a.id, '账单');
    if (bill.createdBy !== me.id) fail('只有创建人可以修改这笔账', 'forbidden');
    if (bill.status === 'void') fail('已作废的账单不能修改');
    checkVersion(bill, a.baseVersion, room);
    const before = billLine(room, bill);
    const oldShares = Object.fromEntries(bill.shares.map((s) => [s.memberId, s.amount]));
    const { id, baseVersion, type, ...rest } = a;
    const fields = billInput(ctx, { ...bill, ...rest }, bill);
    if (bill.purchaseId && fields.category !== bill.category) fail('采购生成的账单不能改类别');
    const wasDisputed = bill.status === 'disputed' ? bill.dispute : null;
    Object.assign(bill, fields, { updatedBy: me.id, updatedAt: now, version: bill.version + 1 });
    if (wasDisputed) {
      bill.status = 'normal';
      bill.dispute = null;
      notify(room, { to: wasDisputed.by, from: me.id, type: 'bill_fixed', ref: bill.id, key: `${bill.id}|v${bill.version}|fixed`, once: true, now, text: `${me.name}修改了你有异议的「${bill.title}」，账单恢复计入余额。`, reason: '你对这笔账提出过异议' });
    }
    if (bill.purchaseId) {
      const p = room.purchases.find((x) => x.id === bill.purchaseId);
      if (p) p.amount = bill.amount;
    }
    for (const pid of uniq([...bill.participants, ...Object.keys(oldShares)])) {
      if (pid === me.id || (wasDisputed && pid === wasDisputed.by)) continue;
      notify(room, {
        to: pid,
        from: me.id,
        type: 'bill_edit',
        ref: bill.id,
        key: `${bill.id}|v${bill.version}`,
        once: true,
        now,
        text: `${me.name}修改了「${bill.title}」。你应摊 ${fmtMoney(oldShares[pid] ?? 0)} → ${fmtMoney(shareOf(bill, pid))}。`,
        reason: '账单修改会通知所有参与人',
      });
    }
    log(room, me.id, now, 'bill.update', `修改了账单「${bill.title}」`, { ref: bill.id, before, after: billLine(room, bill) });
  },
  'bill.dispute'(ctx, a) {
    const { room, me, now } = ctx;
    const bill = find(room.bills, a.id, '账单');
    if (!bill.participants.includes(me.id)) fail('只有参与人可以提出异议', 'forbidden');
    if (bill.createdBy === me.id) fail('这是你自己记的账，可以直接修改或作废');
    if (bill.status !== 'normal') fail(bill.status === 'disputed' ? '这笔账已经有人提出异议了' : '这笔账已作废');
    const reason = text(a.reason, '原因', 100);
    bill.status = 'disputed';
    bill.dispute = { by: me.id, reason, at: now };
    notify(room, { to: bill.createdBy, from: me.id, type: 'bill_dispute', ref: bill.id, key: `${bill.id}|dispute|${now}`, once: true, now, text: `${me.name}对「${bill.title}」有疑问：${reason}。这笔账暂不计入余额，修改后会自动恢复。`, reason: '你是这笔账的创建人' });
    log(room, me.id, now, 'bill.dispute', `对账单「${bill.title}」提出异议：${reason}`, { ref: bill.id });
  },
  'bill.withdrawDispute'(ctx, a) {
    const { room, me, now } = ctx;
    const bill = find(room.bills, a.id, '账单');
    if (bill.status !== 'disputed' || bill.dispute?.by !== me.id) fail('只有提出异议的人可以撤回');
    bill.status = 'normal';
    bill.dispute = null;
    notify(room, { to: bill.createdBy, from: me.id, type: 'bill_fixed', ref: bill.id, key: `${bill.id}|withdraw|${now}`, once: true, now, text: `${me.name}撤回了对「${bill.title}」的异议，账单恢复计入余额。`, reason: '你是这笔账的创建人' });
    log(room, me.id, now, 'bill.dispute', `撤回了对账单「${bill.title}」的异议`, { ref: bill.id });
  },
  'bill.void'(ctx, a) {
    const { room, me, now } = ctx;
    const bill = find(room.bills, a.id, '账单');
    if (bill.createdBy !== me.id) fail('只有创建人可以作废这笔账', 'forbidden');
    if (bill.status === 'void') fail('这笔账已经作废了');
    const reason = text(a.reason, '作废原因', 100);
    bill.status = 'void';
    bill.voidReason = reason;
    bill.updatedBy = me.id;
    bill.updatedAt = now;
    bill.version += 1;
    if (bill.purchaseId) {
      const p = room.purchases.find((x) => x.id === bill.purchaseId);
      if (p) p.voided = true;
    }
    for (const pid of bill.participants) {
      if (pid === me.id) continue;
      notify(room, { to: pid, from: me.id, type: 'bill_void', ref: bill.id, key: `${bill.id}|void`, once: true, now, text: `${me.name}作废了「${bill.title}」${fmtMoney(bill.amount)}：${reason}。`, reason: '你是这笔账的参与人' });
    }
    log(room, me.id, now, 'bill.void', `作废了账单「${bill.title}」：${reason}`, { ref: bill.id });
  },

  'transfer.create'(ctx, a) {
    const { room, me, now } = ctx;
    const to = activeMember(room, a.to, '收款人');
    if (to.id === me.id) fail('不能转给自己');
    const amount = money(a.amount);
    const t = { id: nid(room, 'p'), from: me.id, to: to.id, amount, status: 'pending', by: me.id, createdAt: now, confirmedAt: null, note: text(a.note ?? '', '备注', 40, 0) };
    room.transfers.push(t);
    notify(room, { to: to.id, from: me.id, type: 'transfer_pending', ref: t.id, key: t.id, once: true, now, text: `${me.name}说已经转给你 ${fmtMoney(amount)}，收到后点“确认收款”，余额才会更新。`, reason: '只有收款人能确认收款' });
    log(room, me.id, now, 'transfer.create', `记录已转给${to.name} ${fmtMoney(amount)}，等待确认`, { ref: t.id });
    return { transferId: t.id };
  },
  'transfer.receive'(ctx, a) {
    const { room, me, now } = ctx;
    const from = activeMember(room, a.from, '转账人');
    if (from.id === me.id) fail('不能记自己转给自己');
    const amount = money(a.amount);
    const t = { id: nid(room, 'p'), from: from.id, to: me.id, amount, status: 'confirmed', by: me.id, createdAt: now, confirmedAt: now, note: text(a.note ?? '', '备注', 40, 0) };
    room.transfers.push(t);
    notify(room, { to: from.id, from: me.id, type: 'transfer_done', ref: t.id, key: t.id, once: true, now, text: `${me.name}记录收到你转的 ${fmtMoney(amount)}，余额已更新。`, reason: '收款人记录的还款' });
    log(room, me.id, now, 'transfer.receive', `记录收到${from.name} ${fmtMoney(amount)}`, { ref: t.id });
  },
  'transfer.confirm'(ctx, a) {
    const { room, me, now } = ctx;
    const t = find(room.transfers, a.id, '转账');
    if (t.to !== me.id) fail('只有收款人能确认', 'forbidden');
    if (t.status !== 'pending') fail('这笔转账已经处理过了');
    t.status = 'confirmed';
    t.confirmedAt = now;
    notify(room, { to: t.from, from: me.id, type: 'transfer_done', ref: t.id, key: `${t.id}|ok`, once: true, now, text: `${me.name}确认收到你转的 ${fmtMoney(t.amount)}，余额已更新。`, reason: '你记录的转账已确认' });
    log(room, me.id, now, 'transfer.confirm', `确认收到${nameOf(room, t.from)} ${fmtMoney(t.amount)}`, { ref: t.id });
  },
  'transfer.decline'(ctx, a) {
    const { room, me, now } = ctx;
    const t = find(room.transfers, a.id, '转账');
    if (t.to !== me.id) fail('只有收款人能操作', 'forbidden');
    if (t.status !== 'pending') fail('这笔转账已经处理过了');
    t.status = 'declined';
    t.confirmedAt = now;
    notify(room, { to: t.from, from: me.id, type: 'transfer_declined', ref: t.id, key: `${t.id}|no`, once: true, now, text: `${me.name}暂时没查到你转的 ${fmtMoney(t.amount)}，可以核对一下转账记录。`, reason: '你记录的转账未被确认' });
    log(room, me.id, now, 'transfer.decline', `表示还没收到${nameOf(room, t.from)}的 ${fmtMoney(t.amount)}`, { ref: t.id });
  },
  'transfer.cancel'(ctx, a) {
    const { room, me, now } = ctx;
    const t = find(room.transfers, a.id, '转账');
    if (t.from !== me.id || t.status !== 'pending') fail('只能撤回自己记录、还没确认的转账');
    t.status = 'cancelled';
    room.notifications = room.notifications.filter((n) => !(n.ref === t.id && n.type === 'transfer_pending'));
    log(room, me.id, now, 'transfer.cancel', `撤回了转给${nameOf(room, t.to)}的 ${fmtMoney(t.amount)}`, { ref: t.id });
  },

  'away.create'(ctx, a) {
    const { room, me, now, today } = ctx;
    const start = dateIn(a.start, '开始日期');
    const end = dateIn(a.end, '结束日期');
    if (end < start) fail('结束日期不能早于开始日期');
    if (daysIncl(start, end) > 180) fail('一次最多登记 180 天');
    if (start < addDays(today, -90)) fail('只能补登 90 天以内的离家');
    if (room.aways.some((x) => x.memberId === me.id && !(x.end < start || x.start > end))) fail('和你已有的离家记录重叠了');
    const rec = { id: nid(room, 'w'), memberId: me.id, start, end, createdAt: now };
    room.aways.push(rec);
    const N = currentParams(room).awayMinDays;
    const len = daysIncl(start, end);
    let moved = [];
    if (end >= today) moved = reassignFor(room, me.id, start > today ? start : today, now, `登记了离家（${fmtShort(start, today)}–${fmtShort(end, today)}）`);
    log(room, me.id, now, 'away.create', `登记离家 ${fmtShort(start, today)}–${fmtShort(end, today)}（${len} 天${len >= N ? '，满离家门槛' : ''}）`, { ref: rec.id });
    return { moved: moved.length, counted: len >= N };
  },
  'away.delete'(ctx, a) {
    const { room, me, now, today } = ctx;
    const rec = find(room.aways, a.id, '离家记录');
    if (rec.memberId !== me.id) fail('只能删除自己的离家记录', 'forbidden');
    room.aways = room.aways.filter((x) => x.id !== rec.id);
    log(room, me.id, now, 'away.delete', `删除了离家记录 ${fmtShort(rec.start, today)}–${fmtShort(rec.end, today)}（已改派的值日不会自动换回）`);
  },
  'guest.create'(ctx, a) {
    const { room, me, now, today } = ctx;
    const d = dateIn(a.date, '日期');
    const nights = Number(a.nights);
    if (!Number.isInteger(nights) || nights < 1 || nights > 31) fail('晚数要在 1–31 之间');
    if (d < addDays(today, -90) || d > addDays(today, 60)) fail('只能登记前后两个月内的访客');
    const rec = { id: nid(room, 'g'), memberId: me.id, date: d, nights, note: text(a.note ?? '', '备注', 30, 0), createdAt: now };
    room.guests.push(rec);
    log(room, me.id, now, 'guest.create', `登记访客过夜 ${fmtShort(d, today)} 起 ${nights} 晚`, { ref: rec.id });
  },
  'guest.delete'(ctx, a) {
    const { room, me, now } = ctx;
    const rec = find(room.guests, a.id, '访客记录');
    if (rec.memberId !== me.id) fail('只能删除自己登记的访客', 'forbidden');
    room.guests = room.guests.filter((x) => x.id !== rec.id);
    log(room, me.id, now, 'guest.delete', '删除了一条访客记录');
  },
};
