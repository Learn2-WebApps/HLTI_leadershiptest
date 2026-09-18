'use strict';

/**
 * 결과 화면 렌더링.
 *
 * 참여자 본인의 결과와 관리자의 '결과 다시 보기' 가 같은 화면을 쓰므로
 * 여기 한 곳에 모아 둡니다.
 */

const { HttpError } = require('./errors');

module.exports = function makeRenderer(content) {
  /** 예측 vs 결과 비교 섹션에 필요한 정보. 예측을 건너뛰었으면 null. */
  function compareOf(predictedKey, character) {
    if (!predictedKey) return null;
    const predicted = content.charactersByKey[predictedKey];
    if (!predicted) return null;

    let verdict;
    let message;
    if (predicted.key === character.key) {
      verdict = 'exact';
      message = content.text('compare.exact_match');
    } else if (predicted.type === character.type) {
      verdict = 'same_type';
      message = content.text('compare.same_type').replace(
        '{competency_label}', content.competencyLabel(character.competency)
      );
    } else {
      verdict = 'different';
      message = content.text('compare.different_type');
    }
    return { predicted, verdict, message };
  }

  /**
   * @param {object} res      Express 응답
   * @param {object} payload  { character, type, competency, predicted, companions, name }
   */
  function renderResult(res, payload) {
    const character = content.charactersByKey[payload.character];
    if (!character) {
      throw new HttpError(500, `캐릭터를 찾을 수 없습니다: ${payload.character}`);
    }

    const typeObj = content.typesByKey[character.type];
    const partner = content.charactersByKey[character.partner] || null;
    const companions = (payload.companions || [])
      .map((key) => content.charactersByKey[key])
      .filter(Boolean);

    // '함께 나타난 성향' 카드를 눌렀을 때 보여 줄 내용
    const companionData = {};
    for (const c of companions) {
      companionData[c.key] = {
        name: c.name,
        image: `/static/images/characters/${c.image}`,
        typeName: content.typeName(c.type),
        competencyLabel: content.competencyLabel(c.competency),
        intro: c.intro,
        strength: c.strength,
      };
    }

    res.render('result.html', {
      character,
      type_obj: typeObj,
      partner,
      companions,
      companion_data: companionData,
      compare: compareOf(payload.predicted, character),
      participant_name: payload.name || '',
      competency: payload.competency,
    });
  }

  return { compareOf, renderResult };
};
