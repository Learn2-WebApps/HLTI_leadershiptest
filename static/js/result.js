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

  // --- 저장 방식 ------------------------------------------------------- //

  // iOS Safari 는 <a download> 를 무시하므로 다른 방법이 필요합니다.
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  /** 공유 시트로 넘깁니다(휴대폰에서 '이미지 저장'을 고를 수 있음). */
  function shareFile(blob, filename) {
    if (!navigator.share || !navigator.canShare || typeof File !== "function") {
      return Promise.resolve(false);
    }
    var file;
    try {
      file = new File([blob], filename, { type: "image/png" });
    } catch (err) {
      return Promise.resolve(false);
    }
    if (!navigator.canShare({ files: [file] })) { return Promise.resolve(false); }

    return navigator.share({ files: [file] })
      .then(function () { return true; })
      .catch(function (err) {
        // 사용자가 공유 시트를 닫은 경우는 실패가 아니므로 조용히 넘깁니다.
        return err && err.name === "AbortError" ? true : false;
      });
  }

  /** 브라우저 기본 다운로드. */
  function downloadFile(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /** 이미지를 크게 띄워 길게 눌러 저장하게 합니다(마지막 수단). */
  function showImageOverlay(blob) {
    var url = URL.createObjectURL(blob);

    var bg = document.createElement("div");
    bg.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);" +
      "overflow:auto;padding:16px;text-align:center;";

    var tip = document.createElement("p");
    tip.textContent = "이미지를 길게 눌러 “사진에 저장”을 선택하세요";
    tip.style.cssText = "color:#fff;font-size:15px;line-height:1.5;margin:4px 0 12px;";

    var img = document.createElement("img");
    img.src = url;
    img.style.cssText = "max-width:100%;height:auto;border-radius:8px;";

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "닫기";
    close.style.cssText =
      "display:block;margin:16px auto 24px;padding:12px 32px;font-size:15px;" +
      "border:0;border-radius:8px;background:#fff;color:#222;";
    close.addEventListener("click", function () {
      bg.remove();
      URL.revokeObjectURL(url);
    });

    bg.appendChild(tip);
    bg.appendChild(img);
    bg.appendChild(close);
    document.body.appendChild(bg);
  }

  /** 공유 → 다운로드 → 길게 눌러 저장 순으로 시도합니다. */
  function deliver(blob, filename) {
    return shareFile(blob, filename).then(function (shared) {
      if (shared) { return; }
      if (isIOS) { showImageOverlay(blob); return; }
      downloadFile(blob, filename);
    });
  }

  // --- 캡처 ------------------------------------------------------------ //

  // 휴대폰에서는 화면이 좁아 결과지가 세로로 아주 길어집니다. 그대로 캡처하면
  // 캔버스 한계에 걸려 실패하므로, 캡처하는 동안만 데스크톱과 같은 폭으로
  // 펼쳐 둡니다. 이렇게 하면 어느 기기에서 저장해도 같은 모양이 나옵니다.
  var CAPTURE_WIDTH = 620;

  function withFixedWidth(run) {
    var prevWidth = sheet.style.width;
    var prevMaxWidth = sheet.style.maxWidth;
    var prevOverflow = document.body.style.overflowX;

    sheet.style.width = CAPTURE_WIDTH + "px";
    sheet.style.maxWidth = "none";
    document.body.style.overflowX = "hidden";

    function restore() {
      sheet.style.width = prevWidth;
      sheet.style.maxWidth = prevMaxWidth;
      document.body.style.overflowX = prevOverflow;
    }
    return run().then(
      function (value) { restore(); return value; },
      function (err) { restore(); throw err; }
    );
  }

  /**
   * 캔버스 한계에 걸리지 않는 배율을 고릅니다.
   * iOS Safari 는 한 변 4096px, 전체 면적 약 1,670만 픽셀을 넘으면
   * 빈 이미지를 돌려주거나 실패합니다.
   */
  function capScale(width, height) {
    var base = Math.min(window.devicePixelRatio || 1, 2);
    var MAX_DIM = 4096;
    var MAX_AREA = 16000000;
    var byDim = Math.min(MAX_DIM / width, MAX_DIM / height);
    var byArea = Math.sqrt(MAX_AREA / (width * height));
    // 한계를 넘기느니 작게 만듭니다. 다만 알아볼 수 없을 만큼 줄이지는 않습니다.
    return Math.max(0.5, Math.min(base, byDim, byArea));
  }

  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob) { resolve(blob); return; }
          reject(new Error("빈 이미지가 만들어졌습니다"));
        }, "image/png");
        return;
      }
      // 아주 오래된 브라우저 대비
      try {
        var data = canvas.toDataURL("image/png");
        var binary = atob(data.split(",")[1]);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) { bytes[i] = binary.charCodeAt(i); }
        resolve(new Blob([bytes], { type: "image/png" }));
      } catch (err) {
        reject(err);
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      if (typeof window.html2canvas !== "function") {
        window.alert(config.failed + "\n\n[이미지 변환 기능을 불러오지 못했습니다]");
        return;
      }

      var original = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = config.saving;
      // 캡처 중에는 떠 있는 애니메이션을 멈춰 흔들림을 막습니다.
      sheet.classList.add("is-capturing");

      withFixedWidth(function () {
        var width = sheet.scrollWidth;
        var height = sheet.scrollHeight;
        return window.html2canvas(sheet, {
          backgroundColor: "#FFFBF6",
          scale: capScale(width, height),
          useCORS: true,
          logging: false,
          width: width,
          height: height,
          windowWidth: Math.max(window.innerWidth, CAPTURE_WIDTH + 80),
          scrollX: 0,
          scrollY: 0
        });
      }).then(function (canvas) {
        return toBlob(canvas);
      }).then(function (blob) {
        return deliver(blob, safeFilename(config.filename) + ".png");
      }).catch(function (err) {
        window.alert(
          config.failed + "\n\n[" +
          ((err && (err.message || err.name)) || String(err)) + "]"
        );
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

    var openCompanion = function (key) {
      var c = companions[key];
      if (!c) { return; }
      dImage.src = c.image;
      dImage.alt = c.name;
      dName.textContent = c.name;
      dMeta.textContent = c.typeName + " · " + c.competencyLabel;
      dIntro.textContent = c.intro;
      dStrength.textContent = c.strength;
      dialog.showModal();
    };

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
