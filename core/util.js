// 通用小工具：错误类型、ID 生成、成员查询。

export class ActionError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

export function fail(message, code) {
  throw new ActionError(message, code);
}

/** 房间内自增 ID，前缀区分实体类型。 */
export function nid(room, prefix) {
  room.seq = (room.seq || 0) + 1;
  return prefix + room.seq.toString(36);
}

export function memberOf(room, id) {
  return room.members.find((m) => m.id === id) || null;
}

export function nameOf(room, id) {
  return memberOf(room, id)?.name ?? '已移除的成员';
}

/** 返回按加入顺序比较用的函数：orderOf(id) -> 加入顺序。 */
export function orderFn(room) {
  const map = new Map(room.members.map((m) => [m.id, m.order]));
  return (id) => map.get(id) ?? 999;
}

/** 某天是否在住（未退租、已入住、未过退租日）。 */
export function inResidence(m, date) {
  return !!m && m.status === 'active' && m.moveIn <= date && (!m.moveOut || date <= m.moveOut);
}

/** 某天在住的成员，按加入顺序。 */
export function residents(room, date) {
  return room.members.filter((m) => inResidence(m, date)).sort((a, b) => a.order - b.order);
}
