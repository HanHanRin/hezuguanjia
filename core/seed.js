// 演示数据：绿洲公寓 702。
// 按提示词第 9 节：成员、公约 v1、三笔账单、物品与采购记录、家务模板、值日周期从今天所在周的周一开始、一项进行中的修订。
import { localDate, mondayOf, addDays, addHours, localISO } from './dates.js';
import { createRoom, joinRoom, applyAction, RECOMMENDED_CHORES, addTemplate, templateFields } from './actions.js';
import { generateCycle } from './cycles.js';
import { runDaily } from './daily.js';

export const DEMO_NAMES = ['小林', '阿杰', '小雨', '周周'];

/**
 * 生成演示房间。now 为当前时间（ISO）；日期固定在 2026 年 9–10 月，和验收用例一致。
 * 返回 { room, ids: { 小林: memberId, ... } }
 */
export function seedDemo({ id, now }) {
  const t0 = '2026-09-01T02:00:00.000Z';
  const { room, memberId: lin } = createRoom({ id, name: '绿洲公寓 702', myName: '小林', moveIn: '2026-09-01', template: 'recommended', activateNow: true, now: t0 });
  room.demo = true;
  const jie = joinRoom(room, { name: '阿杰', moveIn: '2026-09-01', agree: true }, '2026-09-01T03:00:00.000Z').id;
  const yu = joinRoom(room, { name: '小雨', moveIn: '2026-09-01', agree: true }, '2026-09-01T04:00:00.000Z').id;
  const zhou = joinRoom(room, { name: '周周', moveIn: '2026-10-01', agree: true }, '2026-10-01T04:00:00.000Z').id;
  const ids = { 小林: lin, 阿杰: jie, 小雨: yu, 周周: zhou };
  const all = [lin, jie, yu, zhou];

  // 公约 v1 四人都已签署（加入时已签），生效日期固定为 9 月 1 日
  const v1 = room.pact.versions[0];
  v1.activatedAt = t0;
  v1.activatedDate = '2026-09-01';

  // 阿杰 9/20–9/24 离家（5 天，满门槛）
  applyAction(room, jie, { type: 'away.create', start: '2026-09-20', end: '2026-09-24' }, '2026-09-19T12:00:00.000Z');

  // 公共物品
  const item = (name, category, location, status) => applyAction(room, lin, { type: 'item.create', name, category, location, status, restock: 'rotate' }, '2026-09-01T05:00:00.000Z').itemId;
  const paper = item('卷纸', 'paper', '卫生间柜子', 'ok');
  item('洗洁精', 'kitchen', '厨房水槽下', 'ok');
  item('垃圾袋', 'cleaning', '厨房抽屉', 'ok');
  const detergent = item('洗衣液', 'cleaning', '阳台', 'out');

  // 卷纸采购记录：09-01 小林、09-21 阿杰（只是记录日期，金额并入当时的日用品账单，这里不重复记账）
  room.purchases.push({ id: 'u_seed1', itemId: paper, qty: 1, amount: 0, payerId: lin, date: '2026-09-01', billId: null, requestId: null, unapproved: false, voided: false, createdBy: lin, createdAt: '2026-09-01T06:00:00.000Z', seeded: true });
  room.purchases.push({ id: 'u_seed2', itemId: paper, qty: 1, amount: 0, payerId: jie, date: '2026-09-21', billId: null, requestId: null, unapproved: false, voided: false, createdBy: jie, createdAt: '2026-09-21T06:00:00.000Z', seeded: true });

  // 账单 1：10 月房租，固定金额
  applyAction(
    room,
    lin,
    { type: 'bill.create', title: '10 月房租', amount: 1020000, category: 'rent', payerId: lin, method: 'fixed', participants: all, fixed: { [lin]: 320000, [jie]: 260000, [yu]: 240000, [zhou]: 200000 } },
    '2026-10-01T05:00:00.000Z',
  );
  // 账单 2：水电燃气，按在住人天
  applyAction(
    room,
    lin,
    { type: 'bill.create', title: '水电燃气 9/15–10/14', amount: 38640, category: 'utilities', payerId: lin, method: 'personDays', participants: all, periodStart: '2026-09-15', periodEnd: '2026-10-14' },
    '2026-10-15T05:00:00.000Z',
  );
  // 账单 3：日用品，10/12 小雨付，四人均摊（作为卷纸第 3 次采购）
  const p3 = applyAction(room, yu, { type: 'purchase.create', itemId: paper, qty: 1, amount: 3650, date: '2026-10-12', participants: all, method: 'equal' }, '2026-10-12T05:00:00.000Z');
  const b3 = room.bills.find((b) => b.id === p3.billId);
  b3.title = '日用品（洗洁精、垃圾袋、卷纸）';
  // 卷纸当前状态：快用完
  room.items.find((i) => i.id === paper).status = 'low';
  room.items.find((i) => i.id === detergent).status = 'out';

  // 家务模板
  const ctx = { room, me: room.members[0], now: '2026-09-01T05:00:00.000Z', today: '2026-09-01' };
  for (const r of RECOMMENDED_CHORES) addTemplate(ctx, templateFields(r));

  // 值日周期：从今天所在周的周一开始，保证打开就能看到今天的任务
  const today = localDate(now);
  const start = mondayOf(today);
  generateCycle(room, { start, planFrom: start, startVals: {}, now });
  // 今天之前的任务都算按时完成，避免一打开就是一片“逾期”
  for (const t of room.tasks) {
    if (t.date < today) {
      t.status = 'done';
      t.doneBy = t.assigneeId;
      t.doneAt = localISO(t.date, 20, 0);
    }
  }

  // 进行中的修订：小雨提议把离家门槛从 3 天改成 7 天；小雨（发起人）、小林同意，阿杰反对，周周未表决
  const created = addHours(now, -17);
  applyAction(room, yu, { type: 'proposal.create', reason: '短途出差不该少摊固定开销', changes: [{ op: 'edit', no: 2, value: 7 }] }, created);
  const prop = room.pact.proposals[room.pact.proposals.length - 1];
  applyAction(room, lin, { type: 'proposal.vote', id: prop.id, vote: 'yes' }, addHours(created, 1));
  applyAction(room, jie, { type: 'proposal.vote', id: prop.id, vote: 'no' }, addHours(created, 2));

  // 演示用的历史通知：只保留最近一周的，避免通知中心堆满旧消息
  const cutoff = addHours(now, -24 * 7);
  room.notifications = room.notifications.filter((n) => n.sendAt >= cutoff);
  room.activity = room.activity.filter((a) => a.at >= '2026-09-01');
  room.meta.lastDaily = null;
  runDaily(room, now);
  room.demoSeededAt = now;
  return { room, ids };
}

export { addDays };
