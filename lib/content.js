'use strict';

/**
 * data/ 의 JSON 콘텐츠를 앱 시작 시 1회 로딩하고 검증한 뒤 메모리에 캐싱합니다.
 *
 * 문항·문구는 전부 이 모듈을 통해서만 읽습니다. 코드에 하드코딩하지 않습니다.
 * 로딩 시점에 스키마를 검증해, 데이터가 잘못되면 요청 처리 중이 아니라
 * 기동 시점에 분명한 메시지와 함께 실패하도록 합니다.
 */

const fs = require('node:fs');
const path = require('node:path');

class ContentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentError';
  }
}

function readJson(filePath) {
  const name = path.basename(filePath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ContentError(`데이터 파일을 찾을 수 없습니다: ${name} (${filePath})`);
    }
    throw new ContentError(`${name} 을(를) 읽을 수 없습니다: ${err.message}`);
  }
  try {
    // BOM 이 있으면 제거합니다.
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (err) {
    throw new ContentError(`${name} 의 JSON 형식이 올바르지 않습니다: ${err.message}`);
  }
}

function require_(condition, message) {
  if (!condition) throw new ContentError(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 문항 하나의 형식을 검증합니다. */
function validateQuestion(q, where, { needType = false, needCompetency = false,
                                      allowedCompetencies = null } = {}) {
  require_(isObject(q), `${where}: 문항은 객체여야 합니다.`);
  require_('id' in q, `${where}: 문항에 'id' 가 없습니다.`);
  require_('situation' in q, `${where}: 문항 '${q.id}' 에 'situation' 이 없습니다.`);
  require_(
    Array.isArray(q.options) && q.options.length >= 2,
    `${where}: 문항 '${q.id}' 의 선택지가 2개 미만입니다.`
  );

  const seen = new Set();
  for (const opt of q.options) {
    require_(isObject(opt), `${where}: '${q.id}' 선택지가 객체가 아닙니다.`);
    require_('id' in opt && 'text' in opt,
      `${where}: '${q.id}' 선택지에 id/text 가 없습니다.`);
    require_(!seen.has(opt.id),
      `${where}: '${q.id}' 에 중복된 선택지 id '${opt.id}' 가 있습니다.`);
    seen.add(opt.id);

    if (needType) {
      require_('type' in opt,
        `${where}: '${q.id}' 선택지 '${opt.id}' 에 type 이 없습니다.`);
    }
    if (needCompetency) {
      require_('competency' in opt,
        `${where}: '${q.id}' 선택지 '${opt.id}' 에 competency 가 없습니다.`);
      if (allowedCompetencies) {
        require_(allowedCompetencies.has(opt.competency),
          `${where}: '${q.id}' 의 역량 '${opt.competency}' 는 이 유형의 역량이 아닙니다.`);
      }
    }
  }
}

class Content {
  constructor(dataDir) {
    const texts = readJson(path.join(dataDir, 'texts.json'));
    const typesRaw = readJson(path.join(dataDir, 'types.json'));
    const p1 = readJson(path.join(dataDir, 'questions_part1.json'));
    const p2 = readJson(path.join(dataDir, 'questions_part2.json'));
    const charsRaw = readJson(path.join(dataDir, 'characters.json'));

    // --- texts ---------------------------------------------------------
    require_(isObject(texts), 'texts.json 의 최상위는 객체여야 합니다.');
    for (const section of ['brand', 'login', 'predict', 'quiz', 'interlude',
                           'result', 'compare', 'errors', 'admin']) {
      require_(isObject(texts[section]),
        `texts.json 에 '${section}' 항목이 없거나 객체가 아닙니다.`);
    }
    this.texts = texts;

    // --- types ---------------------------------------------------------
    require_(isObject(typesRaw), 'types.json 의 최상위는 객체여야 합니다.');
    require_(Array.isArray(typesRaw.types) && typesRaw.types.length === 4,
      "types.json 의 'types' 는 4개 항목의 배열이어야 합니다.");

    this.competencyLabels = typesRaw.competency_labels || {};
    require_(isObject(this.competencyLabels) && Object.keys(this.competencyLabels).length > 0,
      "types.json 에 'competency_labels' 가 없습니다.");
    this.resultDisclaimer = typesRaw.result_disclaimer || '';

    this.types = typesRaw.types;
    this.typesByKey = Object.create(null);
    for (const t of this.types) {
      for (const field of ['key', 'name', 'description', 'overuse_name',
                           'overuse_description', 'competencies']) {
        require_(field in t, `types.json 의 유형에 '${field}' 가 없습니다: ${t.key}`);
      }
      require_(Array.isArray(t.competencies) && t.competencies.length > 0,
        `types.json 의 '${t.key}' 에 competencies 배열이 없습니다.`);
      for (const comp of t.competencies) {
        require_(comp in this.competencyLabels,
          `types.json: '${comp}' 에 대한 competency_labels 항목이 없습니다.`);
      }
      this.typesByKey[t.key] = t;
    }
    this.typeKeys = this.types.map((t) => t.key);

    // --- part 1 --------------------------------------------------------
    require_(isObject(p1), 'questions_part1.json 의 최상위는 객체여야 합니다.');
    this.part1Instruction = p1.instruction || '';
    require_(Array.isArray(p1.questions) && p1.questions.length > 0,
      "questions_part1.json 에 'questions' 배열이 없습니다.");
    for (const q of p1.questions) {
      validateQuestion(q, 'questions_part1.json', { needType: true });
    }
    this.part1Questions = p1.questions;

    require_(isObject(p1.tiebreaker), "questions_part1.json 에 'tiebreaker' 가 없습니다.");
    validateQuestion(p1.tiebreaker, 'questions_part1.json tiebreaker', { needType: true });
    this.part1Tiebreaker = p1.tiebreaker;

    // --- part 2 --------------------------------------------------------
    require_(isObject(p2), 'questions_part2.json 의 최상위는 객체여야 합니다.');
    this.part2Instruction = p2.instruction || '';
    require_(isObject(p2.sets), "questions_part2.json 에 'sets' 가 없습니다.");

    for (const typeKey of this.typeKeys) {
      require_(typeKey in p2.sets, `questions_part2.json 에 '${typeKey}' 세트가 없습니다.`);
      const block = p2.sets[typeKey];
      require_(Array.isArray(block.questions) && block.questions.length > 0,
        `questions_part2.json '${typeKey}' 세트에 questions 가 없습니다.`);

      const allowed = new Set(this.typesByKey[typeKey].competencies);
      for (const q of block.questions) {
        validateQuestion(q, `questions_part2.json[${typeKey}]`,
          { needCompetency: true, allowedCompetencies: allowed });
      }
      require_(isObject(block.tiebreaker),
        `questions_part2.json '${typeKey}' 세트에 tiebreaker 가 없습니다.`);
      validateQuestion(block.tiebreaker, `questions_part2.json[${typeKey}] tiebreaker`,
        { needCompetency: true, allowedCompetencies: allowed });
    }
    this.part2Sets = p2.sets;

    // --- characters ----------------------------------------------------
    require_(isObject(charsRaw), 'characters.json 의 최상위는 객체여야 합니다.');
    require_(Array.isArray(charsRaw.characters) && charsRaw.characters.length > 0,
      "characters.json 에 'characters' 배열이 없습니다.");

    this.characters = charsRaw.characters;
    this.charactersByKey = Object.create(null);
    this._characterByCombo = new Map();

    for (const c of this.characters) {
      for (const field of ['key', 'name', 'type', 'competency', 'image',
                           'intro', 'strength', 'caution', 'tip',
                           'partner', 'partner_message']) {
        require_(field in c, `characters.json 의 캐릭터에 '${field}' 가 없습니다: ${c.key}`);
      }
      require_(c.type in this.typesByKey,
        `characters.json: 알 수 없는 유형 '${c.type}' (캐릭터 ${c.key})`);
      require_(this.typesByKey[c.type].competencies.includes(c.competency),
        `characters.json: '${c.key}' 의 역량 '${c.competency}' 가 ` +
        `유형 '${c.type}' 에 속하지 않습니다.`);

      this.charactersByKey[c.key] = c;
      const combo = `${c.type}|${c.competency}`;
      require_(!this._characterByCombo.has(combo),
        `characters.json: 유형·역량 조합이 중복됩니다: ${combo}`);
      this._characterByCombo.set(combo, c);
    }

    // 모든 유형·역량 조합에 캐릭터가 있는지, partner 참조가 유효한지 확인
    for (const t of this.types) {
      for (const comp of t.competencies) {
        require_(this._characterByCombo.has(`${t.key}|${comp}`),
          `characters.json: '${t.key} + ${comp}' 조합의 캐릭터가 없습니다.`);
      }
    }
    for (const c of this.characters) {
      require_(c.partner in this.charactersByKey,
        `characters.json: '${c.key}' 의 partner '${c.partner}' 를 찾을 수 없습니다.`);
    }
  }

  // --- 조회 도우미 ------------------------------------------------------

  part1Count() {
    return this.part1Questions.length;
  }

  part2Count(typeKey) {
    return this.part2Sets[typeKey].questions.length;
  }

  part2Questions(typeKey) {
    return this.part2Sets[typeKey].questions;
  }

  part2Tiebreaker(typeKey) {
    return this.part2Sets[typeKey].tiebreaker;
  }

  typeName(typeKey) {
    const t = this.typesByKey[typeKey];
    return t ? t.name : typeKey;
  }

  competencyLabel(competency) {
    return this.competencyLabels[competency] || competency;
  }

  character(typeKey, competency) {
    return this._characterByCombo.get(`${typeKey}|${competency}`) || null;
  }

  /** 'result.code_label' 처럼 점으로 구분된 경로로 문구를 읽습니다. */
  text(dottedPath, fallback = '') {
    let node = this.texts;
    for (const part of dottedPath.split('.')) {
      if (!isObject(node) || !(part in node)) return fallback;
      node = node[part];
    }
    return node;
  }
}

let cache = null;

/** 콘텐츠를 1회 로딩해 캐싱합니다. 이후 호출은 같은 객체를 돌려줍니다. */
function loadContent(dataDir, { force = false } = {}) {
  if (cache === null || force) {
    cache = new Content(dataDir);
  }
  return cache;
}

module.exports = { Content, ContentError, loadContent };
