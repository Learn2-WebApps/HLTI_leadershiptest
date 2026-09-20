'use strict';

/**
 * 버셀(서버리스) 진입점.
 *
 * 버셀은 app.listen() 으로 서버를 띄우는 대신, 요청을 처리하는 함수를
 * 내보내 주길 기대합니다. createApp() 은 비동기(Firestore 연결)이므로
 * 첫 요청에서 한 번 만들어 두고, 같은 인스턴스가 살아 있는 동안 재사용합니다.
 *
 * 로컬 실행은 예전처럼 `npm run dev` / `npm start` 로 server.js 를 직접 씁니다.
 */

const { createApp } = require('../server');

let appPromise = null;

function getApp() {
  if (!appPromise) {
    appPromise = createApp().catch((err) => {
      // 실패한 Promise 를 캐시하면 이후 요청이 모두 같은 오류에 묶이므로
      // 다음 요청에서 다시 시도할 수 있게 비웁니다.
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

module.exports = async (req, res) => {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error('[HLTI] 앱 초기화 실패:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // 내부 사정은 로그에만 남기고 화면에는 노출하지 않습니다.
    return res.end(
      '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
      '<title>일시적인 오류</title></head><body style="font-family:sans-serif;padding:40px">' +
      '<h1>일시적인 오류가 발생했습니다</h1>' +
      '<p>잠시 후 다시 시도해 주세요. 계속 문제가 생기면 진행자에게 문의해 주세요.</p>' +
      '</body></html>'
    );
  }
};
