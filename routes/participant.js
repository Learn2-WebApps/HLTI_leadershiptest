'use strict';

/**
 * 참여자 라우트.
 *
 * 화면 흐름
 *   로그인 → 캐릭터 예측 → Part 1(12문항) → [동점 판별] → 전환 안내
 *          → Part 2(6문항) → [동점 판별] → 결과
 */

const express = require('express');

const db = require('../lib/db');
const scoring = require('../lib/scoring');
const security = require('../lib/security');
const { InvalidFlow } = require('../lib/errors');
const makeRenderer = require('../lib/render');

module.exports = function participantRoutes(content, config, limiters) {
  const router = express.Router();
  const { renderResult } = makeRenderer(content);

  // --- 진행 상태 헬퍼 ----------------------------------------------------

  /** 로그인 정보를 꺼냅니다. 없으면 흐름 이탈로 처리합니다. */
  function participantOf(req) {
    const data = req.session.participant;
    if (!data || typeof data !== 'object' || !('sessionId' in data)) {
      throw new InvalidFlow('로그인 정보가 없습니다.');
    }
    return data;
  }

  /** 응답 원본을 세션에서 제거합니다(메모리 누적 방지). */
  function clearProgress(req) {
    delete req.session.participant;
    delete req.session.p1Answers;
    delete req.session.p1Tie;
    delete req.session.typeKey;
    delete req.session.p2Answers;
    delete req.session.p2Tie;
  }

  function answersOf(req, key) {
    const value = req.session[key];
    return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  }

  function resolvePart1(req, answers) {
    return scoring.scorePart1(
      content.part1Questions, answers, content.typeKeys, req.session.p1Tie ?? null
    );
  }

  function resolvePart2(req, typeKey, answers) {
    const competencies = content.typesByKey[typeKey].competencies;
    return scoring.scorePart2(
      content.part2Questions(typeKey), answers, competencies, req.session.p2Tie ?? null
    );
  }

  /** 제출된 '먼저/나중' 한 쌍을 서버에서 검증해 돌려줍니다. */
  function readPair(req, question) {
    const allowed = new Set(question.options.map((o) => o.id));
    const first = security.cleanOptionId(req.body.first, allowed);
    const last = security.cleanOptionId(req.body.last, allowed);
    if (!first || !last || first === last) return null;
    return [first, last];
  }

  // --- 렌더링 헬퍼 -------------------------------------------------------

  /** 문항 화면 왼쪽 프로필 영역에 쓸 정보. */
  function profileOf(participant) {
    const key = participant.predicted;
    return {
      name: participant.name || '',
      character: key ? (content.charactersByKey[key] || null) : null,
      unknown_label: content.text('predict.unknown_label', '???'),
    };
  }

  /** Part 1 진행 중에는 유형이 없으므로 세트 문항 수의 최댓값을 씁니다. */
  function part2MaxCount() {
    return Math.max(
      ...Object.values(content.part2Sets).map((block) => block.questions.length)
    );
  }

  function renderQuestion(req, res, {
    participant, question, index, total, part, saved = {}, error = false,
  }) {
    let badge;
    let overallIndex;
    let overallTotal;
    let prevUrl = null;

    if (part === 'p1') {
      badge = content.text('quiz.part1_badge');
      overallIndex = index;
      overallTotal = content.part1Count() + part2MaxCount();
      prevUrl = index > 1 ? `/q/p1/${index - 1}` : null;
    } else {
      badge = content.text('quiz.part2_badge');
      overallIndex = content.part1Count() + index;
      overallTotal = content.part1Count() + total;
      prevUrl = index > 1 ? `/q/p2/${index - 1}` : null;
    }

    res.status(error ? 400 : 200).render('question.html', {
      question,
      index,
      total,
      overall_index: overallIndex,
      overall_total: overallTotal,
      badge,
      part,
      saved,
      prev_url: prevUrl,
      profile: profileOf(participant),
      error,
      is_tiebreak: false,
      form_action: req.path,
    });
  }

  function renderTiebreak(req, res, {
    participant, question, options, part, error = false,
  }) {
    let overallIndex;
    let overallTotal;

    if (part === 'p1') {
      overallIndex = content.part1Count() + 1;
      overallTotal = content.part1Count() + 1;
    } else {
      const base = content.part1Count() + content.part2Count(req.session.typeKey);
      overallIndex = base + 1;
      overallTotal = base + 1;
    }

    res.status(error ? 400 : 200).render('question.html', {
      question: { ...question, options },
      index: 1,
      total: 1,
      overall_index: overallIndex,
      overall_total: overallTotal,
      badge: content.text('quiz.tie_badge'),
      part,
      saved: {},
      prev_url: null,
      profile: profileOf(participant),
      error,
      is_tiebreak: true,
      form_action: req.path,
    });
  }

  // ======================================================================
  //  로그인
  // ======================================================================

  router.get('/', (req, res) => {
    res.render('login.html', { error: null, form: {} });
  });

  router.post('/', (req, res) => {
    const limiter = limiters.login;
    const key = security.clientKey(req);
    const form = {
      code: typeof req.body.code === 'string' ? req.body.code : '',
      name: typeof req.body.name === 'string' ? req.body.name : '',
    };

    const [allowed, retryAfter] = limiter.check(key);
    if (!allowed) {
      return res.status(429).render('login.html', {
        error: content.text('login.error_too_many_attempts')
          .replace('{seconds}', String(retryAfter)),
        form,
      });
    }

    const code = security.cleanSessionCode(req.body.code);
    const name = security.cleanName(req.body.name);

    let error = null;

    if (code === null) {
      limiter.registerFailure(key);
      error = content.text('login.error_code_format');
    } else if (name === null) {
      const rawName = String(req.body.name || '').trim();
      error = content.text(
        rawName ? 'login.error_name_invalid' : 'login.error_name_required'
      );
    } else {
      const row = db.getSessionByCode(code);
      if (row === null) {
        limiter.registerFailure(key);
        error = content.text('login.error_code_unknown');
      } else if (!row.is_active) {
        error = content.text('login.error_code_closed');
      } else if (!row.allow_retake && db.participantNameTaken(row.id, name)) {
        error = content.text('login.error_duplicate_name');
      } else {
        limiter.reset(key);
        clearProgress(req);
        delete req.session.result;
        req.session.participant = {
          sessionId: row.id,
          code,
          name,
          predicted: null,
        };
        return res.redirect('/predict');
      }
    }

    return res.status(400).render('login.html', { error, form });
  });

  // ======================================================================
  //  캐릭터 예측
  // ======================================================================

  router.get('/predict', (req, res) => {
    const participant = participantOf(req);
    res.render('predict.html', {
      characters: content.characters,
      selected: participant.predicted,
      error: null,
    });
  });

  router.post('/predict', (req, res) => {
    const participant = participantOf(req);

    if (req.body.action === 'skip') {
      participant.predicted = null;
    } else {
      const key = security.cleanCharacterKey(
        req.body.character, new Set(Object.keys(content.charactersByKey))
      );
      if (key === null) {
        return res.status(400).render('predict.html', {
          characters: content.characters,
          selected: null,
          error: content.text('predict.submit_empty'),
        });
      }
      participant.predicted = key;
    }

    req.session.participant = participant;
    req.session.p1Answers = {};
    delete req.session.p1Tie;
    delete req.session.typeKey;
    delete req.session.p2Answers;
    delete req.session.p2Tie;

    return res.redirect('/q/p1/1');
  });

  // ======================================================================
  //  Part 1
  // ======================================================================

  router.get('/q/p1/:index(\\d+)', (req, res) => {
    const participant = participantOf(req);
    const index = Number.parseInt(req.params.index, 10);
    const total = content.part1Count();

    if (!(index >= 1 && index <= total)) {
      throw new InvalidFlow('존재하지 않는 문항입니다.');
    }

    const answers = answersOf(req, 'p1Answers');
    const question = content.part1Questions[index - 1];

    // 앞 문항을 건너뛴 채 접근하는 것을 막습니다.
    for (const earlier of content.part1Questions.slice(0, index - 1)) {
      if (!(earlier.id in answers)) {
        throw new InvalidFlow('이전 문항에 먼저 응답해 주세요.');
      }
    }

    renderQuestion(req, res, {
      participant, question, index, total, part: 'p1',
      saved: answers[question.id] || {},
    });
  });

  router.post('/q/p1/:index(\\d+)', (req, res) => {
    const participant = participantOf(req);
    const index = Number.parseInt(req.params.index, 10);
    const total = content.part1Count();

    if (!(index >= 1 && index <= total)) {
      throw new InvalidFlow('존재하지 않는 문항입니다.');
    }

    const answers = answersOf(req, 'p1Answers');
    const question = content.part1Questions[index - 1];

    for (const earlier of content.part1Questions.slice(0, index - 1)) {
      if (!(earlier.id in answers)) {
        throw new InvalidFlow('이전 문항에 먼저 응답해 주세요.');
      }
    }

    const pair = readPair(req, question);
    if (pair === null) {
      return renderQuestion(req, res, {
        participant, question, index, total, part: 'p1',
        saved: answers[question.id] || {}, error: true,
      });
    }

    answers[question.id] = { first: pair[0], last: pair[1] };
    req.session.p1Answers = answers;

    return res.redirect(index < total ? `/q/p1/${index + 1}` : '/q/p1/done');
  });

  router.get('/q/p1/done', (req, res) => {
    participantOf(req);
    const answers = answersOf(req, 'p1Answers');
    if (Object.keys(answers).length < content.part1Count()) {
      throw new InvalidFlow('Part 1 응답이 완료되지 않았습니다.');
    }
    const outcome = resolvePart1(req, answers);
    if (outcome.winner === null) return res.redirect('/tie/p1');
    req.session.typeKey = outcome.winner;
    return res.redirect('/interlude');
  });

  router.get('/tie/p1', (req, res) => {
    const participant = participantOf(req);
    const answers = answersOf(req, 'p1Answers');
    if (Object.keys(answers).length < content.part1Count()) {
      throw new InvalidFlow('Part 1 응답이 완료되지 않았습니다.');
    }

    const outcome = resolvePart1(req, answers);
    if (outcome.winner !== null) {
      req.session.typeKey = outcome.winner;
      return res.redirect('/interlude');
    }

    const question = content.part1Tiebreaker;
    const options = scoring.tiebreakerOptions(question, outcome.tied, 'type');
    return renderTiebreak(req, res, { participant, question, options, part: 'p1' });
  });

  router.post('/tie/p1', (req, res) => {
    const participant = participantOf(req);
    const answers = answersOf(req, 'p1Answers');
    if (Object.keys(answers).length < content.part1Count()) {
      throw new InvalidFlow('Part 1 응답이 완료되지 않았습니다.');
    }

    const outcome = resolvePart1(req, answers);
    if (outcome.winner !== null) {
      req.session.typeKey = outcome.winner;
      return res.redirect('/interlude');
    }

    const question = content.part1Tiebreaker;
    const options = scoring.tiebreakerOptions(question, outcome.tied, 'type');
    const allowed = new Set(options.map((o) => o.id));
    const choice = security.cleanOptionId(req.body.first, allowed);

    if (choice === null) {
      return renderTiebreak(req, res, {
        participant, question, options, part: 'p1', error: true,
      });
    }

    const picked = options.find((o) => o.id === choice);
    req.session.p1Tie = picked.type;
    req.session.typeKey = picked.type;
    return res.redirect('/interlude');
  });

  // ======================================================================
  //  전환 안내
  // ======================================================================

  router.get('/interlude', (req, res) => {
    participantOf(req);
    const typeKey = req.session.typeKey;
    if (!typeKey || !(typeKey in content.typesByKey)) {
      throw new InvalidFlow('유형이 아직 정해지지 않았습니다.');
    }
    res.render('interlude.html', { type_obj: content.typesByKey[typeKey] });
  });

  // ======================================================================
  //  Part 2
  // ======================================================================

  function requireType(req) {
    const typeKey = req.session.typeKey;
    if (!typeKey || !(typeKey in content.typesByKey)) {
      throw new InvalidFlow('유형이 아직 정해지지 않았습니다.');
    }
    return typeKey;
  }

  router.get('/q/p2/:index(\\d+)', (req, res) => {
    const participant = participantOf(req);
    const typeKey = requireType(req);
    const questions = content.part2Questions(typeKey);
    const total = questions.length;
    const index = Number.parseInt(req.params.index, 10);

    if (!(index >= 1 && index <= total)) {
      throw new InvalidFlow('존재하지 않는 문항입니다.');
    }

    const answers = answersOf(req, 'p2Answers');
    const question = questions[index - 1];

    for (const earlier of questions.slice(0, index - 1)) {
      if (!(earlier.id in answers)) {
        throw new InvalidFlow('이전 문항에 먼저 응답해 주세요.');
      }
    }

    renderQuestion(req, res, {
      participant, question, index, total, part: 'p2',
      saved: answers[question.id] || {},
    });
  });

  router.post('/q/p2/:index(\\d+)', (req, res) => {
    const participant = participantOf(req);
    const typeKey = requireType(req);
    const questions = content.part2Questions(typeKey);
    const total = questions.length;
    const index = Number.parseInt(req.params.index, 10);

    if (!(index >= 1 && index <= total)) {
      throw new InvalidFlow('존재하지 않는 문항입니다.');
    }

    const answers = answersOf(req, 'p2Answers');
    const question = questions[index - 1];

    for (const earlier of questions.slice(0, index - 1)) {
      if (!(earlier.id in answers)) {
        throw new InvalidFlow('이전 문항에 먼저 응답해 주세요.');
      }
    }

    const pair = readPair(req, question);
    if (pair === null) {
      return renderQuestion(req, res, {
        participant, question, index, total, part: 'p2',
        saved: answers[question.id] || {}, error: true,
      });
    }

    answers[question.id] = { first: pair[0], last: pair[1] };
    req.session.p2Answers = answers;

    return res.redirect(index < total ? `/q/p2/${index + 1}` : '/q/p2/done');
  });

  router.get('/q/p2/done', (req, res) => {
    participantOf(req);
    const typeKey = requireType(req);
    const answers = answersOf(req, 'p2Answers');
    if (Object.keys(answers).length < content.part2Count(typeKey)) {
      throw new InvalidFlow('Part 2 응답이 완료되지 않았습니다.');
    }
    const outcome = resolvePart2(req, typeKey, answers);
    if (outcome.winner === null) return res.redirect('/tie/p2');
    return res.redirect('/result');
  });

  router.get('/tie/p2', (req, res) => {
    const participant = participantOf(req);
    const typeKey = requireType(req);
    const answers = answersOf(req, 'p2Answers');
    if (Object.keys(answers).length < content.part2Count(typeKey)) {
      throw new InvalidFlow('Part 2 응답이 완료되지 않았습니다.');
    }

    const outcome = resolvePart2(req, typeKey, answers);
    if (outcome.winner !== null) return res.redirect('/result');

    const question = content.part2Tiebreaker(typeKey);
    const options = scoring.tiebreakerOptions(question, outcome.tied, 'competency');
    return renderTiebreak(req, res, { participant, question, options, part: 'p2' });
  });

  router.post('/tie/p2', (req, res) => {
    const participant = participantOf(req);
    const typeKey = requireType(req);
    const answers = answersOf(req, 'p2Answers');
    if (Object.keys(answers).length < content.part2Count(typeKey)) {
      throw new InvalidFlow('Part 2 응답이 완료되지 않았습니다.');
    }

    const outcome = resolvePart2(req, typeKey, answers);
    if (outcome.winner !== null) return res.redirect('/result');

    const question = content.part2Tiebreaker(typeKey);
    const options = scoring.tiebreakerOptions(question, outcome.tied, 'competency');
    const allowed = new Set(options.map((o) => o.id));
    const choice = security.cleanOptionId(req.body.first, allowed);

    if (choice === null) {
      return renderTiebreak(req, res, {
        participant, question, options, part: 'p2', error: true,
      });
    }

    const picked = options.find((o) => o.id === choice);
    req.session.p2Tie = picked.competency;
    return res.redirect('/result');
  });

  // ======================================================================
  //  결과
  // ======================================================================

  router.get('/result', (req, res) => {
    // 이미 산출된 결과가 있으면 그대로 보여 줍니다(새로고침 대응).
    const cached = req.session.result;
    if (cached && typeof cached === 'object' && cached.character) {
      return renderResult(res, cached);
    }

    const participant = participantOf(req);
    const typeKey = requireType(req);

    const p1Answers = answersOf(req, 'p1Answers');
    const p2Answers = answersOf(req, 'p2Answers');
    if (Object.keys(p2Answers).length < content.part2Count(typeKey)) {
      throw new InvalidFlow('Part 2 응답이 완료되지 않았습니다.');
    }

    const p1Outcome = resolvePart1(req, p1Answers);
    const p2Outcome = resolvePart2(req, typeKey, p2Answers);
    if (p2Outcome.winner === null) return res.redirect('/tie/p2');

    const character = content.character(typeKey, p2Outcome.winner);
    if (!character) {
      const err = new Error(`캐릭터 매칭 실패: ${typeKey} + ${p2Outcome.winner}`);
      err.status = 500;
      throw err;
    }

    // '함께 나타난 성향': 동점이었던 다른 후보의 캐릭터
    const companions = [];
    for (const otherType of scoring.companionAxes(p1Outcome)) {
      let other = content.character(otherType, p2Outcome.winner);
      // 다른 유형에 같은 역량이 없을 수 있으므로 그 유형의 첫 역량으로 대체합니다.
      if (!other) {
        const fallback = content.typesByKey[otherType].competencies[0];
        other = content.character(otherType, fallback);
      }
      if (other) companions.push(other.key);
    }
    for (const otherComp of scoring.companionAxes(p2Outcome)) {
      const other = content.character(typeKey, otherComp);
      if (other) companions.push(other.key);
    }
    // 중복 제거(순서 유지) + 본인 캐릭터 제외
    const uniqueCompanions = [...new Set(companions)].filter((k) => k !== character.key);

    const hadTie = p1Outcome.hadTie || p2Outcome.hadTie;

    try {
      db.saveParticipant({
        sessionId: participant.sessionId,
        name: participant.name,
        predictedCharacter: participant.predicted,
        resultType: typeKey,
        resultCharacter: character.key,
        typeScores: p1Outcome.scores,
        competencyScores: p2Outcome.scores,
        hadTie,
      });
    } catch (err) {
      // 저장 실패로 결과를 못 보는 일은 없게 합니다.
      console.error('[HLTI] 응답 저장 실패:', err.message);
    }

    const payload = {
      character: character.key,
      type: typeKey,
      competency: p2Outcome.winner,
      predicted: participant.predicted,
      companions: uniqueCompanions,
      name: participant.name,
    };

    // 결과 산출이 끝났으므로 응답 원본과 로그인 정보를 세션에서 정리합니다.
    clearProgress(req);
    req.session.result = payload;

    return renderResult(res, payload);
  });

  return router;
};
