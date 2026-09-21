'use strict';

/**
 * Firestore 저장 계층.
 *
 * 이 앱의 유일한 저장소입니다. 모든 함수가 async 이며, id 는 Firestore
 * 문서 id(문자열)입니다.
 *
 * 로컬에서 실행하려면 서비스 계정 키가 필요합니다.
 * .env 에 FIREBASE_SERVICE_ACCOUNT 를 넣으세요(아래 readCredentials 참고).
 *
 * 컬렉션 구조
 *   sessions/{id}       code, name, created_at, is_active, allow_retake
 *   participants/{id}   session_id, name, predicted_character, result_type,
 *                       result_character, type_scores, competency_scores,
 *                       had_tie, completed_at
 *   rate_limits/{key}   hits[]   — 서버리스에서 시도 횟수를 공유하기 위한 것
 */

const crypto = require('node:crypto');

let firestore = null;

const SESSIONS = 'sessions';
const PARTICIPANTS = 'participants';

/**
 * 서비스 계정 자격증명을 환경변수에서 읽습니다.
 *
 * 권장 — 값 3개로 나눠서 넣기 (.env 를 그대로 올려도 안 쪼개집니다)
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY
 *
 * 그 밖에도 아래 방식을 지원합니다.
 *   FIREBASE_SERVICE_ACCOUNT          — 키 JSON 전체
 *   FIREBASE_SERVICE_ACCOUNT_BASE64   — 위 JSON 을 base64 로 인코딩한 값
 *   GOOGLE_APPLICATION_CREDENTIALS    — 키 파일 경로 (구글 SDK 기본 방식)
 */
function readCredentials() {
  // --- 1) 나눠 넣은 값이 있으면 그것을 씁니다 ---------------------------
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId || clientEmail || privateKey) {
    const missing = [];
    if (!projectId) missing.push('FIREBASE_PROJECT_ID');
    if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
    if (!privateKey) missing.push('FIREBASE_PRIVATE_KEY');
    if (missing.length) {
      throw new Error('Firebase 설정이 덜 채워졌습니다: ' + missing.join(', '));
    }
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: normalizeKey(privateKey),
    };
  }

  // --- 2) JSON 통째로 넣은 경우 ------------------------------------------
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  let json = null;
  if (b64) {
    json = Buffer.from(b64, 'base64').toString('utf8');
  } else if (raw) {
    json = raw;
  }

  if (!json) return null;

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT 의 JSON 형식이 올바르지 않습니다. ' +
      '값 전체를 그대로 넣었는지 확인해 주세요.'
    );
  }

  if (typeof parsed.private_key === 'string') {
    parsed.private_key = normalizeKey(parsed.private_key);
  }
  return parsed;
}

/**
 * 비공개 키의 줄바꿈을 복원합니다.
 *
 * 환경변수에 넣으면 실제 줄바꿈이 \n 두 글자로 들어오고,
 * 따옴표째 붙여넣으면 앞뒤에 " 나 ' 가 남기도 합니다. 둘 다 정리합니다.
 */
function normalizeKey(value) {
  return String(value)
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\n/g, '\n');
}

async function init() {
  if (firestore) return firestore;

  // firebase-admin v13 부터는 모듈별 진입점을 씁니다.
  const { getApps, initializeApp, cert, applicationDefault } =
    require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');

  // 서버리스에서는 같은 인스턴스가 재사용되므로 이미 초기화돼 있을 수 있습니다.
  if (getApps().length === 0) {
    const credentials = readCredentials();
    if (credentials) {
      initializeApp({
        credential: cert(credentials),
        projectId: credentials.project_id,
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
    } else {
      throw new Error(
        'Firebase 자격증명이 없습니다.\n' +
        '  로컬: .env 에 FIREBASE_SERVICE_ACCOUNT 를 넣으세요.\n' +
        '  버셀: 환경변수에 같은 이름으로 서비스 계정 JSON 전체를 넣으세요.'
      );
    }
  }

  firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}

function db() {
  if (!firestore) throw new Error('Firestore 가 초기화되지 않았습니다.');
  return firestore;
}

async function close() {
  // 서버리스에서는 연결을 유지해 재사용하는 편이 낫습니다.
  // 프로세스가 끝나면 함께 정리됩니다.
}

/** UTC ISO8601 문자열. 표시할 때 지역 시간으로 변환합니다. */
function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Firestore 문서를 템플릿이 쓰기 좋은 평평한 객체로 바꿉니다. */
function toRow(doc) {
  if (!doc || !doc.exists) return null;
  const data = doc.data();
  return { id: doc.id, ...data };
}

// --- sessions ------------------------------------------------------------

async function generateSessionCode(maxAttempts = 200) {
  const snapshot = await db().collection(SESSIONS).select('code').get();
  const used = new Set(snapshot.docs.map((d) => d.get('code')));

  if (used.size >= 9000) {
    throw new Error('사용 가능한 세션 코드가 없습니다. 오래된 세션을 정리해 주세요.');
  }
  for (let i = 0; i < maxAttempts; i += 1) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!used.has(code)) return code;
  }
  for (let value = 1000; value < 10000; value += 1) {
    const code = String(value);
    if (!used.has(code)) return code;
  }
  throw new Error('사용 가능한 세션 코드가 없습니다.');
}

async function createSession(name) {
  const code = await generateSessionCode();
  const ref = await db().collection(SESSIONS).add({
    code,
    name,
    created_at: now(),
    is_active: 1,
    allow_retake: 0,
  });
  return getSessionById(ref.id);
}

/** 세션별 응답 수를 한 번에 세어 돌려줍니다. */
async function countBySession(sessionIds) {
  const counts = Object.create(null);
  for (const id of sessionIds) counts[id] = 0;
  if (sessionIds.length === 0) return counts;

  // Firestore 의 count() 집계를 세션마다 병렬로 호출합니다.
  await Promise.all(sessionIds.map(async (id) => {
    const snap = await db().collection(PARTICIPANTS)
      .where('session_id', '==', id).count().get();
    counts[id] = snap.data().count;
  }));
  return counts;
}

async function listSessions() {
  const snapshot = await db().collection(SESSIONS)
    .orderBy('created_at', 'desc').get();
  const rows = snapshot.docs.map(toRow);
  const counts = await countBySession(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, participant_count: counts[r.id] || 0 }));
}

async function getSessionById(sessionId) {
  const doc = await db().collection(SESSIONS).doc(String(sessionId)).get();
  const row = toRow(doc);
  if (!row) return null;
  const snap = await db().collection(PARTICIPANTS)
    .where('session_id', '==', row.id).count().get();
  return { ...row, participant_count: snap.data().count };
}

async function getSessionByCode(code) {
  const snapshot = await db().collection(SESSIONS)
    .where('code', '==', code).limit(1).get();
  if (snapshot.empty) return null;
  return toRow(snapshot.docs[0]);
}

async function setSessionActive(sessionId, active) {
  await db().collection(SESSIONS).doc(String(sessionId))
    .update({ is_active: active ? 1 : 0 });
}

async function setSessionRetake(sessionId, allow) {
  await db().collection(SESSIONS).doc(String(sessionId))
    .update({ allow_retake: allow ? 1 : 0 });
}

/**
 * 세션과 그 세션의 응답을 함께 지웁니다. 되돌릴 수 없습니다.
 * 진행 중인 세션은 지우지 않습니다(라우트에서도 한 번 더 막습니다).
 */
async function deleteSession(sessionId) {
  const ref = db().collection(SESSIONS).doc(String(sessionId));
  const doc = await ref.get();
  if (!doc.exists) return { deleted: false, participants: 0 };
  if (doc.get('is_active')) return { deleted: false, participants: 0, active: true };

  const snapshot = await db().collection(PARTICIPANTS)
    .where('session_id', '==', String(sessionId)).get();

  // 배치 한 번에 500건까지 담을 수 있어 나눠서 지웁니다.
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db().batch();
    for (const d of docs.slice(i, i + 450)) batch.delete(d.ref);
    await batch.commit();
  }
  await ref.delete();
  return { deleted: true, participants: docs.length };
}

// --- participants --------------------------------------------------------

/** 이름 비교용 정규화. 공백과 대소문자 차이는 같은 이름으로 봅니다. */
function normalizeName(name) {
  return String(name).replace(/ /g, '').toLowerCase();
}

async function participantNameTaken(sessionId, name) {
  const snapshot = await db().collection(PARTICIPANTS)
    .where('session_id', '==', String(sessionId))
    .where('name_key', '==', normalizeName(name))
    .limit(1)
    .get();
  return !snapshot.empty;
}

async function saveParticipant({
  sessionId, name, predictedCharacter, resultType, resultCharacter,
  typeScores, competencyScores, hadTie,
}) {
  const ref = await db().collection(PARTICIPANTS).add({
    session_id: String(sessionId),
    name,
    name_key: normalizeName(name),   // 중복 검사용
    predicted_character: predictedCharacter ?? null,
    result_type: resultType,
    result_character: resultCharacter,
    type_scores: JSON.stringify(typeScores),
    competency_scores: JSON.stringify(competencyScores),
    had_tie: hadTie ? 1 : 0,
    completed_at: now(),
  });
  return ref.id;
}

async function listParticipants(sessionId) {
  const snapshot = await db().collection(PARTICIPANTS)
    .where('session_id', '==', String(sessionId))
    .get();
  // 색인을 따로 만들지 않아도 되도록 정렬은 메모리에서 합니다.
  return snapshot.docs.map(toRow)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
}

async function getParticipant(participantId) {
  const doc = await db().collection(PARTICIPANTS).doc(String(participantId)).get();
  return toRow(doc);
}

function parseScores(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const value = JSON.parse(raw);
    return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  } catch {
    return {};
  }
}

// --- 통계 -----------------------------------------------------------------

async function sessionStatistics(sessionId, typeKeys, characterTypes = {}) {
  const rows = await listParticipants(sessionId);
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
      if (predicted === row.result_character) matched += 1;
      else if (characterTypes[predicted] === row.result_type) sameType += 1;
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

// --- 시도 횟수 제한 (서버리스에서 인스턴스 간 공유) --------------------------

const RATE_LIMITS = 'rate_limits';

/**
 * 슬라이딩 윈도 제한. 인스턴스가 여러 개여도 같은 값을 보도록 Firestore 에 둡니다.
 * @returns {{allowed: boolean, retryAfter: number}}
 */
async function checkRateLimit(key, maxAttempts, windowSeconds) {
  const ref = db().collection(RATE_LIMITS).doc(encodeURIComponent(key));
  const doc = await ref.get();
  const nowMs = Date.now();
  const cutoff = nowMs - windowSeconds * 1000;

  const hits = (doc.exists ? (doc.get('hits') || []) : []).filter((t) => t > cutoff);
  if (hits.length >= maxAttempts) {
    const retryAfter = Math.ceil((hits[0] + windowSeconds * 1000 - nowMs) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }
  return { allowed: true, retryAfter: 0 };
}

async function registerRateLimitFailure(key, windowSeconds) {
  const ref = db().collection(RATE_LIMITS).doc(encodeURIComponent(key));
  const doc = await ref.get();
  const nowMs = Date.now();
  const cutoff = nowMs - windowSeconds * 1000;
  const hits = (doc.exists ? (doc.get('hits') || []) : []).filter((t) => t > cutoff);
  hits.push(nowMs);
  await ref.set({ hits, updated_at: nowMs }, { merge: true });
}

async function resetRateLimit(key) {
  await db().collection(RATE_LIMITS).doc(encodeURIComponent(key)).delete()
    .catch(() => { /* 없으면 지울 것도 없습니다 */ });
}

/** 시도 횟수 제한을 저장소로 공유하는지. Firestore 이므로 항상 true. */
function supportsSharedRateLimit() {
  return true;
}

module.exports = {
  name: 'firestore',
  init,
  supportsSharedRateLimit,
  close,
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
  checkRateLimit,
  registerRateLimitFailure,
  resetRateLimit,
};
