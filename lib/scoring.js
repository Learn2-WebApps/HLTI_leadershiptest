'use strict';

/**
 * 채점 로직.
 *
 * Express 에 의존하지 않는 순수 함수만 둡니다. 덕분에 단위 테스트가 쉽고,
 * 웹 요청 흐름과 무관하게 규칙만 따로 검증할 수 있습니다.
 *
 * 채점 규칙
 *   - '가장 먼저 할 행동' 선택지의 축(유형 또는 역량)에 +1
 *   - '가장 나중에 할 행동' 선택지의 축에 -1
 *   - 축별로 합산하여 최고점이 결과. 최고점이 둘 이상이면 동점.
 *   - 동점이면 tiebreaker 문항의 선택 결과가 최종 승자가 된다.
 */

/**
 * @typedef {Object} Outcome
 * @property {string|null} winner  확정된 축. 동점이 풀리지 않았으면 null.
 * @property {string[]}    tied    최고점을 공유한 축 목록.
 * @property {Object}      scores  축별 점수.
 * @property {boolean}     hadTie  원점수 기준으로 동점이 있었는지 여부.
 */

/**
 * 문항 목록과 응답으로 축별 점수를 계산합니다.
 *
 * axes 에 주어진 축은 응답에 등장하지 않아도 0 으로 초기화됩니다.
 * 알 수 없는 문항 id, 알 수 없는 선택지 id, first === last 인 응답은 무시합니다
 * (서버에서 이미 거르지만, 채점 단계에서도 방어합니다).
 *
 * @param {Array}  questions  문항 배열
 * @param {Object} answers    { 문항id: { first, last } }
 * @param {string} axisField  'type' 또는 'competency'
 * @param {Array}  axes       0 으로 초기화할 축 목록
 * @returns {Object} 축별 점수
 */
function scoreQuestions(questions, answers, axisField, axes) {
  const scores = Object.create(null);
  for (const axis of axes) scores[axis] = 0;

  const byId = new Map();
  for (const q of questions) byId.set(q.id, q);

  for (const [qid, answer] of Object.entries(answers || {})) {
    const question = byId.get(qid);
    if (!question || !answer) continue;

    const firstId = answer.first;
    const lastId = answer.last;
    if (!firstId || !lastId || firstId === lastId) continue;

    const options = question.options || [];
    const firstOpt = options.find((o) => o.id === firstId);
    const lastOpt = options.find((o) => o.id === lastId);
    if (!firstOpt || !lastOpt) continue;

    const firstAxis = firstOpt[axisField];
    const lastAxis = lastOpt[axisField];
    if (typeof firstAxis === 'string') {
      scores[firstAxis] = (scores[firstAxis] || 0) + 1;
    }
    if (typeof lastAxis === 'string') {
      scores[lastAxis] = (scores[lastAxis] || 0) - 1;
    }
  }

  return scores;
}

/**
 * 점수에서 승자를 정합니다.
 *
 * 최고점이 하나면 그것이 승자입니다.
 * 최고점이 여럿이면 동점이며, tiebreakAxis 가 동점 후보 안에 있으면
 * 그 축이 승자가 됩니다. 아직 tiebreaker 응답이 없으면 winner 는 null 입니다.
 *
 * @param {Object} scores
 * @param {string|null} [tiebreakAxis]
 * @returns {Outcome}
 */
function resolve(scores, tiebreakAxis = null) {
  const entries = Object.entries(scores || {});
  if (entries.length === 0) {
    return { winner: null, tied: [], scores: {}, hadTie: false };
  }

  const top = Math.max(...entries.map(([, v]) => v));
  const tied = entries
    .filter(([, v]) => v === top)
    .map(([k]) => k)
    .sort();
  const hadTie = tied.length > 1;
  const copy = { ...scores };

  if (!hadTie) {
    return { winner: tied[0], tied, scores: copy, hadTie: false };
  }

  if (tiebreakAxis != null && tied.includes(tiebreakAxis)) {
    return { winner: tiebreakAxis, tied, scores: copy, hadTie: true };
  }

  return { winner: null, tied, scores: copy, hadTie: true };
}

/** Part 1 을 채점해 유형을 판정합니다. */
function scorePart1(questions, answers, typeKeys, tiebreakType = null) {
  const scores = scoreQuestions(questions, answers, 'type', typeKeys);
  return resolve(scores, tiebreakType);
}

/** Part 2 를 채점해 대표 역량을 판정합니다. */
function scorePart2(questions, answers, competencies, tiebreakCompetency = null) {
  const scores = scoreQuestions(questions, answers, 'competency', competencies);
  return resolve(scores, tiebreakCompetency);
}

/** 동점 판별 문항에서 동점 축에 해당하는 선택지만 골라 돌려줍니다. */
function tiebreakerOptions(question, tiedAxes, axisField) {
  const tied = new Set(tiedAxes);
  return (question.options || [])
    .filter((opt) => tied.has(opt[axisField]))
    .map((opt) => ({ ...opt }));
}

/** 동점이었을 때, 확정된 승자를 뺀 '함께 나타난' 축 목록. */
function companionAxes(outcome) {
  if (!outcome.hadTie || outcome.winner == null) return [];
  return outcome.tied.filter((axis) => axis !== outcome.winner);
}

module.exports = {
  scoreQuestions,
  resolve,
  scorePart1,
  scorePart2,
  tiebreakerOptions,
  companionAxes,
};
