/**
 * PGN Parser - Parses PGN files into structured move trees
 * Handles: multiple games, nested variations, comments, NAGs, ChessBase annotations
 */

class PGNParser {
    /**
     * Parse a full PGN string containing one or more games
     * @param {string} pgnText - Raw PGN text
     * @returns {Array<Object>} Array of parsed games
     */
    static parseMultipleGames(pgnText) {
        // Remove the first line if it's a description (not a PGN header)
        const lines = pgnText.split('\n');
        let startIdx = 0;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('[') || trimmed === '') {
                startIdx = i;
                break;
            }
        }
        pgnText = lines.slice(startIdx).join('\n');

        const games = [];
        const gameTexts = PGNParser._splitGames(pgnText);

        for (const gameText of gameTexts) {
            try {
                const game = PGNParser.parseSingleGame(gameText);
                if (game) games.push(game);
            } catch (e) {
                console.warn('Failed to parse game:', e.message);
            }
        }
        return games;
    }

    /**
     * Split PGN text into individual game strings
     */
    static _splitGames(pgnText) {
        const games = [];
        const lines = pgnText.split('\n');
        let currentGame = [];
        let hasHeaders = false;
        let hasMoves = false;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                // This is a header line
                if (hasMoves && hasHeaders) {
                    // We've seen headers+moves before, so this starts a new game
                    games.push(currentGame.join('\n'));
                    currentGame = [];
                    hasMoves = false;
                }
                hasHeaders = true;
                currentGame.push(trimmed);
            } else if (trimmed === '') {
                currentGame.push(trimmed);
            } else {
                hasMoves = true;
                currentGame.push(trimmed);
            }
        }

        if (currentGame.length > 0 && hasHeaders) {
            games.push(currentGame.join('\n'));
        }

        return games;
    }

    /**
     * Parse a single game's PGN text
     */
    static parseSingleGame(gameText) {
        const headers = PGNParser._parseHeaders(gameText);
        const moveText = PGNParser._extractMoveText(gameText);

        if (!moveText.trim()) return null;

        // Parse the game-level comment (before any moves)
        let gameComment = '';
        let movesStr = moveText;

        // Check for leading comment before first move
        const leadingCommentMatch = movesStr.match(/^\s*\{([^}]*)\}\s*/);
        if (leadingCommentMatch) {
            const parsed = PGNParser._parseComment(leadingCommentMatch[1]);
            gameComment = parsed.text;
            movesStr = movesStr.slice(leadingCommentMatch[0].length);
        }

        const moveTree = PGNParser._parseMoves(movesStr);

        return {
            headers,
            white: headers['White'] || 'White',
            black: headers['Black'] || 'Black',
            result: headers['Result'] || '*',
            eco: headers['ECO'] || '',
            fen: headers['FEN'] || null,
            gameComment,
            moves: moveTree
        };
    }

    /**
     * Parse PGN header tags
     */
    static _parseHeaders(text) {
        const headers = {};
        const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
        let match;
        while ((match = headerRegex.exec(text)) !== null) {
            headers[match[1]] = match[2];
        }
        return headers;
    }

    /**
     * Extract move text (everything after headers)
     */
    static _extractMoveText(text) {
        const lines = text.split('\n');
        let pastHeaders = false;
        let moveLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                pastHeaders = false;
                continue;
            }
            if (trimmed === '' && !pastHeaders) {
                pastHeaders = true;
                continue;
            }
            if (pastHeaders || (!trimmed.startsWith('[') && trimmed !== '')) {
                pastHeaders = true;
                moveLines.push(trimmed);
            }
        }

        return moveLines.join(' ');
    }

    /**
     * Tokenize move text into tokens
     */
    static _tokenize(text) {
        const tokens = [];
        let i = 0;

        while (i < text.length) {
            // Skip whitespace
            if (/\s/.test(text[i])) {
                i++;
                continue;
            }

            // Comment
            if (text[i] === '{') {
                let depth = 1;
                let j = i + 1;
                while (j < text.length && depth > 0) {
                    if (text[j] === '{') depth++;
                    if (text[j] === '}') depth--;
                    j++;
                }
                tokens.push({ type: 'comment', value: text.slice(i + 1, j - 1) });
                i = j;
                continue;
            }

            // Variation start
            if (text[i] === '(') {
                tokens.push({ type: 'variation_start' });
                i++;
                continue;
            }

            // Variation end
            if (text[i] === ')') {
                tokens.push({ type: 'variation_end' });
                i++;
                continue;
            }

            // NAG
            if (text[i] === '$') {
                let j = i + 1;
                while (j < text.length && /\d/.test(text[j])) j++;
                tokens.push({ type: 'nag', value: parseInt(text.slice(i + 1, j)) });
                i = j;
                continue;
            }

            // Result
            if (text.slice(i).match(/^(1-0|0-1|1\/2-1\/2|\*)/)) {
                const match = text.slice(i).match(/^(1-0|0-1|1\/2-1\/2|\*)/);
                tokens.push({ type: 'result', value: match[1] });
                i += match[1].length;
                continue;
            }

            // Move number (e.g., "1.", "1...", "12.")
            const moveNumMatch = text.slice(i).match(/^(\d+)(\.{1,3})\s*/);
            if (moveNumMatch) {
                tokens.push({
                    type: 'move_number',
                    value: parseInt(moveNumMatch[1]),
                    isBlack: moveNumMatch[2].length === 3
                });
                i += moveNumMatch[0].length;
                continue;
            }

            // SAN move (including castling O-O-O, O-O)
            const sanMatch = text.slice(i).match(/^(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?)/);
            if (sanMatch) {
                tokens.push({ type: 'move', value: sanMatch[1] });
                i += sanMatch[1].length;
                continue;
            }

            // Annotation symbols (!, ?, !!, ??, !?, ?!) → convert to NAGs
            // Check multi-char first to avoid partial matches
            const annotMatch = text.slice(i).match(/^(\?\?|\?\!|\!\?|\!\!|\?|\!)/);
            if (annotMatch) {
                const nagMap = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
                tokens.push({ type: 'nag', value: nagMap[annotMatch[1]] });
                i += annotMatch[1].length;
                continue;
            }

            // Skip unknown characters
            i++;
        }

        return tokens;
    }

    /**
     * Parse move text into a tree structure
     * Returns array of move nodes, where each node has:
     * { san, moveNumber, isWhite, comment, nags, arrows, highlights, variations }
     */
    static _parseMoves(text) {
        const tokens = PGNParser._tokenize(text);
        let pos = 0;

        function parseSequence() {
            const moves = [];
            let currentMoveNumber = 1;
            let expectWhite = true;

            while (pos < tokens.length) {
                const token = tokens[pos];

                if (token.type === 'variation_end') {
                    break;
                }

                if (token.type === 'result') {
                    pos++;
                    continue;
                }

                if (token.type === 'move_number') {
                    currentMoveNumber = token.value;
                    expectWhite = !token.isBlack;
                    pos++;
                    continue;
                }

                if (token.type === 'move') {
                    const node = {
                        san: token.value,
                        moveNumber: currentMoveNumber,
                        isWhite: expectWhite,
                        comment: '',
                        nags: [],
                        arrows: [],
                        highlights: [],
                        variations: []
                    };

                    pos++;

                    // Collect NAGs and comments after the move
                    while (pos < tokens.length) {
                        if (tokens[pos].type === 'nag') {
                            node.nags.push(tokens[pos].value);
                            pos++;
                        } else if (tokens[pos].type === 'comment') {
                            const parsed = PGNParser._parseComment(tokens[pos].value);
                            if (node.comment && parsed.text) {
                                node.comment += ' ' + parsed.text;
                            } else if (parsed.text) {
                                node.comment = parsed.text;
                            }
                            node.arrows.push(...parsed.arrows);
                            node.highlights.push(...parsed.highlights);
                            pos++;
                        } else {
                            break;
                        }
                    }

                    // Collect variations
                    while (pos < tokens.length && tokens[pos].type === 'variation_start') {
                        pos++; // skip '('
                        const variation = parseSequence();
                        node.variations.push(variation);
                        if (pos < tokens.length && tokens[pos].type === 'variation_end') {
                            pos++; // skip ')'
                        }
                        // Skip comments between variations
                        while (pos < tokens.length && tokens[pos].type === 'comment') {
                            const parsed = PGNParser._parseComment(tokens[pos].value);
                            if (parsed.text) {
                                node.comment = node.comment ? node.comment + ' ' + parsed.text : parsed.text;
                            }
                            node.arrows.push(...parsed.arrows);
                            node.highlights.push(...parsed.highlights);
                            pos++;
                        }
                    }

                    moves.push(node);

                    if (expectWhite) {
                        expectWhite = false;
                    } else {
                        expectWhite = true;
                        currentMoveNumber++;
                    }
                    continue;
                }

                if (token.type === 'comment') {
                    // Comment not attached to a move - attach to last move or skip
                    if (moves.length > 0) {
                        const parsed = PGNParser._parseComment(token.value);
                        const lastMove = moves[moves.length - 1];
                        if (parsed.text) {
                            lastMove.comment = lastMove.comment
                                ? lastMove.comment + ' ' + parsed.text
                                : parsed.text;
                        }
                        lastMove.arrows.push(...parsed.arrows);
                        lastMove.highlights.push(...parsed.highlights);
                    }
                    pos++;
                    continue;
                }

                pos++;
            }

            return moves;
        }

        return parseSequence();
    }

    /**
     * Parse a comment string, extracting ChessBase annotations
     */
    static _parseComment(raw) {
        let text = raw;
        const arrows = [];
        const highlights = [];

        // Extract [%cal ...] arrows
        text = text.replace(/\[%cal\s+([^\]]+)\]/g, (_, arrowStr) => {
            const arrowList = arrowStr.split(',');
            for (const a of arrowList) {
                const trimmed = a.trim();
                if (trimmed.length >= 5) {
                    const color = trimmed[0];
                    const from = trimmed.slice(1, 3);
                    const to = trimmed.slice(3, 5);
                    arrows.push({ color: PGNParser._mapColor(color), from, to });
                }
            }
            return '';
        });

        // Extract [%csl ...] highlights
        text = text.replace(/\[%csl\s+([^\]]+)\]/g, (_, hlStr) => {
            const hlList = hlStr.split(',');
            for (const h of hlList) {
                const trimmed = h.trim();
                if (trimmed.length >= 3) {
                    const color = trimmed[0];
                    const square = trimmed.slice(1, 3);
                    highlights.push({ color: PGNParser._mapColor(color), square });
                }
            }
            return '';
        });

        // Remove [%evp ...], [%mdl ...] and other engine annotations
        text = text.replace(/\[%\w+\s+[^\]]*\]/g, '');

        text = PGNParser._cleanComment(text);

        return { text, arrows, highlights };
    }

    /**
     * Clean comment text
     */
    static _cleanComment(text) {
        return text.replace(/\s+/g, ' ').trim();
    }

    /**
     * Map ChessBase color codes to CSS colors
     */
    static _mapColor(code) {
        const map = {
            'R': '#e74c3c',  // Red
            'G': '#2ecc71',  // Green
            'B': '#3498db',  // Blue
            'Y': '#f1c40f',  // Yellow
            'C': '#1abc9c',  // Cyan
            'M': '#9b59b6',  // Magenta
        };
        return map[code.toUpperCase()] || '#3498db';
    }

    /**
     * Get NAG symbol for display
     */
    static nagToSymbol(nag) {
        const map = {
            1: '!',    // Good move
            2: '?',    // Poor move
            3: '!!',   // Very good move
            4: '??',   // Very poor move
            5: '!?',   // Speculative move
            6: '?!',   // Questionable move
            7: '□',    // Forced move
            10: '=',   // Equal position
            13: '∞',   // Unclear position
            14: '⩲',   // Slight advantage white
            15: '⩱',   // Slight advantage black
            16: '±',   // Moderate advantage white
            17: '∓',   // Moderate advantage black
            18: '+-',  // Decisive advantage white
            19: '-+',  // Decisive advantage black
            22: '⨀',   // Zugzwang
            32: '⟳',   // Development advantage
            36: '→',   // Initiative
            40: '↑',   // Attack
            132: '⇆',  // Counterplay
            138: '⊕',  // Time pressure
        };
        return map[nag] || '';
    }

    /**
     * Get all mainline moves (flattened path through the first move of each node)
     */
    static getMainline(moves) {
        const line = [];
        for (const move of moves) {
            line.push(move);
        }
        return line;
    }

    /**
     * Get the move at a specific index in the mainline
     */
    static getMoveAtIndex(moves, index) {
        if (index >= 0 && index < moves.length) {
            return moves[index];
        }
        return null;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PGNParser;
}
