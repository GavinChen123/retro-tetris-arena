const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const initialDb = { users: {}, sessions: {}, friendRequests: [], friendships: [], challenges: [] };
let db = loadDb();

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return structuredClone(initialDb);
  return { ...structuredClone(initialDb), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanName(username) {
  return String(username || "").trim().toLowerCase();
}

function publicUser(username) {
  const user = db.users[cleanName(username)];
  return user ? { username: user.username, createdAt: user.createdAt } : null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, expected] = passwordHash.split(":");
  return crypto.timingSafeEqual(Buffer.from(hashPassword(password, salt).split(":")[1]), Buffer.from(expected));
}

function tokenFor(username) {
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = { username: cleanName(username), createdAt: Date.now() };
  saveDb();
  return token;
}

function userFromToken(token) {
  const session = db.sessions[String(token || "")];
  return session ? db.users[session.username] : null;
}

function friendKey(a, b) {
  return [cleanName(a), cleanName(b)].sort().join("::");
}

function areFriends(a, b) {
  return db.friendships.includes(friendKey(a, b));
}

function getFriends(username) {
  const name = cleanName(username);
  return db.friendships
    .map((key) => key.split("::"))
    .filter(([a, b]) => a === name || b === name)
    .map(([a, b]) => publicUser(a === name ? b : a))
    .filter(Boolean);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post("/api/register", (req, res) => {
  const username = cleanName(req.body.username);
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,16}$/.test(username)) return res.status(400).json({ error: "Use 3-16 letters, numbers, or underscores." });
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
  if (db.users[username]) return res.status(409).json({ error: "That username is taken." });
  db.users[username] = { username, passwordHash: hashPassword(password), createdAt: Date.now() };
  saveDb();
  res.json({ token: tokenFor(username), user: publicUser(username) });
});

app.post("/api/login", (req, res) => {
  const username = cleanName(req.body.username);
  const user = db.users[username];
  if (!user || !verifyPassword(req.body.password || "", user.passwordHash)) return res.status(401).json({ error: "Bad username or password." });
  res.json({ token: tokenFor(username), user: publicUser(username) });
});

app.get("/api/me", (req, res) => {
  const user = userFromToken(req.headers.authorization?.replace("Bearer ", ""));
  if (!user) return res.status(401).json({ error: "Sign in first." });
  res.json({
    user: publicUser(user.username),
    friends: getFriends(user.username),
    incoming: db.friendRequests.filter((r) => r.to === user.username),
    outgoing: db.friendRequests.filter((r) => r.from === user.username)
  });
});

app.post("/api/friends/request", (req, res) => {
  const user = userFromToken(req.headers.authorization?.replace("Bearer ", ""));
  const to = cleanName(req.body.username);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  if (!db.users[to]) return res.status(404).json({ error: "No such user." });
  if (to === user.username) return res.status(400).json({ error: "You cannot friend yourself." });
  if (areFriends(user.username, to)) return res.status(409).json({ error: "Already friends." });
  if (!db.friendRequests.some((r) => r.from === user.username && r.to === to)) {
    db.friendRequests.push({ from: user.username, to, createdAt: Date.now() });
    saveDb();
  }
  emitUser(to, "friend:request", { from: user.username });
  res.json({ ok: true });
});

app.post("/api/friends/accept", (req, res) => {
  const user = userFromToken(req.headers.authorization?.replace("Bearer ", ""));
  const from = cleanName(req.body.username);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const before = db.friendRequests.length;
  db.friendRequests = db.friendRequests.filter((r) => !(r.from === from && r.to === user.username));
  if (db.friendRequests.length === before) return res.status(404).json({ error: "No request from that user." });
  const key = friendKey(from, user.username);
  if (!db.friendships.includes(key)) db.friendships.push(key);
  saveDb();
  emitUser(from, "friend:accepted", { by: user.username });
  res.json({ ok: true, friends: getFriends(user.username) });
});

const socketsByUser = new Map();
let quickQueue = [];
const matches = new Map();

function emitUser(username, event, payload) {
  for (const id of socketsByUser.get(cleanName(username)) || []) io.to(id).emit(event, payload);
}

function makeMatch(playerA, playerB, mode = "human") {
  const id = crypto.randomBytes(8).toString("hex");
  const match = {
    id,
    mode,
    players: [playerA, playerB],
    states: {},
    alive: new Map([[playerA.socket.id, true], [playerB.socket.id, true]])
  };
  matches.set(id, match);
  playerA.socket.join(id);
  playerB.socket.join(id);
  playerA.socket.data.matchId = id;
  playerB.socket.data.matchId = id;
  playerA.socket.data.lastOpponent = playerB.username;
  playerB.socket.data.lastOpponent = playerA.username;
  playerA.socket.emit("match:start", { matchId: id, side: 0, opponent: playerB.username });
  playerB.socket.emit("match:start", { matchId: id, side: 1, opponent: playerA.username });
}

function createChallenge(from, to, options = {}) {
  const challenge = {
    id: crypto.randomBytes(8).toString("hex"),
    from: cleanName(from),
    to: cleanName(to),
    rematch: !!options.rematch,
    createdAt: Date.now()
  };
  db.challenges.push(challenge);
  saveDb();
  emitUser(challenge.to, "challenge:incoming", challenge);
  return challenge;
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = userFromToken(token);
  if (token && user) socket.data.user = user;
  next();
});

io.on("connection", (socket) => {
  const username = socket.data.user?.username || `guest_${socket.id.slice(0, 4)}`;
  socket.data.username = username;
  if (!socketsByUser.has(username)) socketsByUser.set(username, new Set());
  socketsByUser.get(username).add(socket.id);
  socket.emit("presence:hello", { username });

  socket.on("quick:join", () => {
    quickQueue = quickQueue.filter((p) => p.socket.connected && p.socket.id !== socket.id);
    const opponent = quickQueue.shift();
    if (opponent) makeMatch(opponent, { socket, username }, "quick");
    else {
      quickQueue.push({ socket, username });
      socket.emit("quick:waiting");
    }
  });

  socket.on("quick:leave", () => {
    quickQueue = quickQueue.filter((p) => p.socket.id !== socket.id);
  });

  socket.on("challenge:send", ({ to }) => {
    const target = cleanName(to);
    if (!socket.data.user) return socket.emit("notice", { type: "error", message: "Sign in to challenge friends." });
    if (!areFriends(username, target)) return socket.emit("notice", { type: "error", message: "You can only challenge friends." });
    createChallenge(username, target);
    socket.emit("notice", { type: "ok", message: `Challenge sent to ${target}.` });
  });

  socket.on("rematch:request", ({ to } = {}) => {
    const target = cleanName(to || socket.data.lastOpponent);
    if (!target || target === username) return socket.emit("notice", { type: "error", message: "No opponent to rematch." });
    const targetIds = socketsByUser.get(target);
    const targetOnline = targetIds && [...targetIds].some((sid) => io.sockets.sockets.get(sid));
    if (!targetOnline) return socket.emit("notice", { type: "error", message: `${target} is offline.` });
    createChallenge(username, target, { rematch: true });
    socket.emit("notice", { type: "ok", message: `Rematch request sent to ${target}.` });
  });

  socket.on("challenge:accept", ({ id }) => {
    const challenge = db.challenges.find((c) => c.id === id && c.to === username);
    if (!challenge) return socket.emit("notice", { type: "error", message: "Challenge not found." });
    const challengerIds = socketsByUser.get(challenge.from);
    const challengerSocket = challengerIds && [...challengerIds].map((sid) => io.sockets.sockets.get(sid)).find(Boolean);
    if (!challengerSocket) return socket.emit("notice", { type: "error", message: "That player is offline." });
    db.challenges = db.challenges.filter((c) => c.id !== id);
    saveDb();
    makeMatch({ socket: challengerSocket, username: challenge.from }, { socket, username }, "challenge");
  });

  socket.on("game:state", (state) => {
    const match = matches.get(socket.data.matchId);
    if (!match) return;
    socket.to(match.id).emit("opponent:state", state);
  });

  socket.on("game:attack", ({ rows = 1 }) => {
    const match = matches.get(socket.data.matchId);
    if (!match) return;
    socket.to(match.id).emit("opponent:attack", { rows: Math.max(1, Math.min(6, Number(rows) || 1)) });
  });

  socket.on("game:dead", () => {
    const match = matches.get(socket.data.matchId);
    if (!match) return;
    match.alive.set(socket.id, false);
    socket.to(match.id).emit("match:win", { reason: "opponent topped out" });
    socket.emit("match:lose", { reason: "you topped out" });
    matches.delete(match.id);
  });

  socket.on("disconnect", () => {
    socketsByUser.get(username)?.delete(socket.id);
    quickQueue = quickQueue.filter((p) => p.socket.id !== socket.id);
    const match = matches.get(socket.data.matchId);
    if (match) {
      socket.to(match.id).emit("match:win", { reason: "opponent disconnected" });
      matches.delete(match.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Retro Tetris Arena running on http://localhost:${PORT}`);
});
