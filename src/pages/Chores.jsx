import React, { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { AvatarName, Btn, Empty, Sheet, Tag, Seg, Field } from '../ui.jsx';
import { activeMembers, currentCycle, cycleMembers, memberChore, weekTasks, memberColor, todayOf, fmtDateCN } from '../derive.js';
import { addDays, fmtShort, isDate, daysIncl } from '../../core/dates.js';
import { tasksOf, templatesFor } from '../../core/cycles.js';

export default function Chores() {
  const { data, act } = useApp();
  const { room, me, serverNow } = data;
  const today = todayOf(serverNow);
  const cycle = currentCycle(room, today);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(today + 'T00:00:00Z').getUTCDay();
    return addDays(today, d === 0 ? -6 : 1 - d);
  });
  const [sheet, setSheet] = useState(null);
  const tasks = cycle ? tasksOf(room, cycle.id) : [];
  const week = weekTasks(room, cycle, weekStart);

  return (
    <>
      <div className="card row between">
        <div>
          <b>值日排班</b>
          <div className="muted">{cycle ? `${fmtDateCN(cycle.start, today)} 起 28 天` : '还没有值日周期'}</div>
        </div>
        <Btn small onClick={() => setSheet({ k: 'away' })}>
          我出门了
        </Btn>
      </div>

      {!cycle ? (
        <Empty title="还没有值日周期" action={<Btn onClick={() => act({ type: 'cycle.generate' })}>生成本周期</Btn>}>
          生成前先添加几项家务模板。
        </Empty>
      ) : (
        <>
          <div className="row between mb8">
            <Btn small variant="subtle" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              上一周
            </Btn>
            <b>{fmtShort(weekStart, today)} – {fmtShort(addDays(weekStart, 6), today)}</b>
            <Btn small variant="subtle" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              下一周
            </Btn>
          </div>
          <div className="week">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const d = addDays(weekStart, i);
              return (
                <div className="day" key={d} style={d === today ? { borderColor: 'var(--primary)' } : undefined}>
                  <span className="dn">{fmtShort(d, today).replace(' ', '\n')}</span>
                  {(week[d] || []).map((t) => (
                    <button
                      key={t.id}
                      className={'taskpill ' + t.status}
                      style={{ background: memberColor(room, t.assigneeId) + '55' }}
                      onClick={() => setSheet({ k: 'task', task: t })}
                      title={`${t.name} · ${room.members.find((m) => m.id === t.assigneeId)?.name}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="section-title">
            我的任务 <span className="line" />
          </div>
          <div className="card">
            {tasks.filter((t) => t.assigneeId === me && t.date >= addDays(today, -3)).slice(0, 12).map((t) => (
              <TaskLine key={t.id} t={t} onOpen={() => setSheet({ k: 'task', task: t })} />
            ))}
          </div>

          <div className="section-title">
            家务积分（已完成 / 应得） <span className="line" />
          </div>
          <div className="card">
            {cycleMembers(room, cycle).map((m) => {
              const c = memberChore(room, cycle, m.id);
              return (
                <div className="list-line" key={m.id}>
                  <AvatarName room={room} id={m.id} />
                  <span className="grow" />
                  <span className="money">{c.done} / {Math.round(c.fair)}</span>
                  <Tag tone={c.missed ? 'amber' : ''}>{c.missed ? `漏做 ${c.missed}` : c.pending ? `待做 ${c.pending}` : '正常'}</Tag>
                </div>
              );
            })}
            <div className="muted mt8">
              应得按在住权重（{cycle.params.awayMinDays} 天以上离家不排）；漏做、代做的差额结转到下个周期。
            </div>
          </div>
        </>
      )}

      <div className="section-title">
        家务模板与登记 <span className="line" />
      </div>
      <div className="row wrap mb8">
        <Btn small variant="ghost" onClick={() => setSheet({ k: 'tpl' })}>
          管理家务模板
        </Btn>
        <Btn small variant="ghost" onClick={() => setSheet({ k: 'awayList' })}>
          离家记录
        </Btn>
        <Btn small variant="ghost" onClick={() => setSheet({ k: 'guest' })}>
          登记访客
        </Btn>
      </div>

      {sheet?.k === 'task' && <TaskSheet t={sheet.task} onClose={() => setSheet(null)} />}
      {sheet?.k === 'away' && <AwaySheet onClose={() => setSheet(null)} />}
      {sheet?.k === 'guest' && <GuestSheet onClose={() => setSheet(null)} />}
      {sheet?.k === 'awayList' && <AwayListSheet onClose={() => setSheet(null)} onAway={() => setSheet({ k: 'away' })} />}
      {sheet?.k === 'tpl' && <TemplateSheet onClose={() => setSheet(null)} />}
    </>
  );
}

function TaskLine({ t, onOpen }) {
  const { data } = useApp();
  const { room } = data;
  const owner = room.members.find((m) => m.id === t.assigneeId);
  return (
    <div className="list-line" onClick={onOpen} style={{ cursor: 'pointer' }}>
      <div className="grow">
        {fmtDateCN(t.date)} · {t.name}
        <div className="muted" style={{ fontSize: 12 }}>负责人 {owner?.name} · {t.points} 分</div>
      </div>
      <Tag tone={t.status === 'done' ? 'green' : t.status === 'overdue' ? 'red' : ''}>{t.status === 'done' ? (t.late ? '已完成（逾期）' : '已完成') : t.status === 'overdue' ? '已逾期' : '待完成'}</Tag>
    </div>
  );
}

function TaskSheet({ t, onClose }) {
  const { data, act } = useApp();
  const { room, me, today } = data;
  const owner = room.members.find((m) => m.id === t.assigneeId);
  const mine = t.assigneeId === me;
  return (
    <Sheet title={t.name} onClose={onClose}>
      <div className="muted mb8">
        {fmtDateCN(t.date)} · {t.points} 分 · 负责人 {owner?.name}
      </div>
      <div className="card" style={{ background: 'var(--bg)' }}>
        完成标准：{room.templates.find((x) => x.id === t.templateId)?.standard || '按大家认可的标准'}
      </div>
      <div className="btn-row mt16">
        {t.status === 'done' ? (
          <Tag tone="green">{t.doneBy === t.assigneeId ? '已完成' : `${room.members.find((m) => m.id === t.doneBy)?.name} 代做`}</Tag>
        ) : (
          <>
            <Btn
              onClick={async () => {
                try {
                  await act({ type: 'task.complete', id: t.id });
                  onClose();
                } catch {}
              }}
            >
              {t.status === 'overdue' ? '补做完成' : '完成'}
            </Btn>
            {mine && (
              <Btn variant="ghost" onClick={() => act({ type: 'task.askHelp', id: t.id })}>
                找人代做
              </Btn>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function AwaySheet({ onClose }) {
  const [f, setF] = useState({ start: '', end: '' });
  const { act } = useApp();
  return (
    <Sheet title="登记离家" onClose={onClose}>
      <p className="muted">只填日期，不要求说明原因。连续离家达到公约门槛（当前周期的值日和水电会按规则调整）。</p>
      <div className="row">
        <Field label="开始日期">
          <input type="date" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        </Field>
        <Field label="结束日期">
          <input type="date" className="input" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        </Field>
      </div>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>取消</Btn>
        <Btn
          disabled={!isDate(f.start) || !isDate(f.end) || f.end < f.start}
          onClick={async () => {
            try {
              const r = await act({ type: 'away.create', ...f });
              onClose();
            } catch {}
          }}
        >
          保存
        </Btn>
      </div>
    </Sheet>
  );
}

function GuestSheet({ onClose }) {
  const [f, setF] = useState({ date: todayOf(new Date().toISOString()), nights: 1, note: '' });
  const { act } = useApp();
  return (
    <Sheet title="登记访客过夜" onClose={onClose}>
      <p className="muted">公约：每个计费周期免费 4 晚，超出的晚数按 1 人天计入你的水电分摊。</p>
      <Field label="第一晚日期"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="住几晚"><input type="number" className="input" min={1} max={31} value={f.nights} onChange={(e) => setF({ ...f, nights: Number(e.target.value) })} /></Field>
      <Field label="备注（可选）"><input className="input" maxLength={30} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>取消</Btn>
        <Btn onClick={async () => { try { await act({ type: 'guest.create', ...f }); onClose(); } catch {} }}>保存</Btn>
      </div>
    </Sheet>
  );
}

function AwayListSheet({ onClose, onAway }) {
  const { data, act } = useApp();
  const { room, me } = data;
  const list = room.aways.filter((a) => a.memberId === me).sort((a, b) => (a.start < b.start ? 1 : -1));
  return (
    <Sheet title="我的离家记录" onClose={onClose}>
      <Btn small onClick={onAway}>新增离家</Btn>
      <div className="mt8">
        {list.length === 0 && <Empty title="还没有离家记录" />}
        {list.map((a) => (
          <div className="list-line" key={a.id}>
            <div className="grow">{fmtShort(a.start)} – {fmtShort(a.end)}（{daysIncl(a.start, a.end)} 天）</div>
            <Btn small variant="subtle" onClick={() => act({ type: 'away.delete', id: a.id })}>删除</Btn>
          </div>
        ))}
      </div>
      <div className="hint">删除后已改派的值日不会自动换回。</div>
    </Sheet>
  );
}

function TemplateSheet({ onClose }) {
  const { data, act } = useApp();
  const { room } = data;
  const list = room.templates.filter((t) => !t.deleted).sort((a, b) => a.order - b.order);
  const [f, setF] = useState(null);
  return (
    <Sheet title="家务模板" onClose={onClose}>
      <div className="btn-row mb8">
        <Btn small onClick={() => setF({ name: '', area: '', points: 2, standard: '', freq: { type: 'weekly', days: [1] } })}>新增家务</Btn>
        {!room.templates.length && <Btn small variant="ghost" onClick={() => act({ type: 'template.addRecommended' })}>添加推荐 4 项</Btn>}
      </div>
      {list.map((t) => (
        <div className="list-line" key={t.id}>
          <div className="grow">
            {t.name} <Tag>{t.points} 分</Tag>
            <div className="muted" style={{ fontSize: 12 }}>{t.area} · {freqLabel(t.freq)}</div>
          </div>
        </div>
      ))}
      {f && (
        <div className="card" style={{ background: 'var(--bg)' }}>
          <Field label="名称"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="区域"><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></Field>
          <Field label="积分（代表工作量，1–5）"><input type="number" className="input" min={1} max={5} value={f.points} onChange={(e) => setF({ ...f, points: Number(e.target.value) })} /></Field>
          <Field label="频率">
            <Seg value={f.freq.type} onChange={(v) => setF({ ...f, freq: v === 'daily' ? { type: 'daily' } : v === 'everyN' ? { type: 'everyN', n: 2 } : { type: 'weekly', days: [1] } })} options={[{ value: 'daily', label: '每天' }, { value: 'everyN', label: '每 N 天' }, { value: 'weekly', label: '每周几' }]} />
          </Field>
          {f.freq.type === 'everyN' && <Field label="每隔几天"><input type="number" className="input" min={2} max={14} value={f.freq.n} onChange={(e) => setF({ ...f, freq: { type: 'everyN', n: Number(e.target.value) } })} /></Field>}
          {f.freq.type === 'weekly' && (
            <div className="chips">
              {['一', '二', '三', '四', '五', '六', '日'].map((x, i) => {
                const d = i + 1;
                const on = f.freq.days.includes(d);
                return <button key={d} type="button" className={'chip' + (on ? ' on' : '')} onClick={() => setF({ ...f, freq: { ...f.freq, days: on ? f.freq.days.filter((v) => v !== d) : [...f.freq.days, d] } })}>周{x}</button>;
              })}
            </div>
          )}
          <Field label="完成标准"><textarea className="textarea" value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value })} /></Field>
          <div className="btn-row">
            <Btn variant="subtle" onClick={() => setF(null)}>取消</Btn>
            <Btn onClick={async () => { try { await act({ type: 'template.create', ...f }); setF(null); } catch {} }}>保存（下周期生效）</Btn>
          </div>
        </div>
      )}
      <div className="hint">模板的新增和修改都从下一个值日周期开始，本周期不变。</div>
    </Sheet>
  );
}

function freqLabel(f) {
  if (f.type === 'daily') return '每天';
  if (f.type === 'everyN') return `每 ${f.n} 天`;
  return '每' + f.days.map((d) => ['', '一', '二', '三', '四', '五', '六', '日'][d]).map((x) => '周' + x).join('、');
}
