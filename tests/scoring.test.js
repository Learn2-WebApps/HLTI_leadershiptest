'use strict';

/**
 * 채점 로직 단위 테스트.
 *
 * 실행:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const scoring = require('../lib/scoring');
const security = require('../lib/security');
const { Content } = require('../lib/content');

const TYPES = ['connector', 'creator', 'master', 'driver'];

/** (선택지 id, 유형) 쌍으로 문항을 만듭니다. */
function q(id, ...pairs) {
  return {
    id,
    situation: '테스트 상황',
    options: pairs.map(([oid, axis]) => ({ id: oid, text: oid, type: axis })),
  };
}

/** 역량 축 문항. */
function qc(id, ...pairs) {
  return {
    id,
    situation: '테스트 상황',
    options: pairs.map(([oid, axis]) => ({ id: oid, text: oid, competency: axis })),
  };
}

const STD = [['a', 'connector'], ['b', 'creator'], ['c', 'master'], ['d', 'driver']];

// ======================================================================
test('scoreQuestions', async (t) => {
  await t.test('가장 먼저 +1, 가장 나중 -1', () => {
    const scores = scoring.scoreQuestions(
      [q('q1', ...STD)], { q1: { first: 'a', last: 'd' } }, 'type', TYPES
    );
    assert.equal(scores.connector, 1);
    assert.equal(scores.driver, -1);
    assert.equal(scores.creator, 0);
    assert.equal(scores.master, 0);
  });

  await t.test('등장하지 않은 축도 0 으로 초기화', () => {
    const scores = scoring.scoreQuestions([], {}, 'type', TYPES);
    assert.deepEqual({ ...scores }, { connector: 0, creator: 0, master: 0, driver: 0 });
  });

  await t.test('여러 문항에 걸쳐 누적', () => {
    const questions = [q('q1', ...STD), q('q2', ...STD), q('q3', ...STD)];
    const answers = {
      q1: { first: 'a', last: 'b' },
      q2: { first: 'a', last: 'c' },
      q3: { first: 'd', last: 'b' },
    };
    const scores = scoring.scoreQuestions(questions, answers, 'type', TYPES);
    assert.equal(scores.connector, 2);
    assert.equal(scores.creator, -2);
    assert.equal(scores.master, -1);
    assert.equal(scores.driver, 1);
  });

  await t.test('알 수 없는 문항 id 는 무시', () => {
    const scores = scoring.scoreQuestions(
      [q('q1', ...STD)], { nope: { first: 'a', last: 'b' } }, 'type', TYPES
    );
    assert.deepEqual({ ...scores }, { connector: 0, creator: 0, master: 0, driver: 0 });
  });

  await t.test('알 수 없는 선택지 id 는 무시', () => {
    const scores = scoring.scoreQuestions(
      [q('q1', ...STD)], { q1: { first: 'zzz', last: 'b' } }, 'type', TYPES
    );
    assert.deepEqual({ ...scores }, { connector: 0, creator: 0, master: 0, driver: 0 });
  });

  await t.test('first 와 last 가 같으면 무시', () => {
    const scores = scoring.scoreQuestions(
      [q('q1', ...STD)], { q1: { first: 'a', last: 'a' } }, 'type', TYPES
    );
    assert.deepEqual({ ...scores }, { connector: 0, creator: 0, master: 0, driver: 0 });
  });

  await t.test('3지선다 문항', () => {
    const questions = [qc('q1', ['a', 'authority'], ['b', 'clear_direction'],
                          ['c', 'leading_by_example'])];
    const axes = ['authority', 'clear_direction', 'leading_by_example'];
    const scores = scoring.scoreQuestions(
      questions, { q1: { first: 'b', last: 'a' } }, 'competency', axes
    );
    assert.deepEqual({ ...scores },
      { authority: -1, clear_direction: 1, leading_by_example: 0 });
  });
});

// ======================================================================
test('resolve', async (t) => {
  await t.test('단독 1위', () => {
    const o = scoring.resolve({ connector: 3, creator: 1, master: 0, driver: -2 });
    assert.equal(o.winner, 'connector');
    assert.equal(o.hadTie, false);
    assert.deepEqual(o.tied, ['connector']);
  });

  await t.test('2자 동점 — 판별 전에는 승자 없음', () => {
    const o = scoring.resolve({ connector: 2, creator: 2, master: 0, driver: -1 });
    assert.equal(o.winner, null);
    assert.equal(o.hadTie, true);
    assert.deepEqual(o.tied, ['connector', 'creator']);
  });

  await t.test('2자 동점 — tiebreaker 로 해소', () => {
    const o = scoring.resolve({ connector: 2, creator: 2, master: 0, driver: -1 }, 'creator');
    assert.equal(o.winner, 'creator');
    assert.equal(o.hadTie, true);
    assert.deepEqual(o.tied, ['connector', 'creator']);
  });

  await t.test('3자 동점', () => {
    const o = scoring.resolve({ connector: 1, creator: 1, master: 1, driver: -3 });
    assert.equal(o.winner, null);
    assert.deepEqual(o.tied, ['connector', 'creator', 'master']);
  });

  await t.test('4자 동점 (전부 0점)', () => {
    const o = scoring.resolve({ connector: 0, creator: 0, master: 0, driver: 0 });
    assert.equal(o.winner, null);
    assert.equal(o.tied.length, 4);
    assert.equal(o.hadTie, true);
  });

  await t.test('동점 후보가 아닌 tiebreak 값은 무시 (위조 방지)', () => {
    const o = scoring.resolve({ connector: 2, creator: 2, master: 0, driver: -1 }, 'driver');
    assert.equal(o.winner, null);
    assert.equal(o.hadTie, true);
  });

  await t.test('동점이 아니면 tiebreak 값은 무시', () => {
    const o = scoring.resolve({ connector: 3, creator: 1, master: 0, driver: -2 }, 'creator');
    assert.equal(o.winner, 'connector');
    assert.equal(o.hadTie, false);
  });

  await t.test('전부 음수여도 최고점이 승자', () => {
    const o = scoring.resolve({ connector: -1, creator: -3, master: -2, driver: -4 });
    assert.equal(o.winner, 'connector');
  });

  await t.test('빈 점수', () => {
    const o = scoring.resolve({});
    assert.equal(o.winner, null);
    assert.deepEqual(o.tied, []);
    assert.equal(o.hadTie, false);
  });

  await t.test('원본 점수 객체를 변경하지 않음', () => {
    const scores = { connector: 1, creator: 0 };
    const o = scoring.resolve(scores);
    o.scores.connector = 999;
    assert.equal(scores.connector, 1);
  });
});

// ======================================================================
test('Part 채점', async (t) => {
  await t.test('Part 1 전 과정', () => {
    const questions = [1, 2, 3, 4].map((i) => q(`q${i}`, ...STD));
    const answers = {
      q1: { first: 'a', last: 'd' },
      q2: { first: 'a', last: 'c' },
      q3: { first: 'a', last: 'b' },
      q4: { first: 'b', last: 'd' },
    };
    const o = scoring.scorePart1(questions, answers, TYPES);
    assert.equal(o.winner, 'connector');
    assert.equal(o.scores.connector, 3);
    assert.equal(o.scores.driver, -2);
  });

  await t.test('Part 1 동점 후 tiebreaker', () => {
    const questions = [q('q1', ...STD), q('q2', ...STD)];
    const answers = {
      q1: { first: 'a', last: 'c' },
      q2: { first: 'b', last: 'd' },
    };
    const o = scoring.scorePart1(questions, answers, TYPES);
    assert.equal(o.winner, null);
    assert.deepEqual(o.tied, ['connector', 'creator']);

    const resolved = scoring.scorePart1(questions, answers, TYPES, 'connector');
    assert.equal(resolved.winner, 'connector');
    assert.equal(resolved.hadTie, true);
  });

  await t.test('Part 2 3지선다 동점', () => {
    const axes = ['authority', 'clear_direction', 'leading_by_example'];
    const questions = [
      qc('q1', ['a', 'authority'], ['b', 'clear_direction'], ['c', 'leading_by_example']),
      qc('q2', ['a', 'authority'], ['b', 'clear_direction'], ['c', 'leading_by_example']),
    ];
    const answers = {
      q1: { first: 'a', last: 'c' },
      q2: { first: 'b', last: 'c' },
    };
    const o = scoring.scorePart2(questions, answers, axes);
    assert.equal(o.winner, null);
    assert.deepEqual(o.tied, ['authority', 'clear_direction']);

    const resolved = scoring.scorePart2(questions, answers, axes, 'clear_direction');
    assert.equal(resolved.winner, 'clear_direction');
  });
});

// ======================================================================
test('tiebreakerOptions', async (t) => {
  await t.test('동점 축의 선택지만 노출', () => {
    const options = scoring.tiebreakerOptions(
      q('tie', ...STD), ['connector', 'master'], 'type'
    );
    assert.deepEqual(options.map((o) => o.id), ['a', 'c']);
  });

  await t.test('원래 순서를 유지', () => {
    const options = scoring.tiebreakerOptions(
      q('tie', ...STD), ['driver', 'connector'], 'type'
    );
    assert.deepEqual(options.map((o) => o.id), ['a', 'd']);
  });

  await t.test('원본이 아닌 복사본을 돌려줌', () => {
    const tie = q('tie', ...STD);
    const options = scoring.tiebreakerOptions(tie, ['connector'], 'type');
    options[0].text = '바뀜';
    assert.equal(tie.options[0].text, 'a');
  });

  await t.test('역량 축', () => {
    const tie = qc('tie', ['a', 'teamwork'], ['b', 'trust_building'],
                   ['c', 'development'], ['d', 'conflict_management']);
    const options = scoring.tiebreakerOptions(tie, ['teamwork', 'development'], 'competency');
    assert.deepEqual(options.map((o) => o.id), ['a', 'c']);
  });
});

// ======================================================================
test('companionAxes', async (t) => {
  await t.test('동점이 아니면 없음', () => {
    assert.deepEqual(
      scoring.companionAxes({ winner: 'connector', tied: ['connector'], hadTie: false }), []
    );
  });

  await t.test('미해소 동점이면 없음', () => {
    assert.deepEqual(
      scoring.companionAxes({ winner: null, tied: ['connector', 'creator'], hadTie: true }), []
    );
  });

  await t.test('해소된 동점이면 나머지를 반환', () => {
    assert.deepEqual(
      scoring.companionAxes({
        winner: 'connector', tied: ['connector', 'creator', 'master'], hadTie: true,
      }),
      ['creator', 'master']
    );
  });
});

// ======================================================================
test('실제 data/ 파일', async (t) => {
  const dataDir = path.join(__dirname, '..', 'data');
  const content = new Content(dataDir);

  await t.test('Part 1 은 12문항', () => {
    assert.equal(content.part1Count(), 12);
  });

  await t.test('Part 1 각 문항이 4개 유형을 정확히 한 번씩 포함', () => {
    for (const question of content.part1Questions) {
      const types = question.options.map((o) => o.type).sort();
      assert.deepEqual(types, [...TYPES].sort(), `${question.id} 의 유형 구성이 다릅니다`);
    }
  });

  await t.test('Part 2 선택지 수가 명세와 일치', () => {
    const expected = { connector: 4, master: 4, creator: 3, driver: 3 };
    for (const [typeKey, count] of Object.entries(expected)) {
      for (const question of content.part2Questions(typeKey)) {
        assert.equal(question.options.length, count,
          `${question.id} 의 선택지 수가 ${count} 가 아닙니다`);
      }
    }
  });

  await t.test('Part 2 는 유형별 6문항', () => {
    for (const typeKey of content.typeKeys) {
      assert.equal(content.part2Count(typeKey), 6);
    }
  });

  await t.test('모든 유형·역량 조합에 캐릭터가 있음', () => {
    for (const typeObj of content.types) {
      for (const comp of typeObj.competencies) {
        assert.ok(content.character(typeObj.key, comp),
          `${typeObj.key} + ${comp} 캐릭터 없음`);
      }
    }
  });

  await t.test('캐릭터는 14개', () => {
    assert.equal(content.characters.length, 14);
  });

  await t.test('모든 캐릭터 이미지가 디스크에 존재', () => {
    const base = path.join(__dirname, '..', 'static', 'images', 'characters');
    const missing = content.characters
      .map((c) => c.image)
      .filter((image) => !fs.existsSync(path.join(base, image)));
    assert.deepEqual(missing, [], `이미지 파일 없음: ${missing}`);
  });

  await t.test('전 과정을 돌리면 캐릭터가 나옴', () => {
    const answers = {};
    for (const question of content.part1Questions) {
      const first = question.options.find((o) => o.type === 'connector').id;
      const last = question.options.find((o) => o.type === 'driver').id;
      answers[question.id] = { first, last };
    }

    const o = scoring.scorePart1(content.part1Questions, answers, content.typeKeys);
    assert.equal(o.winner, 'connector');
    assert.equal(o.scores.connector, 12);
    assert.equal(o.scores.driver, -12);

    const questions = content.part2Questions('connector');
    const p2Answers = {};
    for (const question of questions) {
      const opts = question.options;
      const first = (opts.find((x) => x.competency === 'teamwork') || opts[0]).id;
      const last = (opts.find((x) => x.id !== first) || opts[opts.length - 1]).id;
      p2Answers[question.id] = { first, last };
    }

    const p2 = scoring.scorePart2(
      questions, p2Answers, content.typesByKey.connector.competencies
    );
    assert.equal(p2.winner, 'teamwork');

    const character = content.character('connector', 'teamwork');
    assert.ok(character);
    assert.equal(character.name, '원팀 커넥터');
  });

  await t.test('Part 1 동점 문항이 4개 유형을 모두 포함', () => {
    const types = content.part1Tiebreaker.options.map((o) => o.type).sort();
    assert.deepEqual(types, [...TYPES].sort());
  });

  await t.test('Part 2 동점 문항이 해당 유형의 역량을 모두 포함', () => {
    for (const typeObj of content.types) {
      const comps = content.part2Tiebreaker(typeObj.key)
        .options.map((o) => o.competency).sort();
      assert.deepEqual(comps, [...typeObj.competencies].sort(),
        `${typeObj.key} 동점 문항의 역량 구성이 다릅니다`);
    }
  });

  await t.test('texts.json 에 필요한 문구가 모두 있음', () => {
    const required = [
      'brand.full_name', 'brand.slogan', 'brand.download_filename',
      'login.intro', 'predict.guide', 'quiz.first_prompt', 'quiz.last_prompt',
      'result.code_label', 'result.disclaimer',
      'compare.exact_match', 'compare.same_type', 'compare.different_type',
    ];
    for (const p of required) {
      assert.ok(content.text(p), `texts.json 에 ${p} 가 비어 있습니다`);
    }
  });

  await t.test('결과 하단 안내 문구가 교체된 문장', () => {
    assert.match(content.text('result.disclaimer'), /리더십의 우열이나 고정된 성격을 판단하지 않으며/);
  });
});

// ======================================================================
test('보안 유틸리티', async (t) => {
  await t.test('이름 — 한글/영문 허용', () => {
    assert.equal(security.cleanName('홍길동'), '홍길동');
    assert.equal(security.cleanName('  김 파트장  '), '김 파트장');
    assert.equal(security.cleanName('Kim Minsu'), 'Kim Minsu');
  });

  await t.test('이름 — 스크립트 주입 거부', () => {
    const bad = ['<script>alert(1)</script>', '홍길동<img src=x>', "a'; DROP TABLE--",
                 '', ' ', '김', '가'.repeat(21)];
    for (const value of bad) {
      assert.equal(security.cleanName(value), null, `거부되어야 함: ${JSON.stringify(value)}`);
    }
  });

  await t.test('이름 — 제어문자 제거', () => {
    assert.equal(security.cleanName('홍 길동'), '홍길동');
  });

  await t.test('세션 코드 검증', () => {
    assert.equal(security.cleanSessionCode('0067'), '0067');
    assert.equal(security.cleanSessionCode(' 1234 '), '1234');
    for (const bad of ['123', '12345', 'abcd', '12a4', '', null, '-123']) {
      assert.equal(security.cleanSessionCode(bad), null,
        `거부되어야 함: ${JSON.stringify(bad)}`);
    }
  });

  await t.test('선택지 id 는 허용 집합 안에 있어야 함', () => {
    const allowed = new Set(['a', 'b', 'c', 'd']);
    assert.equal(security.cleanOptionId('a', allowed), 'a');
    assert.equal(security.cleanOptionId('z', allowed), null);
    assert.equal(security.cleanOptionId('<b>', allowed), null);
    assert.equal(security.cleanOptionId(null, allowed), null);
  });

  await t.test('비밀번호 해시 왕복', () => {
    const stored = security.hashPassword('test-pw-1234');
    assert.equal(security.verifyPassword('test-pw-1234', stored), true);
    assert.equal(security.verifyPassword('test-pw-9999', stored), false);
    assert.equal(security.verifyPassword('', stored), false);
    assert.equal(security.verifyPassword('test-pw-1234', 'garbage'), false);
  });

  await t.test('해시에 솔트가 적용됨', () => {
    const a = security.hashPassword('same');
    const b = security.hashPassword('same');
    assert.notEqual(a, b);
    assert.equal(security.verifyPassword('same', a), true);
    assert.equal(security.verifyPassword('same', b), true);
  });

  await t.test('해시 문자열에 평문이 들어 있지 않음', () => {
    assert.ok(!security.hashPassword('test-pw-1234').includes('test-pw-1234'));
  });

  await t.test('시도 제한 — 초과하면 차단', async () => {
    const limiter = new security.RateLimiter(3, 60);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await limiter.check('1.2.3.4'))[0], true);
      await limiter.registerFailure('1.2.3.4');
    }
    const [allowed, retryAfter] = await limiter.check('1.2.3.4');
    assert.equal(allowed, false);
    assert.ok(retryAfter > 0);
  });

  await t.test('시도 제한 — 키마다 따로', async () => {
    const limiter = new security.RateLimiter(2, 60);
    await limiter.registerFailure('1.1.1.1');
    await limiter.registerFailure('1.1.1.1');
    assert.equal((await limiter.check('1.1.1.1'))[0], false);
    assert.equal((await limiter.check('2.2.2.2'))[0], true);
  });

  await t.test('시도 제한 — reset', async () => {
    const limiter = new security.RateLimiter(1, 60);
    await limiter.registerFailure('k');
    assert.equal((await limiter.check('k'))[0], false);
    await limiter.reset('k');
    assert.equal((await limiter.check('k'))[0], true);
  });

  await t.test('CSRF — 토큰 불일치 거부', () => {
    const req = { session: { csrfToken: 'abc123' } };
    assert.equal(security.validateCsrf(req, 'abc123'), true);
    assert.equal(security.validateCsrf(req, 'abc124'), false);
    assert.equal(security.validateCsrf(req, 'abc'), false);
    assert.equal(security.validateCsrf(req, ''), false);
    assert.equal(security.validateCsrf(req, null), false);
    assert.equal(security.validateCsrf({ session: {} }, 'abc123'), false);
  });

  await t.test('CSRF — 토큰 재발급 시 이전 토큰 무효', () => {
    const req = { session: {} };
    const first = security.getCsrfToken(req);
    assert.equal(security.validateCsrf(req, first), true);
    const second = security.rotateCsrfToken(req);
    assert.notEqual(first, second);
    assert.equal(security.validateCsrf(req, first), false);
    assert.equal(security.validateCsrf(req, second), true);
  });

  await t.test('세션 이름 검증', () => {
    assert.equal(security.cleanSessionName('3월 파트장 교육 1차'), '3월 파트장 교육 1차');
    assert.equal(security.cleanSessionName(''), null);
    assert.equal(security.cleanSessionName('가'.repeat(61)), null);
  });
});
