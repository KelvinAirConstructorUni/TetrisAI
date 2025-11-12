// ----------------------------
// 1. weight helpers
// ----------------------------

function randomWeights() {
    return Array.from({ length: 8 }, () => Math.random() * 2 - 1);
}

function crossover(parentA, parentB) {
    const child = [];
    for (let i = 0; i < parentA.length; i++) {
        child[i] = Math.random() < 0.5 ? parentA[i] : parentB[i];
    }
    return child;
}

function mutate(weights, rate = 0.1) {
    for (let i = 0; i < weights.length; i++) {
        if (Math.random() < rate) {
            weights[i] += (Math.random() * 0.2 - 0.1); // mutate +/- 0.1
        }
    }
    return weights;
}


// ----------------------------
// 2. Quick simulation of Tetris
// ----------------------------

function simulateGame(weights, numPieces = 300) {

    const board = Array.from({ length: nx }, () =>
        Array(ny).fill(null)
    );

    let score = 0;

    for (let i = 0; i < numPieces; i++) {

        const piece = randomPieceFast();
        const move = selectBestMoveFast(piece, board, weights);

        if (!move) break;

        // place piece
        eachblock(piece.type, move.x, move.y, move.dir, (bx, by) => {
            if (by < 0 || by >= ny) return;
            board[bx][by] = 1;
        });

        // clear lines
        score += clearLinesFast(board);
    }

    return score;
}

function randomPieceFast() {
    const list = [i, j, l, o, s, t, z];
    const type = list[Math.floor(Math.random() * list.length)];
    return { type, dir: 0, x: 0, y: 0 };
}

function clearLinesFast(board) {
    let lines = 0;
    for (let y = 0; y < ny; y++) {
        let full = true;
        for (let x = 0; x < nx; x++) {
            if (!board[x][y]) {
                full = false;
                break;
            }
        }
        if (full) {
            lines++;
            // shift rows down
            for (let yy = y; yy > 0; yy--) {
                for (let x = 0; x < nx; x++) {
                    board[x][yy] = board[x][yy - 1];
                }
            }
            for (let x = 0; x < nx; x++) {
                board[x][0] = null;
            }
        }
    }
    return lines;
}


// ----------------------------
// 3. fast move selection
// ----------------------------

function selectBestMoveFast(piece, board, weights) {
    let best = null;
    let bestScore = -Infinity;

    for (let dir = 0; dir < 4; dir++) {
        for (let x = 0; x <= nx - piece.type.size; x++) {

            const y = fastDrop(piece, x, dir, board);
            if (y === null) continue;

            const newBoard = copyBoard(board);

            eachblock(piece.type, x, y, dir, (bx, by) => {
                if (by >= 0 && by < ny) {
                    newBoard[bx][by] = 1;
                }
            });

            const score = fastEvaluateBoard(newBoard, weights);

            if (score > bestScore) {
                bestScore = score;
                best = { x, y, dir };
            }
        }
    }

    return best;
}

function fastDrop(piece, x, dir, board) {
    let y = 0;
    while (!fastOccupied(piece.type, x, y + 1, dir, board)) {
        y++;
        if (y >= ny - 1) break;
    }
    if (fastOccupied(piece.type, x, y, dir, board)) return null;
    return y;
}

function fastOccupied(type, x, y, dir, board) {
    let collision = false;
    eachblock(type, x, y, dir, (bx, by) => {
        if (bx < 0 || bx >= nx || by < 0 || by >= ny) collision = true;
        else if (board[bx][by]) collision = true;
    });
    return collision;
}

function copyBoard(board) {
    return board.map(col => col.slice());
}


// ----------------------------
// 4. Evaluation using weight vector
// ----------------------------

function fastEvaluateBoard(board, w) {

    let colHeights = Array(nx).fill(0);
    let holes = 0;
    let aggregateHeight = 0;
    let bumpiness = 0;

    for (let x = 0; x < nx; x++) {
        let blockFound = false;
        for (let y = 0; y < ny; y++) {
            if (board[x][y]) {
                if (!blockFound) {
                    colHeights[x] = ny - y;
                    aggregateHeight += colHeights[x];
                    blockFound = true;
                }
            } else if (blockFound) {
                holes++;
            }
        }
    }

    for (let x = 0; x < nx - 1; x++) {
        bumpiness += Math.abs(colHeights[x] - colHeights[x + 1]);
    }

    let completeLines = 0;
    for (let y = 0; y < ny; y++) {
        let full = true;
        for (let x = 0; x < nx; x++) {
            if (!board[x][y]) {
                full = false;
                break;
            }
        }
        if (full) completeLines++;
    }

    let wellDepth = 0;
    for (let x = 0; x < nx; x++) {
        let left = x > 0 ? colHeights[x - 1] : Infinity;
        let right = x < nx - 1 ? colHeights[x + 1] : Infinity;
        let h = colHeights[x];
        let neigh = Math.min(left, right);
        if (neigh > h) wellDepth += (neigh - h);
    }

    let landingHeight = aggregateHeight / nx;

    let rowTransitions = 0;
    let columnTransitions = 0;

    for (let y = 0; y < ny; y++) {
        let prev = 1;
        for (let x = 0; x < nx; x++) {
            let cur = board[x][y] ? 1 : 0;
            if (cur !== prev) rowTransitions++;
            prev = cur;
        }
        if (prev === 0) rowTransitions++;
    }

    for (let x = 0; x < nx; x++) {
        let prev = 1;
        for (let y = 0; y < ny; y++) {
            let cur = board[x][y] ? 1 : 0;
            if (cur !== prev) columnTransitions++;
            prev = cur;
        }
        if (prev === 0) columnTransitions++;
    }

    return (
        w[0] * aggregateHeight +
        w[1] * completeLines +
        w[2] * holes +
        w[3] * bumpiness +
        w[4] * landingHeight +
        w[5] * rowTransitions +
        w[6] * columnTransitions +
        w[7] * wellDepth
    );
}


// ----------------------------
// 5. Genetic Algorithm
// ----------------------------

function trainGenerations(generations = 20, popSize = 30) {

    let population = Array.from({ length: popSize }, () => ({
        weights: randomWeights(),
        fitness: 0
    }));

    for (let g = 0; g < generations; g++) {

        for (let i = 0; i < popSize; i++) {
            population[i].fitness = simulateGame(population[i].weights);
        }

        population.sort((a, b) => b.fitness - a.fitness);

        console.log(`GEN ${g}: BEST = ${population[0].fitness}`);
        console.log("WEIGHTS:", population[0].weights);

        let survivors = population.slice(0, popSize / 2);
        let newPop = [];

        while (newPop.length < popSize) {
            let parentA = survivors[Math.floor(Math.random() * survivors.length)].weights;
            let parentB = survivors[Math.floor(Math.random() * survivors.length)].weights;
            let child = crossover(parentA, parentB);
            child = mutate(child, 0.15);
            newPop.push({ weights: child, fitness: 0 });
        }

        population = newPop;
    }

    console.log("Training complete!");
}
