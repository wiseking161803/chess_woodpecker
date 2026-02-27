/**
 * Trainer - Controls the learning and review experience
 * Handles move validation, mode switching, and user interaction flow
 */

class Trainer {
    constructor(board, sr) {
        this.board = board;
        this.sr = sr;
        this.chess = new Chess();

        // Current state
        this.currentGame = null;
        this.currentMoves = [];
        this.currentMoveIndex = -1;
        this.mode = 'idle'; // idle, learn, review
        this.cardId = null;
        this.mistakes = 0;
        this.completed = false;
        this.isPlayerTurn = false;
        this.playerColor = 'w'; // Player always plays White in this context

        // Callbacks
        this.onMoveCompleted = null;
        this.onLineCompleted = null;
        this.onMistake = null;
        this.onComment = null;
        this.onStatusChange = null;

        // Setup board callback
        this.board.onMove = (from, to, promotion) => this._handlePlayerMove(from, to, promotion);
    }

    /**
     * Start learning a chapter (first time - shows comments)
     */
    startLearn(game, cardId) {
        this.currentGame = game;
        this.currentMoves = game.moves;
        this.cardId = cardId;
        this.mode = 'learn';
        this.mistakes = 0;
        this.completed = false;
        this.currentMoveIndex = -1;

        // Determine player color based on the game content
        // Default: player plays White
        this.playerColor = 'w';
        this.board.playerColor = this.playerColor;
        this.board.flipped = this.playerColor === 'b';

        // Reset chess position
        this.chess = new Chess();
        this.board.setPosition(this.chess);
        this.board.clearAnnotations();
        this.board.interactive = true;

        // Show game-level comment if any
        if (game.gameComment) {
            this._emitComment(game.gameComment, 'intro');
        }

        if (this.onStatusChange) {
            this.onStatusChange({
                mode: 'learn',
                moveIndex: -1,
                totalMoves: this.currentMoves.length,
                isPlayerTurn: this._isPlayerTurnAtIndex(0)
            });
        }

        // If first move is opponent's, auto-play it
        this._processNextMove();
    }

    /**
     * Start reviewing a chapter (subsequent times - no comments)
     */
    startReview(game, cardId) {
        this.currentGame = game;
        this.currentMoves = game.moves;
        this.cardId = cardId;
        this.mode = 'review';
        this.mistakes = 0;
        this.completed = false;
        this.currentMoveIndex = -1;

        this.playerColor = 'w';
        this.board.playerColor = this.playerColor;
        this.board.flipped = this.playerColor === 'b';

        this.chess = new Chess();
        this.board.setPosition(this.chess);
        this.board.clearAnnotations();
        this.board.interactive = true;

        if (this.onStatusChange) {
            this.onStatusChange({
                mode: 'review',
                moveIndex: -1,
                totalMoves: this.currentMoves.length,
                isPlayerTurn: this._isPlayerTurnAtIndex(0)
            });
        }

        this._processNextMove();
    }

    /**
     * Process the next move in the sequence
     */
    _processNextMove() {
        const nextIndex = this.currentMoveIndex + 1;

        if (nextIndex >= this.currentMoves.length) {
            this._completeTraining();
            return;
        }

        const nextMove = this.currentMoves[nextIndex];
        const isPlayerTurn = this._isPlayerTurnAtMove(nextMove);

        if (isPlayerTurn) {
            // Wait for player input
            this.isPlayerTurn = true;
            this.board.interactive = true;

            if (this.onStatusChange) {
                this.onStatusChange({
                    mode: this.mode,
                    moveIndex: nextIndex,
                    totalMoves: this.currentMoves.length,
                    isPlayerTurn: true,
                    waitingForMove: nextMove.san
                });
            }
        } else {
            // Auto-play opponent's move
            this.isPlayerTurn = false;
            this.board.interactive = false;

            setTimeout(() => {
                this._executeMove(nextMove, nextIndex);
            }, 400);
        }
    }

    /**
     * Execute a move on the board
     */
    _executeMove(moveNode, index) {
        try {
            const result = this.chess.move(moveNode.san);
            if (!result) {
                console.warn('Invalid move in PGN:', moveNode.san, 'at FEN:', this.chess.fen());
                // Try to continue
                this.currentMoveIndex = index;
                this._processNextMove();
                return;
            }

            this.currentMoveIndex = index;
            this.board.setPosition(this.chess);
            this.board.showLastMove(result.from, result.to);

            // Show annotations in learn mode
            if (this.mode === 'learn') {
                this._showAnnotations(moveNode);
            } else {
                this.board.clearAnnotations();
            }

            if (this.onMoveCompleted) {
                this.onMoveCompleted({
                    moveNode,
                    index,
                    result,
                    totalMoves: this.currentMoves.length
                });
            }

            // Continue to next move
            this._processNextMove();

        } catch (e) {
            console.error('Move execution error:', e, moveNode);
            this.currentMoveIndex = index;
            this._processNextMove();
        }
    }

    /**
     * Handle player's move attempt
     */
    _handlePlayerMove(from, to, promotion) {
        if (!this.isPlayerTurn || this.completed) return;

        const nextIndex = this.currentMoveIndex + 1;
        if (nextIndex >= this.currentMoves.length) return;

        const expectedMove = this.currentMoves[nextIndex];

        // Try to make the move
        const moveAttempt = this.chess.move({ from, to, promotion });
        if (!moveAttempt) {
            // Illegal move
            return;
        }

        // Check if it matches the expected move
        if (moveAttempt.san === expectedMove.san ||
            this._normalizeSan(moveAttempt.san) === this._normalizeSan(expectedMove.san)) {
            // Correct move!
            this.currentMoveIndex = nextIndex;
            this.board.setPosition(this.chess);
            this.board.showLastMove(moveAttempt.from, moveAttempt.to);
            this.isPlayerTurn = false;

            // Show annotations in learn mode
            if (this.mode === 'learn') {
                this._showAnnotations(expectedMove);
            } else {
                this.board.clearAnnotations();
            }

            if (this.onMoveCompleted) {
                this.onMoveCompleted({
                    moveNode: expectedMove,
                    index: nextIndex,
                    result: moveAttempt,
                    totalMoves: this.currentMoves.length,
                    correct: true
                });
            }

            // Continue to next move
            setTimeout(() => this._processNextMove(), 300);
        } else {
            // Wrong move - undo it
            this.chess.undo();
            this.board.setPosition(this.chess);
            this.mistakes++;

            if (this.onMistake) {
                this.onMistake({
                    attempted: moveAttempt.san,
                    expected: expectedMove.san,
                    mistakes: this.mistakes,
                    hint: this.mistakes >= 2 ? expectedMove.san : null
                });
            }

            // Re-show last move highlight if there was one
            if (this.currentMoveIndex >= 0) {
                const prevMove = this.currentMoves[this.currentMoveIndex];
                // Re-execute to get from/to info
                // Actually just refresh position
                this.board.setPosition(this.chess);
            }
        }
    }

    /**
     * Normalize SAN for comparison (remove +, #, !, ?)
     */
    _normalizeSan(san) {
        return san.replace(/[+#!?]/g, '');
    }

    /**
     * Show annotations for a move node
     */
    _showAnnotations(moveNode) {
        // Draw arrows
        if (moveNode.arrows && moveNode.arrows.length > 0) {
            this.board.drawArrows(moveNode.arrows);
        } else {
            this.board.drawArrows([]);
        }

        // Draw highlights
        if (moveNode.highlights && moveNode.highlights.length > 0) {
            this.board.drawHighlights(moveNode.highlights);
        } else {
            this.board.drawHighlights([]);
        }

        // Show comment
        if (moveNode.comment) {
            this._emitComment(moveNode.comment, 'move');
        }

        // Show NAG
        if (moveNode.nags && moveNode.nags.length > 0) {
            const nagSymbols = moveNode.nags.map(n => PGNParser.nagToSymbol(n)).filter(s => s);
            if (nagSymbols.length > 0) {
                // NAGs are shown inline with the move
            }
        }
    }

    /**
     * Emit comment event
     */
    _emitComment(text, type) {
        if (this.onComment) {
            this.onComment({ text, type });
        }
    }

    /**
     * Complete the training session
     */
    _completeTraining() {
        this.completed = true;
        this.board.interactive = false;

        if (this.mode === 'learn') {
            // Mark as learned in spaced repetition
            this.sr.markLearned(this.cardId);

            if (this.onLineCompleted) {
                this.onLineCompleted({
                    mode: 'learn',
                    cardId: this.cardId,
                    mistakes: this.mistakes
                });
            }
        } else {
            // Process review result
            const quality = SpacedRepetition.calculateQuality(this.mistakes);
            this.sr.processReview(this.cardId, quality);

            if (this.onLineCompleted) {
                this.onLineCompleted({
                    mode: 'review',
                    cardId: this.cardId,
                    mistakes: this.mistakes,
                    quality
                });
            }
        }

        if (this.onStatusChange) {
            this.onStatusChange({
                mode: this.mode,
                completed: true,
                mistakes: this.mistakes
            });
        }
    }

    /**
     * Check if a move is the player's turn
     */
    _isPlayerTurnAtMove(moveNode) {
        return (this.playerColor === 'w' && moveNode.isWhite) ||
            (this.playerColor === 'b' && !moveNode.isWhite);
    }

    _isPlayerTurnAtIndex(index) {
        if (index < 0 || index >= this.currentMoves.length) return false;
        return this._isPlayerTurnAtMove(this.currentMoves[index]);
    }

    /**
     * Get current move info for the move list display
     */
    getMoveListData() {
        const moves = [];
        for (let i = 0; i < this.currentMoves.length; i++) {
            const m = this.currentMoves[i];
            const nagStr = (m.nags || []).map(n => PGNParser.nagToSymbol(n)).join('');
            moves.push({
                index: i,
                san: m.san + nagStr,
                moveNumber: m.moveNumber,
                isWhite: m.isWhite,
                comment: m.comment,
                hasVariations: m.variations && m.variations.length > 0,
                variations: m.variations,
                isCurrent: i === this.currentMoveIndex,
                isPlayed: i <= this.currentMoveIndex
            });
        }
        return moves;
    }

    /**
     * Navigate to a specific move (for learn mode exploration)
     */
    goToMove(index) {
        if (this.mode !== 'learn') return;
        if (index < -1 || index >= this.currentMoves.length) return;

        // Reset chess and replay moves up to index
        this.chess = new Chess();
        this.board.clearAnnotations();

        for (let i = 0; i <= index; i++) {
            const result = this.chess.move(this.currentMoves[i].san);
            if (!result) break;

            if (i === index) {
                this.board.showLastMove(result.from, result.to);
                if (this.mode === 'learn') {
                    this._showAnnotations(this.currentMoves[i]);
                }
            }
        }

        this.currentMoveIndex = index;
        this.board.setPosition(this.chess);
    }

    /**
     * Reset to start position
     */
    reset() {
        this.chess = new Chess();
        this.currentMoveIndex = -1;
        this.mistakes = 0;
        this.completed = false;
        this.board.setPosition(this.chess);
        this.board.clearAnnotations();
        this.board.interactive = false;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Trainer;
}
