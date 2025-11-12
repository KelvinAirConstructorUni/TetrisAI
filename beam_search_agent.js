const GA_WEIGHTS = [
    -0.8370186515007799,
    0.07800828639044773,
    -0.9199195588777043,
    -0.16993362833562325,
    -0.03245026652201599,
    -0.9140805670540637,
    0.03862784738965987,
    -0.6946664883532104
];


// Heuristic evaluation function
// this is a function for each hypothetical board - this is like a rating function - 1 star is bad, 5 star is good, 4 staris  better than average
function evaluateBoard(board, landingY, weights) {

    // --------------------
    // Feature accumulators
    // --------------------
    let aggregateHeight = 0;
    let completeLines = 0;
    let holes = 0;
    let bumpiness = 0;
    let columnHeights = new Array(nx).fill(0);
    let rowTransitions = 0;
    let columnTransitions = 0;
    let wellDepth = 0;

    // -------------------------------------------
    // 1. Column heights + holes
    // -------------------------------------------
    for (let x = 0; x < nx; x++) {
        let seenBlock = false;
        for (let y = 0; y < ny; y++) {
            const filled = board[x][y] ? 1 : 0;

            if (filled) {
                if (!seenBlock) {
                    columnHeights[x] = ny - y;   // height
                    aggregateHeight += columnHeights[x];
                    seenBlock = true;
                }
            } else {
                if (seenBlock) holes++;         // empty below height → hole
            }
        }
    }

    // -------------------------------------------
    // 2. Complete lines
    // -------------------------------------------
    for (let y = 0; y < ny; y++) {
        let full = true;
        for (let x = 0; x < nx; x++) {
            if (!board[x][y]) { full = false; break; }
        }
        if (full) completeLines++;
    }

    // -------------------------------------------
    // 3. Bumpiness
    // -------------------------------------------
    for (let x = 0; x < nx - 1; x++) {
        bumpiness += Math.abs(columnHeights[x] - columnHeights[x + 1]);
    }

    // -------------------------------------------
    // 4. Well depth
    // -------------------------------------------
    for (let x = 0; x < nx; x++) {
        const left = (x === 0) ? Infinity : columnHeights[x - 1];
        const right = (x === nx - 1) ? Infinity : columnHeights[x + 1];
        const current = columnHeights[x];

        const minNeighbour = Math.min(left, right);
        if (minNeighbour > current) {
            wellDepth += (minNeighbour - current);
        }
    }

    // -------------------------------------------
    // 5. Landing height
    // -------------------------------------------
    const landingHeight = landingY || 0;

    // -------------------------------------------
    // 6. Row transitions
    // -------------------------------------------
    for (let y = 0; y < ny; y++) {
        let prev = 1; // treat out-of-bounds left as filled
        for (let x = 0; x < nx; x++) {
            const cur = board[x][y] ? 1 : 0;
            if (cur !== prev) rowTransitions++;
            prev = cur;
        }
        if (prev === 0) rowTransitions++; // right boundary transition
    }

    // -------------------------------------------
    // 7. Column transitions
    // -------------------------------------------
    for (let x = 0; x < nx; x++) {
        let prev = 1;
        for (let y = 0; y < ny; y++) {
            const cur = board[x][y] ? 1 : 0;
            if (cur !== prev) columnTransitions++;
            prev = cur;
        }
        if (prev === 0) columnTransitions++;
    }

    // -------------------------------------------
    // Weighted sum
    // -------------------------------------------
    return (
        weights[0] * aggregateHeight +
        weights[1] * completeLines +
        weights[2] * holes +
        weights[3] * bumpiness +
        weights[4] * landingHeight +
        weights[5] * rowTransitions +
        weights[6] * columnTransitions +
        weights[7] * wellDepth
    );
}

// Function to deep copy the blocks array
function copyBlocks(blocks) {
    let new_blocks = [];
    for (let x = 0; x < nx; x++) {
        new_blocks[x] = [];
        for (let y = 0; y < ny; y++) {
            new_blocks[x][y] = blocks[x][y];
        }
    }
    return new_blocks;
}

// Generate all possible moves for the current piece
function getPossibleMoves(piece) {
    let moves = [];

    for (let dir = 0; dir < 4; dir++) {

        for (let x = 0; x < nx - piece.type.size + 1; x++) {

            // do NOT mutate original piece
            const testPiece = { type: piece.type, dir: dir, x: x, y: 0 };

            const y = getDropPosition(testPiece, x);
            if (y === null) continue;

            let new_blocks = copyBlocks(blocks);

            eachblock(testPiece.type, x, y, testPiece.dir, function (bx, by) {
                new_blocks[bx][by] = testPiece.type;
            });

            moves.push({
                piece: testPiece,
                x: x,
                y: y,
                board: new_blocks
            });
        }
    }

    return moves;
}

// Select the best move based on heuristic evaluation
function selectBestMove(piece, board) {
    let moves = getPossibleMoves(piece);
    let bestMove = null;
    let bestScore = -Infinity;

    for (let move of moves) {

        let score = evaluateBoard(move.board, move.y, GA_WEIGHTS);

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    return bestMove;
}


// Function to get the drop position of the piece
function getDropPosition(piece, x) {
    let y = 0;
    while (!occupied(piece.type, x, y + 1, piece.dir)) { // is y + 1 correct?
        y++;
    }

    return y;
}

function applyMove(board, move) {
    let newBoard = copyBlocks(board);

    eachblock(move.piece.type, move.x, move.y, move.piece.dir, (bx, by) => {
        if (by >= 0 && by < ny) {
            newBoard[bx][by] = 1; // or move.piece.type.color
        }
    });

    return newBoard;
}

function beamSearch(board, currentPiece, beamWidth = 5, depth = 2) {
    // initial beam = current board only
    let beam = [{
        board: copyBlocks(board),
        move: null,
        score: 0
    }];

    // Depth loop
    for (let d = 0; d < depth; d++) {
        let candidates = [];

        // Decide which piece we are evaluating at this depth
        let piece = (d === 0)
            ? currentPiece
            : randomPiece(); // or use next bag logic

        for (let state of beam) {
            let moves = getPossibleMoves(piece);

            for (let move of moves) {
                let newBoard = applyMove(state.board, move);
                let score = evaluateBoard(newBoard, move.y, GA_WEIGHTS);

                candidates.push({
                    board: newBoard,
                    move: (d === 0) ? move : state.move, // first move is the one we return
                    score: score
                });
            }
        }

        // keep top-k
        candidates.sort((a, b) => b.score - a.score);
        beam = candidates.slice(0, beamWidth);
    }

    return beam[0].move;
}
