# Chess Interactive Board + PGN Parser — Complete Recreation Guide

> This document provides **100% complete specifications** to recreate the interactive chessboard, PGN parser, and puzzle trainer from scratch. No external code knowledge required.

---

## Architecture Overview

The system consists of 3 custom modules + 1 external dependency:

```
PGN File → [PGNParser] → Move Tree → [WoodpeckerTrainer] → [ChessBoard SVG]
                                              ↕
                                         [chess.js Engine]
```

### Files & Responsibilities

| File | Lines | Role |
|------|-------|------|
| `pgn-parser.js` | ~495 | Parse PGN text → move tree with variations, comments, NAGs |
| `chessboard.js` | ~634 | SVG-based interactive board: drag & drop, highlights, arrows |
| `woodpecker-trainer.js` | ~771 | Training engine: move validation, variation traversal, session management |
| `chess.js` | External | chess.js library — legal move generation, FEN, SAN validation |

### External Dependencies

- **chess.js** (v1.0+): `new Chess()`, `.move()`, `.undo()`, `.load(fen)`, `.fen()`, `.moves()`, `.board()`, `.turn()`, `.reset()`
- **Piece SVG images**: `img/pieces/{wK,wQ,wR,wB,wN,wP,bK,bQ,bR,bB,bN,bP}.svg`

---

## 1. PGN Parser (`PGNParser`)

### Purpose
Parse raw PGN text into a structured move tree that preserves **variations**, **comments**, **NAGs**, and **ChessBase annotations** (arrows/highlights).

### Entry Point
```js
const games = PGNParser.parseMultipleGames(pgnText);
// Returns: Array of game objects
```

### Game Object Structure
```js
{
  headers: { White: "Kasparov", Black: "Karpov", FEN: "...", Result: "1-0", ... },
  white: "Kasparov",
  black: "Karpov",
  result: "1-0",
  eco: "B12",
  fen: "rnbqkbnr/... w KQkq - 0 1" | null,  // Starting FEN (null = standard start)
  gameComment: "Game-level comment before first move",
  moves: [ MoveNode, MoveNode, ... ]  // Array of move nodes (mainline)
}
```

### Move Node Structure (CRITICAL)
```js
{
  san: "Nf3",           // Standard Algebraic Notation
  moveNumber: 1,        // Move number in the game
  isWhite: true,        // true = white's move, false = black's
  comment: "Good move!", // Text comment after the move
  nags: [1, 14],        // Numeric Annotation Glyphs (1=!, 2=?, 3=!!, 4=??, 5=!?, 6=?!)
  arrows: [{ color: "#2ecc71", from: "e2", to: "e4" }],     // [%cal] annotations
  highlights: [{ color: "#e74c3c", square: "e4" }],          // [%csl] annotations
  variations: [          // Array of alternative lines branching from THIS move's position
    [ MoveNode, MoveNode, ... ],   // Variation 1
    [ MoveNode, MoveNode, ... ],   // Variation 2
  ]
}
```

**IMPORTANT — Variation semantics**: A variation attached to move X represents an ALTERNATIVE to move X. The variation starts from the position BEFORE move X was played. The first move of the variation replaces move X.

### Tokenizer
The parser uses a two-phase approach: **tokenize** then **parse**.

**Token types:**
| Token | Example | Description |
|-------|---------|-------------|
| `move` | `Nf3`, `O-O-O`, `exd5` | SAN chess move |
| `move_number` | `1.`, `12...` | Move number (`.` = white, `...` = black) |
| `comment` | `{text}` | Curly-brace comment |
| `variation_start` | `(` | Start of a variation |
| `variation_end` | `)` | End of a variation |
| `nag` | `$1`, `$4` | Numeric Annotation Glyph |
| `result` | `1-0`, `*` | Game result |

**Annotation symbols** (`!`, `?`, `!!`, `??`, `!?`, `?!`) are tokenized as NAGs:
```js
const nagMap = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
```

**SAN regex** (handles all valid chess moves):
```js
/^(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?)/
```

### Tokenizer Order (IMPORTANT — order matters!)
```
1. Whitespace → skip
2. Comment {text} → extract
3. Variation start ( → token
4. Variation end ) → token
5. NAG $N → token
6. Result (1-0, 0-1, 1/2-1/2, *) → token
7. Move number (1., 12...) → token
8. SAN move (Nf3, O-O, exd5+) → token
9. Annotation symbols (!,?,!!,??,!?,?!) → convert to NAG token
10. Unknown character → skip
```

### Comment Parsing
Comments can contain ChessBase annotations:
- `[%cal Ge2e4,Re7e5]` → arrows (Green e2→e4, Red e7→e5)
- `[%csl Gd5,Re4]` → square highlights
- `[%evp ...]`, `[%mdl ...]` → stripped (engine data)

Color codes: `R`=#e74c3c, `G`=#2ecc71, `B`=#3498db, `Y`=#f1c40f, `C`=#1abc9c, `M`=#9b59b6

### Recursive Variation Parsing Algorithm
```js
function parseSequence() {
    const moves = [];
    let currentMoveNumber = 1;
    let expectWhite = true;

    while (hasTokens()) {
        if (token.type === 'variation_end') break;  // End of current variation
        if (token.type === 'result') { skip(); continue; }
        if (token.type === 'move_number') {
            currentMoveNumber = token.value;
            expectWhite = !token.isBlack;
            skip(); continue;
        }
        if (token.type === 'move') {
            const node = {
                san: token.value,
                moveNumber: currentMoveNumber,
                isWhite: expectWhite,
                comment: '', nags: [], arrows: [], highlights: [],
                variations: []
            };
            skip();

            // Collect NAGs and comments AFTER the move
            while (nextToken.type === 'nag' || nextToken.type === 'comment') {
                if (nag) node.nags.push(token.value);
                if (comment) parseAndAttach(node);
            }

            // Collect variations AFTER the move
            while (nextToken.type === 'variation_start') {
                skip('(');
                node.variations.push(parseSequence());  // ← RECURSIVE CALL
                skip(')');
            }

            moves.push(node);
            toggleWhiteBlack();
        }
    }
    return moves;
}
```

### Game Splitting
Multiple games in one PGN file are split by detecting a new `[Header]` line after moves have been seen.

---

## 2. Interactive Chessboard (`ChessBoard`)

### Purpose
SVG-based chess board with drag & drop, click-to-move, move highlighting, arrows, and animations.

### Constructor
```js
const board = new ChessBoard('container-id', {
    size: 480,           // Board size in pixels (square)
    flipped: false,      // true = black at bottom
    interactive: true,   // Allow piece interaction
    playerColor: 'w',    // Which color can interact ('w' or 'b')
    onMove: (from, to, promotion) => {},  // Move callback
    lightColor: '#e8dcc8',
    darkColor: '#7c9a6e'
});
```

### SVG Layer Structure
```
<svg> (width=size, height=size)
  ├── <g id="squares">        — 64 colored rectangles
  ├── <g id="coordinates">    — a-h, 1-8 labels
  ├── <g id="highlights">     — Move highlights (from/to squares)
  ├── <g id="legal-dots">     — Legal move indicators (circles)
  ├── <g id="pieces">         — Piece <image> elements
  ├── <g id="arrows">         — Annotation arrows (SVG lines/polygons)
  └── <g id="sq-highlights">  — Annotation square highlights
```

### Key Methods

| Method | Description |
|--------|-------------|
| `setPosition(chess, animate)` | Sync board with chess.js state. `animate=true` for smooth piece movement |
| `showLastMove(from, to)` | Highlight source and target squares with semi-transparent overlay |
| `clearLastMove()` | Remove move highlights |
| `flip()` | Rotate board 180° (swap perspective) |
| `resize(newSize)` | Resize board dynamically |
| `drawArrows(arrows)` | Draw annotation arrows on the board |
| `drawHighlights(highlights)` | Draw annotation square highlights |
| `clearAnnotations()` | Remove all arrows/highlights |

### Piece Rendering
- Pieces are SVG `<image>` elements pointing to `img/pieces/{color}{Piece}.svg`
- Examples: `wK.svg` (white king), `bN.svg` (black knight)
- Position formula: `x = col * squareSize`, `y = row * squareSize`
- When `flipped=true`: `col = 7 - col`, `row = 7 - row`
- Piece images preloaded in constructor via `new Image()` for fast rendering

### Drag & Drop System
```
mousedown/touchstart on square:
  → Check if square has player's piece
  → If yes: select piece, show legal move dots
  → Begin drag (piece follows cursor)

mousemove/touchmove:
  → Move dragged piece image to cursor position

mouseup/touchend:
  → Get target square from cursor position
  → If target has legal move dot → _tryMove(from, to)
  → else → cancel drag, restore piece position

Click-to-move (alternative to drag):
  → First click: select piece and show legal moves
  → Second click on legal square: _tryMove(from, to)
  → Second click elsewhere: deselect
```

### Move Callback Flow
```
User interaction → _tryMove(from, to) →
  Check if move is legal (via chess.js .moves({square})) →
  If pawn reaches last rank → default promotion to 'q' →
  Call this.onMove(from, to, promotion)
```

**CRITICAL NOTE**: The board does NOT execute the move itself. It only notifies the trainer via `onMove`. The trainer decides whether to accept/reject and updates the board via `setPosition()`.

### Coordinate System
- Squares named: `a1` to `h8` (standard algebraic)
- Internal: `col` (0-7 maps to a-h), `row` (0-7 maps to rank 8 down to 1)
- `_squareToCoords(col, row)` → pixel `{x, y}`
- `_coordsToSquare(px, py)` → `{col, row}`
- `_squareNameToColRow("e4")` → `{col: 4, row: 4}`

### Theme Support
The board reads CSS custom properties for colors:
```css
:root {
    --board-light: #e8dcc8;
    --board-dark: #7c9a6e;
    --board-highlight: rgba(255, 255, 100, 0.45);
}
```

---

## 3. Puzzle Trainer (`WoodpeckerTrainer`)

### Purpose
Engine that orchestrates puzzle solving: loads puzzles from parsed PGN, validates player moves, handles variations, tracks accuracy, and manages session timing.

### Constructor
```js
const trainer = new WoodpeckerTrainer(board);
// Automatically sets board.onMove to route moves to _handlePlayerMove
```

### State Properties
```js
// Core state
this.puzzles = [];           // All parsed PGN games
this.currentPuzzleIndex = -1;
this.currentMoves = [];      // Current move sequence being traversed
this.moveIndex = 0;          // Position in currentMoves
this.playerColor = 'w';      // 'w' or 'b' (determined from FEN)
this.mistakes = 0;           // Mistake count for current puzzle
this.isActive = false;
this.isPaused = false;

// Variation support
this.moveStack = [];              // Stack for variation context
this._variationsDone = false;     // Variations for current move already explored
this.isInVariation = false;       // Currently inside a variation
this._isAutoPlaying = false;      // Auto-playing bad variation (blocks user input)
this._playerVariationRestore = null; // State to restore after bad variation

// Session
this.sessionAttempts = [];        // Array of { puzzleIndex, correct, timeMs, mistakes }
this.SESSION_DURATION = 600;      // 10 minutes in seconds
this.remainingSeconds = 600;
```

### Callbacks
```js
trainer.onPuzzleComplete = (data) => {
    // { puzzleIndex, correct, timeMs, mistakes, totalAttempts, totalSolved }
};
trainer.onSessionComplete = (data) => {
    // { reason: 'timeout'|'manual'|'all_solved', duration, attempts, puzzlesAttempted, puzzlesSolved }
};
trainer.onTimerUpdate = (remainingSeconds) => {};
trainer.onStatusChange = (data) => {
    // { status: 'your_turn'|'incorrect'|'entering_variation'|'exiting_variation'
    //          |'player_bad_variation'|'player_good_variation'|'return_to_mainline',
    //   ...extra fields depending on status }
};
trainer.onMoveCompleted = (data) => { /* { san, from, to, moveIndex } */ };
trainer.onPuzzleStart = (data) => { /* { puzzleIndex, totalPuzzles, playerColor } */ };
```

### Core Flow: `_processNextMove()`

```
_processNextMove():
  1. If moveIndex >= currentMoves.length:
     - If moveStack not empty → _exitVariation()
     - Else → _completePuzzle()
     - Return

  2. Get moveNode at currentMoves[moveIndex]

  3. If moveNode has variations AND not already explored AND it's OPPONENT's turn:
     → _startVariationExploration(moveNode)
     → Return

  4. If it's OPPONENT's turn:
     → setTimeout 300ms → _executeMove(moveNode) → moveIndex++ → recurse

  5. If it's PLAYER's turn:
     → board.interactive = true
     → Emit 'your_turn' status
     → Wait for player input (handled by _handlePlayerMove)
```

### Move Validation: `_handlePlayerMove(from, to, promotion)`

```
1. Save FEN before move attempt
2. Try chess.move({from, to, promotion})
3. If invalid move → return (ignore)
4. Normalize both attempt SAN and expected SAN (strip +, #, !, ?)
5. If matches mainline:
   → Correct! Update board, play sound, show feedback, moveIndex++, continue
6. Else check variations:
   → _findMatchingPlayerVariation(expectedMove, normalizedAttempt)
   → If matches bad variation (NAG ? or ??):
     → mistakes++, auto-play variation at 2s/move, then restore
   → If matches good variation:
     → Interactive play through variation, then restore
   → If no match:
     → Wrong move! Undo, mistakes++, show 'incorrect'
```

### SAN Normalization
```js
_normalizeSan(san) { return san.replace(/[+#!?]/g, '').trim(); }
// "Nf3+" → "Nf3", "e8=Q#" → "e8=Q", "Rxb4+?" → "Rxb4"
```

### Variation Handling — Stack-Based State Machine

The trainer uses a **context stack** (`moveStack`) to traverse variations:

```js
// Stack entry structure:
{
    moves: [...],           // The move sequence to return to
    moveIndex: 5,           // Position in that sequence
    chessFen: "rnbq...",    // FEN to restore when exiting
    pendingVariations: [],  // Remaining variations at this level
    variationsDone: true,   // Skip re-exploring variations on restore
    playerVariation: false  // true if entered via player choice (good variation)
}
```

#### Opponent-Side Variations (auto-explored)
When `_processNextMove()` finds an **opponent**'s move with variations:
1. Save current context → push to `moveStack`
2. `chess.load(savedFen)` — restore position to before branching move
3. Enter first variation: `currentMoves = variation`, `moveIndex = 0`
4. Show "📌 Có biến phụ!" status
5. Process variation moves normally (opponent auto-play, player interactive)
6. When variation ends (`moveIndex >= length`), call `_exitVariation()`
7. If more `pendingVariations` → enter next one (show "📌 Biến phụ 2/3")
8. If no more → restore mainline, show "↩ Quay lại biến chính", continue mainline

#### Player-Side Bad Variation (NAG 2 `?` or NAG 4 `??`)
1. Keep player's move on board (don't undo)
2. `mistakes++`, play incorrect sound
3. Show "❌ Đây là nước sai lầm!"
4. Save `_playerVariationRestore = { chessFen, moves, moveIndex }`
5. `_autoPlayBadVariation(variation, 1)`:
   - Loop through remaining moves at 2s intervals
   - Execute each move via `_executeMove()` (both sides auto-play)
   - Check `isActive` at each step (stop if session ended)
6. When complete → show "↩ Quay lại tìm nước hay hơn"
7. After 2s → `_restoreFromPlayerVariation()`: load saved FEN, wait for player

#### Player-Side Good Variation (no bad NAG)
1. Keep player's move on board
2. Show "✅ Đây là nước cũng hay!"
3. Push mainline to `moveStack` with `playerVariation: true`
4. `currentMoves = variation`, `moveIndex = 1` (player already played move 0)
5. Process variation interactively (normal flow)
6. When `_exitVariation()` pops stack with `playerVariation: true`:
   - Show "↩ Quay lại tìm nước hay hơn"
   - After 2s → restore FEN, wait for player to find mainline move

### Safety Guards

| Guard | Where | Purpose |
|-------|-------|---------|
| `!this.isActive` | `_autoPlayBadVariation` (each step) | Stop auto-play chain if session ended |
| `!this._isAutoPlaying` | `board.onMove` callback | Block user interaction during auto-play |
| `!this.isActive` | `_restoreFromPlayerVariation` | Don't restore if session already ended |
| `_playerVariationRestore = null` | `reset()`, `startPuzzle()` | Clear stale state |
| `_isAutoPlaying = false` | `reset()`, `startPuzzle()` | Clear stale state |

### Puzzle Completion
```js
_completePuzzle() {
    const correct = (this.mistakes === 0);
    const timeMs = Date.now() - this.puzzleStartTime;
    // Record attempt, notify callback, start next puzzle or end session
}
```

### Session Timer
- 10-minute countdown, 1-second interval
- `startTimer()` begins countdown
- `endSession('timeout')` called when time reaches 0
- Timer paused when `isPaused = true`

### Player Color Detection
Determined from FEN active color field:
```js
const fenParts = fen.split(' ');
this.playerColor = fenParts[1]; // 'w' or 'b'
```
Board is auto-flipped so player's pieces are always at bottom.

---

## 4. PGN Example — Full Flow

### Input PGN
```pgn
[FEN "3r3r/pkpR1ppp/1p6/1P6/1b6/3B4/1PP2PPP/1K2R3 w - - 0 1"]

{Steinitz vs Fleissig, 1873} 1. Rxd7 {White wins back the piece.} Kxd7 
(1... Rxb4+? {captures a pawn, but:} 2. Bxb4 Kxd7 3. Kb5) 
2. Kxb5 *
```

### Parsed Move Tree
```
moves[0]: { san: "Rxd7", isWhite: true, comment: "White wins back the piece.", variations: [] }
moves[1]: { san: "Kxd7", isWhite: false, variations: [
    [  // Variation 0 — attached to Kxd7, alternative for black
        { san: "Rxb4+", isWhite: false, nags: [2], comment: "captures a pawn, but:" },
        { san: "Bxb4",  isWhite: true,  nags: [], comment: "" },
        { san: "Kxd7",  isWhite: false, nags: [], comment: "" },
        { san: "Kb5",   isWhite: true,  nags: [], comment: "" }
    ]
]}
moves[2]: { san: "Kxb5", isWhite: true, comment: "", variations: [] }
```

### Interaction Flow (Player = White)
```
1. Board shows position from FEN. Player = White (turn to move).
2. Player plays Rxd7 → matches moves[0].san → ✅ Correct!
3. _processNextMove → moves[1] = Kxd7 (Black, opponent)
   → Has variations! → Auto-explore opponent variation
   → "📌 Có biến phụ!" → save context, enter variation
4. chess.load(FEN before Kxd7) → position restored
5. Auto-play Rxb4+ (opponent/black) → board shows move
6. Player plays Bxb4 → ✅ Correct!
7. Auto-play Kxd7 (opponent) → board shows
8. Player plays Kb5 → ✅ Correct!
9. Variation ends → _exitVariation() → No more variations
10. "↩ Quay lại biến chính" → Restore position
11. Auto-play Kxd7 (mainline, opponent) → board shows
12. Player plays Kxb5 → ✅ Puzzle complete!
```

---

## 5. Key Design Decisions

1. **Board does NOT validate moves** — only the trainer (via chess.js) validates. Board is purely visual + interaction.
2. **`_normalizeSan` strips check/promotion/annotation symbols** — so `Nf3+` matches `Nf3`, `e8=Q#` matches `e8=Q`.
3. **Variations are attached to the PRECEDING move node** — following PGN standard. The variation offers an alternative to that move.
4. **Player-side variations are NOT auto-explored** — only triggered when the player actually plays a move matching the variation.
5. **No chess engine integration** — move quality determined solely by NAGs in the PGN file (`?`/`??` = bad, everything else = good).
6. **Timer runs during variation exploration** — intentional (counts toward session time).
7. **Piece images are SVG** — stored at `img/pieces/{wK,bK,...}.svg`. Preloaded for performance.
8. **CSS variables for theming** — `--board-light`, `--board-dark`, `--board-highlight` control board colors.
9. **All timeouts use specific delays** — 300ms (normal move), 800ms (entering variation), 1000ms (exiting variation), 2000ms (bad variation auto-play).

---

## 6. Minimal Integration Template

### HTML
```html
<div id="chess-board-container"></div>
<div id="wp-training-status"></div>
<div id="wp-hint-flash" class="wp-hint-flash"></div>

<script src="js/chess.js"></script>
<script src="js/pgn-parser.js"></script>
<script src="js/chessboard.js"></script>
<script src="js/woodpecker-trainer.js"></script>
```

### JavaScript
```js
// 1. Create board
const board = new ChessBoard('chess-board-container', { size: 480 });

// 2. Create trainer
const trainer = new WoodpeckerTrainer(board);

// 3. Set callbacks
trainer.onPuzzleComplete = (data) => {
    console.log(`Puzzle ${data.puzzleIndex}: ${data.correct ? 'Solved!' : 'Failed'}`);
};
trainer.onStatusChange = (data) => {
    document.getElementById('wp-training-status').textContent = data.status;
};
trainer.onSessionComplete = (data) => {
    console.log(`Session ended: ${data.reason}, solved ${data.puzzlesSolved}/${data.puzzlesAttempted}`);
};

// 4. Load PGN and start
fetch('puzzles.pgn')
    .then(r => r.text())
    .then(pgnText => {
        const games = PGNParser.parseMultipleGames(pgnText);
        trainer.loadPuzzles(games);
        trainer.startTimer();
        trainer.startPuzzle(0);
    });
```
