import React, { useMemo } from 'react';
import { useApp } from '../store.jsx';
import { Avatar, Btn, Empty, Tag } from '../ui.jsx';
import { fmtDateTime } from '../../core/dates.js';

const TYPE_LABEL = {
  chore_today: '值日提醒',
  chore_overdue: '值日逾期',
  chore_reassigned: '值日改派',
  chore_proxy: '代做',
  chore_help: '代做请求',
  bill_new: '新账单',
  bill_edit: '账单修改',
  bill_dispute: '账单异议',
  bill_fixed: '异议处理',
  bill_void: '账单作废',
  transfer_pending: '待确认收款',
  transfer_done: '转账完成',
  transfer_declined: '转账未确认',
  item_low: '物品补货',
  item_predict: '补货提醒',
  request_new: '采购表决',
  request_result: '采购结果',
  proposal_new: '公约表决',
  proposal_result: '公约结果',
  pact_active: '公约生效',
  vote_soon: '表决快截止',
  cycle_new: '新值日周期',
  member_join: '新成员',
  member_out: '成员退租',
  swap: '换班请求',
  swap_result: '换班回复',
  message: '室友提醒',
};

export default function Notifications() {
  const { data, act } = useApp();
  const list = data.room.notifications;
  const unread = list.filter((n) => !n.read);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const n of list) {
      const d = n.sendAt.slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(n);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <>
      <div className="card row between">
        <b>通知中心（{unread.length} 条未读）</b>
        {unread.length > 0 && <Btn small variant="subtle" onClick={() => act({ type: 'notif.read', ids: null }, { silent: true })}>全部标为已读</Btn>}
      </div>
      {list.length === 0 && <Empty title="还没有通知" />}
      {byDay.map(([d, ns]) => (
        <div key={d}>
          <div className="section-title">{d.slice(5).replace('-', '月') + '日'}<span className="line" /></div>
          {ns.map((n) => (
            <div className="card" key={n.id} style={n.read ? { opacity: 0.6 } : { borderLeft: '3px solid var(--primary)' }}>
              <div className="row between">
                <Tag tone={n.from === 'system' ? 'primary' : ''}>{n.from === 'system' ? '系统' : roomName(data, n.from)}</Tag>
                <span className="muted" style={{ fontSize: 12 }}>{fmtDateTime(n.sendAt).slice(11)}</span>
              </div>
              <div className="mt4">{n.text}</div>
              {n.reason && <div className="muted mt4" style={{ fontSize: 12 }}>{n.reason}</div>}
              <div className="row mt8">
                {!n.read && <Btn small variant="subtle" onClick={() => act({ type: 'notif.read', ids: [n.id] }, { silent: true })}>标为已读</Btn>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function roomName(data, id) {
  return data.room.members.find((m) => m.id === id)?.name || '室友';
}
