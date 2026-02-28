# TriTueTre Chess Training — Complete System Recreation Guide

> This document provides **100% complete specifications** to recreate the entire chess puzzle training system from scratch. Covers every module: PGN parsing, interactive board, puzzle trainer, SPA controller, sound effects, board skins, session management, backend API, database, admin dashboard, statistics, and PDF export.

---

## Architecture Overview

```
Browser (SPA)                                     Server (Node.js + Express)
┌─────────────────────────────────┐               ┌──────────────────────────┐
│  WoodpeckerApp (SPA controller) │    REST API   │  Express server.js       │
│    ├── ChessBoard (SVG board)   │◄────────────►│    ├── Auth (JWT-like)    │
│    ├── WoodpeckerTrainer        │               │    ├── Puzzle Sets CRUD  │
│    ├── PGNParser                │               │    ├── Sessions/Attempts │
│    ├── SoundManager             │               │    ├── Stats/Streaks     │
│    └── Board Skins              │               │    └── Admin endpoints   │
└─────────────────────────────────┘               └──────────┬───────────────┘
                                                             │
                                                  ┌──────────▼───────────────┐
                                                  │  PostgreSQL (8 tables)   │
                                                  └──────────────────────────┘
```

### Files & Responsibilities

| File | Role |
|------|------|
| `pgn-parser.js` | Parse PGN → move tree with variations, comments, NAGs, arrows |
| `chessboard.js` | SVG interactive board: drag&drop, highlights, arrows, skins |
| `woodpecker-trainer.js` | Training engine: move validation, variation traversal, timer |
| `woodpecker-app.js` | SPA: auth, views, dashboard, admin, stats, PDF export, skins |
| `sound-manager.js` | Web Audio API synthesized chess sounds |
| `server.js` | Express REST API (auth, sessions, attempts, stats, admin) |
| `db.js` | PostgreSQL pool + schema initialization |
| `woodpecker.html` | Single-page HTML with all views |
| `woodpecker.css` | Full styling with light/dark theme |

### External Dependencies

- **chess.js** (v0.10.3 CDN): `new Chess()`, `.move()`, `.undo()`, `.load(fen)`, `.fen()`, `.moves()`, `.board()`, `.turn()`, `.get(sq)`
- **Piece SVGs**: `img/pieces/{wK,wQ,wR,wB,wN,wP,bK,bQ,bR,bB,bN,bP}.svg`
- **bcryptjs**: Password hashing
- **pg**: PostgreSQL client
- **multer**: PGN file upload (memory storage)

---

## 1. PGN Parser (`PGNParser`)

### Purpose
Parse raw PGN text into structured move trees preserving **variations**, **comments**, **NAGs**, and **ChessBase annotations** (arrows/highlights).

### Entry Point
```js
const games = PGNParser.parseMultipleGames(pgnText);
// Returns: Array<GameObject>
```

### Game Object
```js
{
  headers: { White: "...", Black: "...", FEN: "...", Result: "1-0", ... },
  white: "Kasparov", black: "Karpov", result: "1-0", eco: "B12",
  fen: "rnbqkbnr/... w KQkq - 0 1" | null,  // null = standard start
  gameComment: "Comment before first move",
  moves: [ MoveNode, ... ]  // Mainline array
}
```

### Move Node Structure (CRITICAL)
```js
{
  san: "Nf3",                // Standard Algebraic Notation
  moveNumber: 1,             // Move number
  isWhite: true,             // true = white's turn
  comment: "Good move!",     // Text after the move
  nags: [1, 14],             // Numeric Annotation Glyphs
  arrows: [{ color: "#2ecc71", from: "e2", to: "e4" }],   // [%cal]
  highlights: [{ color: "#e74c3c", square: "e4" }],        // [%csl]
  variations: [              // Alternatives to THIS move
    [ MoveNode, MoveNode, ... ],  // Variation 1
    [ MoveNode, MoveNode, ... ],  // Variation 2
  ]
}
```

**CRITICAL**: A variation attached to move X is an ALTERNATIVE to move X, starting from the position BEFORE move X.

### Tokenizer
Two-phase: **tokenize** → **parse**.

Token types: `move`, `move_number`, `comment`, `variation_start`, `variation_end`, `nag`, `result`

**SAN regex**: `/^(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?)/`

**Annotation symbols** (`!`, `?`, `!!`, `??`, `!?`, `?!`) convert to NAGs: `{ '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 }`

### Comment Parsing (ChessBase Annotations)
- `[%cal Ge2e4,Re7e5]` → arrows (G=green, R=red, B=blue, Y=yellow, C=cyan, M=magenta)
- `[%csl Gd5,Re4]` → square highlights
- `[%evp ...]`, `[%mdl ...]` → stripped

Color codes: `R=#e74c3c, G=#2ecc71, B=#3498db, Y=#f1c40f, C=#1abc9c, M=#9b59b6`

### Recursive Variation Parsing
```
parseSequence():
  while (hasTokens):
    variation_end → break
    result → skip
    move_number → update currentMoveNumber, skip
    move → create node, collect NAGs/comments, collect variations (recurse), push
```

### Helper Methods
- `getMainline(moves)` — flatten first-child path through move tree
- `getMoveAtIndex(moves, idx)` — get n-th mainline move
- `nagToSymbol(nag)` — convert NAG number to display symbol (1→"!", 4→"??", etc.)

---

## 2. Interactive Chessboard (`ChessBoard`)

### Constructor
```js
const board = new ChessBoard('container-id', {
    size: 480,           // Board size in pixels (square)
    flipped: false,      // true = black at bottom
    interactive: true,   // Allow piece interaction
    playerColor: 'w',    // Which color can interact
    onMove: (from, to, promotion) => {},
    lightColor: '#e8dcc8',
    darkColor: '#7c9a6e'
});
```

Colors read from CSS `--board-light` / `--board-dark` / `--board-highlight` with JS fallbacks.

### SVG Layer Structure
```
<svg>
  ├── <g id="board-layer">     — 64 colored rects + coordinate labels
  ├── <g id="highlight-layer"> — Move highlights, selection highlights
  ├── <g id="piece-layer">     — Piece <image> elements
  ├── <g id="arrow-layer">     — Annotation arrows (lines with arrowhead markers)
  ├── <g id="legal-move-layer">— Legal move dots/rings
  └── <g id="drag-layer">      — Dragged piece clone
```

### Key Methods

| Method | Description |
|--------|-------------|
| `setPosition(chess, animate)` | Sync board with chess.js. Smart diff: only add/remove changed pieces |
| `showLastMove(from, to)` | Highlight from/to squares with semi-transparent overlay |
| `clearLastMove()` | Remove move highlights |
| `flip()` | Rotate 180° |
| `resize(newSize)` | Resize and redraw everything |
| `setSkin(lightColor, darkColor)` | **Change board colors at runtime** and redraw |
| `drawArrows(arrows)` | Draw annotation arrows with SVG markers |
| `drawHighlights(highlights)` | Draw colored square overlays |
| `clearAnnotations()` | Remove arrows + highlights |

### Piece Rendering
- SVG `<image>` elements pointing to `img/pieces/{color}{Piece}.svg`
- Position: `x = col * squareSize`, `y = row * squareSize`
- When `flipped`: `col = 7-col`, `row = 7-row`
- **Smart diff**: on `_drawPieces()`, compare desired vs existing DOM — only add/remove changed pieces
- Images preloaded via `new Image()` in constructor

### Drag & Drop
```
mousedown/touchstart → select piece, show legal dots, start drag
mousemove/touchmove → move dragged piece to cursor
mouseup/touchend → drop on target → _tryMove(from, to)
Click-to-move: click piece → click target square
```

**Auto-promotion**: pawns reaching last rank auto-promote to queen.

**CRITICAL**: Board does NOT validate moves. It calls `this.onMove(from, to, promotion)`. Trainer decides acceptance.

### Coordinate System
- `_squareToCoords(col, row)` → pixel `{x, y}`
- `_coordsToSquare(px, py)` → `"e4"` string
- `_squareNameToColRow("e4")` → `{col: 4, row: 4}`

---

## 3. Board Skins System

### 3 Skill-Optimized Skins (Color Psychology)

| Key | Name | Light | Dark | Background | Purpose |
|-----|------|-------|------|------------|---------|
| `memory` | 🧠 Trí nhớ | `#f0d9b5` (warm wheat) | `#b58863` (amber-brown) | `#2c1f14` | Warm tones aid pattern recognition & spatial memory |
| `focus` | 🎯 Tập trung | `#dee3e6` (silver-gray) | `#6b8cae` (steel-blue) | `#1a2332` | Cool tones reduce visual fatigue, promote concentration |
| `speed` | ⚡ Tốc độ | `#eeeed2` (bright cream) | `#769656` (vivid green) | `#302e2b` | High contrast maximizes scanning speed |

### Implementation
```js
// Defined as static property on WoodpeckerApp
static BOARD_SKINS = { memory: { name, desc, light, dark, bg }, focus: {...}, speed: {...} };

// Apply skin
applySkin(skinKey) {
    localStorage.setItem('wp_board_skin', skinKey);
    this.board.setSkin(skin.light, skin.dark);
    document.getElementById('view-training').style.background = skin.bg;
}

// Auto-apply on session start
_applyCurrentSkin() → reads localStorage('wp_board_skin'), defaults to 'memory'
```

### Selector UI
- 🎨 button next to 🔄 (flip) button in training view
- Modal shows 3 options with **mini 4×4 chessboard previews**
- Active skin highlighted with primary color border
- Persisted in `localStorage('wp_board_skin')`

---

## 4. Sound Manager (`SoundManager`)

### Purpose
ASMR-style chess sounds using **Web Audio API** — no audio files needed.

### Sounds

| Method | Sound | Technique |
|--------|-------|-----------|
| `playMove()` | Soft wooden "tok" | Sine 420→280Hz + filtered noise burst |
| `playCapture()` | Deep resonant thud | Sine 300→120Hz + harmonic + noise |
| `playCorrect()` | Ascending bell chime | 4-note pentatonic (C5→E5→G5→C6) with detuned harmonics |
| `playIncorrect()` | Gentle descending tone | Sine 440→349Hz, then 370→293Hz |

### Key Details
- Lazy `AudioContext` creation (user gesture requirement)
- Auto-resume suspended context
- `this.enabled` flag to toggle
- Global instance: `const soundManager = new SoundManager()`

---

## 5. Puzzle Trainer (`WoodpeckerTrainer`)

### Constructor
```js
const trainer = new WoodpeckerTrainer(board);
// Sets board.onMove → routes to _handlePlayerMove
```

### State
```js
this.puzzles = [];              // Loaded PGN games
this.currentPuzzleIndex = -1;
this.currentMoves = [];         // Current move sequence
this.moveIndex = 0;
this.playerColor = 'w';         // From FEN active color
this.mistakes = 0;
this.isActive = false;
this.isPaused = false;

// Variation support
this.moveStack = [];            // Context stack for variations
this._variationsDone = false;
this.isInVariation = false;
this._isAutoPlaying = false;    // Blocks user input during bad variation
this._playerVariationRestore = null;

// Timer with pause tracking
this._pausedTotal = 0;          // Total ms spent paused
this._pauseStart = null;        // Timestamp when current pause started
this.SESSION_DURATION = 600;    // 10 min
```

### Callbacks
```js
onPuzzleComplete = ({ puzzleIndex, correct, timeMs, mistakes, totalAttempts, totalSolved });
onSessionComplete = ({ reason: 'timeout'|'manual'|'all_solved', duration, attempts, ... });
onTimerUpdate = (remainingSeconds);
onStatusChange = ({ status: 'your_turn'|'incorrect'|'entering_variation'|... });
onMoveCompleted = ({ san, from, to, moveIndex });
onPuzzleStart = ({ puzzleIndex, totalPuzzles, playerColor });
```

### Core Flow: `_processNextMove()`
```
1. moveIndex >= currentMoves.length?
   → moveStack not empty? _exitVariation() : _completePuzzle()
2. Get moveNode at currentMoves[moveIndex]
3. Opponent's move with unexplored variations?
   → _startVariationExploration(moveNode)
4. Opponent's turn?
   → setTimeout(300ms) → _executeMove() → moveIndex++ → recurse
5. Player's turn?
   → board.interactive = true → emit 'your_turn' → wait
```

### Move Validation: `_handlePlayerMove(from, to, promotion)`
```
1. Save FEN before attempt
2. Try chess.move({from, to, promotion})
3. Normalize both SANs: strip +, #, !, ? → compare
4. Matches mainline → ✅ correct, continue
5. Check variations:
   - Bad variation (NAG 2/4) → mistakes++, auto-play at 2s/move, restore
   - Good variation (no bad NAG) → interactive play, restore
   - No match → ❌ wrong, undo, mistakes++
```

**SAN normalization**: `san.replace(/[+#!?]/g, '').trim()`

### Variation State Machine (Stack-Based)

**Opponent-side variations (auto-explored):**
1. Push current context → `moveStack`
2. `chess.load(savedFen)` before branch
3. Enter first variation → show "📌 Có biến phụ!"
4. Process normally (opponent auto, player interactive)
5. On end → `_exitVariation()` → check `pendingVariations`
6. All done → restore mainline → "↩ Quay lại biến chính"

**Player bad variation (NAG ? or ??):**
1. Keep player's move, `mistakes++`, play incorrect sound
2. Show "❌ Đây là nước sai lầm!"
3. `_autoPlayBadVariation()` — both sides at 2s/move
4. After → "↩ Quay lại tìm nước hay hơn" → restore FEN → wait

**Player good variation (no bad NAG):**
1. Keep move, show "✅ Đây là nước cũng hay!"
2. Push mainline to stack with `playerVariation: true`
3. Play through variation interactively
4. On exit → restore → wait for mainline move

### Timer (with Pause Tracking)
```js
startTimer() {
    this.sessionStartTime = Date.now();
    this._pausedTotal = 0;
    this._pauseStart = null;
    // setInterval 1s countdown
}

getElapsedTime() {
    let paused = this._pausedTotal;
    if (this._pauseStart) paused += Date.now() - this._pauseStart;
    return Math.floor((Date.now() - this.sessionStartTime - paused) / 1000);
}

togglePause() {
    if (this.isPaused) {
        this._pausedTotal += Date.now() - this._pauseStart;
        this._pauseStart = null;
    } else {
        this._pauseStart = Date.now();
    }
    this.isPaused = !this.isPaused;
}
```

---

## 6. SPA Controller (`WoodpeckerApp`)

### Views (Single Page)
| View ID | Purpose |
|---------|---------|
| `view-login` | Username/password login |
| `view-register` | Registration form (pending admin approval) |
| `view-register-success` | Registration confirmation |
| `view-dashboard` | Puzzle sets grid |
| `view-set-detail` | Set info + cycle progress + start session |
| `view-training` | Board + trainer panel + timer |
| `view-admin` | User management, puzzle sets, cycle requests |

### Auth Flow
```
Login → POST /api/auth/login → token → localStorage('wp_token')
Init → GET /api/auth/me (with Bearer token) → user object
Logout → DELETE /api/auth/logout → clear localStorage → end active session via sendBeacon
```

### Session Lifecycle
```
1. User clicks "Bắt đầu luyện tập" on set detail
2. POST /api/woodpecker/sessions/:setId/start → { sessionId, cycleId, puzzles, solvedPuzzleIndices }
3. Client loads PGN, creates board + trainer, applies skin, starts timer
4. Each puzzle complete → POST /api/woodpecker/sessions/:sessionId/attempt
5. Session ends (timeout/manual/all_solved) → PUT /api/woodpecker/sessions/:sessionId
6. On F5/close → sendBeacon POST /api/woodpecker/sessions/:sessionId/end
```

### beforeunload / Logout Safety
```js
_setupBeforeUnload() {
    window.addEventListener('beforeunload', () => {
        if (this.currentSessionId && this.trainer?.isActive) {
            const blob = new Blob([JSON.stringify({
                duration: this.trainer.getElapsedTime(),
                token: this.token
            })], { type: 'application/json' });
            navigator.sendBeacon(`/api/woodpecker/sessions/${this.currentSessionId}/end`, blob);
        }
    });
}

logout() {
    // End active session via sendBeacon FIRST, then clear auth
}
```

### PDF Export
```
showExportPdfForm() → modal with user checkboxes (select all / individual)
exportUserStatsPdf() →
  1. Fetch /api/admin/users/:id/stats for each selected user (parallel)
  2. Build compact HTML cards: name, streak badges, stats row, puzzle sets with mini progress bars
  3. 2-column CSS grid layout, font 13-15px, fits 4-6 users per A4
  4. window.open() + document.write() + window.print()
```

---

## 7. Backend API (`server.js`)

### Tech Stack
- Express.js, PostgreSQL (pg), bcryptjs, multer, crypto

### Auth
- Token-based (random 64-char hex), stored in `sessions` table
- `authMiddleware`: reads `Authorization: Bearer <token>` header
- `adminMiddleware`: checks `role = 'admin'`
- Token expires after 7 days

### Key Endpoints

#### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register (status='pending', needs admin approval) |
| POST | `/api/auth/login` | Login → returns token + user |
| GET | `/api/auth/me` | Get current user |
| DELETE | `/api/auth/logout` | Delete session token |

#### Puzzle Sets & Training
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/woodpecker/sets` | User's assigned puzzle sets with cycle progress |
| GET | `/api/woodpecker/sets/:id` | Set detail with cycles and sessions |
| POST | `/api/woodpecker/sessions/:setId/start` | Start training session → returns PGN + solvedPuzzleIndices |
| POST | `/api/woodpecker/sessions/:sessionId/attempt` | Record puzzle attempt |
| PUT | `/api/woodpecker/sessions/:sessionId` | End session normally |
| POST | `/api/woodpecker/sessions/:sessionId/end` | End via sendBeacon (F5/logout) |
| GET | `/api/woodpecker/stats/:setId` | Stats for leaderboard |

#### Beacon Endpoint (F5/Close Safety)
```js
// POST /api/woodpecker/sessions/:sessionId/end
// Body (sendBeacon): { duration, token }
// 1. Recalculate puzzles_attempted/puzzles_solved from attempts table
// 2. Update training_sessions with ended_at, duration, recalculated counts
// 3. If token provided → record daily_completion
```

#### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | All users |
| GET | `/api/admin/users/:id/stats` | User stats (streak, sets progress, PPM) |
| POST | `/api/admin/users/:id/approve` | Approve pending registration |
| POST | `/api/admin/users/:id/reject` | Reject registration |
| DELETE | `/api/admin/users/:id` | Delete user |
| POST | `/api/admin/create-user` | Admin creates user directly |
| GET | `/api/admin/puzzle-sets` | All sets with assigned users |
| POST | `/api/admin/puzzle-sets` | Create set (PGN file upload) |
| DELETE | `/api/admin/puzzle-sets/:id` | Delete set |
| POST | `/api/admin/puzzle-sets/:id/assign` | Assign set to user |
| GET | `/api/admin/cycle-requests` | Pending cycle unlock requests |
| POST | `/api/admin/cycle-requests/:id/approve` | Approve cycle request |
| POST | `/api/admin/cycle-requests/:id/reject` | Reject cycle request |

### Admin User Stats Response
```js
{
  user: { id, username, fullName, dateOfBirth, createdAt },
  streak: { current, longest, totalDays, completedToday },
  puzzleSets: [{
    name, puzzleCount, completedCycles, currentCycle, totalCycles,
    puzzlesSolved  // unique correct puzzle indices in current cycle
  }],
  stats: {
    totalSessions, totalAttempted, totalSolved,
    accuracy,      // (totalSolved/totalAttempted * 100).toFixed(1)
    totalTimeMinutes,
    ppm            // puzzles per minute = totalSolved / totalTimeMinutes
  }
}
```

---

## 8. Database Schema

### Tables

```sql
-- Users (role: 'admin'|'user', status: 'active'|'pending')
users (id TEXT PK, username UNIQUE, full_name, password_hash, date_of_birth, role, status, created_at)

-- Auth sessions (token-based, 7-day expiry)
sessions (token TEXT PK, user_id FK→users, created_at)

-- Puzzle sets (PGN stored as text in DB)
puzzle_sets (id TEXT PK, name, pgn_file, pgn_content, original_name, puzzle_count, assigned_to FK→users, created_at)

-- Cycles (Woodpecker method: 7 cycles with decreasing target days)
cycles (id TEXT PK, set_id FK→puzzle_sets, cycle_number INT, target_days INT, started_at, completed_at)

-- Training sessions (10-min timed sessions)
training_sessions (id TEXT PK, cycle_id FK→cycles, started_at, ended_at, duration INT, puzzles_attempted INT, puzzles_solved INT)

-- Individual puzzle attempts
attempts (id SERIAL PK, session_id FK→training_sessions, puzzle_index INT, correct BOOL, time_ms INT, recorded_at)

-- Cycle unlock requests (require admin approval)
cycle_requests (id TEXT PK, user_id FK→users, set_id FK→puzzle_sets, cycle_number INT, status, created_at)

-- Streak tracking
daily_completions (id TEXT PK, user_id FK→users, completed_date DATE, created_at, UNIQUE(user_id, completed_date))
```

### Woodpecker Cycle System
7 cycles with decreasing target days: `[one_week, 14, 7, 3, 2, 1, 1]`
- Cycle completes when all puzzles solved correctly
- Next cycle requires admin approval (cycle_requests)
- Each cycle user must solve ALL puzzles in the set again

### ID Generation
```js
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}
```

---

## 9. Streak & Statistics System

### Daily Completion
Recorded when a training session ends with ≥5 minutes duration. Tracked in `daily_completions` table (1 record per user per day).

### Streak Calculation
```
1. Query daily_completions ORDER BY completed_date DESC
2. Check if today is completed
3. Walk backwards from today (or yesterday) counting consecutive days
4. Longest streak: scan all dates for longest consecutive run
```

### Stats Per Set
- `puzzlesSolved`: COUNT(DISTINCT puzzle_index) WHERE correct=true AND cycle_id=currentCycle
- Progress bar shows `puzzlesSolved / puzzleCount`

### PPM (Puzzles Per Minute)
`ppm = totalSolved / totalTimeMinutes` — only counted from completed sessions.

---

## 10. Key Design Decisions

1. **Board does NOT validate moves** — only trainer (via chess.js) validates
2. **`_normalizeSan` strips `+#!?`** — so `Nf3+` matches `Nf3`
3. **Variations attached to PRECEDING move node** — PGN standard
4. **Player variations only triggered by player's actual move** — not auto-explored
5. **Bad move quality from NAGs only** — `?`/`??` = bad, everything else = good
6. **Timer exclusion of pause time** — `_pausedTotal` tracks accumulated pause duration
7. **sendBeacon for unload** — ensures session data saved on F5/close/logout
8. **Server recalculates stats on beacon** — `puzzles_attempted`/`puzzles_solved` recounted from `attempts` table
9. **PGN content stored in DB** — `pgn_content` column, not filesystem
10. **Synthesized sounds** — Web Audio API, no audio files needed
11. **Skin persistence** — `localStorage('wp_board_skin')`, applied on session start
12. **Registration requires approval** — status='pending' until admin approves

### Timing Constants
| Delay | Where | Purpose |
|-------|-------|---------|
| 300ms | `_processNextMove` | Opponent move auto-play |
| 800ms | `_startVariationExploration` | Entering variation notification |
| 1000ms | `_exitVariation` | Exiting variation notification |
| 2000ms | `_autoPlayBadVariation` | Auto-play speed for bad variation moves |
| 2000ms | `_restoreFromPlayerVariation` | Delay before returning to mainline |

---

## 11. Minimal Integration Template

### HTML
```html
<div id="chess-board-container"></div>
<div id="wp-training-status"></div>
<div id="wp-hint-flash" class="wp-hint-flash"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
<script src="js/pgn-parser.js"></script>
<script src="js/chessboard.js"></script>
<script src="js/sound-manager.js"></script>
<script src="js/woodpecker-trainer.js"></script>
```

### JavaScript
```js
// 1. Create board
const board = new ChessBoard('chess-board-container', { size: 480 });

// 2. Apply skin
board.setSkin('#f0d9b5', '#b58863');  // Memory skin

// 3. Create trainer
const trainer = new WoodpeckerTrainer(board);

// 4. Set callbacks
trainer.onPuzzleComplete = (data) => {
    console.log(`Puzzle ${data.puzzleIndex}: ${data.correct ? 'Solved!' : 'Failed'}`);
};
trainer.onStatusChange = (data) => {
    document.getElementById('wp-training-status').textContent = data.status;
};
trainer.onSessionComplete = (data) => {
    console.log(`Session: ${data.reason}, solved ${data.puzzlesSolved}/${data.puzzlesAttempted}`);
};

// 5. Load PGN and start
fetch('puzzles.pgn')
    .then(r => r.text())
    .then(pgnText => {
        const games = PGNParser.parseMultipleGames(pgnText);
        trainer.loadPuzzles(games);
        trainer.startTimer();
        trainer.startPuzzle(0);
    });
```
