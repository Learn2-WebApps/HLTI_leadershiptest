'use strict';

/**
 * SQLite 저장 계층.
 *
 * - 서버 설치가 필요 없도록 파일 하나로 관리합니다.
 * - 모든 쿼리는 파라미터 바인딩을 사용합니다(SQL 인젝션 방지).
 * - 진행 중인 응답은 서버 세션에 두고, 완료 시점에만 이곳에 저장합니다.
 * - 수집하는 개인정보는 '이름' 뿐입니다.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1,
    allow_retake  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id           INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name                 TEXT    NOT NULL,
    predicted_character  TEXT,
    result_type          TEXT    NOT NULL,
    result_character     TEXT    NOT NULL,
    type_scores          TEXT    NOT NULL,
    competency_scores    TEXT    NOT NULL,
    had_tie              INTEGER NOT NULL DEFAULT 0,
    completed_at         TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_session
    ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_participants_session_name
    ON participants(session_id, name);
`;

let db = null;

/**
 * 데이터베이스를 열고 스키마를 만듭니다.
 * better-sqlite3 는 동기 API 이고 연결 하나를 계속 재사용하므로,
 * 요청마다 연결을 열고 닫을 필요가 없습니다(연결 누수 없음).
 */
function init(databasePath) {
  if (db) return db;

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  db = new Database(databasePath);
  db.exec(SCHEMA);
  return db;
}

function getDb() {
  if (!db) throw new Error('데이터베이스가 초기화되지 않았습니다. init() 을 먼저 호출하세요.');
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

/** UTC ISO8601 문자열. 표시할 때 지역 시간으로 변환합니다. */
function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// --- sessions ------------------------------------------------------------

/**
 * 사용 중이 아닌 4자리 숫자 코드를 만듭니다.
 * crypto 를 사용해 예측하기 어렵게 하고, 이미 존재하는 코드는 피합니다.
 */
function generateSessionCode(maxAttempts = 200) {
  const rows = getDb().prepare('SELECT code FROM sessions').all();
  const used = new Set(rows.map((r) => r.code));

  if (used.size >= 9000) {
    throw new Error('사용 가능한 세션 코드가 없습니다. 오래된 세션을 정리해 주세요.');
  }

  for (let i = 0; i < maxAttempts; i += 1) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!used.has(code)) return code;
  }
  // 무작위 시도가 계속 실패하면 순차 탐색으로 확실히 찾습니다.
  for (let value = 1000; value < 10000; value += 1) {
    const code = String(value);
    if (!used.has(code)) return code;
  }
  throw new Error('사용 가능한 세션 코드가 없습니다.');
}

function createSession(name) {
  const code = generateSessionCode();
  const info = getDb()
    .prepare('INSERT INTO sessions (code, name, created_at, is_active) VALUES (?, ?, ?, 1)')
    .run(code, name, now());
  return getSessionById(info.lastInsertRowid);
}

function listSessions() {
  return getDb().prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM participants p WHERE p.session_id = s.id)
                AS participant_count
    FROM sessions s
    ORDER BY s.created_at DESC, s.id DESC
  `).all();
}

function getSessionById(sessionId) {
  return getDb().prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM participants p WHERE p.session_id = s.id)
                AS participant_count
    FROM sessions s WHERE s.id = ?
  `).get(sessionId) || null;
}

function getSessionByCode(code) {
  return getDb().prepare('SELECT * FROM sessions WHERE code = ?').get(code) || null;
}

function setSessionActive(sessionId, active) {
  getDb().prepare('UPDATE sessions SET is_active = ? WHERE id = ?')
    .run(active ? 1 : 0, sessionId);
}

function setSessionRetake(sessionId, allow) {
  getDb().prepare('UPDATE sessions SET allow_retake = ? WHERE id = ?')
    .run(allow ? 1 : 0, sessionId);
}

/**
 * 세션과 그 세션의 응답을 함께 지웁니다.
 *
 * participants 는 ON DELETE CASCADE 로 묶여 있지만, 외래키 설정에 기대지 않고
 * 한 트랜잭션 안에서 명시적으로 지웁니다. 되돌릴 수 없습니다.
 *
 * 진행 중인 세션은 지우지 않습니다(라우트에서도 한 번 더 막습니다).
 *
 * @returns {{deleted: boolean, participants: number}}
 */
function deleteSession(sessionId) {
  const db = getDb();
  const run = db.transaction((id) => {
    const row = db.prepare('SELECT is_active FROM sessions WHERE id = ?').get(id);
    if (!row) return { deleted: false, participants: 0 };
    if (row.is_active) return { deleted: false, participants: 0, active: true };

    const info = db.prepare('DELETE FROM participants WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return { deleted: true, participants: info.changes };
  });
  return run(sessionId);
}

// --- participants --------------------------------------------------------

/**
 * 같은 세션에 같은 이름이 이미 완료 기록을 남겼는지 확인합니다.
 * 공백·대소문자 차이는 같은 이름으로 봅니다.
 */
function participantNameTaken(sessionId, name) {
  const row = getDb().prepare(`
    SELECT 1 FROM participants
    WHERE session_id = ?
      AND LOWER(REPLACE(name, ' ', '')) = LOWER(REPLACE(?, ' ', ''))
    LIMIT 1
  `).get(sessionId, name);
  return row !== undefined;
}

function saveParticipant({
  sessionId, name, predictedCharacter, resultType, resultCharacter,
  typeScores, competencyScores, hadTie,
}) {
  const info = getDb().prepare(`
    INSERT INTO participants
        (session_id, name, predicted_character, result_type, result_character,
         type_scores, competency_scores, had_tie, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    name,
    predictedCharacter ?? null,
    resultType,
    resultCharacter,
    JSON.stringify(typeScores),
    JSON.stringify(competencyScores),
    hadTie ? 1 : 0,
    now(),
  );
  return Number(info.lastInsertRowid);
}

function listParticipants(sessionId) {
  return getDb().prepare(
    'SELECT * FROM participants WHERE session_id = ? ORDER BY completed_at DESC, id DESC'
  ).all(sessionId);
}

function getParticipant(participantId) {
  return getDb().prepare('SELECT * FROM participants WHERE id = ?')
    .get(participantId) || null;
}

function parseScores(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  } catch {
    return {};
  }
}

// --- 통계 -----------------------------------------------------------------

/**
 * 유형 분포, 캐릭터 분포, 예측 일치율을 계산합니다.
 * characterTypes 는 캐릭터 key -> 유형 key 매핑입니다.
 */
function sessionStatistics(sessionId, typeKeys, characterTypes = {}) {
  const rows = listParticipants(sessionId);
  const total = rows.length;

  const typeCounts = Object.create(null);
  for (const key of typeKeys) typeCounts[key] = 0;

  const characterCounts = Object.create(null);
  let predictedTotal = 0;
  let matched = 0;
  let sameType = 0;

  for (const row of rows) {
    typeCounts[row.result_type] = (typeCounts[row.result_type] || 0) + 1;
    characterCounts[row.result_character] =
      (characterCounts[row.result_character] || 0) + 1;

    const predicted = row.predicted_character;
    if (predicted) {
      predictedTotal += 1;
      if (predicted === row.result_character) {
        matched += 1;
      } else if (characterTypes[predicted] === row.result_type) {
        sameType += 1;
      }
    }
  }

  return {
    total,
    typeCounts,
    characterCounts,
    predictedTotal,
    matched,
    sameType,
    matchRate: predictedTotal ? (matched / predictedTotal) * 100 : null,
  };
}

module.exports = {
  SCHEMA,
  init,
  getDb,
  close,
  generateSessionCode,
  createSession,
  listSessions,
  getSessionById,
  getSessionByCode,
  setSessionActive,
  setSessionRetake,
  deleteSession,
  participantNameTaken,
  saveParticipant,
  listParticipants,
  getParticipant,
  parseScores,
  sessionStatistics,
};
