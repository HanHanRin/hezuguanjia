import React, { useState } from 'react';
import { useApp } from '../store.jsx';
import { Btn, Field, Seg } from '../ui.jsx';

/** “提醒 TA”：AI 改写成平和提醒；不匿名、不自动发送。 */
export default function RemindSheet({ to, refId, context, onClose }) {
  const { data, act, api, showToast } = useApp();
  const { room, me } = data;
  const [text, setText] = useState('');
  const [tone, setTone] = useState('direct');
  const [out, setOut] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const member = room.members.find((m) => m.id === to);
  const clauses = [];
  for (const v of room.pact.versions) {
    if (v.status === 'active' || v.status === 'draft') clauses.push(...v.clauses);
  }
  async function rewrite() {
    if (!text.trim()) return showToast('先写下你想说的话', 'err');
    setAiBusy(true);
    try {
      const r = await api.ai(room.id, 'rewrite', { to, text, ref: refId || null, context: context || '' });
      setOut(r);
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setAiBusy(false);
    }
  }
  async function send() {
    const body = out ? out[tone] : text.trim();
    if (!body) return;
    try {
      const r = await act({ type: 'message.send', to, ref: refId, text: body });
      showToast(r.delayed ? '已排到明早发送' : '已发送');
      onClose();
    } catch {
      /* 已提示 */
    }
  }
  return (
    <>
      <div className="muted mb8">
        以你（{me.name}）的名义发给 {member?.name}；不提供匿名。AI 只帮你把话说得更平和，不会自动发送。
      </div>
      <Field label="想说的话（可以很冲）">
        <textarea className="textarea" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：水槽里的碗怎么又放了两天……" />
      </Field>
      {data.ai?.available ? (
        <Btn small variant="ghost" disabled={aiBusy || !text.trim()} onClick={rewrite}>
          {aiBusy ? '改写中…' : '帮我改得平和一点'}
        </Btn>
      ) : (
        <div className="hint">这个房间没有开 AI，可以直接编辑后发送。</div>
      )}
      {out && (
        <div className="mt8">
          <Field label="选一个版本（可以直接改）">
            <Seg value={tone} onChange={setTone} options={[{ value: 'direct', label: '直接' }, { value: 'casual', label: '轻松' }]} />
          </Field>
          <textarea className="textarea" value={out[tone]} maxLength={200} onChange={(e) => setOut({ ...out, [tone]: e.target.value })} />
          <div className="hint">同一事项每天只提醒 1 次；22:00–08:00 的提醒会排到明早。</div>
        </div>
      )}
      <div className="btn-row mt16">
        <Btn variant="subtle" onClick={onClose}>
          取消
        </Btn>
        <Btn onClick={send} disabled={!text.trim() && !out}>
          发送提醒
        </Btn>
      </div>
    </>
  );
}
