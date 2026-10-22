// SQLite 存储（Node 内置 node:sqlite）。房间整体存为一份 JSON 文档，用 rev 做乐观锁。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'hezuguanjia.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite TEXT,
      demo INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      rev INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rooms_invite ON rooms(invite) WHERE invite IS NOT NULL;
    CREATE INDEX IF NOT EXISTS rooms_demo_updated ON rooms(demo, updated_at);
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      session TEXT NOT NULL,
      room_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session, room_id)
    );
    CREATE INDEX IF NOT EXISTS memberships_room ON memberships(room_id);
    CREATE TABLE IF NOT EXISTS device_codes (
      code TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS photos_room ON photos(room_id);
    CREATE TABLE IF NOT EXISTS ai_usage (
      scope TEXT NOT NULL,
      day TEXT NOT NULL,
      n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, day)
    );
  `);
  return db;
}

export function prepare(db) {
  const p = (sql) => db.prepare(sql);
  return {
    room: p('SELECT id, data, rev, demo FROM rooms WHERE id = ?'),
    roomByInvite: p('SELECT id, data, rev FROM rooms WHERE invite = ? AND demo = 0'),
    inviteTaken: p('SELECT 1 AS x FROM rooms WHERE invite = ?'),
    insertRoom: p('INSERT INTO rooms (id, name, invite, demo, data, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'),
    updateRoom: p('UPDATE rooms SET data = ?, name = ?, invite = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?'),
    deleteRoom: p('DELETE FROM rooms WHERE id = ?'),
    countRooms: p('SELECT demo, COUNT(*) AS n FROM rooms GROUP BY demo'),
    allRoomIds: p('SELECT id FROM rooms'),
    oldDemo: p('SELECT id FROM rooms WHERE demo = 1 AND updated_at < ?'),
    session: p('SELECT hash, expires_at, last_seen FROM sessions WHERE hash = ?'),
    insertSession: p('INSERT INTO sessions (hash, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?)'),
    touchSession: p('UPDATE sessions SET expires_at = ?, last_seen = ? WHERE hash = ?'),
    membership: p('SELECT member_id FROM memberships WHERE session = ? AND room_id = ?'),
    memberships: p('SELECT m.room_id, m.member_id, r.data FROM memberships m JOIN rooms r ON r.id = m.room_id WHERE m.session = ? ORDER BY m.created_at'),
    roomSessions: p('SELECT COUNT(*) AS n FROM memberships WHERE room_id = ?'),
    addMembership: p('INSERT OR REPLACE INTO memberships (session, room_id, member_id, created_at) VALUES (?, ?, ?, ?)'),
    delMembership: p('DELETE FROM memberships WHERE session = ? AND room_id = ?'),
    delMemberMemberships: p('DELETE FROM memberships WHERE room_id = ? AND member_id = ?'),
    delRoomMemberships: p('DELETE FROM memberships WHERE room_id = ?'),
    insertCode: p('INSERT INTO device_codes (code, room_id, member_id, expires_at) VALUES (?, ?, ?, ?)'),
    code: p('SELECT room_id, member_id, expires_at FROM device_codes WHERE code = ?'),
    delCode: p('DELETE FROM device_codes WHERE code = ?'),
    insertPhoto: p('INSERT INTO photos (id, room_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)'),
    photo: p('SELECT mime, data FROM photos WHERE id = ? AND room_id = ?'),
    countPhotos: p('SELECT COUNT(*) AS n FROM photos WHERE room_id = ?'),
    delRoomPhotos: p('DELETE FROM photos WHERE room_id = ?'),
    aiUsage: p('SELECT n FROM ai_usage WHERE scope = ? AND day = ?'),
    aiInc: p('INSERT INTO ai_usage (scope, day, n) VALUES (?, ?, 1) ON CONFLICT(scope, day) DO UPDATE SET n = n + 1'),
    delSessions: p('DELETE FROM sessions WHERE expires_at < ?'),
    delOrphanMemberships: p('DELETE FROM memberships WHERE session NOT IN (SELECT hash FROM sessions)'),
    delCodes: p('DELETE FROM device_codes WHERE expires_at < ?'),
    delUsage: p('DELETE FROM ai_usage WHERE day < ?'),
  };
}
