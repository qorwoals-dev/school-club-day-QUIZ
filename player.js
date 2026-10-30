import { initFirebase, configured, serverNow } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["loading", "setup", "join", "lobby", "question", "answered", "reveal", "ended"];
const SHAPES = ["▲", "◆", "●", "■"];
const MEDALS = ["🥇", "🥈", "🥉"];

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let pid = ls.get("quiz_pid");
if (!pid) {
  pid = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  ls.set("quiz_pid", pid);
}

let F, db;
let game = null, players = {};
let gameLoaded = false, playersLoaded = false;
let myAnswers = {};          // "round:qIndex" -> 고른 번호
let answerCount = 0, answersKey = "", answersUnsub = null;
let renderedKey = "", current = "", sending = false;

const me = () => players[pid];
const qKey = () => (game ? `${game.round}:${game.qIndex}` : "");

function show(name) {
  if (current === name) return;
  current = name;
  for (const s of SCREENS) $("s-" + s).hidden = s !== name;
  if (name !== "reveal") delete document.body.dataset.result;
}

function ranking() {
  return Object.entries(players)
    .filter(([, p]) => p && p.name)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
}
function myRank() {
  const i = ranking().findIndex(([id]) => id === pid);
  return i < 0 ? "-" : `${i + 1}위`;
}
function remaining() {
  if (!game || game.status !== "question" || !game.startAt) return 0;
  return Math.max(0, game.duration - (serverNow() - game.startAt) / 1000);
}

async function main() {
  if (!configured) { show("setup"); return; }
  try {
    F = await initFirebase();
    db = F.db;
  } catch (e) {
    show("setup");
    $("setupMsg").textContent = "서버 연결에 실패했어요: " + e.message;
    return;
  }

  $("name").value = ls.get("quiz_name") || "";
  $("joinForm").addEventListener("submit", join);

  F.onValue(F.ref(db, "players"), (s) => { players = s.val() || {}; playersLoaded = true; render(); });
  F.onValue(F.ref(db, "game"), (s) => { game = s.val() || { status: "lobby" }; gameLoaded = true; watchAnswers(); render(); });
  F.onValue(F.ref(db, ".info/connected"), (s) => { if (s.val() === true) setPresence(); });

  setInterval(tick, 100);
}

function setPresence() {
  const r = F.ref(db, "presence/" + pid);
  F.onDisconnect(r).remove();
  F.set(r, true);
}

async function join(e) {
  e.preventDefault();
  const name = $("name").value.trim().slice(0, 12);
  if (!name) { $("joinErr").textContent = "닉네임을 입력해주세요!"; return; }
  $("joinErr").textContent = "";
  $("joinBtn").disabled = true;
  try {
    ls.set("quiz_name", name);
    await F.set(F.ref(db, "players/" + pid), { name, score: 0, joinedAt: F.serverTimestamp() });
    setPresence();
  } catch (err) {
    $("joinErr").textContent = "입장 실패: " + err.message;
  } finally {
    $("joinBtn").disabled = false;
  }
}

function watchAnswers() {
  const active = game && (game.status === "question" || game.status === "reveal");
  const k = active ? qKey() : "";
  if (k === answersKey) return;
  if (answersUnsub) { answersUnsub(); answersUnsub = null; }
  answersKey = k;
  answerCount = 0;
  if (!k) return;
  const qi = game.qIndex;
  answersUnsub = F.onValue(F.ref(db, "answers/" + qi), (s) => {
    const v = s.val() || {};
    answerCount = Object.keys(v).length;
    if (v[pid] && myAnswers[k] === undefined) myAnswers[k] = v[pid].choice; // 새로고침해도 복구
    render();
  });
}

async function answer(i) {
  const k = qKey();
  if (sending || myAnswers[k] !== undefined || remaining() <= 0) return;
  sending = true;
  myAnswers[k] = i;
  render();
  try {
    await F.set(F.ref(db, `answers/${game.qIndex}/${pid}`), { choice: i, at: F.serverTimestamp() });
  } catch (err) {
    delete myAnswers[k];
    alert("답 제출 실패: " + err.message);
    render();
  } finally {
    sending = false;
  }
}

function optionLabel(q, i) {
  return q.type === "ox" ? q.options[i] : `${SHAPES[i]} ${q.options[i]}`;
}

function render() {
  if (!playersLoaded || !gameLoaded) return;
  const m = me();
  $("foot").hidden = !m;
  if (!m) { show("join"); return; }
  $("footName").textContent = m.name;
  $("footScore").textContent = (m.score || 0).toLocaleString() + "점";

  switch (game.status) {
    case "question": {
      const mine = myAnswers[qKey()];
      if (mine !== undefined) {
        $("myPick").textContent = "내가 고른 답: " + optionLabel(game.question, mine);
        $("ansCount").textContent = answerCount;
        show("answered");
      } else {
        renderQuestion();
        show("question");
        tick();
      }
      break;
    }
    case "reveal": renderReveal(m); show("reveal"); break;
    case "ended": renderEnded(m); show("ended"); break;
    default:
      $("lobbyName").textContent = m.name;
      $("lobbyCount").textContent = ranking().length;
      show("lobby");
  }
}

function renderQuestion() {
  const k = qKey();
  if (renderedKey === k) return;
  renderedKey = k;
  const q = game.question || {};
  $("qNum").textContent = `${game.qIndex + 1} / ${game.total}`;
  $("qText").textContent = q.q || "";
  const box = $("qOpts");
  box.className = "opts " + (q.type === "ox" ? "ox" : "mc");
  box.innerHTML = "";
  (q.options || []).forEach((opt, i) => {
    const b = document.createElement("button");
    b.type = "button";
    if (q.type === "ox") {
      b.className = "opt " + (i === 0 ? "co" : "cx");
      b.innerHTML = `<span class="ox-mark">${esc(opt)}</span>`;
    } else {
      b.className = "opt c" + i;
      b.innerHTML = `<span class="shape">${SHAPES[i]}</span><span class="otext">${esc(opt)}</span>`;
    }
    b.addEventListener("click", () => answer(i));
    box.appendChild(b);
  });
}

function renderReveal(m) {
  const q = game.question || { options: [] };
  const c = game.correct;
  let result;
  if (!m.answered) {
    result = "late";
    $("rvIcon").textContent = "⌛";
    $("rvTitle").textContent = "시간 초과!";
  } else if (m.lastCorrect) {
    result = "ok";
    $("rvIcon").textContent = "🎉";
    $("rvTitle").textContent = "정답!";
  } else {
    result = "no";
    $("rvIcon").textContent = "😢";
    $("rvTitle").textContent = "아쉽게 오답!";
  }
  document.body.dataset.result = result;
  $("rvGain").textContent = `+${(m.lastGain || 0).toLocaleString()}점`;
  $("rvAnswer").textContent = typeof c === "number" ? "정답: " + optionLabel(q, c) : "";
  $("rvScore").textContent = (m.score || 0).toLocaleString();
  $("rvRank").textContent = myRank();
}

function renderEnded(m) {
  $("endScore").textContent = (m.score || 0).toLocaleString();
  $("endRank").textContent = myRank();
  $("endTop").innerHTML = ranking().slice(0, 3).map(([id, p], i) =>
    `<li class="${id === pid ? "me" : ""}"><span>${MEDALS[i]} ${esc(p.name)}</span><b>${(p.score || 0).toLocaleString()}</b></li>`
  ).join("");
}

function tick() {
  if (current !== "question" || !game) return;
  const r = remaining();
  $("qTimer").textContent = Math.ceil(r);
  $("qBar").style.width = Math.max(0, (r / game.duration) * 100) + "%";
  const up = r <= 0;
  $("qTimeup").hidden = !up;
  $("qOpts").classList.toggle("disabled", up);
}

main();
