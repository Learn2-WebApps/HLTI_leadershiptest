'use strict';

/**
 * 애플리케이션 설정.
 *
 * 민감한 값은 모두 환경변수에서 읽습니다. 코드에 평문으로 두지 않습니다.
 * 로컬 실행 시에는 프로젝트 루트의 .env 파일을 사용합니다.
 */

const path = require('node:path');
const crypto = require('node:crypto');

require('dotenv').config();

const BASE_DIR = path.resolve(__dirname, '..');

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) ? value : fallback;
}

// 운영 환경에서는 반드시 HLTI_SECRET_KEY 를 지정하세요.
// 지정하지 않으면 기동할 때마다 새로 생성되어 기존 세션이 모두 끊깁니다.
const secretKey = process.env.HLTI_SECRET_KEY || crypto.randomBytes(32).toString('hex');

const config = {
  baseDir: BASE_DIR,
  dataDir: path.join(BASE_DIR, 'data'),
  staticDir: path.join(BASE_DIR, 'static'),
  templatesDir: path.join(BASE_DIR, 'templates'),

  // --- 세션/암호화 -------------------------------------------------------
  secretKey,
  secretKeyIsEphemeral: !process.env.HLTI_SECRET_KEY,
  sessionCookieName: 'hlti_session',
  // HTTPS 로 서비스할 때 HLTI_SECURE_COOKIE=1 을 지정하세요.
  secureCookie: boolEnv('HLTI_SECURE_COOKIE', false),

  // 응답 도중 자리를 비우는 경우를 감안한 유효 시간(분)
  participantSessionMinutes: intEnv('HLTI_PARTICIPANT_TIMEOUT_MIN', 90),
  // 관리자 세션 자동 만료(분)
  adminSessionMinutes: intEnv('HLTI_ADMIN_TIMEOUT_MIN', 30),

  // --- 관리자 비밀번호 ---------------------------------------------------
  // 평문을 코드에 두지 않습니다. HLTI_ADMIN_PASSWORD_HASH 가 있으면 우선 사용합니다(권장).
  adminPasswordHash: process.env.HLTI_ADMIN_PASSWORD_HASH || '',
  adminPassword: process.env.HLTI_ADMIN_PASSWORD || '',

  // --- 무차별 대입 방지 --------------------------------------------------
  loginMaxAttempts: intEnv('HLTI_LOGIN_MAX_ATTEMPTS', 8),
  loginWindowSeconds: intEnv('HLTI_LOGIN_WINDOW_SEC', 300),
  adminMaxAttempts: intEnv('HLTI_ADMIN_MAX_ATTEMPTS', 5),
  adminWindowSeconds: intEnv('HLTI_ADMIN_WINDOW_SEC', 600),

  // --- 서버 --------------------------------------------------------------
  host: process.env.HLTI_HOST || '0.0.0.0',
  port: intEnv('HLTI_PORT', 3000),
  debug: boolEnv('HLTI_DEBUG', false),

  // 업로드가 없으므로 요청 본문을 작게 제한합니다.
  maxBodySize: '64kb',

  // 프록시(nginx 등) 뒤에서 운영할 때 1 로 지정하세요.
  trustProxy: boolEnv('HLTI_TRUST_PROXY', false),
};

module.exports = config;
