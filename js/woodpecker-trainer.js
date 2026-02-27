/**
 * Woodpecker Trainer - Puzzle session engine
 * Handles sequential puzzle solving with timing, move validation, and attempt tracking
 */

class WoodpeckerTrainer {
    constructor(board) {
        this.board = board;
        this.chess = new Chess();

        // State
        this.puzzles = []; // All parsed games (puzzles)
        this.currentPuzzleIndex = -1;
        this.currentMoves = [];
        this.moveIndex = 0;
        this.playerColor = 'w';
        this.mistakes = 0;
        this.puzzleStartTime = 0;
        this.isActive = false;
        this.isPaused = false;

        // Session
        this.sessionAttempts = [];
        this.sessionStartTime = 0;
        this.timerInterval = null;
        this.SESSION_DURATION = 10 * 60; // 10 minutes in seconds
        this.remainingSeconds = this.SESSION_DURATION;

        // Callbacks
        this.onPuzzleComplete = null;
        this.onSessionComplete = null;
        this.onTimerUpdate = null;
        this.onStatusChange = null;
        this.onMoveCompleted = null;
        this.onPuzzleStart = null;

        // Setup board callback
        this.board.onMove = (from, to, promotion) => {
            if (this.isActive && !this.isPaused) {
                this._handlePlayerMove(from, to, promotion);
            }
        };
    }

    /**
     * Load puzzles from parsed PGN games
     */
    loadPuzzles(games) {
        this.puzzles = games;
    }

    /**
     * Get the next puzzle index to solve (for current cycle)
     * Uses the solvedIndices to determine which puzzle is next
     */
    getNextPuzzleIndex(solvedIndices) {
        for (let i = 0; i < this.puzzles.length; i++) {
            if (!solvedIndices.has(i)) return i;
        }
        return -1; // All puzzles solved
    }

    /**
     * Start a puzzle by index
     */
    startPuzzle(puzzleIndex) {
        if (puzzleIndex < 0 || puzzleIndex >= this.puzzles.length) return false;

        const game = this.puzzles[puzzleIndex];
        this.currentPuzzleIndex = puzzleIndex;
        this.mistakes = 0;
        this.puzzleStartTime = Date.now();

        // Get mainline moves
        this.currentMoves = PGNParser.getMainline(game.moves);

        // Reset chess engine and load FEN position
        this.chess.reset();
        const fen = game.fen || (game.headers && game.headers['FEN']);
        if (fen) {
            this.chess.load(fen);
        }

        // Determine player color from FEN active color
        // In tactics puzzles, the player is the side whose turn it is (active color in FEN)
        // FEN format: "position activeColor castling enPassant halfmove fullmove"
        // e.g. "8/7p/4kb2/5Rp1/8/2rB4/3K2PP/8 w - - 0 1" → White to move → player = White
        // e.g. "6k1/6p1/p3br2/1p1pQ3/5r2/1P1B2R1/1P3qPP/2R4K b - - 0 1" → Black to move → player = Black
        if (fen) {
            const fenParts = fen.split(' ');
            this.playerColor = fenParts[1] || 'w'; // 'w' or 'b'
        } else if (this.currentMoves.length > 0) {
            // Fallback: determine from first move
            this.playerColor = this.currentMoves[0].isWhite ? 'w' : 'b';
        } else {
            this.playerColor = 'w';
        }

        this.moveIndex = 0;
        this.isActive = true;

        // Sync player color to the board so it knows which pieces can be dragged
        this.board.playerColor = this.playerColor;

        // Set initial position on the board (clear previous highlights first)
        this.board.clearLastMove();
        this.board.setPosition(this.chess);

        // Orient board so player's pieces are at the bottom
        // If player is Black → board should be flipped (Black at bottom)
        // If player is White → board should not be flipped (White at bottom)
        const shouldBeFlipped = (this.playerColor === 'b');
        if (shouldBeFlipped !== this.board.flipped) {
            this.board.flip();
        }

        if (this.onPuzzleStart) {
            this.onPuzzleStart({
                puzzleIndex,
                totalPuzzles: this.puzzles.length,
                playerColor: this.playerColor
            });
        }

        // Process first move(s) - since it's the player's turn, wait for their input
        this._processNextMove();

        return true;
    }

    /**
     * Start session timer
     */
    startTimer() {
        this.sessionStartTime = Date.now();
        this.remainingSeconds = this.SESSION_DURATION;

        if (this.timerInterval) clearInterval(this.timerInterval);

        this.timerInterval = setInterval(() => {
            if (this.isPaused) return;

            const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
            this.remainingSeconds = Math.max(0, this.SESSION_DURATION - elapsed);

            if (this.onTimerUpdate) {
                this.onTimerUpdate(this.remainingSeconds);
            }

            if (this.remainingSeconds <= 0) {
                this.endSession('timeout');
            }
        }, 1000);
    }

    /**
     * Pause/resume timer
     */
    togglePause() {
        this.isPaused = !this.isPaused;
        return this.isPaused;
    }

    /**
     * End session
     */
    endSession(reason = 'manual') {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // If there's a puzzle in progress, record it as an attempt
        if (this.currentPuzzleIndex >= 0 && this.puzzleStartTime > 0) {
            const timeMs = Date.now() - this.puzzleStartTime;
            const alreadyRecorded = this.sessionAttempts.some(
                a => a.puzzleIndex === this.currentPuzzleIndex
            );
            if (!alreadyRecorded) {
                const attempt = {
                    puzzleIndex: this.currentPuzzleIndex,
                    correct: this.mistakes === 0,
                    timeMs,
                    mistakes: this.mistakes
                };
                this.sessionAttempts.push(attempt);

                // Also send to backend
                if (this.onPuzzleComplete) {
                    this.onPuzzleComplete({
                        ...attempt,
                        totalAttempts: this.sessionAttempts.length,
                        totalSolved: this.sessionAttempts.filter(a => a.correct).length,
                        isPartial: true
                    });
                }
            }
        }

        this.isActive = false;
        const duration = Math.floor((Date.now() - this.sessionStartTime) / 1000);

        if (this.onSessionComplete) {
            this.onSessionComplete({
                reason,
                duration: Math.min(duration, this.SESSION_DURATION),
                attempts: this.sessionAttempts,
                puzzlesAttempted: this.sessionAttempts.length,
                puzzlesSolved: this.sessionAttempts.filter(a => a.correct).length
            });
        }
    }

    /**
     * Get elapsed session time in seconds
     */
    getElapsedTime() {
        if (!this.sessionStartTime) return 0;
        return Math.floor((Date.now() - this.sessionStartTime) / 1000);
    }

    /**
     * Process the next move in the sequence
     */
    _processNextMove() {
        if (this.moveIndex >= this.currentMoves.length) {
            // Puzzle completed
            this._completePuzzle();
            return;
        }

        const moveNode = this.currentMoves[this.moveIndex];
        const isPlayerTurn = this._isPlayerTurn(moveNode);

        if (!isPlayerTurn) {
            // Opponent's move - auto-play after delay
            setTimeout(() => {
                this._executeMove(moveNode);
                this.moveIndex++;
                this._processNextMove();
            }, 300);
        } else {
            // Player's turn - wait for input
            this.board.interactive = true;
            if (this.onStatusChange) {
                this.onStatusChange({ status: 'your_turn', moveIndex: this.moveIndex });
            }
        }
    }

    /**
     * Execute a move on the board
     */
    _executeMove(moveNode) {
        const result = this.chess.move(moveNode.san);
        if (result) {
            this.board.setPosition(this.chess, true);
            this.board.showLastMove(result.from, result.to);

            // Play sound
            if (typeof soundManager !== 'undefined') {
                result.captured ? soundManager.playCapture() : soundManager.playMove();
            }

            if (this.onMoveCompleted) {
                this.onMoveCompleted({
                    san: result.san,
                    from: result.from,
                    to: result.to,
                    moveIndex: this.moveIndex
                });
            }
        }
        return result;
    }

    /**
     * Handle player's move attempt
     */
    _handlePlayerMove(from, to, promotion) {
        if (!this.isActive || this.moveIndex >= this.currentMoves.length) return;

        const expectedMove = this.currentMoves[this.moveIndex];

        // Try to make the move
        const attemptResult = this.chess.move({
            from, to,
            promotion: promotion || 'q'
        });

        if (!attemptResult) return; // Invalid move

        // Check if it matches expected
        const normalizedAttempt = this._normalizeSan(attemptResult.san);
        const normalizedExpected = this._normalizeSan(expectedMove.san);

        if (normalizedAttempt === normalizedExpected) {
            // Correct!
            this.board.setPosition(this.chess, true);
            this.board.showLastMove(from, to);

            // Play sound
            if (typeof soundManager !== 'undefined') {
                attemptResult.captured ? soundManager.playCapture() : soundManager.playMove();
            }

            this._showFeedback('correct');

            if (this.onMoveCompleted) {
                this.onMoveCompleted({
                    san: attemptResult.san,
                    from, to,
                    moveIndex: this.moveIndex,
                    correct: true
                });
            }

            this.moveIndex++;

            // Small delay then process next
            setTimeout(() => this._processNextMove(), 300);
        } else {
            // Wrong move - undo it
            this.chess.undo();
            this.board.setPosition(this.chess);
            this.mistakes++;

            // Play incorrect sound
            if (typeof soundManager !== 'undefined') {
                soundManager.playIncorrect();
            }

            this._showFeedback('incorrect');

            if (this.onStatusChange) {
                this.onStatusChange({ status: 'incorrect', mistakes: this.mistakes });
            }
        }
    }

    /**
     * Show visual feedback
     */
    _showFeedback(type) {
        const flash = document.getElementById('wp-hint-flash');
        if (!flash) return;

        const t = typeof i18n !== 'undefined' ? (k) => i18n.t(k) : (k) => k;
        flash.className = 'wp-hint-flash ' + type + ' show';
        flash.textContent = type === 'correct' ? t('train_correct') : t('train_incorrect');

        // Play puzzle-level feedback sound on puzzle complete
        if (type === 'correct' && typeof soundManager !== 'undefined') {
            soundManager.playCorrect();
        }

        setTimeout(() => {
            flash.classList.remove('show');
        }, 800);
    }

    /**
     * Complete current puzzle
     */
    _completePuzzle() {
        const timeMs = Date.now() - this.puzzleStartTime;
        const correct = this.mistakes === 0;

        const attempt = {
            puzzleIndex: this.currentPuzzleIndex,
            correct,
            timeMs,
            mistakes: this.mistakes
        };

        this.sessionAttempts.push(attempt);

        if (this.onPuzzleComplete) {
            this.onPuzzleComplete({
                ...attempt,
                totalAttempts: this.sessionAttempts.length,
                totalSolved: this.sessionAttempts.filter(a => a.correct).length
            });
        }
    }

    /**
     * Check if it's the player's turn
     */
    _isPlayerTurn(moveNode) {
        if (this.playerColor === 'w') {
            return moveNode.isWhite;
        }
        return !moveNode.isWhite;
    }

    /**
     * Normalize SAN for comparison
     */
    _normalizeSan(san) {
        return san.replace(/[+#!?]/g, '').trim();
    }

    /**
     * Reset trainer state
     */
    reset() {
        this.isActive = false;
        this.isPaused = false;
        this.currentPuzzleIndex = -1;
        this.currentMoves = [];
        this.moveIndex = 0;
        this.mistakes = 0;
        this.sessionAttempts = [];

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        this.chess.reset();
        this.board.setPosition(this.chess);
    }

    /**
     * Get session statistics so far
     */
    getSessionStats() {
        const attempted = this.sessionAttempts.length;
        const solved = this.sessionAttempts.filter(a => a.correct).length;
        const elapsed = this.getElapsedTime();
        const ppm = elapsed > 0 ? (solved / (elapsed / 60)).toFixed(2) : '0.00';
        const successRate = attempted > 0 ? (solved / attempted * 100).toFixed(1) : '0.0';

        return { attempted, solved, elapsed, ppm, successRate };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WoodpeckerTrainer;
}
