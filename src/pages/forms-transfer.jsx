import React, { useState } from 'react';
import { useApp } from '../store.jsx';
import { Btn, Field } from '../ui.jsx';
import { fmtMoney, parseMoney } from '../../core/dates.js';
import { activeMembers } from '../derive.js';

/** “我已转账” */
export function TransferCreateForm({ to, amount, onClose }) {
  const { data, act } = useApp();
  const members = activeMembers(data.room);
  const [f, setF] = useState({ to: to?.id || '', amountText: amount != null ? String(amount / 100) : '', note: '' });
  const money = parseMoney(f.amountText);
  async function save() {
    try {
      await act({ type: 'transfer.create', to: f.to, amount: money, note: f.note || undefined });
      onClose();
    } catch {
      /* 已提示 */
    }
  }
  return (
    <>
      <Field label="转给谁">
        <select className="select" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
          <option value="">请选择</option>
          {members
            .filter((m) => m.id !== data.me)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="金额（元）">
        <input className="input" inputMode="decimal" value={f.amountText} onChange={(e) => setF({ ...f, amountText: e.target.value.replace(/[^\d.]/g, '') })} />
      </Field>
      <Field label="备注（可选）">
        <input className="input" maxLength={40} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <div className="hint mb8">应用不处理真实支付，只记录；对方确认后余额才更新。</div>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>
          取消
        </Btn>
        <Btn disabled={!f.to || money == null || money <= 0} onClick={save}>
          我已转账
        </Btn>
      </div>
    </>
  );
}

/** “我收到现金了”（收款人直接记录） */
export function TransferReceiveForm({ from, amount, onClose }) {
  const { data, act } = useApp();
  const members = activeMembers(data.room);
  const [f, setF] = useState({ from: from?.id || '', amountText: amount != null ? String(amount / 100) : '', note: '' });
  const money = parseMoney(f.amountText);
  async function save() {
    try {
      await act({ type: 'transfer.receive', from: f.from, amount: money, note: f.note || undefined });
      onClose();
    } catch {
      /* 已提示 */
    }
  }
  return (
    <>
      <Field label="谁转给你的">
        <select className="select" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
          <option value="">请选择</option>
          {members
            .filter((m) => m.id !== data.me)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="收到的金额（元）">
        <input className="input" inputMode="decimal" value={f.amountText} onChange={(e) => setF({ ...f, amountText: e.target.value.replace(/[^\d.]/g, '') })} />
      </Field>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>
          取消
        </Btn>
        <Btn disabled={!f.from || money == null || money <= 0} onClick={save}>
          记录已收到
        </Btn>
      </div>
    </>
  );
}

/** 待确认的转账 */
export function PendingTransferCard({ t }) {
  const { data, act } = useApp();
  const { room, me } = data;
  const name = (id) => room.members.find((m) => m.id === id)?.name || '成员';
  const mineTo = t.to === me;
  return (
    <div className="card">
      <div className="row between">
        <div>
          {name(t.from)} → {name(t.to)}
          <div className="money" style={{ marginLeft: 8 }}>
            {fmtMoney(t.amount)}
          </div>
          <div className="muted">待确认 · {t.note || ''}</div>
        </div>
        <span className="tag amber">待确认</span>
      </div>
      <div className="btn-row mt8">
        {mineTo ? (
          <>
            <Btn
              small
              onClick={async () => {
                try {
                  await act({ type: 'transfer.confirm', id: t.id });
                } catch {}
              }}
            >
              确认收到
            </Btn>
            <Btn
              small
              variant="subtle"
              onClick={async () => {
                try {
                  await act({ type: 'transfer.decline', id: t.id });
                } catch {}
              }}
            >
              没收到
            </Btn>
          </>
        ) : (
          <Btn
            small
            variant="subtle"
            onClick={async () => {
              try {
                await act({ type: 'transfer.cancel', id: t.id });
              } catch {}
            }}
          >
            撤回
          </Btn>
        )}
      </div>
    </div>
  );
}
