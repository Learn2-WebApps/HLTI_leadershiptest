/* 관리자 화면: 세션 삭제 전 확인.
   삭제는 되돌릴 수 없으므로, 무엇이 지워지는지 보여준 뒤 한 번 더 묻습니다. */
(function () {
  "use strict";

  var dialog = document.getElementById("delete-dialog");
  var bodyEl = document.getElementById("delete-body");
  var confirmBtn = document.getElementById("delete-confirm");
  var cancelBtn = document.getElementById("delete-cancel");
  var configEl = document.getElementById("admin-config");

  var forms = Array.prototype.slice.call(
    document.querySelectorAll(".js-delete-form")
  );
  if (forms.length === 0) { return; }

  var config = { deleteBody: "" };
  if (configEl) {
    try { config = JSON.parse(configEl.textContent); } catch (err) { /* 기본값 */ }
  }

  // <dialog> 를 쓸 수 없는 오래된 브라우저에서는 기본 confirm 으로 대체합니다.
  var canUseDialog = dialog && typeof dialog.showModal === "function";
  var pendingForm = null;

  function messageFor(form) {
    return String(config.deleteBody || "")
      .split("{name}").join(form.dataset.name || "")
      .split("{code}").join(form.dataset.code || "")
      .split("{count}").join(form.dataset.count || "0");
  }

  function submit(form) {
    // 확인을 거쳤다는 표시. 아래 submit 핸들러가 그대로 통과시킵니다.
    form.dataset.confirmed = "1";
    if (form.requestSubmit) { form.requestSubmit(); } else { form.submit(); }
  }

  forms.forEach(function (form) {
    form.addEventListener("submit", function (event) {
      if (form.dataset.confirmed === "1") { return; }
      event.preventDefault();

      var message = messageFor(form);

      if (!canUseDialog) {
        if (window.confirm(message)) { submit(form); }
        return;
      }

      pendingForm = form;
      // textContent 로 넣으므로 세션 이름에 특수문자가 있어도 안전합니다.
      bodyEl.textContent = message;
      dialog.showModal();
    });
  });

  if (canUseDialog) {
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        pendingForm = null;
        dialog.close();
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        var form = pendingForm;
        pendingForm = null;
        dialog.close();
        if (form) { submit(form); }
      });
    }

    // 바깥쪽(배경)을 누르면 취소합니다.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        pendingForm = null;
        dialog.close();
      }
    });

    // ESC 로 닫았을 때도 대기 중인 폼을 비웁니다.
    dialog.addEventListener("close", function () { pendingForm = null; });
  }
})();
