import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function makeCanvas() {
  const noop = () => {};
  return {
    width: 240,
    height: 576,
    textContent: "",
    innerHTML: "",
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    insertAdjacentHTML() {},
    getContext: () => ({
      fillRect: noop,
      strokeRect: noop,
      fillText: noop,
      set fillStyle(_value) {},
      set strokeStyle(_value) {},
      set lineWidth(_value) {},
      set font(_value) {},
      set textAlign(_value) {}
    })
  };
}

const element = {
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {},
  insertAdjacentHTML() {},
  textContent: "",
  innerHTML: "",
  dataset: {}
};

const context = {
  console,
  performance: { now: () => 0 },
  localStorage: {
    getItem: () => null,
    setItem() {},
    removeItem() {}
  },
  location: { protocol: "http:", hostname: "localhost" },
  document: {
    body: element,
    createElement: () => element,
    head: { appendChild() {} },
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById: () => makeCanvas()
  },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  setInterval: () => 0,
  clearInterval() {},
  fetch: async () => ({ ok: false, text: async () => "{}" })
};

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
vm.runInNewContext(`${source}\nglobalThis.TestTetrisGame = TetrisGame; globalThis.TestRows = ROWS; globalThis.TestCols = COLS;`, context);

const { TestTetrisGame: TetrisGame, TestRows: ROWS, TestCols: COLS } = context;

function makeGame() {
  return new TetrisGame(makeCanvas());
}

{
  const game = makeGame();
  game.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  game.board[6][3] = 1;
  game.board[6][4] = 1;
  game.board[6][5] = 1;
  game.board[6][6] = 1;
  game.piece = { matrix: [[1, 1, 1, 1]], x: 3, y: 5, id: 999 };

  game.addGarbage(1);

  assert.equal(game.dead, false, "garbage rising into active piece should push it up, not top out");
  assert.equal(game.piece.y, 4, "active piece should be pushed above the risen stack");
}

{
  const game = makeGame();
  game.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  game.board[0][0] = 1;

  game.addGarbage(1);

  assert.equal(game.dead, true, "pushing locked blocks above the top should top out");
}

{
  const game = makeGame();
  for (let i = 0; i < 40; i++) {
    game.addGarbage(1);
    const gapCount = game.board[ROWS - 1].filter((cell) => cell === 0).length;
    assert.ok(gapCount >= 1 && gapCount <= 4, `garbage row should have 1-4 gaps, got ${gapCount}`);
    game.dead = false;
  }
}

console.log("Game logic tests passed");
