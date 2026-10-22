// 验收用例 T1–T17（提示词第 10 节）。运行：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { largestRemainder, computeShares } from '../core/split.js';
import { settlePlan, netMap } from '../core/ledger.js';
import { planCycle, reassignAbsence } from '../core/chores.js';
import { predictRunOut } from '../core/items.js';
import { pactThreshold, purchaseThreshold } from '../core/pact.js';
import { notify, shiftQuiet } from '../core/notify.js';
import { proposalPreview } from '../core/preview.js';
import { seedDemo } from '../core/seed.js';
import { applyAction, createRoom, joinRoom } from '../core/actions.js';
import { fmtMoney, addDays } from '../core/dates.js';

const ORDER = { A: 1, B: 2, C: 3, D: 4 };
const orderOf = (id) => ORDER[id];
const FAR = null;
const members4 = [
  { id: 'A', moveIn: '2026-09-01', moveOut: FAR, status: 'active', order: 1 },
  { id: 'B', moveIn: '2026-09-01', moveOut: FAR, status: 'active', order: 2 },
  { id: 'C', moveIn: '2026-09-01', moveOut: FAR, status: 'active', order: 3 },
  { id: 'D', moveIn: '2026-10-01', moveOut: FAR, status: 'active', order: 4 },
];
const amounts = (shares) => shares.map((s) => s.amount);
const util = (extra = {}) =>
  computeShares(
    { amount: 38640, payerId: 'A', method: 'personDays', participants: ['A', 'B', 'C', 'D'], periodStart: '2026-09-15', periodEnd: '2026-10-14' },
    { members: members4, aways: extra.aways || [], guests: extra.guests || [], params: { awayMinDays: extra.awayMin ?? 3, freeGuestNights: 4 }, orderOf },
  );

test('T1 均摊取整：100.00 元三人均摊，小林付款 → 33.34 / 33.33 / 33.33', () => {
  const r = largestRemainder(10000, [{ id: 'A', w: 1 }, { id: 'B', w: 1 }, { id: 'C', w: 1 }], 'A', orderOf);
  assert.deepEqual(r.map((x) => x.amount), [3334, 3333, 3333]);
});

test('T2 按在住人天：人天 30/30/30/14 → 111.46 / 111.46 / 111.46 / 52.02', () => {
  const r = util();
  assert.deepEqual(r.shares.map((s) => s.explain.w), [30, 30, 30, 14]);
  assert.deepEqual(amounts(r.shares), [11146, 11146, 11146, 5202]);
});

test('T3 离家扣除：阿杰 09-20 至 09-24 离家 → 人天 30/25/30/14 → 117.09 / 97.58 / 117.09 / 54.64', () => {
  const r = util({ aways: [{ memberId: 'B', start: '2026-09-20', end: '2026-09-24' }] });
  assert.deepEqual(r.shares.map((s) => s.explain.w), [30, 25, 30, 14]);
  assert.deepEqual(amounts(r.shares), [11709, 9758, 11709, 5464]);
  assert.equal(r.shares[1].explain.raw, '97.5757…');
  assert.equal(r.shares[1].explain.extra, 1);
});

test('T4 短离家不扣：离家 2 天 → 与 T2 相同', () => {
  const r = util({ aways: [{ memberId: 'B', start: '2026-09-20', end: '2026-09-21' }] });
  assert.deepEqual(amounts(r.shares), [11146, 11146, 11146, 5202]);
});

test('T5 访客加成：小林访客 6 晚 → 人天 32/30/30/14 → 116.65 / 109.36 / 109.36 / 51.03', () => {
  const r = util({ guests: [{ memberId: 'A', date: '2026-10-02', nights: 6 }] });
  assert.deepEqual(r.shares.map((s) => s.explain.w), [32, 30, 30, 14]);
  assert.deepEqual(amounts(r.shares), [11665, 10936, 10936, 5103]);
});

test('T6 固定金额：合计相等可保存；小雨改成 2,300 → 还差 ¥100.00', () => {
  const ctx = { members: members4, aways: [], guests: [], params: { awayMinDays: 3, freeGuestNights: 4 }, orderOf };
  const ok = computeShares({ amount: 1020000, payerId: 'A', method: 'fixed', participants: ['A', 'B', 'C', 'D'], fixed: { A: 320000, B: 260000, C: 240000, D: 200000 } }, ctx);
  assert.equal(ok.error, undefined);
  const bad = computeShares({ amount: 1020000, payerId: 'A', method: 'fixed', participants: ['A', 'B', 'C', 'D'], fixed: { A: 320000, B: 260000, C: 230000, D: 200000 } }, ctx);
  assert.equal(bad.error, 'fixed_mismatch');
  assert.equal(`还差 ${fmtMoney(bad.diff)}`, '还差 ¥100.00');
  // 通过动作层也会拒绝保存
  const { room, memberId } = createRoom({ id: 'r6', name: '测试', myName: '小林', moveIn: '2026-09-01', now: '2026-09-01T02:00:00.000Z' });
  const b = joinRoom(room, { name: '阿杰', moveIn: '2026-09-01', agree: true }, '2026-09-01T03:00:00.000Z').id;
  assert.throws(() => applyAction(room, memberId, { type: 'bill.create', title: '房租', amount: 500000, category: 'rent', method: 'fixed', participants: [memberId, b], fixed: { [memberId]: 300000, [b]: 190000 } }, '2026-10-01T03:00:00.000Z'), /还差 ¥100.00/);
});

test('T7 结算建议：+100 / +20 / −70 / −50 → 小雨转小林 70、周周转小林 30、周周转阿杰 20', () => {
  const plan = settlePlan({ A: 10000, B: 2000, C: -7000, D: -5000 }, orderOf);
  assert.deepEqual(plan, [
    { from: 'C', to: 'A', amount: 7000 },
    { from: 'D', to: 'A', amount: 3000 },
    { from: 'D', to: 'B', amount: 2000 },
  ]);
  assert.ok(plan.length <= 3);
});

function demo() {
  return seedDemo({ id: 'demo', now: '2026-10-22T04:00:00.000Z' });
}

test('T8 演示余额：小林 +7,260.18、阿杰 −2,706.70、小雨 −2,489.72、周周 −2,063.76，合计 0', () => {
  const { room, ids } = demo();
  const net = netMap(room);
  assert.equal(net[ids['小林']], 726018);
  assert.equal(net[ids['阿杰']], -270670);
  assert.equal(net[ids['小雨']], -248972);
  assert.equal(net[ids['周周']], -206376);
  assert.equal(Object.values(net).reduce((s, x) => s + x, 0), 0);
});

test('T9 还款确认：确认前余额不变；确认后阿杰 0.00、小林 +4,553.48', () => {
  const { room, ids } = demo();
  const now = '2026-10-22T05:00:00.000Z';
  const { transferId } = applyAction(room, ids['阿杰'], { type: 'transfer.create', to: ids['小林'], amount: 270670 }, now);
  assert.equal(netMap(room)[ids['阿杰']], -270670);
  assert.throws(() => applyAction(room, ids['阿杰'], { type: 'transfer.confirm', id: transferId }, now), /只有收款人/);
  applyAction(room, ids['小林'], { type: 'transfer.confirm', id: transferId }, now);
  assert.equal(netMap(room)[ids['阿杰']], 0);
  assert.equal(netMap(room)[ids['小林']], 455348);
});

const TPLS = [
  { id: 'h1', name: '卫生间深度清洁', points: 3, order: 1, freq: { type: 'weekly', days: [1] }, anchor: '2026-10-26' },
  { id: 'h2', name: '厨房台面与水槽', points: 2, order: 2, freq: { type: 'everyN', n: 2 }, anchor: '2026-10-26' },
  { id: 'h3', name: '客厅拖地', points: 2, order: 3, freq: { type: 'weekly', days: [1] }, anchor: '2026-10-26' },
  { id: 'h4', name: '倒垃圾', points: 1, order: 4, freq: { type: 'daily' }, anchor: '2026-10-26' },
];
const crew = ['A', 'B', 'C', 'D'].map((id, i) => ({ id, moveIn: '2026-09-01', moveOut: null, status: 'active', order: i + 1 }));
const plan = (aways = [], startVals = {}, start = '2026-10-26') =>
  planCycle({ start, end: addDays(start, 27), participants: crew, aways, templates: TPLS.map((t) => ({ ...t, anchor: start })), startVals, awayMin: 3, orderOf });
const sum = (tasks, id) => tasks.filter((t) => t.assigneeId === id).reduce((s, t) => s + t.points, 0);

test('T10 值日均衡：四人全勤 28 天 → 50 个任务、总积分 76、每人 19 分', () => {
  const r = plan();
  assert.equal(r.tasks.length, 50);
  assert.equal(r.tasks.reduce((s, t) => s + t.points, 0), 76);
  for (const id of ['A', 'B', 'C', 'D']) assert.equal(sum(r.tasks, id), 19);
  // 前两天的分配（便于人工核对）
  const first = r.tasks.filter((t) => t.date === '2026-10-26').map((t) => `${t.name}:${t.assigneeId}`);
  assert.deepEqual(first, ['卫生间深度清洁:A', '厨房台面与水槽:B', '客厅拖地:C', '倒垃圾:D']);
});

test('T11 离家不排：生成前阿杰 10-28 至 10-30 离家 → 这 3 天阿杰没有任务；积分 20/17/20/19', () => {
  const aways = [{ memberId: 'B', start: '2026-10-28', end: '2026-10-30' }];
  const r = plan(aways);
  assert.equal(r.tasks.filter((t) => t.assigneeId === 'B' && t.date >= '2026-10-28' && t.date <= '2026-10-30').length, 0);
  assert.deepEqual(['A', 'B', 'C', 'D'].map((id) => sum(r.tasks, id)), [20, 17, 20, 19]);
});

test('T12 事后登记离家：只改派阿杰这 3 天里的任务（2 个），其余不变，偏差不超过 1', () => {
  const r = plan();
  const tasks = r.tasks.map((t, i) => ({ ...t, id: 't' + i, status: 'pending' }));
  const before = tasks.map((t) => t.assigneeId);
  const aways = [{ memberId: 'B', start: '2026-10-28', end: '2026-10-30' }];
  const cycle = { participants: ['A', 'B', 'C', 'D'], planFrom: '2026-10-26', end: '2026-11-22', startVals: {} };
  const moved = reassignAbsence({ cycle, tasks, members: crew, aways, memberId: 'B', fromDate: '2026-10-26', awayMin: 3, orderOf, templateOrder: (id) => TPLS.find((t) => t.id === id).order });
  assert.equal(moved.length, 2);
  assert.deepEqual(moved.map((m) => `${m.task.date}:${m.task.name}->${m.to}`), ['2026-10-28:倒垃圾->A', '2026-10-30:倒垃圾->D']);
  const changed = tasks.filter((t, i) => t.assigneeId !== before[i]);
  assert.equal(changed.length, 2);
  const pts = ['A', 'B', 'C', 'D'].map((id) => sum(tasks, id));
  assert.equal(pts.reduce((s, x) => s + x, 0), 76);
  const w = { A: 28, B: 25, C: 28, D: 28 };
  const W = 109;
  for (const [i, id] of ['A', 'B', 'C', 'D'].entries()) assert.ok(Math.abs(pts[i] - (76 * w[id]) / W) <= 1, `${id} 偏差超过 1`);
  assert.deepEqual(pts, [20, 17, 19, 20]);
});

test('T13 结转：阿杰漏做 3 次倒垃圾由小林代做 → 结转 +3 / −3；下一周期分配 16/22/19/19', () => {
  const r = plan();
  const tasks = r.tasks.map((t) => ({ ...t, status: 'done', doneBy: t.assigneeId }));
  let k = 0;
  for (const t of tasks) if (t.assigneeId === 'B' && t.name === '倒垃圾' && k < 3) (t.doneBy = 'A'), k++;
  const done = (id) => tasks.filter((t) => t.doneBy === id).reduce((s, t) => s + t.points, 0);
  const carry = Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [id, done(id) - sum(tasks, id)]));
  assert.deepEqual(carry, { A: 3, B: -3, C: 0, D: 0 });
  const next = plan([], carry, '2026-11-23');
  assert.deepEqual(['A', 'B', 'C', 'D'].map((id) => sum(next.tasks, id)), [16, 22, 19, 19]);
  for (const id of ['A', 'B', 'C', 'D']) assert.equal(carry[id] + sum(next.tasks, id), 19);
});

test('T14 用完预测：09-01、09-21、10-12 → 平均 20.5 → 21 → 11-02 用完，10-31 提醒周周', () => {
  const p = predictRunOut([{ date: '2026-09-01' }, { date: '2026-09-21' }, { date: '2026-10-12' }]);
  assert.deepEqual(p.intervals, [20, 21]);
  assert.equal(p.avg, 20.5);
  assert.equal(p.rounded, 21);
  assert.equal(p.date, '2026-11-02');
  assert.equal(addDays(p.date, -2), '2026-10-31');
  const { room, ids } = demo();
  const paper = room.items.find((i) => i.name === '卷纸');
  room.items.find((i) => i.name === '卷纸').status = 'ok';
  room.meta.lastDaily = null;
  room.notifications = [];
  import('../core/daily.js').then(() => {});
  return import('../core/daily.js').then(({ runDaily }) => {
    runDaily(room, '2026-10-31T01:30:00.000Z');
    const n = room.notifications.find((x) => x.type === 'item_predict' && x.ref === paper.id);
    assert.ok(n, '10-31 应生成补货提醒');
    assert.equal(n.to, ids['周周']);
  });
});

test('T15 修订影响预览：离家门槛 3 → 7，用 T3 数据模拟 → −5.63 / +13.88 / −5.63 / −2.62，合计 0；账单不变', () => {
  const { room, ids } = demo();
  const bill = room.bills.find((b) => b.category === 'utilities');
  const before = JSON.stringify(bill.shares);
  const pv = proposalPreview(room, [{ op: 'edit', no: 2, value: 7 }], '2026-10-22T05:00:00.000Z');
  const d = Object.fromEntries(pv.utilities.rows.map((r) => [r.memberId, r.delta]));
  assert.equal(d[ids['小林']], -563);
  assert.equal(d[ids['阿杰']], 1388);
  assert.equal(d[ids['小雨']], -563);
  assert.equal(d[ids['周周']], -262);
  assert.equal(pv.utilities.total, 0);
  assert.equal(JSON.stringify(bill.shares), before);
});

test('T16 表决门槛：4 人在住 → 公约修订至少 3 人同意；大额采购除发起人外至少 2 人', () => {
  assert.equal(pactThreshold(4), 3);
  assert.equal(purchaseThreshold(4), 2);
  const { room } = demo();
  const p = room.pact.proposals[0];
  assert.equal(p.threshold, 3);
  assert.equal(p.status, 'open');
});

test('T17 提醒克制：同一事项同一天只生成 1 条；22:30 产生的提醒次日 08:00 发送', () => {
  const { room, ids } = demo();
  room.notifications = [];
  const now = '2026-10-22T14:30:00.000Z'; // 上海 22:30
  const a = notify(room, { to: ids['阿杰'], type: 'test', ref: 'x', key: 'x', text: '测试', now });
  const b = notify(room, { to: ids['阿杰'], type: 'test', ref: 'x', key: 'x', text: '测试', now });
  assert.ok(a);
  assert.equal(b, null);
  assert.equal(a.sendAt, '2026-10-23T00:00:00.000Z'); // 上海 10-23 08:00
  assert.equal(shiftQuiet('2026-10-22T13:59:00.000Z', { start: '22:00', end: '08:00' }), '2026-10-22T13:59:00.000Z');
});
