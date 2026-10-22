import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from './store.jsx';
import Welcome from './pages/Welcome.jsx';
import Today from './pages/Today.jsx';
import Ledger from './pages/Ledger.jsx';
import Chores from './pages/Chores.jsx';
import Items from './pages/Items.jsx';
import Pact from './pages/Pact.jsx';
import Settings from './pages/Settings.jsx';
import Notifications from './pages/Notifications.jsx';
import { Avatar, Btn } from './ui.jsx';
import { STATIC } from './api.js';
import { visibleNotifs } from './../core/notify.js';

const NAV = [
  { hash: '#/today', label: '今天', icon: 'M5 4h14v3H5zm0 5h14v11H5z M9 12h6' },
  { hash: '#/ledger', label: '账本', icon: 'M6 4h9l3 3v13H6z M9 11h6M9 15h6' },
  { hash: '#/chores', label: '值日', icon: 'M7 20l4-10 4 10M8 14h6M6 7h12' },
  { hash: '#/items', label: '物品', icon: 'M5 8h14l-1 12H6z M9 8a3 3 0 0 1 6 0' },
  { hash: '#/pact', label: '公约', icon: 'M7 4h10v16H7z M10 8h4M10 12h4M10 16h2' },
];

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function IdentitySwitch({ onSelect }) {
  const { data, act, showToast, api } = useApp();
  const { room, me } = data;
  const mine = room.members.find((m) => m.id === me);
  if (!room.demo && !STATIC) return null;
  const change = async (id) => {
    if (id === me) return;
    if (room.demo && api.switchDemo) {
      try {
        const r = await api.switchDemo(room.id, id);
        window.location.hash = '#/today';
        window.location.reload();
      } catch (e) {
        showToast(e.message, 'err');
      }
    } else if (api.addLocalMember) {
      const r = await api.switchDemo(room.id, id);
      window.location.hash = '#/today';
      window.location.reload();
    }
  };
  return (
    <select
      className="select"
      style={{ width: 'auto', minHeight: 34, padding: '4px 8px', fontSize: 13 }}
      value={me}
      onChange={(e) => change(e.target.value)}
      aria-label="切换演示身份"
    >
      {room.members
        .filter((m) => m.status === 'active')
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}视角
          </option>
        ))}
    </select>
  );
}

function Shell() {
  const { data, leaveRoom, memberships } = useApp();
  const { room, me, serverNow } = data;
  const [hash, setHash] = useState(() => (location.hash && location.hash !== '#' ? location.hash : '#/today'));
  useEffect(() => {
    const on = () => setHash(location.hash || '#/today');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const notifs = useMemo(() => visibleNotifs(room, me, serverNow).filter((n) => !n.read), [room, me, serverNow]);
  const mine = room.members.find((m) => m.id === me);
  const active = NAV.find((n) => hash.startsWith(n.hash.replace('#/', '#/'))) || NAV[0];

  const go = (h) => {
    location.hash = h;
    setHash(h);
  };

  let Page = Today;
  if (hash.startsWith('#/ledger')) Page = Ledger;
  else if (hash.startsWith('#/chores')) Page = Chores;
  else if (hash.startsWith('#/items')) Page = Items;
  else if (hash.startsWith('#/pact')) Page = Pact;
  else if (hash.startsWith('#/settings')) Page = Settings;
  else if (hash.startsWith('#/notifications')) Page = Notifications;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2317775F'/%3E%3Cpath d='M16 7 6 15.5h3V24h6v-5h2v5h6v-8.5h3z' fill='%23fff'/%3E%3C/svg%3E" alt="" />
          合租管家
        </div>
        {NAV.map((n) => (
          <a key={n.hash} href={n.hash} className={hash.startsWith(n.hash) ? 'active' : ''}>
            <Icon d={n.icon} />
            {n.label}
          </a>
        ))}
        <div className="side-bottom">
          <a href="#/notifications" className={hash.startsWith('#/notifications') ? 'active' : ''}>
            <Icon d="M12 3a6 6 0 0 0-6 6v4l-2 4h16l-2-4V9a6 6 0 0 0-6-6z M10 20a2 2 0 0 0 4 0" />
            通知{notifs.length ? `（${notifs.length}）` : ''}
          </a>
          <a href="#/settings" className={hash.startsWith('#/settings') ? 'active' : ''}>
            <Icon d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 20c0-3 4-4 8-4s8 1 8 4" />
            设置
          </a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="room-name">{room.name}</span>
          <span className="spacer" />
          {(room.demo || STATIC) && <IdentitySwitch />}
          <a href="#/notifications" className="btn subtle small" style={{ position: 'relative' }} aria-label={`通知 ${notifs.length} 条未读`}>
            <Icon d="M12 3a6 6 0 0 0-6 6v4l-2 4h16l-2-4V9a6 6 0 0 0-6-6z M10 20a2 2 0 0 0 4 0" />
            {notifs.length > 0 && (
              <span style={{ position: 'absolute', top: -5, right: -5, background: '#c62828', color: '#fff', borderRadius: 999, fontSize: 11, padding: '0 5px', minWidth: 16 }}>{notifs.length}</span>
            )}
          </a>
        </header>
        <main className="content">
          {(room.demo || STATIC) && (
            <div className="banner warn">
              {STATIC
                ? '纯前端演示版：数据只保存在这台设备的浏览器里，室友之间不同步、没有 AI；当前演示数据是虚构的，可随便点。多人完整版：yuhaipei.cn/hezuguanjia/'
                : '演示房间：数据是虚构的，可随便点；7 天没有操作会自动清空。'}
            </div>
          )}
          <Page />
        </main>
      </div>
      <nav className="bottomnav">
        {NAV.map((n) => (
          <a key={n.hash} href={n.hash} className={hash.startsWith(n.hash) ? 'active' : ''}>
            <Icon d={n.icon} />
            {n.label}
            {n.hash === '#/today' && notifs.length > 0 && <i style={{ fontStyle: 'normal', color: '#c62828', fontSize: 10 }}>·</i>}
          </a>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const { boot, data } = useApp();
  if (boot === 'loading') return <div className="splash">正在打开…</div>;
  return data ? <Shell /> : <Welcome />;
}
