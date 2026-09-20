'use strict';

/**
 * 관리자 라우트.
 *
 *   /admin                              비밀번호 로그인
 *   /admin/dashboard                    세션 생성 · 목록 · 종료/재개
 *   /admin/sessions/:id                 응답자 목록 + 통계
 *   /admin/sessions/:id/export.csv      CSV 다운로드
 *   /admin/participants/:id             개별 결과 다시 보기
 */

const express = require('express');

const db = require('../lib/db');
const security = require('../lib/security');
const makeRenderer = require('../lib/render');
const { HttpError } = require('../lib/errors');
const { wrap } = require('../lib/async-route');

/** CSV 한 칸을 안전하게 감쌉니다. */
function csvCell(value) {
  let text = value == null ? '' : String(value);

  // 스프레드시트에서 수식으로 해석되는 것을 막습니다(CSV 인젝션 방지).
  // 다만 -12 같은 정상적인 음수 점수까지 텍스트로 만들면 안 되므로,
  // 순수한 숫자는 그대로 둡니다.
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(text);
  if (!isPlainNumber && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

/** 저장된 UTC ISO 문자열을 로컬 시간 표기로 바꿉니다. */
function toLocal(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
         `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

module.exports = function adminRoutes(content, config, limiters, adminPasswordHash) {
  const router = express.Router();
  const { renderResult } = makeRenderer(content);

  // --- 접근 통제 ---------------------------------------------------------

  /** 로그인하지 않았거나 세션이 만료되었으면 로그인 화면으로 보냅니다. */
  function requireAdmin(req, res, next) {
    const authenticatedAt = req.session.adminAuthenticatedAt;
    if (!authenticatedAt) return res.redirect('/admin');

    const limitMs = config.adminSessionMinutes * 60 * 1000;
    const now = Date.now();
    if (now - Number(authenticatedAt) > limitMs) {
      delete req.session.adminAuthenticatedAt;
      return res.redirect('/admin?expired=1');
    }

    // 활동이 있으면 만료 시각을 뒤로 미룹니다.
    req.session.adminAuthenticatedAt = now;
    return next();
  }

  async function requireSession(sessionId) {
    const row = await db.getSessionById(sessionId);
    if (row === null) throw new HttpError(404, '세션을 찾을 수 없습니다.');
    return row;
  }

  /**
   * Firestore 문서 id 검증.
   * 경로에 이상한 값(슬래시, 상위 경로 등)이 오면 여기서 막습니다.
   */
  function parseId(raw) {
    const value = String(raw || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new HttpError(404, '잘못된 식별자입니다.');
    }
    return value;
  }

  // --- 로그인 ------------------------------------------------------------

  router.get('/', wrap(async (req, res) => {
    if (req.session.adminAuthenticatedAt) return res.redirect('/admin/dashboard');
    const error = req.query.expired
      ? content.text('errors.session_expired_body')
      : null;
    return res.render('admin_login.html', { error });
  }));

  router.post('/', wrap(async (req, res) => {
    const limiter = limiters.admin;
    const key = security.clientKey(req);

    const [allowed, retryAfter] = await limiter.check(key);
    if (!allowed) {
      return res.status(429).render('admin_login.html', {
        error: content.text('admin.login_locked').replace('{seconds}', String(retryAfter)),
      });
    }

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (adminPasswordHash && security.verifyPassword(password, adminPasswordHash)) {
      await limiter.reset(key);
      // 로그인 성공 시 CSRF 토큰을 새로 발급합니다.
      // (쿠키 세션에는 세션 id 가 없어 regenerate 가 필요 없습니다.)
      security.rotateCsrfToken(req);
      req.session.adminAuthenticatedAt = Date.now();
      return res.redirect('/admin/dashboard');
    }

    await limiter.registerFailure(key);
    return res.status(401).render('admin_login.html', {
      error: content.text('admin.login_failed'),
    });
  }));

  router.post('/logout', requireAdmin, wrap(async (req, res) => {
    delete req.session.adminAuthenticatedAt;
    res.redirect('/admin');
  }));

  // --- 대시보드 ----------------------------------------------------------

  router.get('/dashboard', requireAdmin, wrap(async (req, res) => {
    res.render('admin_dashboard.html', {
      sessions: await db.listSessions(),
      error: null,
    });
  }));

  router.post('/sessions', requireAdmin, wrap(async (req, res) => {
    const name = security.cleanSessionName(req.body.name);
    if (name === null) {
      return res.status(400).render('admin_dashboard.html', {
        sessions: await db.listSessions(),
        error: '세션 이름을 1~60자로 입력해 주세요.',
      });
    }
    await db.createSession(name);
    return res.redirect('/admin/dashboard');
  }));

  router.post('/sessions/:id/toggle', requireAdmin, wrap(async (req, res) => {
    const row = await requireSession(parseId(req.params.id));
    await db.setSessionActive(row.id, !row.is_active);
    res.redirect(safeNext(req.body.next, '/admin/dashboard'));
  }));

  router.post('/sessions/:id/retake', requireAdmin, wrap(async (req, res) => {
    const row = await requireSession(parseId(req.params.id));
    await db.setSessionRetake(row.id, !row.allow_retake);
    res.redirect(safeNext(req.body.next, '/admin/dashboard'));
  }));

  // 되돌릴 수 없는 삭제. 종료한 세션만 지울 수 있게 서버에서도 막습니다.
  router.post('/sessions/:id/delete', requireAdmin, wrap(async (req, res) => {
    const row = await requireSession(parseId(req.params.id));

    if (row.is_active) {
      return res.status(400).render('admin_dashboard.html', {
        sessions: await db.listSessions(),
        error: content.text('admin.delete_blocked'),
      });
    }

    const result = await db.deleteSession(row.id);
    console.info(
      `[HLTI] 세션 삭제: ${row.code} ${row.name} ` +
      `(응답 ${result.participants}건 함께 삭제)`
    );
    return res.redirect('/admin/dashboard');
  }));

  /** 열린 리다이렉트를 막기 위해 앱 내부 경로만 허용합니다. */
  function safeNext(value, fallback) {
    if (typeof value !== 'string') return fallback;
    if (!value.startsWith('/') || value.startsWith('//')) return fallback;
    return value;
  }

  // --- 세션 상세 ---------------------------------------------------------

  router.get('/sessions/:id', requireAdmin, wrap(async (req, res) => {
    const row = await requireSession(parseId(req.params.id));
    const characterTypes = Object.fromEntries(
      content.characters.map((c) => [c.key, c.type])
    );
    const stats = await db.sessionStatistics(row.id, content.typeKeys, characterTypes);

    res.render('admin_session.html', {
      session_row: row,
      participants: await db.listParticipants(row.id),
      stats,
      characters_by_key: content.charactersByKey,
      characters: content.characters,
      types: content.types,
    });
  }));

  // --- CSV ---------------------------------------------------------------

  router.get('/sessions/:id/export.csv', requireAdmin, wrap(async (req, res) => {
    const row = await requireSession(parseId(req.params.id));

    const typeKeys = content.typeKeys;
    const competencyKeys = Object.keys(content.competencyLabels);

    const lines = [];
    lines.push(csvRow([
      '이름', '예측 캐릭터', '결과 캐릭터', '유형', '대표 역량',
      ...typeKeys.map((k) => `유형점수:${content.typeName(k)}`),
      ...competencyKeys.map((k) => `역량점수:${content.competencyLabel(k)}`),
      '동점 여부', '완료 시각',
    ]));

    for (const p of await db.listParticipants(row.id)) {
      const character = content.charactersByKey[p.result_character];
      const predicted = p.predicted_character
        ? content.charactersByKey[p.predicted_character]
        : null;
      const typeScores = db.parseScores(p.type_scores);
      const compScores = db.parseScores(p.competency_scores);

      lines.push(csvRow([
        p.name,
        predicted ? predicted.name : '',
        character ? character.name : p.result_character,
        content.typeName(p.result_type),
        character ? content.competencyLabel(character.competency) : '',
        ...typeKeys.map((k) => (k in typeScores ? typeScores[k] : '')),
        ...competencyKeys.map((k) => (k in compScores ? compScores[k] : '')),
        p.had_tie ? 'Y' : 'N',
        toLocal(p.completed_at),
      ]));
    }

    // Excel 이 UTF-8 을 바로 인식하도록 BOM 을 붙입니다.
    const body = '﻿' + lines.join('\r\n') + '\r\n';
    const filename = `HLTI_${row.code}_${row.name}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(body);
  }));

  // --- 개별 결과 다시 보기 ------------------------------------------------

  router.get('/participants/:id', requireAdmin, wrap(async (req, res) => {
    const p = await db.getParticipant(parseId(req.params.id));
    if (p === null) throw new HttpError(404, '응답자를 찾을 수 없습니다.');

    const character = content.charactersByKey[p.result_character];
    if (!character) throw new HttpError(404, '캐릭터를 찾을 수 없습니다.');

    renderResult(res, {
      character: character.key,
      type: p.result_type,
      competency: character.competency,
      predicted: p.predicted_character,
      companions: [],
      name: p.name,
    });
  }));

  return router;
};
