import React, { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { AvatarName, Btn, Empty, Field, Sheet, Tag, Seg, ConfirmButton } from '../ui.jsx';
import { activeMembers, itemInfo, itemFormula, ITEM_CATEGORIES, ITEM_STATUS, todayOf } from '../derive.js';
import { fmtShort, fmtMoney, parseMoney, addDays, isDate, fmtDateTime } from '../../core/dates.js';

export default function Items() {
  const { data, act, showToast } = useApp();
  const { room, me, serverNow } = data;
  const today = todayOf(serverNow);
  const [sheet, setSheet] = useState(null);
  const [reqOpen, setReqOpen] = useState(null);
  useEffect(() => {
    const on = (e) => setReqOpen(e.detail || {});
    window.addEventListener('hz-open-request', on);
    return () => window.removeEventListener('hz-open-request', on);
  }, []);
  const items = room.items.filter((i) => !i.deleted);
  const openReq = room.requests.filter((r) => ['open', 'approved'].includes(r.status));
  const [cat, setCat] = useState('');
  const shown = items.filter((i) => !cat || i.category === cat);

  return (
    <>
      <div className="card row between">
        <div>
          <b>公共物品</b>
          <div className="muted">登记后轮流补货，按采购间隔预测用完时间。</div>
        </div>
        <Btn small onClick={() => setSheet({ k: 'item' })}>登记物品</Btn>
      </div>

      {openReq.length > 0 && (
        <>
          <div className="section-title">
            采购预审 <span className="line" />
          </div>
          {openReq.map((r) => (
            <RequestCard key={r.id} r={r} onVote={() => setSheet({ k: 'vote', r })} />
          ))}
        </>
      )}

      <div className="chips mb8">
        <button className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}>全部</button>
        {Object.entries(ITEM_CATEGORIES).map(([v, label]) => (
          <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => setCat(v)}>{label}</button>
        ))}
      </div>

      {shown.length === 0 && <Empty title="还没有登记公共物品" action={<Btn onClick={() => setSheet({ k: 'item' })}>登记第一件</Btn>} />}
      {shown.map((item) => (
        <ItemCard key={item.id} item={item} today={today} onBuy={() => setSheet({ k: 'buy', item })} onEdit={() => setSheet({ k: 'item', item })} />
      ))}

      <div className="section-title">
        采购记录 <span className="line" />
      </div>
      <div className="card">
        {room.purchases.filter((p) => !p.voided).slice().reverse().slice(0, 20).map((p) => {
          const item = room.items.find((i) => i.id === p.itemId);
          return (
            <div className="list-line" key={p.id}>
              <div className="grow">
                {fmtShort(p.date, today)} · {item?.name || '已删除物品'} ×{p.qty}
                <div className="muted" style={{ fontSize: 12 }}>{room.members.find((m) => m.id === p.payerId)?.name} 买</div>
              </div>
              <MoneyOrZero amount={p.amount} />
              {p.unapproved && <Tag tone="amber">未预审</Tag>}
            </div>
          );
        })}
        {room.purchases.length === 0 && <Empty title="还没有采购记录" />}
      </div>

      {sheet?.k === 'item' && <ItemForm item={sheet.item} onClose={() => setSheet(null)} />}
      {sheet?.k === 'buy' && <BuyForm item={sheet.item} onClose={() => setSheet(null)} />}
      {sheet?.k === 'request' && <RequestForm item={sheet.item} onClose={() => setSheet(null)} />}
      {sheet?.k === 'vote' && <VoteSheet r={sheet.r} onClose={() => setSheet(null)} />}
      {reqOpen && (
        <RequestForm
          item={items.find((i) => i.id === reqOpen.itemId) || null}
          initialAmount={reqOpen.amount}
          onClose={() => setReqOpen(null)}
        />
      )}
    </>
  );
}

function RequestForm({ item, initialAmount, onClose }) {
  const { data, act, showToast } = useApp();
  const [f, setF] = useState({ itemName: item?.name || '', amountText: initialAmount != null ? String(initialAmount / 100) : '', reason: '' });
  const amount = parseMoney(f.amountText);
  return (
    <Sheet title="大额采购预审" onClose={onClose}>
      <p className="muted">按公约第 4 条，达到预审金额的公共采购先表决，48 小时内除发起人外过半同意即通过。</p>
      <Field label="要买的东西"><input className="input" maxLength={20} disabled={!!item} value={f.itemName} onChange={(e) => setF({ ...f, itemName: e.target.value })} /></Field>
      <Field label="预计金额（元）"><input className="input" inputMode="decimal" value={f.amountText} onChange={(e) => setF({ ...f, amountText: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      <Field label="理由"><textarea className="textarea" maxLength={100} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>取消</Btn>
        <Btn
          disabled={amount == null || !f.itemName.trim() || !f.reason.trim()}
          onClick={async () => {
            try {
              await act({ type: 'request.create', itemId: item?.id || null, itemName: f.itemName.trim(), amount, reason: f.reason.trim() });
              onClose();
            } catch {}
          }}
        >发起申请</Btn>
      </div>
    </Sheet>
  );
}

function MoneyOrZero({ amount }) {
  return amount ? <span className="money">{fmtMoney(amount)}</span> : <span className="muted">历史</span>;
}

function ItemCard({ item, today, onBuy, onEdit }) {
  const { data, act } = useApp();
  const { room } = data;
  const info = itemInfo(room, item, today);
  const statusTag = { ok: <Tag tone="green">充足</Tag>, low: <Tag tone="amber">快用完</Tag>, out: <Tag tone="red">已用完</Tag> }[item.status];
  const buyer = room.members.find((m) => m.id === info.buyer?.id);
  const dueSoon = info.prediction && info.prediction.date <= addDays(today, 7);
  return (
    <div className="card">
      <div className="row between">
        <div className="grow">
          <b>{item.name}</b> {statusTag}
          <div className="muted" style={{ fontSize: 12 }}>
            {ITEM_CATEGORIES[item.category]}{item.location ? ` · ${item.location}` : ''}
          </div>
        </div>
        <Seg
          value={item.status}
          onChange={(v) => act({ type: 'item.setStatus', id: item.id, status: v })}
          options={[
            { value: 'ok', label: '充足' },
            { value: 'low', label: '快用完' },
            { value: 'out', label: '用完' },
          ]}
        />
      </div>
      <div className="muted mt8" style={{ fontSize: 13 }}>
        {info.prediction ? (
          <>
            最近 {info.purchases.length} 次：{fmtShort(info.purchases[0].date, today)} 等，间隔 {info.prediction.intervals.join('、')} 天，预计
            <b className={dueSoon ? '' : ''}> {fmtShort(info.prediction.date, today)} </b>
            用完
            {buyer && <>；下一位采购人：{buyer.name}</>}
          </>
        ) : (
          <>至少登记 2 次采购后预测用完时间；{buyer ? <>下一位采购人：{buyer.name}</> : '还没有采购人'}</>
        )}
      </div>
      <details className="f">
        <summary>怎么算的</summary>
        <pre className="formula">{itemFormula(info)}</pre>
      </details>
      <div className="row mt8">
        <Btn small onClick={onBuy}>登记采购</Btn>
        <Btn small variant="subtle" onClick={onEdit}>编辑</Btn>
      </div>
    </div>
  );
}

function ItemForm({ item, onClose }) {
  const { data, act } = useApp();
  const members = activeMembers(data.room);
  const [f, setF] = useState(() => ({
    name: item?.name || '',
    category: item?.category || 'cleaning',
    location: item?.location || '',
    restock: item?.restock || 'rotate',
    fixedMemberId: item?.fixedMemberId || members[0]?.id,
  }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Sheet title={item ? '编辑物品' : '登记公共物品'} onClose={onClose}>
      <Field label="名称"><input className="input" maxLength={20} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="类别">
        <Seg value={f.category} onChange={(v) => set('category', v)} options={Object.entries(ITEM_CATEGORIES).map(([v, label]) => ({ value: v, label }))} />
      </Field>
      <Field label="存放位置（可选）"><input className="input" maxLength={20} value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
      <Field label="补货方式">
        <Seg value={f.restock} onChange={(v) => set('restock', v)} options={[{ value: 'rotate', label: '轮流（采购最少的人）' }, { value: 'fixed', label: '指定某人' }]} />
      </Field>
      {f.restock === 'fixed' && (
        <Field label="补货人">
          <select className="select" value={f.fixedMemberId} onChange={(e) => set('fixedMemberId', e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      )}
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>取消</Btn>
        <Btn
          onClick={async () => {
            try {
              await act({ type: item ? 'item.update' : 'item.create', ...(item ? { id: item.id, baseVersion: item.version } : {}), ...f });
              onClose();
            } catch {}
          }}
        >保存</Btn>
        {item && (
          <ConfirmButton
            className="btn small"
            onClick={async () => {
              try {
                await act({ type: 'item.delete', id: item.id });
                onClose();
              } catch {}
            }}
          >删除</ConfirmButton>
        )}
      </div>
    </Sheet>
  );
}

function BuyForm({ item, onClose }) {
  const { data, act } = useApp();
  const { room, me, serverNow } = data;
  const today = todayOf(serverNow);
  const members = activeMembers(room);
  const threshold = room.pact.versions.filter((v) => v.status === 'active').slice(-1)[0];
  const approval = threshold ? threshold.clauses.find((c) => c.key === 'purchaseApprovalCents')?.value : 10000;
  const [f, setF] = useState({ qty: 1, amountText: '', payerId: me, date: today, note: '', requestId: '' });
  const approved = room.requests.find((r) => r.status === 'approved' && r.itemId === item.id && !r.usedBy);
  const amount = parseMoney(f.amountText);
  const needApproval = amount != null && amount >= approval && !approved && f.requestId !== 'skip';
  return (
    <Sheet title={`登记采购：${item.name}`} onClose={onClose}>
      <div className="row">
        <Field label="数量"><input type="number" className="input" min={1} max={999} value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
        <Field label="金额（元）"><input className="input" inputMode="decimal" value={f.amountText} onChange={(e) => setF({ ...f, amountText: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      </div>
      <Field label="付款人">
        <select className="select" value={f.payerId} onChange={(e) => setF({ ...f, payerId: e.target.value })}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="采购日期"><input type="date" className="input" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="备注（可选）"><input className="input" maxLength={100} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {needApproval && (
        <div className="banner warn">
          这笔达到公约预审金额（{fmtMoney(approval)}）。可以先发起采购申请；不预审也能保存，但会标记“未预审”，其他室友可以提出异议。
        </div>
      )}
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>取消</Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent('hz-open-request', { detail: { itemId: item.id, amount } }));
          }}
        >先申请</Btn>
        <Btn
          disabled={amount == null || f.qty < 1 || !isDate(f.date)}
          onClick={async () => {
            try {
              await act({
                type: 'purchase.create',
                itemId: item.id,
                qty: f.qty,
                amount,
                payerId: f.payerId,
                date: f.date,
                note: f.note || undefined,
                participants: members.map((m) => m.id),
                method: 'equal',
              });
              onClose();
            } catch {}
          }}
        >保存{needApproval ? '（未预审）' : ''}</Btn>
      </div>
    </Sheet>
  );
}

function RequestCard({ r, onVote }) {
  const { data } = useApp();
  const { room, me } = data;
  const myVote = r.votes[me];
  const yes = Object.values(r.votes).filter((v) => v === 'yes').length;
  const no = Object.values(r.votes).filter((v) => v === 'no').length;
  const canVote = r.status === 'open' && r.eligible.includes(me) && !(me in r.votes);
  return (
    <div className="card">
      <div className="row between">
        <b>{r.itemName}</b>
        <Money cents={r.amount} />
      </div>
      <div className="muted">{room.members.find((m) => m.id === r.by)?.name} 发起 · 理由：{r.reason}</div>
      <div className="muted">同意 {yes} · 反对 {no} · 需要除发起人外 {r.threshold} 人同意</div>
      {r.status === 'approved' && <Tag tone="green">已通过，可以买了</Tag>}
      {canVote && <Btn small className="mt8" onClick={onVote}>去表决</Btn>}
      {myVote && <div className="muted mt8">你已投：{myVote === 'yes' ? '同意' : '反对'}</div>}
    </div>
  );
}

function VoteSheet({ r, onClose }) {
  const { act } = useApp();
  return (
    <Sheet title={`采购申请：${r.itemName}`} onClose={onClose}>
      <div className="card" style={{ background: 'var(--bg)' }}>
        <div>预计金额：{fmtMoney(r.amount)}</div>
        <div className="muted">理由：{r.reason}</div>
      </div>
      <p className="muted">有人反对即不通过；48 小时内同意人数不够则过期。</p>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>再想想</Btn>
        <Btn variant="subtle" onClick={async () => { try { await act({ type: 'request.vote', id: r.id, vote: 'no' }); onClose(); } catch {} }}>反对</Btn>
        <Btn onClick={async () => { try { await act({ type: 'request.vote', id: r.id, vote: 'yes' }); onClose(); } catch {} }}>同意</Btn>
      </div>
    </Sheet>
  );
}
