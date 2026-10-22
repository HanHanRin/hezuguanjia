// 余额与结算建议。

/**
 * 余额 = 我付出的账单总额 − 我应摊的总额 + 我已确认转出的金额 − 我已确认收到的金额
 * 只统计“正常”状态的账单；有异议、已作废的不计入。
 */
export function balances(room) {
  const rows = {};
  for (const m of room.members) rows[m.id] = { paid: 0, owed: 0, sent: 0, recv: 0, net: 0 };
  for (const b of room.bills) {
    if (b.status !== 'normal') continue;
    if (rows[b.payerId]) rows[b.payerId].paid += b.amount;
    for (const s of b.shares) if (rows[s.memberId]) rows[s.memberId].owed += s.amount;
  }
  for (const t of room.transfers) {
    if (t.status !== 'confirmed') continue;
    if (rows[t.from]) rows[t.from].sent += t.amount;
    if (rows[t.to]) rows[t.to].recv += t.amount;
  }
  for (const id of Object.keys(rows)) {
    const r = rows[id];
    r.net = r.paid - r.owed + r.sent - r.recv;
  }
  return rows;
}

/**
 * 结算建议：每次让应付最多的人转给应收最多的人，金额取两者中较小的绝对值，
 * 直到全部为 0；平局按加入顺序。转账笔数不超过“人数 − 1”。
 */
export function settlePlan(netById, orderOf) {
  const bal = { ...netById };
  const out = [];
  for (let guard = 0; guard < 200; guard++) {
    const pos = Object.keys(bal)
      .filter((id) => bal[id] > 0)
      .sort((a, b) => bal[b] - bal[a] || orderOf(a) - orderOf(b));
    const neg = Object.keys(bal)
      .filter((id) => bal[id] < 0)
      .sort((a, b) => bal[a] - bal[b] || orderOf(a) - orderOf(b));
    if (!pos.length || !neg.length) break;
    const c = pos[0];
    const d = neg[0];
    const amt = Math.min(bal[c], -bal[d]);
    out.push({ from: d, to: c, amount: amt });
    bal[c] -= amt;
    bal[d] += amt;
  }
  return out;
}

export function netMap(room) {
  const b = balances(room);
  const o = {};
  for (const id of Object.keys(b)) o[id] = b[id].net;
  return o;
}
