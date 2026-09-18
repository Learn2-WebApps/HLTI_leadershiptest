'use strict';

/** 진행 순서를 벗어난 접근. */
class InvalidFlow extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidFlow';
    this.status = 400;
  }
}

/** HTTP 상태를 지정하는 일반 오류. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

module.exports = { InvalidFlow, HttpError };
