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

    // iOS Safari는 <a download>를 지원하지 않아 저장이 실패합니다.
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function download(blobOrUrl, filename) {
    var url = typeof blobOrUrl === "string"
      ? blobOrUrl
      : URL.createObjectURL(blobOrUrl);

    if (isIOS) {
      showImageOverlay(url, typeof blobOrUrl !== "string");
      return;
    }

    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof blobOrUrl !== "string") {
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
  }

  // 이미지를 화면에 띄우고 길게 눌러 사진 앱에 저장하게 합니다.
  function showImageOverlay(url, isObjectUrl) {
    var bg = document.createElement("div");
    bg.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);" +
      "overflow:auto;padding:16px;text-align:center;";

    var tip = document.createElement("p");
    tip.textContent = "이미지를 길게 눌러 \u201C사진에 저장\u201D을 선택하세요";
    tip.style.cssText =
      "color:#fff;font-size:15px;line-height:1.5;margin:4px 0 12px;";

    var img = document.createElement("img");
    img.src = url;
    img.style.cssText = "max-width:100%;height:auto;border-radius:8px;";

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "닫기";
    close.style.cssText =
      "display:block;margin:16px auto 24px;padding:10px 28px;font-size:15px;" +
      "border:0;border-radius:6px;background:#fff;color:#222;";
    close.addEventListener("click", function () {
      bg.remove();
      if (isObjectUrl) { URL.revokeObjectURL(url); }
    });

    bg.appendChild(tip);
    bg.appendChild(img);
    bg.appendChild(close);
    document.body.appendChild(bg);
  }

  // iOS Safari의 캔버스 최대 면적은 4096x4096px입니다.
  // 결과지가 세로로 길면 이 한계에 걸려 빈 이미지가 됩니다.
  function capScale(el) {
    var base = Math.min(window.devicePixelRatio || 1, 2);
    var w = el.scrollWidth || el.offsetWidth || 1;
    var h = el.scrollHeight || el.offsetHeight || 1;
    var MAX = 4096;
    return Math.max(1, Math.min(base, MAX / w, MAX / h));
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
      // 저장 이미지에서 제외할 영역을 잠시 숨깁니다.
      var hidden = Array.prototype.slice.call(
        sheet.querySelectorAll(".no-capture")
      );
      hidden.forEach(function (el) { el.style.display = "none"; });
     
      window.html2canvas(sheet, {
        backgroundColor: "#FFFBF6",
        scale: capScale(sheet),
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
      }).catch(function (err) {
        window.alert(
        config.failed + "\n\n[" +
        ((err && (err.message || err.name)) || String(err)) + "]"
       );
      }).then(function () {
        hidden.forEach(function (el) { el.style.display = ""; });
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
