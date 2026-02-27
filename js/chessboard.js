/**
 * Interactive Chessboard - SVG-based chess board with piece interaction
 * Supports: drag & drop, click-to-move, arrows, highlights, animations
 */

class ChessBoard {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.size = options.size || 480;
        this.squareSize = this.size / 8;
        this.flipped = options.flipped || false;
        this.interactive = options.interactive !== undefined ? options.interactive : true;
        this.onMove = options.onMove || null;
        this.playerColor = options.playerColor || 'w';

        // Colors - read from CSS variables for theme support
        const cs = getComputedStyle(document.documentElement);
        this.lightColor = options.lightColor || cs.getPropertyValue('--board-light').trim() || '#e8dcc8';
        this.darkColor = options.darkColor || cs.getPropertyValue('--board-dark').trim() || '#7c9a6e';
        this.highlightFromColor = cs.getPropertyValue('--board-highlight').trim() || 'rgba(255, 255, 100, 0.45)';
        this.highlightToColor = cs.getPropertyValue('--board-highlight').trim() || 'rgba(255, 255, 100, 0.45)';
        this.legalMoveColor = 'rgba(0, 0, 0, 0.15)';

        // State
        this.position = null; // chess.js instance
        this.selectedSquare = null;
        this.legalMoves = [];
        this.arrows = [];
        this.squareHighlights = [];
        this.lastMove = null;
        this.dragging = null;

        // Preload piece images for faster rendering
        this._pieceCache = {};
        const pieces = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
        for (const p of pieces) {
            const img = new Image();
            img.src = `img/pieces/${p}.svg`;
            this._pieceCache[p] = img;
        }

        // Create SVG
        this._createBoard();
    }

    _createBoard() {
        this.container.innerHTML = '';
        this.container.style.position = 'relative';
        this.container.style.width = this.size + 'px';
        this.container.style.height = this.size + 'px';
        this.container.style.userSelect = 'none';

        // SVG element
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('width', this.size);
        this.svg.setAttribute('height', this.size);
        this.svg.setAttribute('viewBox', `0 0 ${this.size} ${this.size}`);
        this.svg.style.display = 'block';

        // Layers
        this.boardLayer = this._createGroup('board-layer');
        this.highlightLayer = this._createGroup('highlight-layer');
        this.pieceLayer = this._createGroup('piece-layer');
        this.arrowLayer = this._createGroup('arrow-layer');
        this.legalMoveLayer = this._createGroup('legal-move-layer');
        this.dragLayer = this._createGroup('drag-layer');

        this.svg.appendChild(this.boardLayer);
        this.svg.appendChild(this.highlightLayer);
        this.svg.appendChild(this.pieceLayer);
        this.svg.appendChild(this.arrowLayer);
        this.svg.appendChild(this.legalMoveLayer);
        this.svg.appendChild(this.dragLayer);

        this.container.appendChild(this.svg);

        this._drawSquares();
        this._drawCoordinates();
        this._attachEvents();
    }

    _createGroup(id) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', id);
        return g;
    }

    _drawSquares() {
        this.boardLayer.innerHTML = '';
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const isLight = (row + col) % 2 === 0;
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                const { x, y } = this._squareToCoords(col, row);
                rect.setAttribute('x', x);
                rect.setAttribute('y', y);
                rect.setAttribute('width', this.squareSize);
                rect.setAttribute('height', this.squareSize);
                rect.setAttribute('fill', isLight ? this.lightColor : this.darkColor);
                this.boardLayer.appendChild(rect);
            }
        }
    }

    _drawCoordinates() {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        const fontSize = this.squareSize * 0.2;

        for (let i = 0; i < 8; i++) {
            // File labels (bottom)
            const fileIdx = this.flipped ? 7 - i : i;
            const fileLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            fileLabel.setAttribute('x', i * this.squareSize + this.squareSize - 3);
            fileLabel.setAttribute('y', this.size - 3);
            fileLabel.setAttribute('font-size', fontSize);
            fileLabel.setAttribute('font-family', 'Inter, sans-serif');
            fileLabel.setAttribute('font-weight', '600');
            fileLabel.setAttribute('text-anchor', 'end');
            fileLabel.setAttribute('fill', i % 2 === 0 ? this.darkColor : this.lightColor);
            fileLabel.textContent = files[fileIdx];
            this.boardLayer.appendChild(fileLabel);

            // Rank labels (left)
            const rankIdx = this.flipped ? 7 - i : i;
            const rankLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            rankLabel.setAttribute('x', 3);
            rankLabel.setAttribute('y', i * this.squareSize + fontSize + 2);
            rankLabel.setAttribute('font-size', fontSize);
            rankLabel.setAttribute('font-family', 'Inter, sans-serif');
            rankLabel.setAttribute('font-weight', '600');
            rankLabel.setAttribute('fill', i % 2 === 0 ? this.darkColor : this.lightColor);
            rankLabel.textContent = ranks[rankIdx];
            this.boardLayer.appendChild(rankLabel);
        }
    }

    _squareToCoords(col, row) {
        const displayCol = this.flipped ? 7 - col : col;
        const displayRow = this.flipped ? 7 - row : row;
        return {
            x: displayCol * this.squareSize,
            y: displayRow * this.squareSize
        };
    }

    _coordsToSquare(x, y) {
        let col = Math.floor(x / this.squareSize);
        let row = Math.floor(y / this.squareSize);
        if (this.flipped) {
            col = 7 - col;
            row = 7 - row;
        }
        const files = 'abcdefgh';
        const ranks = '87654321';
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        return files[col] + ranks[row];
    }

    _squareNameToColRow(square) {
        const files = 'abcdefgh';
        const ranks = '87654321';
        return {
            col: files.indexOf(square[0]),
            row: ranks.indexOf(square[1])
        };
    }

    /**
     * Set position from a chess.js instance
     */
    setPosition(chess, animate = false) {
        this.position = chess;
        this._drawPieces(animate);
    }

    /**
     * Draw all pieces on the board
     */
    _drawPieces(animate = false) {
        if (!this.position) {
            this.pieceLayer.innerHTML = '';
            return;
        }

        const board = this.position.board();
        const files = 'abcdefgh';
        const ranks = '87654321';

        // Build map of desired pieces: "a1" -> "wR", "e8" -> "bK"
        const desired = {};
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (piece) {
                    const sq = files[col] + ranks[row];
                    desired[sq] = piece.color + piece.type.toUpperCase();
                }
            }
        }

        // Build map of current DOM pieces
        const existing = {};
        const existingEls = this.pieceLayer.querySelectorAll('image');
        for (const el of existingEls) {
            const sq = el.dataset.square;
            const href = el.getAttribute('href') || '';
            const match = href.match(/\/([wb][KQRBNP])\.svg$/);
            const key = match ? match[1] : '';
            if (sq && key) {
                existing[sq] = { key, el };
            }
        }

        // Remove pieces that are no longer present or changed
        for (const sq of Object.keys(existing)) {
            if (!desired[sq] || desired[sq] !== existing[sq].key) {
                existing[sq].el.remove();
                delete existing[sq];
            }
        }

        // Add new pieces
        for (const sq of Object.keys(desired)) {
            if (!existing[sq]) {
                const col = files.indexOf(sq[0]);
                const row = ranks.indexOf(sq[1]);
                const piece = { color: desired[sq][0], type: desired[sq][1].toLowerCase() };
                this._drawPiece(piece, col, row, animate);
            }
        }
    }

    _drawPiece(piece, col, row, animate = false) {
        const { x, y } = this._squareToCoords(col, row);
        const pieceKey = piece.color + piece.type.toUpperCase();
        const padding = this.squareSize * 0.05;
        const imgSize = this.squareSize - padding * 2;

        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('x', x + padding);
        image.setAttribute('y', y + padding);
        image.setAttribute('width', imgSize);
        image.setAttribute('height', imgSize);
        image.setAttribute('href', `img/pieces/${pieceKey}.svg`);
        image.setAttribute('pointer-events', 'none');
        image.setAttribute('class', 'chess-piece');

        const files = 'abcdefgh';
        const ranks = '87654321';
        image.dataset.square = files[col] + ranks[row];

        if (animate) {
            image.style.opacity = '0';
            image.style.transition = 'opacity 0.15s ease';
            setTimeout(() => { image.style.opacity = '1'; }, 10);
        }

        this.pieceLayer.appendChild(image);
    }

    _getPieceImageSrc(piece) {
        return `img/pieces/${piece.color}${piece.type.toUpperCase()}.svg`;
    }

    /**
     * Highlight a square
     */
    _highlightSquare(square, color) {
        const { col, row } = this._squareNameToColRow(square);
        const { x, y } = this._squareToCoords(col, row);
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', this.squareSize);
        rect.setAttribute('height', this.squareSize);
        rect.setAttribute('fill', color);
        rect.setAttribute('class', 'square-highlight');
        this.highlightLayer.appendChild(rect);
    }

    /**
     * Show last move highlights
     */
    showLastMove(from, to) {
        this.lastMove = { from, to };
        // Clear previous last-move highlights
        this.highlightLayer.querySelectorAll('.last-move-hl').forEach(el => el.remove());

        const addHL = (sq) => {
            const { col, row } = this._squareNameToColRow(sq);
            const { x, y } = this._squareToCoords(col, row);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', this.squareSize);
            rect.setAttribute('height', this.squareSize);
            rect.setAttribute('fill', this.highlightToColor);
            rect.setAttribute('class', 'last-move-hl');
            this.highlightLayer.appendChild(rect);
        };

        addHL(from);
        addHL(to);
    }

    /**
     * Show legal move indicators
     */
    _showLegalMoves(square) {
        this.legalMoveLayer.innerHTML = '';
        if (!this.position) return;

        const moves = this.position.moves({ square, verbose: true });
        this.legalMoves = moves;

        for (const move of moves) {
            const { col, row } = this._squareNameToColRow(move.to);
            const { x, y } = this._squareToCoords(col, row);
            const cx = x + this.squareSize / 2;
            const cy = y + this.squareSize / 2;

            // Check if target square has a piece (capture)
            const isCapture = move.captured;

            if (isCapture) {
                // Ring for captures
                const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                ring.setAttribute('cx', cx);
                ring.setAttribute('cy', cy);
                ring.setAttribute('r', this.squareSize * 0.45);
                ring.setAttribute('fill', 'none');
                ring.setAttribute('stroke', this.legalMoveColor);
                ring.setAttribute('stroke-width', this.squareSize * 0.08);
                this.legalMoveLayer.appendChild(ring);
            } else {
                // Dot for empty squares
                const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                dot.setAttribute('cx', cx);
                dot.setAttribute('cy', cy);
                dot.setAttribute('r', this.squareSize * 0.15);
                dot.setAttribute('fill', this.legalMoveColor);
                this.legalMoveLayer.appendChild(dot);
            }
        }
    }

    /**
     * Draw arrows on the board
     */
    drawArrows(arrows) {
        this.arrowLayer.innerHTML = '';
        this.arrows = arrows || [];

        // Add arrowhead marker definition
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        for (const arrow of this.arrows) {
            const markerId = `arrowhead-${arrow.from}-${arrow.to}`;
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', markerId);
            marker.setAttribute('markerWidth', '4');
            marker.setAttribute('markerHeight', '4');
            marker.setAttribute('refX', '2.5');
            marker.setAttribute('refY', '2');
            marker.setAttribute('orient', 'auto');
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 0, 4 2, 0 4');
            polygon.setAttribute('fill', arrow.color);
            marker.appendChild(polygon);
            defs.appendChild(marker);
        }
        this.arrowLayer.appendChild(defs);

        for (const arrow of this.arrows) {
            const from = this._squareNameToColRow(arrow.from);
            const to = this._squareNameToColRow(arrow.to);
            const fromCoords = this._squareToCoords(from.col, from.row);
            const toCoords = this._squareToCoords(to.col, to.row);

            const x1 = fromCoords.x + this.squareSize / 2;
            const y1 = fromCoords.y + this.squareSize / 2;
            const x2 = toCoords.x + this.squareSize / 2;
            const y2 = toCoords.y + this.squareSize / 2;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('stroke', arrow.color);
            line.setAttribute('stroke-width', this.squareSize * 0.15);
            line.setAttribute('stroke-opacity', '0.7');
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('marker-end', `url(#arrowhead-${arrow.from}-${arrow.to})`);
            this.arrowLayer.appendChild(line);
        }
    }

    /**
     * Draw square highlights
     */
    drawHighlights(highlights) {
        // Remove annotation highlights (not last-move highlights)
        this.highlightLayer.querySelectorAll('.annotation-hl').forEach(el => el.remove());
        this.squareHighlights = highlights || [];

        for (const hl of this.squareHighlights) {
            const { col, row } = this._squareNameToColRow(hl.square);
            const { x, y } = this._squareToCoords(col, row);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', this.squareSize);
            rect.setAttribute('height', this.squareSize);
            rect.setAttribute('fill', hl.color);
            rect.setAttribute('fill-opacity', '0.45');
            rect.setAttribute('class', 'annotation-hl');
            this.highlightLayer.appendChild(rect);
        }
    }

    /**
     * Clear all annotations (arrows + highlights)
     */
    clearAnnotations() {
        this.arrowLayer.innerHTML = '';
        this.highlightLayer.querySelectorAll('.annotation-hl').forEach(el => el.remove());
    }

    /**
     * Clear selection and legal moves
     */
    _clearSelection() {
        this.selectedSquare = null;
        this.legalMoveLayer.innerHTML = '';
        this.highlightLayer.querySelectorAll('.selection-hl').forEach(el => el.remove());
    }

    /**
     * Attach mouse/touch events
     */
    _attachEvents() {
        let dragStartSquare = null;
        let dragPiece = null;
        let offsetX = 0, offsetY = 0;

        const getCoords = (e) => {
            const rect = this.svg.getBoundingClientRect();
            const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
            const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
            return { x, y };
        };

        this.svg.addEventListener('mousedown', (e) => {
            if (!this.interactive || !this.position) return;
            e.preventDefault();

            const { x, y } = getCoords(e);
            const square = this._coordsToSquare(x, y);
            if (!square) return;

            const piece = this.position.get(square);

            // If clicking on own piece
            if (piece && piece.color === this.position.turn() && piece.color === this.playerColor) {
                // Select this piece
                this._clearSelection();
                this.selectedSquare = square;

                // Highlight selected square
                const { col, row } = this._squareNameToColRow(square);
                const coords = this._squareToCoords(col, row);
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', coords.x);
                rect.setAttribute('y', coords.y);
                rect.setAttribute('width', this.squareSize);
                rect.setAttribute('height', this.squareSize);
                rect.setAttribute('fill', 'rgba(255, 255, 100, 0.5)');
                rect.setAttribute('class', 'selection-hl');
                this.highlightLayer.appendChild(rect);

                this._showLegalMoves(square);

                // Start drag
                dragStartSquare = square;
                // Find the piece image element
                const pieceElements = this.pieceLayer.querySelectorAll('image');
                for (const el of pieceElements) {
                    if (el.dataset.square === square) {
                        dragPiece = el.cloneNode(true);
                        dragPiece.style.opacity = '0.85';
                        dragPiece.style.pointerEvents = 'none';
                        el.style.opacity = '0.3';
                        this.dragLayer.appendChild(dragPiece);
                        break;
                    }
                }
            } else if (this.selectedSquare) {
                // Try to move to this square
                this._tryMove(this.selectedSquare, square);
            }
        });

        this.svg.addEventListener('mousemove', (e) => {
            if (!dragPiece) return;
            e.preventDefault();
            const { x, y } = getCoords(e);
            const halfSize = this.squareSize * 0.45;
            dragPiece.setAttribute('x', x - halfSize);
            dragPiece.setAttribute('y', y - halfSize);
        });

        this.svg.addEventListener('mouseup', (e) => {
            if (!dragPiece) return;
            e.preventDefault();
            const { x, y } = getCoords(e);
            const square = this._coordsToSquare(x, y);

            this.dragLayer.innerHTML = '';
            // Restore opacity
            const pieceElements = this.pieceLayer.querySelectorAll('image');
            for (const el of pieceElements) {
                el.style.opacity = '1';
            }

            if (square && dragStartSquare && square !== dragStartSquare) {
                this._tryMove(dragStartSquare, square);
            }

            dragPiece = null;
            dragStartSquare = null;
        });

        // Touch events
        this.svg.addEventListener('touchstart', (e) => {
            if (!this.interactive || !this.position) return;
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.svg.dispatchEvent(mouseEvent);
        }, { passive: false });

        this.svg.addEventListener('touchmove', (e) => {
            if (!dragPiece) return;
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.svg.dispatchEvent(mouseEvent);
        }, { passive: false });

        this.svg.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {
                clientX: e.changedTouches[0].clientX,
                clientY: e.changedTouches[0].clientY
            });
            this.svg.dispatchEvent(mouseEvent);
        }, { passive: false });
    }

    /**
     * Try to make a move
     */
    _tryMove(from, to) {
        if (!this.position || !this.onMove) return;

        // Check for promotion
        const piece = this.position.get(from);
        let promotion = undefined;
        if (piece && piece.type === 'p') {
            const targetRank = to[1];
            if ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1')) {
                promotion = 'q'; // Auto-promote to queen
            }
        }

        this.onMove(from, to, promotion);
        this._clearSelection();
    }

    /**
     * Resize the board
     */
    resize(newSize) {
        this.size = newSize;
        this.squareSize = this.size / 8;
        this._createBoard();
        if (this.position) {
            this._drawPieces();
        }
        if (this.lastMove) {
            this.showLastMove(this.lastMove.from, this.lastMove.to);
        }
        if (this.arrows.length) {
            this.drawArrows(this.arrows);
        }
        if (this.squareHighlights.length) {
            this.drawHighlights(this.squareHighlights);
        }
    }

    /**
     * Flip the board
     */
    flip() {
        this.flipped = !this.flipped;
        this._createBoard();
        if (this.position) {
            this._drawPieces();
        }
        if (this.lastMove) {
            this.showLastMove(this.lastMove.from, this.lastMove.to);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChessBoard;
}
