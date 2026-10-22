import React, { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar, AvatarName, Btn, Empty, Money, Sheet, Tag } from '../ui.jsx';
import { activeMembers, myTodos, netMap, settleSuggestions, memberChore, currentCycle, todayOf, fmtDateCN, CATEGORIES } from '../derive.js';
import BillForm from './forms-bill.jsx';
import RemindSheet from './RemindSheet.jsx';
import { fmtMoney } from '../../core/dates.js';

export default function Today() {
  const { data, act } = useApp();
  const { room, me, serverNow } = data;
  const today = todayOf(serverNow);
  const todos = myTodos(room, me, today);
  const nets = netMap(room);
  const settles = settleSuggestions(room);
  const cycle = currentCycle(room, today);
  const [sheet, setSheet] = useState(null);

  return (
    <>
      <div className="section-title">
        我的今天 <span className="line" />
      </div>
      {todos.length === 0 ? <Empty title="今天没有要处理的事" action={<Btn onClick={() => setSheet({ k: 'bill' })}>记一笔</Btn>} /> : null}
      {todos.map((t) => (
        <TodoRow key={t.kind + t.key} t={t} onSheet={setSheet} />
      ))}

      <div className="section-title">
        快捷入口 <span className="line" />
      </div>
      <div className="row wrap">
        <Btn small variant="ghost" onClick={() => setSheet({ k: 'bill' })}>
          记一笔
        </Btn>
        <Btn small variant="ghost" onClick={() => (location.hash = '#/chores')}>
          我出门了
        </Btn>
        <Btn small variant="ghost" onClick={() => (location.hash = '#/chores')}>
          登记访客
        </Btn>
        <Btn small variant="ghost" onClick={() => (location.hash = '#/items')}>
          登记采购
        </Btn>
      </div>

      <div className="section-title">
        公平概览 <span className="line" />
        <span className="muted">按加入顺序，不排名</span>
      </div>
      <div className="card">
        {activeMembers(room).map((m) => {
          const n = nets[m.id] || 0;
          const c = memberChore(room, cycle, m.id);
          return (
            <div className="list-line" key={m.id}>
              <Avatar name={m.name} color={m.color} />
              <div className="grow">
                <div className="row between">
                  <span>{m.name}</span>
                  <span>
                    {n > 0 ? <span className="recv">应收 {fmtMoney(n)}</span> : n < 0 ? <span>应付 {fmtMoney(-n)}</span> : <span className="muted">已结清</span>}
                  </span>
                </div>
                {c && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    家务 {c.done}/{Math.round(c.fair)} 分{c.startVal ? `（上期结转 ${c.startVal > 0 ? '+' : ''}${c.startVal}）` : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {settles.some((s) => s.from === me || s.to === me) && (
        <>
          <div className="section-title">
            结算建议 <span className="line" />
          </div>
          <div className="card">
            {settles
              .filter((s) => s.from === me || s.to === me)
              .map((s, i) => (
                <div className="list-line" key={i}>
                  <div className="grow">
                    {room.members.find((m) => m.id === s.from)?.name} 转给 {room.members.find((m) => m.id === s.to)?.name}{' '}
                    <Money cents={s.amount} />
                  </div>
                  {s.from === me && <Btn small onClick={() => setSheet({ k: 'transfer', to: room.members.find((m) => m.id === s.to), amount: s.amount })}>我已转账</Btn>}
                  {s.to === me && <Btn small variant="ghost" onClick={() => (location.hash = '#/ledger')}>等对方转</Btn>}
                </div>
              ))}
          </div>
        </>
      )}

      {sheet?.k === 'bill' && <Sheet title="记一笔" onClose={() => setSheet(null)}><BillForm onClose={() => setSheet(null)} /></Sheet>}
      {sheet?.k === 'transfer' && (
        <Sheet title="记录转账" onClose={() => setSheet(null)}>
          <TransferWrap sheet={sheet} onClose={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet?.k === 'remind' && (
        <Sheet title="提醒 TA" onClose={() => setSheet(null)}>
          <RemindSheet to={sheet.to} refId={sheet.ref} context={sheet.context} onClose={() => setSheet(null)} />
        </Sheet>
      )}
    </>
  );
}

import { TransferCreateForm } from './forms-transfer.jsx';
function TransferWrap({ sheet, onClose }) {
  return <TransferCreateForm to={sheet.to} amount={sheet.amount} onClose={onClose} />;
}

function TodoRow({ t, onSheet }) {
  const { data, act, showToast } = useApp();
  const { room, me } = data;
  const go = (h) => (location.hash = h);
  let btn = null;
  const name = (id) => room.members.find((m) => m.id === id)?.name || '';

  if (t.kind === 'chore') {
    btn = (
      <Btn
        small
        onClick={async () => {
          try {
            await act({ type: 'task.complete', id: t.task.id });
          } catch {}
        }}
      >
        {t.overdue ? '补做' : '完成'}
      </Btn>
    );
  } else if (t.kind === 'bill') {
    btn = (
      <Btn small variant="ghost" onClick={() => go('#/ledger')}>
        查看
      </Btn>
    );
  } else if (t.kind === 'dispute') {
    btn = (
      <Btn small variant="ghost" onClick={() => go('#/ledger')}>
        处理异议
      </Btn>
    );
  } else if (t.kind === 'item') {
    btn = (
      <Btn small variant="ghost" onClick={() => go('#/items')}>
        去补货
      </Btn>
    );
  } else if (t.kind === 'vote') {
    btn = (
      <Btn small variant="ghost" onClick={() => go('#/pact')}>
        表决
      </Btn>
    );
  } else if (t.kind === 'request') {
    btn = (
      <Btn small variant="ghost" onClick={() => go('#/items')}>
        表决
      </Btn>
    );
  } else if (t.kind === 'transfer') {
    btn = (
      <Btn
        small
        onClick={async () => {
          try {
            await act({ type: 'transfer.confirm', id: t.transfer.id });
          } catch {}
        }}
      >
        确认收款
      </Btn>
    );
  } else if (t.kind === 'swap') {
    btn = (
      <Btn small variant="ghost" onClick={() => go('#/chores')}>
        去处理
      </Btn>
    );
  }

  return (
    <div className="todo">
      <div className="grow">{t.text}</div>
      {btn}
    </div>
  );
}
