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

        // Variation support
        this.moveStack = [];           // Stack of saved contexts for variation traversal
        this._variationsDone = false;  // Flag: variations for current move already explored
        this.isInVariation = false;    // Are we currently inside a variation?

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
            if (this.isActive && !this.isPaused && !this._isAutoPlaying) {
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

        // Reset variation state
        this.moveStack = [];
        this._variationsDone = false;
        this.isInVariation = false;
        this._playerVariationRestore = null;
        this._isAutoPlaying = false;

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
        if (this.currentPuzzleIndex >= 0 && this.puzzleStartTime > 0 && this.moveIndex > 0) {
            const timeMs = Date.now() - this.puzzleStartTime;
            const alreadyRecorded = this.sessionAttempts.some(
                a => a.puzzleIndex === this.currentPuzzleIndex
            );
            if (!alreadyRecorded) {
                // In-progress puzzle is always incorrect (not fully solved)
                const attempt = {
                    puzzleIndex: this.currentPuzzleIndex,
                    correct: false,
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
            if (this.moveStack.length > 0) {
                // Finished a variation — exit back
                this._exitVariation();
            } else {
                // All done — puzzle complete
                this._completePuzzle();
            }
            return;
        }

        const moveNode = this.currentMoves[this.moveIndex];

        // Auto-explore variations only on OPPONENT moves
        // Player-side variations are handled in _handlePlayerMove when the player chooses one
        if (moveNode.variations && moveNode.variations.length > 0 && !this._variationsDone) {
            if (!this._isPlayerTurn(moveNode)) {
                this._variationsDone = true;
                this._startVariationExploration(moveNode);
                return;
            }
        }

        // Reset flag for next move
        this._variationsDone = false;

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
                this.onStatusChange({
                    status: 'your_turn',
                    moveIndex: this.moveIndex,
                    isVariation: this.isInVariation
                });
            }
        }
    }

    /**
     * Begin exploring variations for a move before executing it
     * Saves current context, enters the first variation
     */
    _startVariationExploration(moveNode) {
        const savedFen = this.chess.fen();
        const pendingVariations = [...moveNode.variations];
        const firstVariation = pendingVariations.shift();

        // Push mainline context onto stack
        this.moveStack.push({
            moves: this.currentMoves,
            moveIndex: this.moveIndex,
            chessFen: savedFen,
            pendingVariations,
            variationsDone: true
        });

        // Enter the first variation
        this.currentMoves = firstVariation;
        this.moveIndex = 0;
        this.isInVariation = true;

        // Restore position to before the branching move
        this.chess.load(savedFen);
        this.board.clearLastMove();
        this.board.setPosition(this.chess);

        if (this.onStatusChange) {
            this.onStatusChange({
                status: 'entering_variation',
                totalVariations: moveNode.variations.length,
                variationNumber: 1
            });
        }

        // Process first move of variation after a short delay
        setTimeout(() => this._processNextMove(), 800);
    }

    /**
     * Exit the current variation and either enter the next one or return to mainline
     */
    _exitVariation() {
        if (this.moveStack.length === 0) {
            this._completePuzzle();
            return;
        }

        const saved = this.moveStack.pop();

        // Check if there are more pending variations at this level
        if (saved.pendingVariations.length > 0) {
            // Pause 1s at end of variation before entering next one
            setTimeout(() => {
                const nextVariation = saved.pendingVariations.shift();
                const totalVariations = saved.moves[saved.moveIndex].variations.length;
                const variationNumber = totalVariations - saved.pendingVariations.length;

                // Push context back for remaining variations
                this.moveStack.push({
                    moves: saved.moves,
                    moveIndex: saved.moveIndex,
                    chessFen: saved.chessFen,
                    pendingVariations: saved.pendingVariations,
                    variationsDone: true
                });

                // Enter next variation from the same branch point
                this.currentMoves = nextVariation;
                this.moveIndex = 0;
                this.isInVariation = true;

                this.chess.load(saved.chessFen);
                this.board.clearLastMove();
                this.board.setPosition(this.chess);

                if (this.onStatusChange) {
                    this.onStatusChange({
                        status: 'entering_variation',
                        totalVariations,
                        variationNumber
                    });
                }

                // Pause 1s after restoring position before auto-playing
                setTimeout(() => this._processNextMove(), 1000);
            }, 1000);
        } else if (saved.playerVariation) {
            // Returning from a player-initiated good variation
            this.currentMoves = saved.moves;
            this.moveIndex = saved.moveIndex;
            this._variationsDone = false;
            this.isInVariation = this.moveStack.length > 0;

            this.chess.load(saved.chessFen);
            this.board.clearLastMove();
            this.board.setPosition(this.chess);

            if (this.onStatusChange) {
                this.onStatusChange({ status: 'return_to_mainline' });
            }

            // After delay, wait for player to find the mainline move
            setTimeout(() => {
                this.board.interactive = true;
                if (this.onStatusChange) {
                    this.onStatusChange({
                        status: 'your_turn',
                        moveIndex: this.moveIndex,
                        isVariation: this.isInVariation
                    });
                }
            }, 2000);
        } else {
            // Pause 1s at end of variation before restoring mainline
            setTimeout(() => {
                // All opponent variations done at this level — restore mainline
                this.currentMoves = saved.moves;
                this.moveIndex = saved.moveIndex;
                this._variationsDone = saved.variationsDone;
                this.isInVariation = this.moveStack.length > 0;

                this.chess.load(saved.chessFen);
                this.board.clearLastMove();
                this.board.setPosition(this.chess);

                if (this.onStatusChange) {
                    this.onStatusChange({ status: 'exiting_variation' });
                }

                // Pause 1s after restoring so user recognizes the position
                setTimeout(() => this._processNextMove(), 1000);
            }, 1000);
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

        // Save FEN before making the move (needed for variation restoration)
        const fenBeforeMove = this.chess.fen();

        // Try to make the move
        const attemptResult = this.chess.move({
            from, to,
            promotion: promotion || 'q'
        });

        if (!attemptResult) return; // Invalid move

        // Check if it matches expected mainline move
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
            // Not the mainline move — check if it matches a player-side variation
            const matchedVar = this._findMatchingPlayerVariation(expectedMove, normalizedAttempt);

            if (matchedVar) {
                // Player chose a variation move — keep the move on the board
                this.board.setPosition(this.chess, true);
                this.board.showLastMove(from, to);

                if (typeof soundManager !== 'undefined') {
                    attemptResult.captured ? soundManager.playCapture() : soundManager.playMove();
                }

                this._handlePlayerVariation(matchedVar, fenBeforeMove);
            } else {
                // Wrong move — not mainline and not in any variation
                this.chess.undo();
                this.board.setPosition(this.chess);
                this.mistakes++;

                if (typeof soundManager !== 'undefined') {
                    soundManager.playIncorrect();
                }

                this._showFeedback('incorrect');

                if (this.onStatusChange) {
                    this.onStatusChange({ status: 'incorrect', mistakes: this.mistakes });
                }
            }
        }
    }

    /**
     * Check if a player's move matches any variation of the expected move
     * Returns { variation, isBad, firstMove } or null
     */
    _findMatchingPlayerVariation(expectedMove, normalizedAttempt) {
        if (!expectedMove.variations || expectedMove.variations.length === 0) return null;

        for (const variation of expectedMove.variations) {
            if (variation.length === 0) continue;
            const firstMove = variation[0];
            if (this._normalizeSan(firstMove.san) === normalizedAttempt) {
                // Check if it's a bad move: NAG 2 (?) or NAG 4 (??)
                const isBad = firstMove.nags.includes(2) || firstMove.nags.includes(4);
                return { variation, isBad, firstMove };
            }
        }
        return null;
    }

    /**
     * Handle a player-initiated variation
     * @param {Object} matchedVar - { variation, isBad, firstMove }
     * @param {string} fenBeforeMove - FEN before the player's move
     */
    _handlePlayerVariation(matchedVar, fenBeforeMove) {
        const { variation, isBad } = matchedVar;
        this.board.interactive = false;

        if (isBad) {
            // BAD variation: mistakes++, auto-play everything, then restore
            this.mistakes++;

            if (typeof soundManager !== 'undefined') {
                soundManager.playIncorrect();
            }

            if (this.onStatusChange) {
                this.onStatusChange({ status: 'player_bad_variation' });
            }

            // Save state for restoration after auto-play
            this._playerVariationRestore = {
                chessFen: fenBeforeMove,
                moves: this.currentMoves,
                moveIndex: this.moveIndex
            };

            // Auto-play remaining moves of the bad variation (start from index 1, player already played 0)
            this._autoPlayBadVariation(variation, 1);
        } else {
            // GOOD variation: interactive play, then restore
            if (this.onStatusChange) {
                this.onStatusChange({ status: 'player_good_variation' });
            }

            // Push current mainline state onto stack
            this.moveStack.push({
                moves: this.currentMoves,
                moveIndex: this.moveIndex,
                chessFen: fenBeforeMove,
                pendingVariations: [],
                variationsDone: false,
                playerVariation: true
            });

            // Enter variation from index 1 (player already played move 0)
            this.currentMoves = variation;
            this.moveIndex = 1;
            this.isInVariation = true;

            // Process next move in variation after a delay
            setTimeout(() => this._processNextMove(), 800);
        }
    }

    /**
     * Auto-play all remaining moves of a bad variation at slow speed (2s/move)
     * Player watches the consequences of their bad move
     */
    _autoPlayBadVariation(variationMoves, index) {
        // Guard: stop if session ended during auto-play
        if (!this.isActive) {
            this._isAutoPlaying = false;
            return;
        }

        if (index >= variationMoves.length) {
            // Variation complete — show "find a better move" message
            this._isAutoPlaying = false;
            if (this.onStatusChange) {
                this.onStatusChange({ status: 'return_to_mainline' });
            }

            // Restore position after delay
            setTimeout(() => this._restoreFromPlayerVariation(), 2000);
            return;
        }

        this._isAutoPlaying = true;
        setTimeout(() => {
            if (!this.isActive) {
                this._isAutoPlaying = false;
                return;
            }
            const moveNode = variationMoves[index];
            this._executeMove(moveNode);
            this._autoPlayBadVariation(variationMoves, index + 1);
        }, 2000);
    }

    /**
     * Restore position after a player-initiated variation (bad or good)
     * Returns to the position before the player's variation move
     */
    _restoreFromPlayerVariation() {
        const saved = this._playerVariationRestore;
        if (!saved || !this.isActive) {
            this._playerVariationRestore = null;
            return;
        }
        this._playerVariationRestore = null;

        this.currentMoves = saved.moves;
        this.moveIndex = saved.moveIndex;
        this.isInVariation = this.moveStack.length > 0;

        this.chess.load(saved.chessFen);
        this.board.clearLastMove();
        this.board.setPosition(this.chess);

        // Wait for player to find the mainline move
        this.board.interactive = true;
        if (this.onStatusChange) {
            this.onStatusChange({
                status: 'your_turn',
                moveIndex: this.moveIndex,
                isVariation: this.isInVariation
            });
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

        // Play puzzle completion sound
        if (typeof soundManager !== 'undefined') {
            correct ? soundManager.playCorrect() : soundManager.playIncorrect();
        }

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
        this.moveStack = [];
        this._variationsDone = false;
        this.isInVariation = false;
        this._playerVariationRestore = null;
        this._isAutoPlaying = false;

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
