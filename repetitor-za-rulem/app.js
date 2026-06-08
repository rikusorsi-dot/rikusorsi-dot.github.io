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

const audioCache = new Map();
const progressKey = "repetitorZaRulemLesson1";
const introKey = "repetitorZaRulemIntroDoneMp3V1";
const listenLimitMs = 12000;
const recordLimitMs = 4500;
const realtimeTokenUrl = "https://latvijas-skola.lv/repetitor-api/realtime-token";
const realtimeCallsUrl = "https://api.openai.com/v1/realtime/calls";

let microphoneStream = null;
let realtimePc = null;
let realtimeDc = null;
let realtimeReadyPromise = null;
let pendingTranscript = null;
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
let listenGeneration = 0;

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
  listenGeneration += 1;

  if (pendingTranscript) {
    const error = new Error("listening stopped");
    error.code = "listening_stopped";
    settlePendingTranscript("reject", error);
  }
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

function playReadySignal(after = null) {
  stopRecognition();
  stopAudio();
  isSpeaking = true;
  setStatus("Жди сигнал", "warn");
  el.recognizedText.textContent = "После сигнала говори по-латышски.";

  const audio = getAudio("ready_signal");
  currentAudio = audio;
  audio.currentTime = 0;

  const finish = () => {
    isSpeaking = false;
    currentAudio = null;
    if (after) after();
  };

  audio.onended = finish;
  audio.onerror = finish;
  audio.play().catch(finish);
}

function microphoneErrorText(error) {
  const code = typeof error === "string" ? error : error?.error || error?.name || "unknown";
  const message = String(error?.message || "").trim();
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Браузер не дал доступ к микрофону. Проверь разрешение микрофона для этой страницы.";
  }
  if (code === "audio-capture") {
    return "Браузер не видит микрофон. Проверь, не занят ли он другим приложением.";
  }
  if (code === "network") {
    return "Распознавание голоса не запустилось из-за сети. Попробуй ещё раз с нормальным интернетом.";
  }
  if (code === "language-not-supported" || code === "language-unavailable") {
    return "Браузер не даёт распознавание латышского языка на этом телефоне.";
  }
  if (code === "no-speech") {
    return "Пока не услышал голос. Скажи фразу после сигнала.";
  }
  if (code === "Error" && message) {
    return `Распознавание не сработало: ${message}`;
  }
  return `Микрофон/распознавание не запустились: ${code}.`;
}

function showMicrophoneError(error) {
  pauseLesson(microphoneErrorText(error));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getRealtimeTokenValue(data) {
  if (typeof data?.value === "string") return data.value;
  if (typeof data?.client_secret?.value === "string") return data.client_secret.value;
  return "";
}

async function fetchRealtimeToken() {
  const response = await fetch(realtimeTokenUrl, { method: "GET" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `realtime token ${response.status}`);
  }

  const token = getRealtimeTokenValue(data);
  if (!token) throw new Error("empty realtime token");
  return token;
}

function closeRealtimeConnection() {
  try {
    realtimeDc?.close();
  } catch {}
  try {
    realtimePc?.close();
  } catch {}
  realtimeDc = null;
  realtimePc = null;
  realtimeReadyPromise = null;
}

function sendRealtimeEvent(event) {
  if (realtimeDc?.readyState !== "open") return false;
  realtimeDc.send(JSON.stringify(event));
  return true;
}

function settlePendingTranscript(type, value) {
  const pending = pendingTranscript;
  if (!pending) return;
  window.clearTimeout(pending.timeout);
  pendingTranscript = null;
  pending[type](value);
}

function handleRealtimeMessage(message) {
  let event = null;
  try {
    event = JSON.parse(message.data);
  } catch {
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.delta" && pendingTranscript) {
    pendingTranscript.partial += event.delta || "";
    const partial = pendingTranscript.partial.trim();
    if (partial) el.recognizedText.textContent = `Слышу: ${partial}`;
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed" && pendingTranscript) {
    const transcript = String(event.transcript || pendingTranscript.partial || "").trim();
    settlePendingTranscript("resolve", transcript);
    return;
  }

  if (event.type === "error" && pendingTranscript) {
    settlePendingTranscript("reject", new Error(event.error?.message || "realtime error"));
  }
}

function waitForRealtimeTranscript() {
  if (pendingTranscript) {
    settlePendingTranscript("reject", new Error("previous listening window was not finished"));
  }

  return new Promise((resolve, reject) => {
    pendingTranscript = {
      partial: "",
      resolve,
      reject,
      timeout: window.setTimeout(() => {
        const transcript = pendingTranscript?.partial?.trim() || "";
        settlePendingTranscript("resolve", transcript);
      }, 8000),
    };
  });
}

async function ensureRealtimeConnection() {
  if (realtimeDc?.readyState === "open" && realtimePc?.connectionState !== "failed") return;
  if (realtimeReadyPromise) return realtimeReadyPromise;

  realtimeReadyPromise = (async () => {
    closeRealtimeConnection();

    const track = microphoneStream?.getAudioTracks?.()[0];
    if (!track) throw new Error("microphone stream is missing");
    track.enabled = true;

    const token = await fetchRealtimeToken();
    const pc = new RTCPeerConnection();
    realtimePc = pc;
    pc.addTrack(track, microphoneStream);

    const dc = pc.createDataChannel("oai-events");
    realtimeDc = dc;
    dc.addEventListener("message", handleRealtimeMessage);

    const dataChannelOpen = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("data channel timeout")), 8000);
      dc.addEventListener("open", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      dc.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("data channel error"));
      }, { once: true });
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch(realtimeCallsUrl, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/sdp",
      },
    });

    const answerSdp = await response.text();
    if (!response.ok) {
      throw new Error(`realtime call ${response.status}`);
    }

    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    await dataChannelOpen;
  })();

  try {
    await realtimeReadyPromise;
  } finally {
    realtimeReadyPromise = null;
  }
}

async function captureRealtimeAnswer(generation) {
  await ensureRealtimeConnection();
  if (generation !== listenGeneration) throw Object.assign(new Error("listening stopped"), { code: "listening_stopped" });

  sendRealtimeEvent({ type: "input_audio_buffer.clear" });
  const transcriptPromise = waitForRealtimeTranscript();

  await sleep(350);
  await sleep(recordLimitMs);

  if (generation !== listenGeneration) throw Object.assign(new Error("listening stopped"), { code: "listening_stopped" });
  if (!sendRealtimeEvent({ type: "input_audio_buffer.commit" })) {
    throw new Error("realtime data channel closed");
  }

  try {
    return await transcriptPromise;
  } finally {
    sendRealtimeEvent({ type: "input_audio_buffer.clear" });
  }
}

async function startListening() {
  if (!isRunning || isSpeaking || finalShown || isPaused) return;
  if (Date.now() >= listenDeadline) {
    pauseLesson("Молчание больше 10 секунд. Нажми «Продолжить», когда будешь готов.");
    return;
  }

  try {
    setStatus("Говори", "ok");
    el.recognizedText.textContent = "Говори сейчас. Слушаю короткий ответ.";
    listenWindowActive = true;
    const generation = listenGeneration;
    window.clearTimeout(listenTimer);
    listenTimer = window.setTimeout(() => {
      pauseLesson("Молчание больше 10 секунд. Нажми «Продолжить», когда будешь готов.");
    }, Math.max(800, listenDeadline - Date.now()));
    const transcript = await captureRealtimeAnswer(generation);
    window.clearTimeout(listenTimer);
    listenTimer = null;
    setStatus("Проверяю", "warn");
    if (!transcript) {
      pauseLesson("Не получилось распознать ответ. Нажми «Продолжить» и скажи фразу после сигнала.");
      return;
    }
    handleAnswer(transcript);
  } catch (error) {
    if (error?.code === "listening_stopped") return;
    showMicrophoneError(error);
  }
}

function beginListeningWindow(delay = 1100) {
  if (!isRunning || finalShown || isPaused) return;
  setStatus("Жди сигнал", "warn");
  el.recognizedText.textContent = "Подожди секунду: сейчас будет сигнал.";
  listenDeadline = Date.now() + listenLimitMs;
  window.setTimeout(() => playReadySignal(() => startListening()), delay);
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
  closeRealtimeConnection();
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
    "ready_signal",
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
  closeRealtimeConnection();
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
  closeRealtimeConnection();
  stopAudio();
  el.weakList.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = "Отзыв пока можно написать Рихарду вручную: что понравилось, что мешало, где было неудобно в машине.";
  el.weakList.appendChild(note);
  play("feedback_info");
}

function showPriceInfo() {
  stopRecognition();
  closeRealtimeConnection();
  stopAudio();
  el.weakList.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = "Черновая цена следующего урока: 5 €. Оплату подключим позже отдельным шагом.";
  el.weakList.appendChild(note);
  play("price_info");
}

async function requestMicrophoneAccess() {
  if (!window.isSecureContext) {
    el.supportNote.textContent = "Микрофон работает только по HTTPS. Открой публичную https-ссылку.";
    return false;
  }

  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
    el.supportNote.textContent = "Этот браузер не даёт голосовой WebRTC-режим. Открой страницу в обычном Safari или Chrome.";
    return false;
  }

  try {
    if (!microphoneStream?.active) {
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    const track = microphoneStream.getAudioTracks()[0];
    if (track) track.enabled = true;
    el.supportNote.textContent = "";
    return true;
  } catch (error) {
    el.supportNote.textContent = microphoneErrorText(error);
    return false;
  }
}

async function startFromButton() {
  const hasMicrophone = await requestMicrophoneAccess();
  if (!hasMicrophone) return;

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
  closeRealtimeConnection();
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

bindEvents();
if (getSavedProgress()) {
  el.startBtn.textContent = "Продолжить";
}
setView("start");
