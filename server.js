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
const cookieSession = require('cookie-session');
const nunjucks = require('nunjucks');

const config = require('./lib/config');
const db = require('./lib/db');
const security = require('./lib/security');
const { loadContent, ContentError } = require('./lib/content');
const { InvalidFlow, HttpError } = require('./lib/errors');
const participantRoutes = require('./routes/participant');
const adminRoutes = require('./routes/admin');

async function createApp() {
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
  await db.init();
  console.log('[HLTI] 저장소: Firestore');

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

  /**
   * 줄바꿈을 <br> 로. 먼저 이스케이프하므로 XSS 위험이 없습니다.
   *
   * nunjucks 의 내부 API(nunjucks.lib.escape)에 기대면 번들링 환경에 따라
   * 사라질 수 있어, 이스케이프를 직접 구현합니다.
   */
  const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' };
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
  }

  env.addFilter('nl2br', (value) => {
    if (!value) return '';
    const escaped = escapeHtml(value);
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
  // 세션 내용을 서명된 쿠키에 담습니다(서버에 상태를 두지 않음).
  // 버셀처럼 요청마다 다른 인스턴스가 뜨는 환경에서도 로그인이 유지됩니다.
  // 담기는 값은 응답 18개와 로그인 정보뿐이라 쿠키 4KB 한도에 충분히 들어갑니다.
  app.use(cookieSession({
    name: config.sessionCookieName,
    keys: [config.secretKey],
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookie,   // HTTPS 라면 HLTI_SECURE_COOKIE=1
    maxAge: config.participantSessionMinutes * 60 * 1000,
  }));

  // cookie-session 은 값을 지울 때 delete 가 통하지 않는 경우가 있어
  // 세션 객체가 항상 존재하도록 보장합니다.
  app.use((req, res, next) => {
    if (!req.session) req.session = {};
    next();
  });

  /**
   * POST 처리 뒤의 리다이렉트는 303 으로 보냅니다.
   *
   * Express 의 기본값은 302 인데, 버셀 같은 프록시가 이를 307 로 바꾸는 일이
   * 있습니다. 307 은 원래 메서드를 그대로 유지하므로 브라우저가 다음 주소로
   * POST 를 다시 보냅니다. 그러면
   *   - 로그인 성공 → /admin/dashboard 로 POST → 그 경로엔 POST 가 없고
   *     CSRF 토큰도 이미 새로 발급된 뒤라 '잘못된 접근' 화면이 뜨고
   *   - 로그아웃 → /admin 으로 POST → 빈 비밀번호로 로그인 시도가 되어
   *     '비밀번호가 올바르지 않습니다' 가 뜹니다.
   *
   * 303 은 '다음 주소는 GET 으로 가져가라'는 뜻이라 이 문제가 없습니다.
   */
  app.use((req, res, next) => {
    if (req.method === 'POST') {
      const redirect = res.redirect.bind(res);
      res.redirect = (...args) => (
        typeof args[0] === 'string' ? redirect(303, args[0]) : redirect(...args)
      );
    }
    next();
  });

  // --- 보안 헤더 -----------------------------------------------------------
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');

    // 이 아래 화면들은 모두 세션에 따라 내용이 달라집니다(CSRF 토큰, 로그인
    // 상태, 진행 중인 응답). 캐시되면 다른 사람의 화면이나 옛 토큰이 보일 수
    // 있으므로 저장을 막습니다. /static 은 이 미들웨어 앞에서 처리되므로
    // 영향받지 않습니다.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Vary', 'Cookie');
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
  // 인스턴스가 여러 개여도 같은 횟수를 보도록 Firestore 에 기록합니다.
  const limiters = {
    login: new security.SharedRateLimiter(
      db, config.loginMaxAttempts, config.loginWindowSeconds),
    admin: new security.SharedRateLimiter(
      db, config.adminMaxAttempts, config.adminWindowSeconds),
  };

  // --- 라우트 --------------------------------------------------------------
  app.use('/admin', adminRoutes(content, config, limiters, adminPasswordHash));
  app.use('/', participantRoutes(content, config, limiters));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', characters: content.characters.length });
  });

  // --- 404 -----------------------------------------------------------------
  app.use((req, res, next) => {
    next(new HttpError(404, '경로를 찾을 수 없습니다.'));
  });

  // --- 오류 처리 ------------------------------------------------------------
  // 내부 사유는 로그로만 남기고 화면에는 노출하지 않습니다.

  /**
   * 오류 화면을 그립니다.
   *
   * error.html 자체가 그려지지 않는 상황(템플릿 누락, 필터 오류 등)에서도
   * 함수가 죽지 않도록 마지막에 평문으로 물러섭니다. 이 안전망이 없으면
   * 렌더링 오류가 다시 오류 처리기로 들어가 무한히 맴돌거나 함수가 중단됩니다.
   */
  function sendErrorPage(res, status, title, body) {
    res.status(status).render('error.html', { title, body }, (renderErr, html) => {
      if (!renderErr) {
        res.send(html);
        return;
      }
      console.error('[HLTI] 오류 화면 렌더링 실패:', renderErr);
      res.type('html').send(
        '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
        `<title>${escapeHtml(title)}</title></head>` +
        '<body style="font-family:sans-serif;padding:40px;text-align:center">' +
        `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>` +
        '<p><a href="/">처음으로</a></p></body></html>'
      );
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;

    if (err instanceof InvalidFlow) {
      console.info(`[HLTI] 흐름 이탈: ${err.message} (${req.path})`);
      const expired = !req.session || !req.session.participant;
      return sendErrorPage(res, 400,
        content.text(expired ? 'errors.session_expired_title'
                             : 'errors.invalid_access_title'),
        content.text(expired ? 'errors.session_expired_body'
                             : 'errors.invalid_access_body'));
    }

    if (status === 404) {
      return sendErrorPage(res, 404,
        content.text('errors.not_found_title'),
        content.text('errors.not_found_body'));
    }

    if (status < 500) {
      console.info(`[HLTI] ${status} ${req.method} ${req.path}: ${err.message}`);
      return sendErrorPage(res, status,
        content.text('errors.invalid_access_title'),
        content.text('errors.invalid_access_body'));
    }

    console.error(`[HLTI] 처리되지 않은 오류 (${req.path}):`, err);
    return sendErrorPage(res, 500,
      content.text('errors.server_error_title'),
      content.text('errors.server_error_body'));
  });

  return app;
}

// --- 실행 -----------------------------------------------------------------

if (require.main === module) {
  createApp().then((app) => {
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
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    // 연결이 남아 있어도 일정 시간 뒤에는 종료합니다.
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  }).catch((err) => {
    console.error('\n[HLTI] 앱을 시작하지 못했습니다.\n  ' + err.message + '\n');
    process.exit(1);
  });
}

module.exports = { createApp };
