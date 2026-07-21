const COLS = 10;
const ROWS = 24;
const BLOCK = 24;
const PREVIEW_BLOCK = 20;
const COLORS = ["#000000", "#5b6ee1", "#6abe30", "#d9a441", "#ac3232", "#5fcde4", "#d95763", "#8f563b", "#f8f8d8"];
const PIECES = {
  I: [[1, 1, 1, 1]],
  O: [[2, 2], [2, 2]],
  T: [[0, 3, 0], [3, 3, 3]],
  S: [[0, 4, 4], [4, 4, 0]],
  Z: [[5, 5, 0], [0, 5, 5]],
  J: [[6, 0, 0], [6, 6, 6]],
  L: [[0, 0, 7], [7, 7, 7]]
};
const AI_DIFFICULTIES = {
  easy: {
    label: "Easy",
    stepMs: 430,
    dropInterval: 620,
    mistakeChance: 0.35,
    weights: { lines: -1.2, height: 1.25, holes: 4.5, bumpiness: 0.75, wells: 0.2 }
  },
  normal: {
    label: "Normal",
    stepMs: 240,
    dropInterval: 470,
    mistakeChance: 0.12,
    weights: { lines: -3.5, height: 1.0, holes: 7.0, bumpiness: 1.0, wells: -0.15 }
  },
  hard: {
    label: "Hard",
    stepMs: 115,
    dropInterval: 330,
    mistakeChance: 0.02,
    weights: { lines: -6.0, height: 0.75, holes: 9.0, bumpiness: 1.15, wells: -0.35 }
  }
};
const ids = (id) => document.getElementById(id);
const tokenKey = "retroTetrisToken";
const localUsersKey = "retroTetrisLocalUsers";
const localFriendsKey = "retroTetrisLocalFriends";

let token = localStorage.getItem(tokenKey);
let me = null;
let socket = null;
let mode = "single";
let playerGame = null;
let opponentGame = null;
let animationId = null;
let computerTimer = null;
let socketScriptPromise = null;
let selectedDifficulty = "easy";
let lastDownTapAt = 0;
const HARD_DROP_TAP_MS = 340;

function rotateMatrix(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]).reverse());
}

function matrixEquals(a, b) {
  return a.length === b.length && a.every((row, y) => row.length === b[y].length && row.every((value, x) => value === b[y][x]));
}

class TetrisGame {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.nextCanvas = options.nextCanvas || null;
    this.nextCtx = this.nextCanvas?.getContext("2d") || null;
    this.options = options;
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.score = 0;
    this.lines = 0;
    this.spawnCounter = 0;
    this.dropCounter = 0;
    this.dropInterval = this.options.ai ? this.aiConfig().dropInterval : 720;
    this.dead = false;
    this.paused = false;
    this.aiPlan = null;
    this.piece = this.randomPiece();
    this.nextPiece = this.randomPiece();
    this.draw();
  }

  aiConfig() {
    return AI_DIFFICULTIES[this.options.difficulty || "easy"] || AI_DIFFICULTIES.easy;
  }

  randomPiece() {
    const keys = Object.keys(PIECES);
    const type = keys[Math.floor(Math.random() * keys.length)];
    const matrix = PIECES[type].map((row) => [...row]);
    return { matrix, x: Math.floor(COLS / 2) - Math.ceil(matrix[0].length / 2), y: 0, id: ++this.spawnCounter };
  }

  takeNextPiece() {
    this.piece = {
      ...this.nextPiece,
      matrix: this.nextPiece.matrix.map((row) => [...row]),
      x: Math.floor(COLS / 2) - Math.ceil(this.nextPiece.matrix[0].length / 2),
      y: 0,
      id: ++this.spawnCounter
    };
    this.nextPiece = this.randomPiece();
  }

  collide(piece = this.piece) {
    return piece.matrix.some((row, y) => row.some((value, x) => {
      if (!value) return false;
      const nx = piece.x + x;
      const ny = piece.y + y;
      return nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && this.board[ny][nx]);
    }));
  }

  merge() {
    this.piece.matrix.forEach((row, y) => row.forEach((value, x) => {
      if (value) this.board[this.piece.y + y][this.piece.x + x] = value;
    }));
  }

  rotate() {
    const matrix = rotateMatrix(this.piece.matrix);
    const old = this.piece.matrix;
    this.piece.matrix = matrix;
    let offset = 1;
    while (this.collide()) {
      this.piece.x += offset;
      offset = -(offset + (offset > 0 ? 1 : -1));
      if (Math.abs(offset) > matrix[0].length + 1) {
        this.piece.matrix = old;
        return;
      }
    }
    this.changed();
  }

  move(dir) {
    this.piece.x += dir;
    if (this.collide()) this.piece.x -= dir;
    this.changed();
  }

  softDrop() {
    this.piece.y++;
    if (this.collide()) {
      this.piece.y--;
      this.lock();
      return true;
    }
    this.changed();
    return false;
  }

  hardDrop() {
    while (!this.softDrop()) {}
  }

  lock() {
    this.merge();
    const cleared = this.clearLines();
    if (cleared >= 2 && this.options.onAttack) this.options.onAttack(cleared - 1);
    this.aiPlan = null;
    this.takeNextPiece();
    if (this.collide()) {
      this.dead = true;
      this.options.onDead?.();
    }
    this.changed();
  }

  clearLines() {
    let cleared = 0;
    outer: for (let y = ROWS - 1; y >= 0; y--) {
      for (let x = 0; x < COLS; x++) if (!this.board[y][x]) continue outer;
      this.board.splice(y, 1);
      this.board.unshift(Array(COLS).fill(0));
      cleared++;
      y++;
    }
    if (cleared) {
      this.lines += cleared;
      this.score += [0, 100, 300, 500, 800][cleared] || cleared * 300;
      this.dropInterval = Math.max(120, this.dropInterval - cleared * 8);
    }
    return cleared;
  }

  addGarbage(rows = 1) {
    for (let i = 0; i < rows; i++) {
      this.board.shift();
      const gapCount = 1 + Math.floor(Math.random() * 4);
      const gaps = new Set();
      while (gaps.size < gapCount) gaps.add(Math.floor(Math.random() * COLS));
      this.board.push(Array.from({ length: COLS }, (_, x) => (gaps.has(x) ? 0 : 8)));
    }
    if (this.collide()) {
      this.dead = true;
      this.options.onDead?.();
    }
    this.changed();
  }

  update(delta) {
    if (this.dead || this.paused) return;
    this.dropCounter += delta;
    if (this.dropCounter > this.dropInterval) {
      this.softDrop();
      this.dropCounter = 0;
    }
  }

  aiStep() {
    if (this.dead) return;
    const target = this.currentAiPlan();
    if (!target) {
      this.softDrop();
      return;
    }
    if (!matrixEquals(this.piece.matrix, target.matrix)) {
      this.rotate();
      return;
    }
    if (this.piece.x < target.x) this.move(1);
    else if (this.piece.x > target.x) this.move(-1);
    else this.softDrop();
  }

  currentAiPlan() {
    if (!this.aiPlan || this.aiPlan.pieceId !== this.piece.id) {
      this.aiPlan = { pieceId: this.piece.id, ...this.bestMove() };
    }
    return this.aiPlan;
  }

  bestMove() {
    const difficulty = this.aiConfig();
    const candidates = [];
    let testMatrix = this.piece.matrix.map((r) => [...r]);
    for (let r = 0; r < 4; r++) {
      for (let x = -2; x < COLS; x++) {
        const testPiece = { matrix: testMatrix, x, y: 0 };
        while (!this.collide(testPiece)) testPiece.y++;
        testPiece.y--;
        if (testPiece.y < 0) continue;
        const score = this.scoreLanding(testPiece, difficulty.weights);
        candidates.push({ score, x, matrix: testMatrix.map((row) => [...row]) });
      }
      testMatrix = rotateMatrix(testMatrix);
    }
    candidates.sort((a, b) => a.score - b.score);
    if (!candidates.length) return null;
    if (Math.random() < difficulty.mistakeChance) {
      const sloppyPool = candidates.slice(1, Math.min(candidates.length, difficulty.label === "Easy" ? 8 : 4));
      return sloppyPool[Math.floor(Math.random() * sloppyPool.length)] || candidates[0];
    }
    return candidates[0];
  }

  scoreLanding(piece, weights) {
    const clone = this.board.map((r) => [...r]);
    piece.matrix.forEach((row, y) => row.forEach((value, x) => {
      if (value && piece.y + y >= 0 && piece.x + x >= 0 && piece.x + x < COLS) clone[piece.y + y][piece.x + x] = value;
    }));
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (clone[y].every(Boolean)) {
        clone.splice(y, 1);
        clone.unshift(Array(COLS).fill(0));
        cleared++;
        y++;
      }
    }
    const heights = Array(COLS).fill(0);
    let holes = 0;
    for (let x = 0; x < COLS; x++) {
      let seen = false;
      for (let y = 0; y < ROWS; y++) {
        if (clone[y][x]) {
          if (!seen) heights[x] = ROWS - y;
          seen = true;
        } else if (seen) holes++;
      }
    }
    const aggregateHeight = heights.reduce((sum, height) => sum + height, 0);
    const bumpiness = heights.reduce((sum, height, i) => sum + (i ? Math.abs(height - heights[i - 1]) : 0), 0);
    const wells = heights.reduce((sum, height, i) => {
      const left = i === 0 ? ROWS : heights[i - 1];
      const right = i === COLS - 1 ? ROWS : heights[i + 1];
      return sum + Math.max(0, Math.min(left, right) - height);
    }, 0);
    return cleared * weights.lines + aggregateHeight * weights.height + holes * weights.holes + bumpiness * weights.bumpiness + wells * weights.wells;
  }

  changed() {
    this.draw();
    this.options.onChange?.(this.snapshot());
  }

  snapshot() {
    return { board: this.board, piece: this.piece, nextPiece: this.nextPiece, score: this.score, lines: this.lines, dead: this.dead };
  }

  loadSnapshot(state) {
    this.board = state.board;
    this.piece = state.piece;
    this.nextPiece = state.nextPiece || null;
    this.score = state.score || 0;
    this.lines = state.lines || 0;
    this.dead = !!state.dead;
    this.draw();
  }

  draw() {
    this.ctx.fillStyle = "#0b0b12";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawMatrix(this.board, 0, 0);
    if (this.piece && !this.dead) this.drawMatrix(this.piece.matrix, this.piece.x, this.piece.y);
    this.drawNext();
    if (this.dead) {
      this.ctx.fillStyle = "rgba(0,0,0,.72)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "#f8f8d8";
      this.ctx.font = "bold 24px Courier New";
      this.ctx.textAlign = "center";
      this.ctx.fillText("GAME OVER", this.canvas.width / 2, this.canvas.height / 2);
    }
  }

  drawMatrix(matrix, ox, oy) {
    matrix.forEach((row, y) => row.forEach((value, x) => {
      if (!value) return;
      const px = (x + ox) * BLOCK;
      const py = (y + oy) * BLOCK;
      this.ctx.fillStyle = COLORS[value];
      this.ctx.fillRect(px, py, BLOCK, BLOCK);
      this.ctx.strokeStyle = "#f8f8d8";
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(px + 1, py + 1, BLOCK - 2, BLOCK - 2);
      this.ctx.fillStyle = "rgba(0,0,0,.25)";
      this.ctx.fillRect(px + BLOCK - 6, py + 4, 3, BLOCK - 8);
    }));
  }

  drawNext() {
    if (!this.nextCtx || !this.nextCanvas || !this.nextPiece) return;
    this.nextCtx.fillStyle = "#0b0b12";
    this.nextCtx.fillRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);
    const matrix = this.nextPiece.matrix;
    const pieceWidth = matrix[0].length * PREVIEW_BLOCK;
    const pieceHeight = matrix.length * PREVIEW_BLOCK;
    const ox = Math.floor((this.nextCanvas.width - pieceWidth) / 2);
    const oy = Math.floor((this.nextCanvas.height - pieceHeight) / 2);
    matrix.forEach((row, y) => row.forEach((value, x) => {
      if (!value) return;
      const px = ox + x * PREVIEW_BLOCK;
      const py = oy + y * PREVIEW_BLOCK;
      this.nextCtx.fillStyle = COLORS[value];
      this.nextCtx.fillRect(px, py, PREVIEW_BLOCK, PREVIEW_BLOCK);
      this.nextCtx.strokeStyle = "#f8f8d8";
      this.nextCtx.lineWidth = 2;
      this.nextCtx.strokeRect(px + 1, py + 1, PREVIEW_BLOCK - 2, PREVIEW_BLOCK - 2);
    }));
  }
}

function setStatus(message) { ids("status").textContent = message; }
function show(id) {
  ["menu", "multiMenu", "humanMenu", "arena"].forEach((name) => ids(name).classList.toggle("hidden", name !== id));
}

function api(path, body) {
  if (isStaticHost()) return localApi(path, body);
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  }).then(async (res) => {
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  });
}

function safeJson(res) {
  return res.text().then((text) => {
    try { return JSON.parse(text); }
    catch { return { error: text || "Server did not return JSON." }; }
  });
}

function isStaticHost() {
  return location.protocol === "file:" || location.hostname.endsWith("github.io") || location.hostname.endsWith("chatgpt.site");
}

function loadLocalUsers() {
  return JSON.parse(localStorage.getItem(localUsersKey) || "{}");
}

function saveLocalUsers(users) {
  localStorage.setItem(localUsersKey, JSON.stringify(users));
}

function loadLocalFriends() {
  return JSON.parse(localStorage.getItem(localFriendsKey) || "{}");
}

function saveLocalFriends(friends) {
  localStorage.setItem(localFriendsKey, JSON.stringify(friends));
}

function localApi(path, body) {
  const users = loadLocalUsers();
  const username = String(body?.username || "").trim().toLowerCase();
  if (path === "/api/register") {
    if (!/^[a-z0-9_]{3,16}$/.test(username)) return Promise.reject(new Error("Use 3-16 letters, numbers, or underscores."));
    if (users[username]) return Promise.reject(new Error("That username is taken on this browser."));
    users[username] = { username, password: String(body.password || ""), createdAt: Date.now() };
    saveLocalUsers(users);
    return Promise.resolve({ token: `local:${username}`, user: { username } });
  }
  if (path === "/api/login") {
    if (!users[username] || users[username].password !== String(body.password || "")) return Promise.reject(new Error("Bad local username or password."));
    return Promise.resolve({ token: `local:${username}`, user: { username } });
  }
  if (path === "/api/friends/request") {
    const current = token?.replace("local:", "");
    if (!current) return Promise.reject(new Error("Create or login to a local demo account first."));
    if (!users[username]) return Promise.reject(new Error("That local demo user does not exist in this browser."));
    const friends = loadLocalFriends();
    friends[current] = [...new Set([...(friends[current] || []), username])];
    friends[username] = [...new Set([...(friends[username] || []), current])];
    saveLocalFriends(friends);
    return Promise.resolve({ ok: true });
  }
  return Promise.reject(new Error("This action needs the Node realtime server."));
}

async function refreshMe() {
  if (!token) return;
  if (token.startsWith("local:")) {
    const username = token.replace("local:", "");
    const friends = (loadLocalFriends()[username] || []).map((name) => ({ username: name }));
    me = { username };
    ids("authForm").classList.add("hidden");
    ids("signedIn").classList.remove("hidden");
    ids("signedName").textContent = `${username} local`;
    renderSocial({ incoming: [], outgoing: [], friends });
    setStatus("GitHub Pages mode: singleplayer and vs computer are playable. Realtime human matchmaking needs the Node server.");
    return;
  }
  const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return logout();
  const data = await res.json();
  me = data.user;
  ids("authForm").classList.add("hidden");
  ids("signedIn").classList.remove("hidden");
  ids("signedName").textContent = me.username;
  renderSocial(data);
  connectSocket();
}

function renderSocial(data) {
  ids("incoming").innerHTML = data.incoming.map((r) => `<div class="friend-line"><span>${r.from} wants in</span><button data-accept="${r.from}">Accept</button></div>`).join("");
  ids("friends").innerHTML = data.friends.length
    ? data.friends.map((f) => `<div class="friend-line"><span>${f.username}</span><button data-challenge="${f.username}">Challenge</button></div>`).join("")
    : `<p class="notice">No friends yet.</p>`;
}

function logout() {
  token = null;
  me = null;
  localStorage.removeItem(tokenKey);
  ids("authForm").classList.remove("hidden");
  ids("signedIn").classList.add("hidden");
  if (socket) socket.disconnect();
}

async function connectSocket() {
  if (typeof io === "undefined") {
    if (isStaticHost()) {
      setStatus("Realtime human play needs the Node server. Use vs Computer on GitHub Pages.");
      return false;
    }
    try {
      await loadSocketScript();
    } catch {
      setStatus("Could not load the realtime server. Use singleplayer or vs computer for now.");
      return false;
    }
  }
  if (socket?.connected) return true;
  socket = io({ auth: { token } });
  socket.on("quick:waiting", () => setStatus("Waiting for another quick play challenger..."));
  socket.on("match:start", ({ opponent }) => startHumanMatch(opponent));
  socket.on("opponent:state", (state) => {
    if (!opponentGame) opponentGame = new TetrisGame(ids("opponentBoard"), { nextCanvas: ids("opponentNext") });
    opponentGame.loadSnapshot(state);
    ids("opponentStatus").textContent = state.dead ? "Out" : "Playing";
  });
  socket.on("opponent:attack", ({ rows }) => playerGame?.addGarbage(rows));
  socket.on("match:win", ({ reason }) => endMatch(`You win: ${reason}.`));
  socket.on("match:lose", ({ reason }) => endMatch(`You lose: ${reason}.`));
  socket.on("challenge:incoming", (challenge) => {
    setStatus(`${challenge.from} challenged you.`);
    ids("incoming").insertAdjacentHTML("afterbegin", `<div class="friend-line"><span>${challenge.from} challenged you</span><button data-accept-challenge="${challenge.id}">Fight</button></div>`);
  });
  socket.on("notice", ({ message }) => setStatus(message));
  return true;
}

function loadSocketScript() {
  if (socketScriptPromise) return socketScriptPromise;
  socketScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/socket.io/socket.io.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return socketScriptPromise;
}

function startSingle() {
  mode = "single";
  ids("opponentCard").classList.add("hidden");
  ids("matchLabel").textContent = "Singleplayer";
  startArena("Singleplayer ready.");
}

function startComputer() {
  mode = "computer";
  const difficulty = AI_DIFFICULTIES[selectedDifficulty];
  ids("opponentCard").classList.remove("hidden");
  ids("opponentName").textContent = `CPU ${difficulty.label}`;
  ids("matchLabel").textContent = `Vs Computer: ${difficulty.label}`;
  startArena("Clearing N rows sends N-1 garbage rows.");
  opponentGame = new TetrisGame(ids("opponentBoard"), {
    ai: true,
    difficulty: selectedDifficulty,
    nextCanvas: ids("opponentNext"),
    onAttack: (rows) => playerGame.addGarbage(rows),
    onDead: () => endMatch("You win: CPU topped out.")
  });
  computerTimer = setInterval(() => opponentGame.aiStep(), difficulty.stepMs);
}

function startHumanMatch(opponent) {
  mode = "human";
  ids("opponentCard").classList.remove("hidden");
  ids("opponentName").textContent = opponent;
  ids("matchLabel").textContent = `Vs ${opponent}`;
  startArena("Fight started. Clearing N rows sends N-1 garbage rows.");
}

function startArena(message) {
  stopLoops();
  show("arena");
  setStatus(message);
  ids("score").textContent = "0";
  ids("lines").textContent = "0";
  ids("opponentStatus").textContent = "Ready";
  opponentGame = mode === "single" ? null : opponentGame;
  playerGame = new TetrisGame(ids("playerBoard"), {
    nextCanvas: ids("playerNext"),
    onAttack: (rows) => {
      if (mode === "human") socket?.emit("game:attack", { rows });
      if (mode === "computer") opponentGame?.addGarbage(rows);
    },
    onChange: (state) => {
      ids("score").textContent = state.score;
      ids("lines").textContent = state.lines;
      if (mode === "human") socket?.emit("game:state", state);
    },
    onDead: () => {
      if (mode === "human") socket?.emit("game:dead");
      else if (mode === "computer") endMatch("You lose: you topped out.");
      else setStatus("Game over. Restart to try again.");
    }
  });
  let last = 0;
  const loop = (time = 0) => {
    const delta = time - last;
    last = time;
    playerGame?.update(delta);
    if (mode === "computer") opponentGame?.update(delta);
    animationId = requestAnimationFrame(loop);
  };
  loop();
}

function stopLoops() {
  cancelAnimationFrame(animationId);
  clearInterval(computerTimer);
  computerTimer = null;
}

function endMatch(message) {
  setStatus(message);
  if (playerGame) playerGame.paused = true;
  if (opponentGame) opponentGame.paused = true;
  stopLoops();
}

document.addEventListener("keydown", (event) => {
  if (!playerGame || playerGame.dead || playerGame.paused) return;
  if (event.code === "ArrowDown") {
    event.preventDefault();
    const now = performance.now();
    if (!event.repeat && now - lastDownTapAt <= HARD_DROP_TAP_MS) {
      lastDownTapAt = 0;
      playerGame.hardDrop();
    } else {
      if (!event.repeat) lastDownTapAt = now;
      playerGame.softDrop();
      if (!playerGame.dead) playerGame.softDrop();
    }
    return;
  }
  const actions = {
    ArrowLeft: () => playerGame.move(-1),
    ArrowRight: () => playerGame.move(1),
    ArrowUp: () => playerGame.rotate(),
    Space: () => playerGame.rotate(),
    " ": () => playerGame.rotate(),
    ShiftRight: () => playerGame.hardDrop()
  };
  const action = actions[event.code] || actions[event.key];
  if (action) {
    event.preventDefault();
    action();
  }
});

ids("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/login", { username: ids("username").value, password: ids("password").value });
    token = data.token;
    localStorage.setItem(tokenKey, token);
    await refreshMe();
    setStatus(`Logged in as ${data.user.username}.`);
  } catch (error) { setStatus(error.message); }
});

ids("registerBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/register", { username: ids("username").value, password: ids("password").value });
    token = data.token;
    localStorage.setItem(tokenKey, token);
    await refreshMe();
    setStatus(`Registered ${data.user.username}.`);
  } catch (error) { setStatus(error.message); }
});

ids("logoutBtn").addEventListener("click", logout);
ids("singleBtn").addEventListener("click", startSingle);
ids("multiBtn").addEventListener("click", () => show("multiMenu"));
ids("vsHumanBtn").addEventListener("click", () => { show("humanMenu"); refreshMe(); connectSocket(); });
ids("vsComputerBtn").addEventListener("click", startComputer);
document.querySelectorAll(".difficultyBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedDifficulty = btn.dataset.difficulty;
    document.querySelectorAll(".difficultyBtn").forEach((item) => item.classList.toggle("selected", item === btn));
  });
});
document.querySelectorAll(".backBtn").forEach((btn) => btn.addEventListener("click", () => show("menu")));
ids("homeBtn").addEventListener("click", () => { stopLoops(); show("menu"); });
ids("restartBtn").addEventListener("click", () => mode === "computer" ? startComputer() : mode === "single" ? startSingle() : setStatus("Human matches restart by starting a new challenge or quick play."));
ids("quickBtn").addEventListener("click", async () => {
  if (await connectSocket()) socket.emit("quick:join");
});

ids("friendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/friends/request", { username: ids("friendName").value });
    setStatus("Friend request sent.");
    await refreshMe();
  } catch (error) { setStatus(error.message); }
});

document.body.addEventListener("click", async (event) => {
  const accept = event.target.dataset.accept;
  const challenge = event.target.dataset.challenge;
  const acceptChallenge = event.target.dataset.acceptChallenge;
  try {
    if (accept) {
      await api("/api/friends/accept", { username: accept });
      await refreshMe();
      setStatus(`You are now friends with ${accept}.`);
    }
    if (challenge) {
      if (await connectSocket()) socket.emit("challenge:send", { to: challenge });
    }
    if (acceptChallenge) {
      if (await connectSocket()) socket.emit("challenge:accept", { id: acceptChallenge });
    }
  } catch (error) { setStatus(error.message); }
});

refreshMe();
