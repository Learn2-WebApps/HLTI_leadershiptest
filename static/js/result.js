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

  /* 저장 이미지에서 글자가 세로 가운데에서 벗어나는 문제 보정.

     html2canvas 는 글자의 세로 위치를 스스로 잰 폰트 지표로 정하기 때문에
     화면과 몇 px 어긋나게 그립니다. 어긋나는 양은 요소·폰트·기기마다 달라서
     코드에 숫자로 박아 둘 수 없습니다.

     그래서 저장하기 직전에 화면 밖에서 작은 견본을 한 번 그려 보고,
     글자가 실제로 몇 px 밀렸는지 재서 본 캡처에서 그만큼 되돌립니다.
     상자 크기·배경·테두리·좌우 여백은 건드리지 않고, 글자만 움직입니다. */

  // 패딩으로 세로 가운데를 맞춘 한 줄짜리 요소들입니다.
  var CENTER_SELECTOR = ".hero__label, .result-brand__mark, .chip, .code-chip";

  // 보정 대상 고르기: 글자만 들어 있고, 한 줄이며, 세로 패딩이 있는 요소.
  function centerTargets() {
    var all = sheet.querySelectorAll(CENTER_SELECTOR);
    var picked = [];

    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (el.children.length > 0) { continue; }
      if (!el.textContent.trim()) { continue; }

      var cs = window.getComputedStyle(el);
      var lineHeight = parseFloat(cs.lineHeight);
      if (!isFinite(lineHeight) || lineHeight <= 0) { continue; }

      var padTop = parseFloat(cs.paddingTop) || 0;
      var padBottom = parseFloat(cs.paddingBottom) || 0;
      if (padTop === 0 && padBottom === 0) { continue; }

      var borderTop = parseFloat(cs.borderTopWidth) || 0;
      var borderBottom = parseFloat(cs.borderBottomWidth) || 0;
      var height = el.getBoundingClientRect().height;
      if (!(height > 0)) { continue; }
      // 두 줄 이상이면 가운데 정렬 대상이 아닙니다.
      if (height > lineHeight + padTop + padBottom + borderTop + borderBottom + 1) {
        continue;
      }

      picked.push({ index: i, el: el });
    }

    return picked;
  }

  function copyComputedStyle(from, to) {
    var cs = window.getComputedStyle(from);
    for (var i = 0; i < cs.length; i += 1) {
      var name = cs[i];
      to.style.setProperty(name, cs.getPropertyValue(name));
    }
  }

  /** 화면 밖 견본을 캡처해 요소마다 글자가 밀린 양(px)을 잽니다. */
  function measureTextShifts(targets) {
    var zeros = targets.map(function () { return 0; });
    if (!targets.length) { return Promise.resolve(zeros); }

    var probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:-10000px;top:0;z-index:-1;margin:0;padding:0;" +
      "background:#ffffff;";

    var clones = targets.map(function (t) {
      var row = document.createElement("div");
      row.style.cssText =
        "margin:0;padding:0;background:#ffffff;font-size:0;line-height:0;";
      var clone = t.el.cloneNode(true);
      copyComputedStyle(t.el, clone);
      // 글자만 검게 남기고 나머지는 흰색으로 지웁니다.
      clone.style.setProperty("margin", "0");
      clone.style.setProperty("position", "static");
      clone.style.setProperty("transform", "none");
      clone.style.setProperty("animation", "none");
      clone.style.setProperty("box-shadow", "none");
      clone.style.setProperty("color", "#000000");
      clone.style.setProperty("background", "#ffffff");
      clone.style.setProperty("border-color", "#ffffff");
      row.appendChild(clone);
      probe.appendChild(row);
      return clone;
    });

    document.body.appendChild(probe);
    var probeRect = probe.getBoundingClientRect();
    var boxes = clones.map(function (clone) {
      var r = clone.getBoundingClientRect();
      return {
        x: r.left - probeRect.left,
        y: r.top - probeRect.top,
        w: r.width,
        h: r.height
      };
    });

    function cleanup() {
      if (probe.parentNode) { probe.parentNode.removeChild(probe); }
    }

    return window.html2canvas(probe, {
      backgroundColor: "#ffffff",
      scale: 1,
      useCORS: true,
      logging: false
    }).then(function (canvas) {
      var ctx = canvas.getContext("2d");
      var shifts = boxes.map(function (b) {
        var x0 = Math.max(0, Math.round(b.x));
        var y0 = Math.max(0, Math.round(b.y));
        var w = Math.min(Math.round(b.w), canvas.width - x0);
        var h = Math.min(Math.round(b.h), canvas.height - y0);
        if (w <= 0 || h <= 0) { return 0; }

        var data;
        try { data = ctx.getImageData(x0, y0, w, h).data; } catch (err) { return 0; }

        var top = null;
        var bottom = null;
        for (var y = 0; y < h; y += 1) {
          var dark = 0;
          for (var x = 0; x < w; x += 1) {
            var i = (y * w + x) * 4;
            if (data[i] < 140 && data[i + 3] > 40) { dark += 1; }
          }
          if (dark >= 2) {
            if (top === null) { top = y; }
            bottom = y;
          }
        }
        if (top === null) { return 0; }

        // 글자 덩어리의 한가운데와 상자 한가운데의 차이가 밀린 양입니다.
        var shift = (top + bottom + 1) / 2 - h / 2;
        // 값이 터무니없으면 측정이 잘못된 것이므로 보정하지 않습니다.
        return Math.abs(shift) > 14 ? 0 : shift;
      });
      cleanup();
      return shifts;
    }).catch(function () {
      cleanup();
      return zeros;
    });
  }

  /** 복제본에서 글자만 끌어올립니다. 상자와 배경은 그대로 둡니다. */
  function applyTextShifts(clonedRoot, targets, shifts) {
    try {
      var live = sheet.querySelectorAll(CENTER_SELECTOR);
      var cloned = clonedRoot.querySelectorAll(CENTER_SELECTOR);
      // 짝이 맞지 않으면 엉뚱한 요소를 건드리게 되므로 그만둡니다.
      if (live.length !== cloned.length) { return; }

      targets.forEach(function (t, n) {
        var shift = shifts[n];
        if (!shift) { return; }
        var node = cloned[t.index];
        if (!node) { return; }

        var span = node.ownerDocument.createElement("span");
        span.textContent = node.textContent;
        span.style.position = "relative";
        span.style.top = (-shift) + "px";
        node.textContent = "";
        node.appendChild(span);
      });
    } catch (err) {
      // 보정에 실패하더라도 저장 자체는 계속되어야 합니다.
    }
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
     
      // 글자가 몇 px 밀리는지 먼저 재고, 그 값을 본 캡처에 반영합니다.
      var targets = centerTargets();

      measureTextShifts(targets).then(function (shifts) {
        return window.html2canvas(sheet, {
          backgroundColor: "#FFFBF6",
          scale: capScale(sheet),
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          onclone: function (doc, el) { applyTextShifts(el, targets, shifts); }
        });
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
