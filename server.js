'use strict';

/**
 * HLTI; Hyundai Leadership Type Indicator — Express 애플리케이션.
 *
 * 화면 흐름
 *     로그인 → 캐릭터 예측 → Part 1(12문항) → [동점 판별] → 전환 안내
 *           → Part 2(6문항) → [동점 판별] → 결과
 * 관리자
 *     /admin (비밀번호 로그인) → 세션 생성/종료, 응답자 목록, 통계, CSV
 */

const fs = require('node:fs');
const path = require('node:path');

const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');

const config = require('./lib/config');
const db = require('./lib/db');
const security = require('./lib/security');
const { loadContent, ContentError } = require('./lib/content');
const { InvalidFlow } = require('./lib/errors');
const participantRoutes = require('./routes/participant');
const adminRoutes = require('./routes/admin');

function createApp() {
  // --- 콘텐츠 로딩 (기동 시 1회, 이후 메모리 캐싱) ------------------------
  let content;
  try {
    content = loadContent(config.dataDir);
  } catch (err) {
    if (err instanceof ContentError) {
      console.error(
        '\n[HLTI] 데이터 파일을 읽지 못해 앱을 시작할 수 없습니다.\n' +
        `  ${err.message}\n` +
        '  data/ 폴더의 JSON 파일을 확인한 뒤 다시 실행해 주세요.\n'
      );
      process.exit(1);
    }
    throw err;
  }

  // --- 관리자 비밀번호 해시 준비 ------------------------------------------
  let adminPasswordHash = config.adminPasswordHash;
  if (!adminPasswordHash) {
    if (config.adminPassword) {
      // 환경변수로 받은 평문을 기동 시점에 해시로 바꿔 메모리에 둡니다.
      adminPasswordHash = security.hashPassword(config.adminPassword);
    } else {
      console.warn(
        '[HLTI] 관리자 비밀번호가 설정되지 않아 /admin 에 로그인할 수 없습니다. ' +
        'HLTI_ADMIN_PASSWORD 또는 HLTI_ADMIN_PASSWORD_HASH 를 지정하세요.'
      );
    }
  }
  // 평문은 더 이상 들고 있지 않습니다.
  config.adminPassword = '';

  if (config.secretKeyIsEphemeral) {
    console.warn(
      '[HLTI] HLTI_SECRET_KEY 가 없어 임시 키를 생성했습니다. ' +
      '서버를 재시작하면 진행 중인 응답이 모두 끊깁니다.'
    );
  }

  // --- DB ----------------------------------------------------------------
  db.init(config.databasePath);

  // --- 앱 ----------------------------------------------------------------
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // --- 템플릿 엔진 --------------------------------------------------------
  const env = nunjucks.configure(config.templatesDir, {
    autoescape: true,        // XSS 방지: 모든 출력은 기본 이스케이프
    express: app,
    watch: config.debug,
    noCache: config.debug,
  });

  /** 줄바꿈을 <br> 로. 먼저 이스케이프하므로 XSS 위험이 없습니다. */
  env.addFilter('nl2br', (value) => {
    if (!value) return '';
    const escaped = nunjucks.lib.escape(String(value));
    return new nunjucks.runtime.SafeString(escaped.split('\n').join('<br>'));
  });

  /** 저장된 UTC ISO 문자열을 로컬 시간 표기로 바꿉니다. */
  env.addFilter('localdt', (value) => {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
           `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  });

  /** 객체에서 키를 꺼내되 없으면 기본값. 통계 표에서 씁니다. */
  env.addFilter('lookup', (obj, key, fallback = 0) => {
    if (!obj || typeof obj !== 'object') return fallback;
    return key in obj ? obj[key] : fallback;
  });

  /**
   * <script type="application/json"> 안에 안전하게 넣을 JSON 을 만듭니다.
   *
   * 자동 이스케이프를 그대로 두면 따옴표가 &#34; 로 바뀌어 JSON.parse 가 깨지고,
   * 반대로 그냥 safe 로 내보내면 값 안의 </script> 가 태그를 닫아 버립니다.
   * 그래서 태그를 만들 수 있는 문자만 유니코드 이스케이프로 바꿔 safe 처리합니다.
   */
  env.addFilter('json_script', (value) => {
    const json = JSON.stringify(value === undefined ? null : value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
      .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
    return new nunjucks.runtime.SafeString(json);
  });

  /** texts.json 문구를 읽고 {자리표시자} 를 채웁니다. */
  function t(dottedPath, replacements) {
    let value = content.text(dottedPath, '');
    if (typeof value === 'string' && replacements && typeof replacements === 'object') {
      for (const [key, replacement] of Object.entries(replacements)) {
        value = value.split(`{${key}}`).join(String(replacement));
      }
    }
    return value;
  }

  /**
   * 정적 파일 주소에 파일 수정 시각을 버전으로 붙입니다.
   *   asset('css/style.css') -> /static/css/style.css?v=1a2b3c
   *
   * 파일을 고치면 주소가 바뀌므로, 브라우저가 옛 파일을 계속 쓰는 일이 없습니다.
   * (캐릭터 이미지를 교체했는데 예전 그림이 보이던 문제가 이것 때문이었습니다.)
   * 덕분에 캐시를 길게 잡아도 안전합니다.
   */
  const assetVersions = new Map();
  function asset(relPath) {
    const clean = String(relPath).replace(/^\/+/, '');
    if (!config.debug && assetVersions.has(clean)) {
      return `/static/${clean}?v=${assetVersions.get(clean)}`;
    }
    let version = '0';
    try {
      const stat = fs.statSync(path.join(config.staticDir, clean));
      version = Math.floor(stat.mtimeMs).toString(36);
    } catch {
      // 파일이 없으면 버전 없이 그대로 둡니다(404 는 브라우저가 알려 줍니다).
      return `/static/${clean}`;
    }
    assetVersions.set(clean, version);
    return `/static/${clean}?v=${version}`;
  }

  env.addGlobal('asset', asset);
  env.addGlobal('t', t);
  env.addGlobal('texts', content.texts);
  env.addGlobal('brand', content.texts.brand);
  env.addGlobal('csrf_field', security.CSRF_FIELD_NAME);
  env.addGlobal('competency_label', (key) => content.competencyLabel(key));
  env.addGlobal('type_name', (key) => content.typeName(key));

  // --- 정적 파일 ----------------------------------------------------------
  // 템플릿이 asset() 으로 ?v=<수정시각> 을 붙이므로, 파일이 바뀌면 주소도 바뀝니다.
  // 따라서 캐시를 길게 잡아도 예전 파일이 남지 않습니다.
  app.use('/static', express.static(config.staticDir, {
    maxAge: config.debug ? 0 : '7d',
    etag: true,
    lastModified: true,
    index: false,
    dotfiles: 'ignore',
  }));

  // --- 본문 파싱 (업로드 없음, 작게 제한) -----------------------------------
  app.use(express.urlencoded({ extended: false, limit: config.maxBodySize }));

  // --- 세션 ---------------------------------------------------------------
  app.use(session({
    name: config.sessionCookieName,
    secret: config.secretKey,
    resave: false,
    saveUninitialized: true,   // CSRF 토큰을 첫 GET 에서 발급해야 합니다
    rolling: true,             // 활동이 있으면 만료를 뒤로 미룹니다
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookie,   // HTTPS 라면 HLTI_SECURE_COOKIE=1
      maxAge: config.participantSessionMinutes * 60 * 1000,
    },
  }));

  // --- 보안 헤더 -----------------------------------------------------------
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    // 외부 리소스를 쓰지 않으므로 자기 출처로 제한합니다.
    // html2canvas 를 로컬에 두었기 때문에 inline 스크립트가 필요 없습니다.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
    next();
  });

  // --- CSRF ---------------------------------------------------------------
  app.use(security.csrfProtection);

  // 템플릿에서 csrf_token() 으로 쓸 수 있게 요청마다 주입합니다.
  app.use((req, res, next) => {
    const token = security.getCsrfToken(req);
    res.locals.csrf_token = () => token;
    res.locals.request = { path: req.path, query: req.query };
    next();
  });

  // --- 시도 횟수 제한기 (앱 1개당 1개) ---------------------------------------
  const limiters = {
    login: new security.RateLimiter(config.loginMaxAttempts, config.loginWindowSeconds),
    admin: new security.RateLimiter(config.adminMaxAttempts, config.adminWindowSeconds),
  };

  // --- 라우트 --------------------------------------------------------------
  app.use('/admin', adminRoutes(content, config, limiters, adminPasswordHash));
  app.use('/', participantRoutes(content, config, limiters));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', characters: content.characters.length });
  });

  // --- 404 -----------------------------------------------------------------
  app.use((req, res) => {
    res.status(404).render('error.html', {
      title: content.text('errors.not_found_title'),
      body: content.text('errors.not_found_body'),
    });
  });

  // --- 오류 처리 ------------------------------------------------------------
  // 내부 사유는 로그로만 남기고 화면에는 노출하지 않습니다.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;

    if (err instanceof InvalidFlow) {
      console.info(`[HLTI] 흐름 이탈: ${err.message} (${req.path})`);
      const expired = !req.session || !req.session.participant;
      return res.status(400).render('error.html', {
        title: content.text(expired ? 'errors.session_expired_title'
                                    : 'errors.invalid_access_title'),
        body: content.text(expired ? 'errors.session_expired_body'
                                   : 'errors.invalid_access_body'),
      });
    }

    if (status === 404) {
      return res.status(404).render('error.html', {
        title: content.text('errors.not_found_title'),
        body: content.text('errors.not_found_body'),
      });
    }

    if (status < 500) {
      console.info(`[HLTI] ${status} ${req.method} ${req.path}: ${err.message}`);
      return res.status(status).render('error.html', {
        title: content.text('errors.invalid_access_title'),
        body: content.text('errors.invalid_access_body'),
      });
    }

    console.error(`[HLTI] 처리되지 않은 오류 (${req.path}):`, err);
    return res.status(500).render('error.html', {
      title: content.text('errors.server_error_title'),
      body: content.text('errors.server_error_body'),
    });
  });

  return app;
}

// --- 실행 -----------------------------------------------------------------

if (require.main === module) {
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log('');
    console.log('  ==========================================');
    console.log('    HLTI 리더십 유형 진단');
    console.log('  ==========================================');
    console.log(`    진단 화면 : http://localhost:${config.port}`);
    console.log(`    관리자    : http://localhost:${config.port}/admin`);
    console.log('    (종료: Ctrl+C)');
    console.log('');
  });

  function shutdown(signal) {
    console.log(`\n[HLTI] ${signal} 수신. 서버를 정리합니다.`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // 연결이 남아 있어도 일정 시간 뒤에는 종료합니다.
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { createApp };
