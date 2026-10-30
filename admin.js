import { initFirebase, configured, serverNow } from "./firebase.js";
import { QUESTIONS, QUESTION_TIME, REVEAL_SECONDS, ADMIN_PASSWORD } from "./questions.js";

const $ = (id) => document.getElementById(id);
const SHAPES = ["▲", "◆", "●", "■"];
const MEDALS = ["🥇", "🥈", "🥉"];
const STATUS = { lobby: "대기실", reveal: "정답 공개", ended: "종료" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

let F, db;
let game = null, players = {}, presence = {};
let curAnswers = {}, answersKey = "", answersUnsub = null;
let revealedKey = "", nextKey = "";

const qKey = () => (game ? `${game.round}:${game.qIndex}` : "");
const onlineIds = () => Object.keys(players).filter((id) => presence[id] && players[id]?.name);
const ranking = () => Object.entries(players)
  .filter(([, p]) => p && p.name)
  .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
const fmt = (n) => (n || 0).toLocaleString();

// ---------- 로그인 ----------
$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if ($("pw").value === ADMIN_PASSWORD) {
    ss.set("quiz_admin", "1");
    boot();
  } else {
    $("pwErr").textContent = "비밀번호가 틀렸어요";
    $("pw").value = "";
  }
});
if (ss.get("quiz_admin") === "1") boot();

async function boot() {
  $("login").hidden = true;
  if (!configured) { $("setup").hidden = false; return; }
  try {
    F = await initFirebase();
    db = F.db;
  } catch (e) {
    $("setup").hidden = false;
    $("setupMsg").textContent = "Firebase 연결 실패: " + e.message;
    return;
  }
  $("app").hidden = false;

  $("joinUrl").value = new URL("./", location.href).href;
  $("joinUrl").addEventListener("change", drawQRs);
  drawQRs();

  $("startBtn").onclick = startQuiz;
  $("revealBtn").onclick = () => reveal();
  $("nextBtn").onclick = () => next();
  $("endBtn").onclick = endQuiz;
  $("resetBtn").onclick = resetScores;
  $("againBtn").onclick = resetScores;
  $("kickBtn").onclick = deleteAll;
  $("qrBtn").onclick = () => { $("qrOverlay").hidden = false; };
  $("qrOverlay").onclick = () => { $("qrOverlay").hidden = true; };

  F.onValue(F.ref(db, "players"), (s) => { players = s.val() || {}; render(); });
  F.onValue(F.ref(db, "presence"), (s) => { presence = s.val() || {}; render(); });
  F.onValue(F.ref(db, "game"), (s) => {
    game = s.val();
    if (!game) { F.set(F.ref(db, "game"), { status: "lobby" }); return; }
    watchAnswers();
    render();
  });
  setInterval(tick, 100);
}

function drawQRs() {
  const url = $("joinUrl").value.trim();
  $("qrBigUrl").textContent = url;
  if (!window.QRCode) { $("qr").textContent = "QR 라이브러리를 불러오지 못했어요"; return; }
  for (const [id, size] of [["qr", 280], ["qrBig", 520]]) {
    $(id).innerHTML = "";
    new window.QRCode($(id), { text: url, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
  }
}

function watchAnswers() {
  const active = game.status === "question" || game.status === "reveal";
  const k = active ? qKey() : "";
  if (k === answersKey) return;
  if (answersUnsub) { answersUnsub(); answersUnsub = null; }
  answersKey = k;
  curAnswers = {};
  if (!k) return;
  answersUnsub = F.onValue(F.ref(db, "answers/" + game.qIndex), (s) => { curAnswers = s.val() || {}; render(); });
}

// ---------- 게임 진행 ----------
function questionGame(i, round) {
  const q = QUESTIONS[i];
  return {
    status: "question",
    round,
    qIndex: i,
    total: QUESTIONS.length,
    duration: q.time || QUESTION_TIME,
    startAt: F.serverTimestamp(),
    question: { type: q.type, q: q.q, options: q.type === "ox" ? ["O", "X"] : q.options },
  };
}

const clearPlayer = (id) => ({
  [`players/${id}/score`]: 0,
  [`players/${id}/lastGain`]: null,
  [`players/${id}/lastCorrect`]: null,
  [`players/${id}/answered`]: null,
});

async function startQuiz() {
  if (ranking().length === 0 && !confirm("아직 참가자가 없어요. 그래도 시작할까요?")) return;
  const upd = { answers: null, game: questionGame(0, Date.now().toString(36)) };
  for (const id of Object.keys(players)) Object.assign(upd, clearPlayer(id));
  revealedKey = nextKey = "";
  await F.update(F.ref(db), upd);
}

function remaining() {
  if (!game || game.status !== "question" || !game.startAt) return 0;
  return Math.max(0, game.duration - (serverNow() - game.startAt) / 1000);
}

async function reveal() {
  if (!game || game.status !== "question") return;
  const k = qKey();
  if (revealedKey === k) return;
  revealedKey = k;
  try {
    const qi = game.qIndex;
    const q = QUESTIONS[qi];
    const ans = (await F.get(F.ref(db, "answers/" + qi))).val() || {};
    const dist = new Array(q.type === "ox" ? 2 : q.options.length).fill(0);
    const upd = {};
    for (const [id, p] of Object.entries(players)) {
      if (!p || !p.name) continue;
      const a = ans[id];
      let gain = 0, correct = false;
      if (a) {
        if (typeof dist[a.choice] === "number") dist[a.choice]++;
        if (a.choice === q.answer) {
          correct = true;
          // 빨리 맞힐수록 점수 ↑ (최대 1000점, 최소 500점)
          const elapsed = Math.max(0, ((a.at || game.startAt) - game.startAt) / 1000);
          gain = Math.round(1000 - 500 * Math.min(1, elapsed / game.duration));
        }
      }
      upd[`players/${id}/score`] = (p.score || 0) + gain;
      upd[`players/${id}/lastGain`] = gain;
      upd[`players/${id}/lastCorrect`] = correct;
      upd[`players/${id}/answered`] = !!a;
    }
    upd["game/status"] = "reveal";
    upd["game/correct"] = q.answer;
    upd["game/dist"] = dist;
    upd["game/revealAt"] = F.serverTimestamp();
    await F.update(F.ref(db), upd);
  } catch (e) {
    revealedKey = "";
    alert("정답 공개 실패: " + e.message);
  }
}

async function next() {
  if (!game || game.status !== "reveal") return;
  const k = qKey();
  if (nextKey === k) return;
  nextKey = k;
  const ni = game.qIndex + 1;
  try {
    if (ni < QUESTIONS.length) await F.update(F.ref(db), { game: questionGame(ni, game.round) });
    else await F.update(F.ref(db), { "game/status": "ended" });
  } catch (e) {
    nextKey = "";
    alert("다음 문제로 못 넘어갔어요: " + e.message);
  }
}

async function endQuiz() {
  if (!confirm("퀴즈를 지금 끝내고 최종 결과를 보여줄까요?")) return;
  await F.update(F.ref(db), { "game/status": "ended" });
}

async function resetScores() {
  if (!confirm("점수를 모두 0으로 만들고 대기실로 돌아갈까요? (참가자는 유지돼요)")) return;
  const upd = { game: { status: "lobby" }, answers: null };
  for (const id of Object.keys(players)) Object.assign(upd, clearPlayer(id));
  revealedKey = nextKey = "";
  await F.update(F.ref(db), upd);
}

async function deleteAll() {
  if (!confirm("참가자를 전부 삭제할까요? 참가자들은 다시 닉네임을 입력해야 해요.")) return;
  revealedKey = nextKey = "";
  await F.update(F.ref(db), { game: { status: "lobby" }, answers: null, players: null });
}

// ---------- 화면 ----------
function render() {
  if (!game) return;
  const st = game.status || "lobby";
  for (const v of ["lobby", "question", "reveal", "ended"]) $("v-" + v).hidden = v !== st;
  $("statusPill").textContent = st === "question" ? `문제 진행 중 ${game.qIndex + 1}/${game.total}` : STATUS[st] || st;
  const list = ranking();
  $("onlineInfo").textContent = `참가자 ${list.length}명 · 접속 중 ${onlineIds().length}명`;

  if (st === "lobby") renderLobby(list);
  else if (st === "question") renderQuestion();
  else if (st === "reveal") renderReveal(list);
  else if (st === "ended") renderEnded(list);
}

function renderLobby(list) {
  $("pCount").textContent = list.length;
  $("chips").innerHTML = list.length
    ? list.map(([id, p]) => `<span class="chip ${presence[id] ? "" : "off"}">${esc(p.name)}</span>`).join("")
    : `<p class="muted-dark">아직 아무도 없어요. QR을 찍어주세요!</p>`;
}

function optionHTML(q, i, extra = "") {
  if (q.type === "ox") {
    return `<div class="aopt ${i === 0 ? "co" : "cx"} ${extra.cls || ""}"><span class="ox-mark">${esc(q.options[i])}</span>${extra.html || ""}</div>`;
  }
  return `<div class="aopt c${i} ${extra.cls || ""}"><span class="shape">${SHAPES[i]}</span><span class="otext">${esc(q.options[i])}</span>${extra.html || ""}</div>`;
}

function renderQuestion() {
  const q = game.question || { options: [] };
  $("aqNum").textContent = `Q ${game.qIndex + 1} / ${game.total}`;
  $("aqText").textContent = q.q;
  $("aOpts").className = "aopts " + (q.type === "ox" ? "ox" : "mc");
  $("aOpts").innerHTML = q.options.map((_, i) => optionHTML(q, i)).join("");
  const answered = Object.keys(curAnswers).filter((id) => players[id]).length;
  $("aAnswered").textContent = `응답 ${answered} / ${onlineIds().length}`;
}

function renderReveal(list) {
  const q = game.question || { options: [] };
  const dist = game.dist || [];
  const max = Math.max(1, ...dist);
  $("rqText").textContent = `Q${game.qIndex + 1}. ${q.q}`;
  $("rOpts").className = "aopts reveal " + (q.type === "ox" ? "ox" : "mc");
  $("rOpts").innerHTML = q.options.map((_, i) => {
    const n = dist[i] || 0;
    return optionHTML(q, i, {
      cls: i === game.correct ? "correct" : "wrong",
      html: `<span class="dist"><span class="dbar" style="width:${(n / max) * 100}%"></span><b>${n}명</b></span>${i === game.correct ? '<span class="check">✔</span>' : ""}`,
    });
  }).join("");
  $("top5").innerHTML = list.slice(0, 5).map(([, p], i) =>
    `<li><span class="rk">${MEDALS[i] || i + 1}</span><span class="nm">${esc(p.name)}</span>` +
    `<span class="gain-sm">${p.lastGain ? "+" + fmt(p.lastGain) : ""}</span><b>${fmt(p.score)}</b></li>`
  ).join("") || `<li class="muted-dark">참가자가 없어요</li>`;
  $("nextBtn").textContent = game.qIndex + 1 < game.total ? "다음 문제 ▶" : "최종 결과 보기 🏆";
}

function renderEnded(list) {
  const top = list.slice(0, 3);
  const order = [1, 0, 2]; // 2등-1등-3등 배치
  $("podium").innerHTML = order.filter((i) => top[i]).map((i) =>
    `<div class="pod p${i + 1}"><div class="pname">${esc(top[i][1].name)}</div><div class="pscore">${fmt(top[i][1].score)}점</div><div class="pblock">${MEDALS[i]}</div></div>`
  ).join("");
  $("fullRank").innerHTML = list.map(([, p], i) =>
    `<li><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span><b>${fmt(p.score)}</b></li>`
  ).join("") || `<li class="muted-dark">참가자가 없어요</li>`;
}

function tick() {
  if (!game) return;
  if (game.status === "question") {
    const r = remaining();
    const t = $("aTimer");
    t.firstElementChild.textContent = Math.ceil(r);
    t.style.setProperty("--p", (r / game.duration) * 100);
    t.classList.toggle("hurry", r <= 5);

    const online = onlineIds();
    const allAnswered = answersKey === qKey() && online.length > 0 && online.every((id) => curAnswers[id]);
    if (r <= 0 || allAnswered) reveal();
  } else if (game.status === "reveal") {
    if ($("autoNext").checked && game.revealAt) {
      const left = REVEAL_SECONDS - (serverNow() - game.revealAt) / 1000;
      $("autoLeft").textContent = left > 0 ? `(${Math.ceil(left)}초 후)` : "";
      if (left <= 0) next();
    } else {
      $("autoLeft").textContent = "";
    }
  }
}
