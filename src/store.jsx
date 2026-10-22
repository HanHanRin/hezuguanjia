import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api, STATIC } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function hashRoom() {
  const m = /#\/room\/([A-Za-z0-9_-]+)(?:\/(.+))?/.exec(location.hash);
  return m ? { id: m[1], as: m[2] ? decodeURIComponent(m[2]) : null } : null;
}

export function AppProvider({ children }) {
  const [boot, setBoot] = useState('loading');
  const [memberships, setMemberships] = useState([]);
  const [config, setConfig] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef(null);
  const currentIdRef = useRef(null);
  currentIdRef.current = currentId;

  const showToast = useCallback((msg, kind = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const loadRoom = useCallback(
    async (id) => {
      const d = await api.room(id);
      setCurrentId(id);
      setData(d);
      return d;
    },
    [],
  );

  // 启动：拉身份与配置
  useEffect(() => {
    (async () => {
      try {
        const [me, cfg] = await Promise.all([api.me(), api.config()]);
        setMemberships(me.rooms || []);
        setConfig(cfg);
        const want = hashRoom();
        if (want && (me.rooms || []).some((r) => r.id === want.id)) {
          await loadRoom(want.id);
          location.hash = '#/today';
        } else if ((me.rooms || []).length) {
          // 刷新或直接打开带 hash 的地址：会话还在，就回到最近用过的房间
          await loadRoom(me.rooms[0].id);
          if (!location.hash || location.hash === '#/') location.hash = '#/today';
        } else {
          setBoot('ready');
        }
      } catch (e) {
        setConfig({ ai: false, vision: false, questions: [] });
        showToast(e.message || '启动失败', 'err');
      } finally {
        setBoot('ready');
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!currentIdRef.current) return;
    try {
      const d = await api.room(currentIdRef.current);
      setData(d);
    } catch {
      /* 后台轮询失败不打扰 */
    }
  }, []);

  // 20 秒轮询；页面重新可见立即刷新
  useEffect(() => {
    if (!currentId) return;
    const t = setInterval(refresh, 20000);
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [currentId, refresh]);

  const act = useCallback(
    async (action, { silent = false } = {}) => {
      setBusy(true);
      try {
        const r = await api.action(currentId, action);
        setData(r);
        if (!silent) showToast('已保存');
        return r;
      } catch (e) {
        showToast(e.message || '操作失败', 'err');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [currentId, showToast],
  );

  const selectRoom = useCallback(
    async (id) => {
      await loadRoom(id);
      setMemberships((await api.me()).rooms || []);
      if (!location.hash || location.hash === '#/' || location.hash.startsWith('#/room')) location.hash = '#/today';
    },
    [loadRoom],
  );

  const openDemo = useCallback(
    async (as, reset) => {
      const d = await api.demo(as, reset);
      setCurrentId(d.room.id);
      setData(d);
      setMemberships((await api.me()).rooms || []);
      location.hash = '#/today';
      return d;
    },
    [],
  );

  const leaveRoom = useCallback(
    async (id) => {
      if (api.leave) await api.leave(id);
      setCurrentId(null);
      setData(null);
      setMemberships((await api.me()).rooms || []);
      location.hash = '#/';
    },
    [],
  );

  const value = {
    boot,
    setBoot,
    memberships,
    setMemberships,
    config,
    setConfig,
    currentId,
    setCurrentId,
    data,
    setData,
    busy,
    toast,
    showToast,
    refresh,
    act,
    loadRoom,
    selectRoom,
    openDemo,
    leaveRoom,
    api,
    staticMode: STATIC,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
