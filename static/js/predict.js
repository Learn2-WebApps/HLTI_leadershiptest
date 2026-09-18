/* 캐릭터 예측 선택: 카드 탭으로 선택, 하단 버튼으로 진행. */
(function () {
  "use strict";

  var form = document.getElementById("predict-form");
  var hidden = document.getElementById("predict-character");
  var submit = document.getElementById("predict-submit");
  var label = document.getElementById("predict-submit-label");
  var labelsEl = document.getElementById("predict-labels");

  if (!form || !hidden || !submit) { return; }

  var labels = { selected: "", empty: "" };
  if (labelsEl) {
    try { labels = JSON.parse(labelsEl.textContent); } catch (err) { /* 기본값 사용 */ }
  }

  var cards = Array.prototype.slice.call(form.querySelectorAll(".char-card"));

  function select(key) {
    hidden.value = key;
    cards.forEach(function (card) {
      var on = card.dataset.key === key;
      card.classList.toggle("is-selected", on);
      card.setAttribute("aria-checked", on ? "true" : "false");
    });
    submit.disabled = !key;
    if (label) { label.textContent = key ? labels.selected : labels.empty; }
  }

  cards.forEach(function (card) {
    card.addEventListener("click", function () {
      // 같은 카드를 다시 누르면 선택 해제
      select(hidden.value === card.dataset.key ? "" : card.dataset.key);
    });
  });

  // 중복 제출 방지
  var submitted = false;
  form.addEventListener("submit", function (event) {
    if (submitted) { event.preventDefault(); return; }
    submitted = true;
  });
})();
