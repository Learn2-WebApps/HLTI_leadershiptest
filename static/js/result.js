/* 결과 화면: 이미지 저장 / 인쇄.
   저장 범위는 #result-sheet 전체이므로 진단명·비교 섹션·하단 안내가 모두 포함됩니다. */
(function () {
  "use strict";

  var sheet = document.getElementById("result-sheet");
  var saveBtn = document.getElementById("save-image");
  var printBtn = document.getElementById("print-result");
  var configEl = document.getElementById("result-config");

  if (!sheet) { return; }

  var config = { filename: "HLTI", saving: "", failed: "", saveLabel: "" };
  if (configEl) {
    try { config = JSON.parse(configEl.textContent); } catch (err) { /* 기본값 사용 */ }
  }

  if (printBtn) {
    printBtn.addEventListener("click", function () { window.print(); });
  }

  function safeFilename(value) {
    // 파일명에 쓸 수 없는 문자를 걸러냅니다.
    return String(value).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "HLTI";
  }

  function download(blobOrUrl, filename) {
    var link = document.createElement("a");
    var url = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof blobOrUrl !== "string") {
      // 메모리 해제
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      if (typeof window.html2canvas !== "function") {
        window.alert(config.failed);
        return;
      }

      var original = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = config.saving;

      // 캡처 중에는 떠 있는 애니메이션을 멈춰 흔들림을 막습니다.
      sheet.classList.add("is-capturing");

      window.html2canvas(sheet, {
        backgroundColor: "#FFFBF6",
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY
      }).then(function (canvas) {
        var filename = safeFilename(config.filename) + ".png";
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (blob) {
              download(blob, filename);
            } else {
              download(canvas.toDataURL("image/png"), filename);
            }
          }, "image/png");
        } else {
          download(canvas.toDataURL("image/png"), filename);
        }
      }).catch(function () {
        window.alert(config.failed);
      }).then(function () {
        sheet.classList.remove("is-capturing");
        saveBtn.disabled = false;
        saveBtn.textContent = original || config.saveLabel;
      });
    });
  }

  // --- '함께 나타난 성향' 상세 보기 -------------------------------------
  var dialog = document.getElementById("companion-dialog");
  var dataEl = document.getElementById("companion-data");

  if (dialog && dataEl && typeof dialog.showModal === "function") {
    var companions = {};
    try { companions = JSON.parse(dataEl.textContent) || {}; } catch (err) { companions = {}; }

    var dImage = document.getElementById("companion-image");
    var dName = document.getElementById("companion-name");
    var dMeta = document.getElementById("companion-meta");
    var dIntro = document.getElementById("companion-intro");
    var dStrength = document.getElementById("companion-strength");
    var closeBtn = document.getElementById("companion-close");

    function openCompanion(key) {
      var c = companions[key];
      if (!c) { return; }
      dImage.src = c.image;
      dImage.alt = c.name;
      dName.textContent = c.name;
      dMeta.textContent = c.typeName + " · " + c.competencyLabel;
      dIntro.textContent = c.intro;
      dStrength.textContent = c.strength;
      dialog.showModal();
    }

    Array.prototype.forEach.call(
      document.querySelectorAll(".companion[data-key]"),
      function (btn) {
        btn.addEventListener("click", function () {
          openCompanion(btn.dataset.key);
        });
      }
    );

    if (closeBtn) {
      closeBtn.addEventListener("click", function () { dialog.close(); });
    }

    // 바깥쪽(배경)을 누르면 닫습니다.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) { dialog.close(); }
    });
  }
})();
