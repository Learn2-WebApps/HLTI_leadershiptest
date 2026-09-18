/* 문항 화면.
   '가장 먼저' 와 '가장 나중' 두 칸이 있고, 아무 칸이나 눌러 언제든 다시 고를 수 있습니다.
   애니메이션 없이 즉시 표시합니다. */
(function () {
  "use strict";

  var configEl = document.getElementById("quiz-config");
  if (!configEl) { return; }

  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (err) {
    config = {
      isTiebreak: false, firstPrompt: "", lastPrompt: "",
      savedFirst: "", savedLast: "", stepEmpty: "선택"
    };
  }

  var promptEl = document.getElementById("prompt");
  var optionsEl = document.getElementById("options");
  var nextBtn = document.getElementById("next-btn");
  var firstInput = document.getElementById("answer-first");
  var lastInput = document.getElementById("answer-last");
  var form = document.getElementById("question-form");

  var stepFirstBtn = document.getElementById("step-first");
  var stepLastBtn = document.getElementById("step-last");
  var stepFirstValue = document.getElementById("step-first-value");
  var stepLastValue = document.getElementById("step-last-value");

  if (!optionsEl || !nextBtn || !form) { return; }

  var optionButtons = Array.prototype.slice.call(
    optionsEl.querySelectorAll(".option")
  );

  // 선택지 id -> 화면에 보이는 번호
  var numberOf = {};
  optionButtons.forEach(function (btn, i) {
    numberOf[btn.dataset.id] = i + 1;
  });

  // 지금 고르고 있는 칸: "first" 또는 "last"
  var activeStep = "first";

  // ------------------------------------------------------------------ //

  function inputFor(step) {
    return step === "first" ? firstInput : lastInput;
  }

  function valueLabel(id) {
    if (!id) { return config.stepEmpty; }
    var num = numberOf[id];
    return num ? num + "번" : config.stepEmpty;
  }

  function paint() {
    var firstId = firstInput.value;
    var lastId = lastInput.value;

    // 두 칸 상태 갱신
    if (stepFirstValue) { stepFirstValue.textContent = valueLabel(firstId); }
    if (stepLastValue) { stepLastValue.textContent = valueLabel(lastId); }

    if (stepFirstBtn) {
      stepFirstBtn.classList.toggle("is-active", activeStep === "first");
      stepFirstBtn.classList.toggle("is-filled", Boolean(firstId));
      stepFirstBtn.setAttribute("aria-selected", activeStep === "first" ? "true" : "false");
    }
    if (stepLastBtn) {
      stepLastBtn.classList.toggle("is-active", activeStep === "last");
      stepLastBtn.classList.toggle("is-filled", Boolean(lastId));
      stepLastBtn.setAttribute("aria-selected", activeStep === "last" ? "true" : "false");
    }

    // 프롬프트
    if (promptEl) {
      promptEl.textContent = (config.isTiebreak || activeStep === "first")
        ? config.firstPrompt
        : config.lastPrompt;
    }

    // 선택지 상태
    optionButtons.forEach(function (btn) {
      var id = btn.dataset.id;
      btn.classList.toggle("is-picked", id === firstId);
      btn.classList.toggle("is-last", id === lastId);

      // 지금 고르는 칸의 '반대쪽'에 이미 쓰인 선택지는 고를 수 없습니다.
      var takenByOther = config.isTiebreak
        ? false
        : (activeStep === "first" ? id === lastId : id === firstId);
      btn.classList.toggle("is-excluded", takenByOther);
      btn.disabled = takenByOther;

      btn.setAttribute("aria-pressed",
        (id === firstId || id === lastId) ? "true" : "false");
    });

    var complete = config.isTiebreak
      ? Boolean(firstId)
      : (Boolean(firstId) && Boolean(lastId) && firstId !== lastId);
    nextBtn.disabled = !complete;
  }

  function setActiveStep(step) {
    activeStep = step;
    paint();
  }

  function handlePick(btn) {
    var id = btn.dataset.id;

    if (config.isTiebreak) {
      firstInput.value = id;
      paint();
      return;
    }

    var input = inputFor(activeStep);

    // 이미 고른 것을 다시 누르면 해제합니다.
    if (input.value === id) {
      input.value = "";
      paint();
      return;
    }

    input.value = id;

    // 반대쪽 칸이 아직 비어 있으면 자연스럽게 그쪽으로 넘어갑니다.
    var other = activeStep === "first" ? "last" : "first";
    if (!inputFor(other).value) {
      activeStep = other;
    }
    paint();
  }

  optionButtons.forEach(function (btn) {
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      handlePick(btn);
    });
  });

  if (stepFirstBtn) {
    stepFirstBtn.addEventListener("click", function () { setActiveStep("first"); });
  }
  if (stepLastBtn) {
    stepLastBtn.addEventListener("click", function () { setActiveStep("last"); });
  }

  // 숫자 키로도 고를 수 있게 (현장에서 빠르게 응답할 때)
  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) { return; }
    var index = parseInt(event.key, 10);
    if (!isNaN(index) && index >= 1 && index <= optionButtons.length) {
      var btn = optionButtons[index - 1];
      if (btn && !btn.disabled) { handlePick(btn); }
    } else if (event.key === "Enter" && !nextBtn.disabled) {
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }
  });

  // 중복 제출 방지
  var submitted = false;
  form.addEventListener("submit", function (event) {
    if (submitted) { event.preventDefault(); return; }
    submitted = true;
    nextBtn.disabled = true;
  });

  // --- 시작 ------------------------------------------------------------- //

  // 이전 문항으로 돌아온 경우: 저장된 응답을 복원합니다.
  firstInput.value = config.savedFirst || "";
  lastInput.value = config.savedLast || "";

  // 비어 있는 칸부터 고르게 합니다.
  if (!firstInput.value) {
    activeStep = "first";
  } else if (!lastInput.value) {
    activeStep = "last";
  } else {
    activeStep = "first";
  }

  paint();
})();
