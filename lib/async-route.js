'use strict';

/**
 * async 핸들러에서 던진 오류를 Express 오류 처리기로 넘겨 줍니다.
 *
 * Express 4 는 async 함수가 반환한 Promise 의 reject 를 잡지 못해서,
 * 감싸 주지 않으면 요청이 응답 없이 멈춰 버립니다.
 *
 *   router.get('/x', wrap(async (req, res) => { ... }));
 */
function wrap(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { wrap };
