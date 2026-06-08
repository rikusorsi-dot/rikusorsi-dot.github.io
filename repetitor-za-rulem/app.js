const baseItems = [
  { prompt: "q01", expected: "es gribētu to izdarīt", correct: "lv_es_gribetu_to_izdarit" },
  { prompt: "q02", expected: "es gribu to izdarīt", correct: "lv_es_gribu_to_izdarit" },
  { prompt: "q03", expected: "es gribētu to nopirkt", correct: "lv_es_gribetu_to_nopirkt" },
  { prompt: "q04", expected: "es gribu nopirkt šo lietu", correct: "lv_es_gribu_nopirkt_so_lietu" },
  { prompt: "q05", expected: "es gribētu to redzēt", correct: "lv_es_gribetu_to_redzet" },
];

const brickItems = [
  { prompt: "r01", expected: "es gribētu to izdarīt", correct: "lv_es_gribetu_to_izdarit" },
  { prompt: "r02", expected: "es gribu to izdarīt", correct: "lv_es_gribu_to_izdarit" },
  { prompt: "r03", expected: "es gribētu to nopirkt", correct: "lv_es_gribetu_to_nopirkt" },
  { prompt: "r04", expected: "es gribu to nopirkt", correct: "lv_es_gribu_to_nopirkt" },
  { prompt: "r05", expected: "es gribu nopirkt šo lietu", correct: "lv_es_gribu_nopirkt_so_lietu" },
  { prompt: "r06", expected: "es gribētu to redzēt", correct: "lv_es_gribetu_to_redzet" },
  { prompt: "r07", expected: "es gribu to redzēt", correct: "lv_es_gribu_to_redzet" },
  { prompt: "r08", expected: "es gribētu", correct: "lv_es_gribetu" },
  { prompt: "r09", expected: "es gribu", correct: "lv_es_gribu" },
  { prompt: "r10", expected: "es gribētu to redzēt", correct: "lv_es_gribetu_to_redzet" },
];

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const audioCache = new Map();
const progressKey = "repetitorZaRulemLesson1";
const introKey = "repetitorZaRulemIntroDoneMp3V1";
const listenLimitMs = 12000;

let recognition = null;
let queue = baseItems;
let phase = "base";
let index = 0;
let correct = 0;
let attempts = 0;
let isRunning = false;
let isPaused = false;
let isSpeaking = false;
let finalShown = false;
let currentAudio = null;
let skipped = [];
let listenDeadline = 0;
let listenTimer = null;
let listenWindowActive = false;

const el = {
  startView: document.querySelector("#startView"),
  lessonView: document.querySelector("#lessonView"),
  resultView: document.querySelector("#resultView"),
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  continueBtn: document.querySelector("#continueBtn"),
  promptText: document.querySelector("#promptText"),
  statusText: document.querySelector("#statusText"),
  recognizedText: document.querySelector("#recognizedText"),
  stepLabel: document.querySelector("#stepLabel"),
  progressFill: document.querySelector("#progressFill"),
  supportNote: document.querySelector("#supportNote"),
  resultTitle: document.querySelector("#resultTitle"),
  scoreText: document.querySelector("#scoreText"),
  weakList: document.querySelector("#weakList"),
  restartBtn: document.querySelector("#restartBtn"),
  reinforceBtn: document.querySelector("#reinforceBtn"),
  nextLessonBtn: document.querySelector("#nextLessonBtn"),
  feedbackBtn: document.querySelector("#feedbackBtn"),
  priceBtn: document.querySelector("#priceBtn"),
};

function audioUrl(id) {
  return `./audio/${id}.mp3`;
}

function getAudio(id) {
  if (!audioCache.has(id)) {
    audioCache.set(id, new Audio(audioUrl(id)));
  }
  return audioCache.get(id);
}

function normalize(text) {
  return String(text || "")
    .toLocaleLowerCase("lv-LV")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?;:()"«»„“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCommand(text) {
  const value = normalize(text);
  if (/\b(atkarto|turpinam|velreiz|velreiz|turpinat)\b/.test(value)) return "repeat";
  if (/\b(stop|pauze)\b/.test(value)) return "stop";
  if (/\b(talak|nakamais|nakošais|nakosais)\b/.test(value)) return "next";
  if (/\b(ja|jā)\b/.test(value)) return "yes";
  if (/\b(ne|nē)\b/.test(value)) return "no";
  return null;
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function similarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right || left.includes(right)) return 1;

  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[left.length][right.length] / Math.max(left.length, right.length);
}

function currentItem() {
  return queue[index];
}

function setView(name) {
  el.startView.classList.toggle("hidden", name !== "start");
  el.lessonView.classList.toggle("hidden", name !== "lesson");
  el.resultView.classList.toggle("hidden", name !== "result");
}

function setStatus(text, kind = "") {
  el.statusText.textContent = text;
  el.statusText.className = `status ${kind}`.trim();
}

function updateScreen() {
  const item = currentItem();
  if (!item && phase !== "askReinforce") return;

  el.promptText.textContent = phase === "askReinforce"
    ? "Закрепим? Скажи по-латышски: да или нет"
    : item.expected;
  el.stepLabel.textContent = `${index + 1}/${queue.length}`;
  el.progressFill.style.width = `${Math.round((index / queue.length) * 100)}%`;
}

function stopRecognition() {
  window.clearTimeout(listenTimer);
  listenTimer = null;
  listenWindowActive = false;
  try {
    recognition?.stop();
  } catch {}
}

function stopAudio() {
  if (!currentAudio) return;
  currentAudio.pause();
  currentAudio.currentTime = 0;
}

function play(id, after = null) {
  stopRecognition();
  stopAudio();
  isSpeaking = true;
  setStatus("Слушай");

  const audio = getAudio(id);
  currentAudio = audio;
  audio.currentTime = 0;
  audio.onended = () => {
    isSpeaking = false;
    currentAudio = null;
    if (after) after();
  };
  audio.onerror = () => {
    isSpeaking = false;
    currentAudio = null;
    if (after) after();
  };
  audio.play().catch(() => {
    isSpeaking = false;
    currentAudio = null;
    if (after) after();
  });
}

function playReadySignal() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 720;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  } catch {}
}

function startListening() {
  if (!recognition || !isRunning || isSpeaking || finalShown || isPaused) return;
  if (Date.now() >= listenDeadline) {
    pauseLesson("Молчание больше 10 секунд. Нажми «Продолжить», когда будешь готов.");
    return;
  }

  try {
    recognition.lang = "lv-LV";
    setStatus("Говори", "ok");
    el.recognizedText.textContent = "Ответь по-латышски. Команды: atkārto, stop, pauze.";
    listenWindowActive = true;
    window.clearTimeout(listenTimer);
    listenTimer = window.setTimeout(() => {
      pauseLesson("Молчание больше 10 секунд. Нажми «Продолжить», когда будешь готов.");
    }, Math.max(800, listenDeadline - Date.now()));
    recognition.start();
    window.setTimeout(playReadySignal, 250);
  } catch {
    window.setTimeout(startListening, 350);
  }
}

function beginListeningWindow(delay = 1100) {
  if (!isRunning || finalShown || isPaused) return;
  setStatus("Жди сигнал", "warn");
  el.recognizedText.textContent = "Подожди секунду: микрофон включается.";
  listenDeadline = Date.now() + listenLimitMs;
  window.setTimeout(startListening, delay);
}

function askCurrentQuestion() {
  const item = currentItem();
  if (!item) {
    finishPhase();
    return;
  }

  isPaused = false;
  updateScreen();
  saveProgress();
  play(item.prompt, () => beginListeningWindow());
}

function nextQuestion() {
  attempts = 0;
  index += 1;
  if (index >= queue.length) {
    finishPhase();
    return;
  }
  askCurrentQuestion();
}

function pauseLesson(message) {
  isPaused = true;
  isRunning = false;
  stopRecognition();
  stopAudio();
  setStatus("Пауза", "warn");
  el.continueBtn.classList.remove("hidden");
  el.recognizedText.textContent = message || "Пауза. Нажми «Продолжить», когда будешь готов.";
  saveProgress();
}

function handleCommand(command) {
  if (command === "stop") {
    pauseLesson("Пауза. Нажми «Продолжить», когда будешь готов.");
    return;
  }

  if (command === "repeat") {
    askCurrentQuestion();
    return;
  }

  if (command === "next") {
    const item = currentItem();
    if (item) skipped.push(item.expected);
    nextQuestion();
  }
}

function handleReinforceChoice(command) {
  if (command === "yes") {
    phase = "bricks";
    queue = brickItems;
    index = 0;
    attempts = 0;
    correct = 0;
    skipped = [];
    setStatus("Закрепляем", "ok");
    saveProgress();
    askCurrentQuestion();
    return;
  }

  if (command === "no" || command === "stop") {
    finishLesson("trial");
    return;
  }

  beginListeningWindow(300);
}

function handleAnswer(transcript) {
  window.clearTimeout(listenTimer);
  listenTimer = null;
  listenWindowActive = false;

  const command = detectCommand(transcript);
  el.recognizedText.textContent = `Услышал: ${transcript}`;

  if (phase === "askReinforce") {
    handleReinforceChoice(command);
    return;
  }

  if (command) {
    handleCommand(command);
    return;
  }

  if (isPaused) {
    window.setTimeout(startListening, 350);
    return;
  }

  const item = currentItem();
  if (!item) return;

  if (similarity(transcript, item.expected) >= 0.78) {
    correct += 1;
    nextQuestion();
    return;
  }

  attempts += 1;
  play(item.correct, nextQuestion);
}

function setupRecognition() {
  if (!SpeechRecognition) {
    el.supportNote.textContent = "Для hands-free нужен Chrome или Safari с поддержкой голосового распознавания.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "lv-LV";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    handleAnswer(transcript);
  };

  recognition.onerror = () => {
    if (isRunning && listenWindowActive && !isSpeaking && !finalShown && Date.now() < listenDeadline) {
      window.setTimeout(startListening, 600);
    }
  };

  recognition.onend = () => {
    if (isRunning && listenWindowActive && !isSpeaking && !finalShown && Date.now() < listenDeadline) {
      window.setTimeout(startListening, 500);
      return;
    }

    if (isRunning && listenWindowActive && !isSpeaking && !finalShown) {
      pauseLesson("Молчание больше 10 секунд. Нажми «Продолжить», когда будешь готов.");
    }
  };
}

function warmAudio() {
  [
    "intro",
    ...baseItems.map((item) => item.prompt),
    ...baseItems.map((item) => item.correct),
    ...brickItems.map((item) => item.prompt),
    ...brickItems.map((item) => item.correct),
    "ask_reinforce",
    "finish_trial",
    "finish_reinforce",
    "next_lesson",
    "feedback_info",
    "price_info",
  ].forEach((id) => getAudio(id).load());
}

function saveProgress() {
  if (finalShown) return;
  storageSet(progressKey, JSON.stringify({
    phase,
    index,
    correct,
    attempts,
    skipped,
    introDone: storageGet(introKey) === "1",
  }));
}

function getSavedProgress() {
  const raw = storageGet(progressKey);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || !["base", "bricks", "askReinforce"].includes(saved.phase)) return null;
    return saved;
  } catch {
    return null;
  }
}

function applySavedProgress(saved) {
  phase = saved.phase || "base";
  queue = phase === "bricks" ? brickItems : baseItems;
  index = Number.isFinite(saved.index) ? saved.index : 0;
  index = Math.max(0, Math.min(index, queue.length - 1));
  correct = Number.isFinite(saved.correct) ? saved.correct : 0;
  attempts = Number.isFinite(saved.attempts) ? saved.attempts : 0;
  skipped = Array.isArray(saved.skipped) ? saved.skipped : [];
}

function startBaseLesson() {
  warmAudio();
  phase = "base";
  queue = baseItems;
  index = 0;
  correct = 0;
  attempts = 0;
  skipped = [];
  finalShown = false;
  isRunning = true;
  isPaused = false;
  el.continueBtn.classList.add("hidden");
  setView("lesson");
  askCurrentQuestion();
}

function startLesson() {
  storageRemove(progressKey);
  if (storageGet(introKey) === "1") {
    startBaseLesson();
    return;
  }

  warmAudio();
  finalShown = false;
  isRunning = true;
  isPaused = false;
  phase = "base";
  queue = baseItems;
  index = 0;
  correct = 0;
  attempts = 0;
  skipped = [];
  setView("lesson");
  el.continueBtn.classList.add("hidden");
  el.promptText.textContent = "Как работает урок";
  el.stepLabel.textContent = "Старт";
  el.progressFill.style.width = "0%";
  el.recognizedText.textContent = "Сейчас будет короткая инструкция.";
  play("intro", () => {
    storageSet(introKey, "1");
    startBaseLesson();
  });
}

function continueLesson() {
  const saved = getSavedProgress();
  if (!saved) {
    startLesson();
    return;
  }

  warmAudio();
  applySavedProgress(saved);
  finalShown = false;
  isRunning = true;
  isPaused = false;
  el.continueBtn.classList.add("hidden");
  setView("lesson");

  if (phase === "askReinforce") {
    askReinforce();
    return;
  }

  askCurrentQuestion();
}

function startReinforcement() {
  warmAudio();
  phase = "bricks";
  queue = brickItems;
  index = 0;
  correct = 0;
  attempts = 0;
  skipped = [];
  finalShown = false;
  isRunning = true;
  isPaused = false;
  el.continueBtn.classList.add("hidden");
  setView("lesson");
  setStatus("Закрепляем", "ok");
  askCurrentQuestion();
}

function askReinforce() {
  phase = "askReinforce";
  queue = baseItems;
  isPaused = false;
  isRunning = true;
  el.continueBtn.classList.add("hidden");
  el.promptText.textContent = "Закрепим? Скажи по-латышски: да или нет";
  el.stepLabel.textContent = "5/5";
  el.progressFill.style.width = "100%";
  saveProgress();
  play("ask_reinforce", () => beginListeningWindow());
}

function finishPhase() {
  if (phase === "base") {
    askReinforce();
    return;
  }

  finishLesson("reinforce");
}

function showNextLessonStub() {
  finalShown = true;
  isRunning = false;
  stopRecognition();
  stopAudio();
  setView("result");
  el.resultTitle.textContent = "Следующий урок";
  el.scoreText.textContent = "Готовим";
  el.weakList.innerHTML = "";

  const note = document.createElement("p");
  note.textContent = "Следующий урок будет готовиться отдельно под продолжение. Сейчас это только каркас.";
  el.weakList.appendChild(note);
  play("next_lesson");
}

function showFeedbackStub() {
  stopRecognition();
  stopAudio();
  el.weakList.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = "Отзыв пока можно написать Рихарду вручную: что понравилось, что мешало, где было неудобно в машине.";
  el.weakList.appendChild(note);
  play("feedback_info");
}

function showPriceInfo() {
  stopRecognition();
  stopAudio();
  el.weakList.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = "Черновая цена следующего урока: 5 €. Оплату подключим позже отдельным шагом.";
  el.weakList.appendChild(note);
  play("price_info");
}

function startFromButton() {
  if (getSavedProgress()) {
    continueLesson();
    return;
  }

  startLesson();
}

function finishLesson(type) {
  finalShown = true;
  isRunning = false;
  stopRecognition();
  stopAudio();
  storageRemove(progressKey);
  setView("result");
  el.resultTitle.textContent = type === "reinforce" ? "Первый урок закончен" : "Первые 5 фраз пройдены";
  el.scoreText.textContent = type === "reinforce" ? `${correct}/${brickItems.length}` : "5/5";
  el.weakList.innerHTML = "";

  const note = document.createElement("p");
  note.textContent = skipped.length
    ? `Пропущено: ${skipped.join(", ")}`
    : type === "reinforce"
      ? "Если хочешь продолжить, нажми «Продолжить». Можно также оставить отзыв или узнать цену."
      : "Если хочешь, закрепим эти фразы кирпичиками.";
  el.weakList.appendChild(note);

  play(type === "reinforce" ? "finish_reinforce" : "finish_trial");
}

function bindEvents() {
  el.startBtn.addEventListener("click", startFromButton);
  el.continueBtn.addEventListener("click", continueLesson);
  el.restartBtn.addEventListener("click", startLesson);
  el.reinforceBtn.addEventListener("click", startReinforcement);
  el.nextLessonBtn.addEventListener("click", showNextLessonStub);
  el.feedbackBtn.addEventListener("click", showFeedbackStub);
  el.priceBtn.addEventListener("click", showPriceInfo);
  el.stopBtn.addEventListener("click", () => handleCommand("stop"));
}

setupRecognition();
bindEvents();
if (getSavedProgress()) {
  el.startBtn.textContent = "Продолжить";
}
setView("start");
