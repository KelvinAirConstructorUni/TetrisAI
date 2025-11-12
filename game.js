//-------------------------------------------------------------------------
// base helper methods
//-------------------------------------------------------------------------

function get(id) { return document.getElementById(id); }
function hide(id) { get(id).style.visibility = 'hidden'; }
function show(id) { get(id).style.visibility = null; }
function html(id, html) { get(id).innerHTML = html; }

function timestamp() { return new Date().getTime(); }
function random(min, max) { return (min + (Math.random() * (max - min))); }
function randomInt(min, maxInclusive) { return Math.floor(min + Math.random() * (maxInclusive - min + 1)); }

if (!window.requestAnimationFrame) { // polyfill
    window.requestAnimationFrame = window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.oRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) { window.setTimeout(callback, 1000 / 60); };
}

// Initialize the Tetris court
function initializeBoard(nx, ny) {
    const board = [];
    for (let x = 0; x < nx; x++) {
        board[x] = [];
        for (let y = 0; y < ny; y++) board[x][y] = null; // null = empty
    }
    return board;
}

//-------------------------------------------------------------------------
// game constants
//-------------------------------------------------------------------------

var KEY = { ESC: 27, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 },
    DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3, MIN: 0, MAX: 3, AI: -1 },
    stats = new Stats(),
    canvas = get('canvas'),
    ctx = canvas.getContext('2d'),
    ucanvas = get('upcoming'),
    uctx = ucanvas.getContext('2d'),
    speed = { start: 0.6, decrement: 0.005, min: 0.1 }, // seconds per step
    nx = 10, // width
    ny = 20, // height
    nu = 5;  // preview box (blocks)

//-------------------------------------------------------------------------
// game variables (initialized during reset)
//-------------------------------------------------------------------------

var dx, dy,          // pixel size of a block
    blocks,          // nx*ny court (null | string color)
    actions,         // input queue
    playing,         // game in progress?
    dt,              // elapsed for gravity
    current,         // current falling piece
    next,            // next piece
    score,           // score
    vscore,          // displayed score (incremental)
    rows,            // completed rows
    step;            // gravity interval

//-------------------------------------------------------------------------
// tetris pieces (bitboards)
//-------------------------------------------------------------------------

const i = { size: 4, blocks: [0x0F00, 0x2222, 0x00F0, 0x4444], color: 'cyan' };
const j = { size: 3, blocks: [0x44C0, 0x8E00, 0x6440, 0x0E20], color: 'blue' };
const l = { size: 3, blocks: [0x4460, 0x0E80, 0xC440, 0x2E00], color: 'orange' };
const o = { size: 2, blocks: [0xCC00, 0xCC00, 0xCC00, 0xCC00], color: 'yellow' };
const s = { size: 3, blocks: [0x06C0, 0x8C40, 0x6C00, 0x4620], color: 'green' };
const t = { size: 3, blocks: [0x0E40, 0x4C40, 0x4E00, 0x4640], color: 'purple' };
const z = { size: 3, blocks: [0x0C60, 0x4C80, 0xC600, 0x2640], color: 'red' };

function eachblock(type, x, y, dir, fn) {
    let bit, row = 0, col = 0, mask = type.blocks[dir];
    for (bit = 0x8000; bit > 0; bit = bit >> 1) {
        if (mask & bit) fn(x + col, y + row);
        if (++col === 4) { col = 0; ++row; }
    }
}

function occupied(type, x, y, dir) {
    let result = false;
    eachblock(type, x, y, dir, function (bx, by) {
        if (bx < 0 || bx >= nx || by < 0 || by >= ny || getBlock(bx, by)) result = true;
    });
    return result;
}
function unoccupied(type, x, y, dir) { return !occupied(type, x, y, dir); }

// 7-bag generator
var pieces = [];
function refillBag() { pieces = [i, i, i, i, j, j, j, j, l, l, l, l, o, o, o, o, s, s, s, s, t, t, t, t, z, z, z, z]; }
function randomPiece() {
    if (pieces.length === 0) refillBag();
    const idx = randomInt(0, pieces.length - 1);
    const type = pieces.splice(idx, 1)[0];
    return { type, dir: DIR.UP, x: Math.round(random(0, nx - type.size)), y: 0 };
}

//-------------------------------------------------------------------------
// GAME LOOP
//-------------------------------------------------------------------------

function run() {
    showStats();
    addEvents();

    let now, last = now = timestamp();
    function frame() {
        now = timestamp();
        update(Math.min(1, (now - last) / 1000.0));
        draw();
        stats.update();
        last = now;
        requestAnimationFrame(frame);
    }

    resize();
    reset();
    frame();
}

function showStats() {
    stats.domElement.id = 'stats';
    get('menu').appendChild(stats.domElement);
}

function addEvents() {
    document.addEventListener('keydown', keydown, false);
    window.addEventListener('resize', resize, false);
}

function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    ucanvas.width = ucanvas.clientWidth;
    ucanvas.height = ucanvas.clientHeight;
    dx = canvas.width / nx;
    dy = canvas.height / ny;
    invalidate();
    invalidateNext();
}

function keydown(ev) {
    let handled = false;
    if (playing) {
        switch (ev.keyCode) {
            case KEY.LEFT: actions.push(DIR.LEFT); handled = true; break;
            case KEY.RIGHT: actions.push(DIR.RIGHT); handled = true; break;
            case KEY.UP: actions.push(DIR.UP); handled = true; break;
            case KEY.DOWN: actions.push(DIR.DOWN); handled = true; break;
            case KEY.ESC: lose(); handled = true; break;
            case KEY.SPACE: actions.push(DIR.AI); handled = true; break;
        }
    } else if (ev.keyCode == KEY.SPACE) {
        play(); handled = true;
    }
    if (handled) ev.preventDefault();
}

//-------------------------------------------------------------------------
// GAME LOGIC
//-------------------------------------------------------------------------

function play() { hide('start'); reset(); playing = true; }
function lose() { show('start'); setVisualScore(); playing = false; }

function setVisualScore(n) { vscore = n || score; invalidateScore(); }
function setScore(n) { score = n; setVisualScore(n); }
function addScore(n) { score = score + n; }
function clearScore() { setScore(0); }
function clearRows() { setRows(0); }
function setRows(n) { rows = n; step = Math.max(speed.min, speed.start - (speed.decrement * rows)); invalidateRows(); }
function addRows(n) { setRows(rows + n); }
function getBlock(x, y) { return (blocks && blocks[x] ? blocks[x][y] : null); }
function setBlock(x, y, val) { blocks[x] = blocks[x] || []; blocks[x][y] = val; invalidate(); }
function clearBlocks() { blocks = initializeBoard(nx, ny); invalidate(); }
function clearActions() { actions = []; }
function setCurrentPiece(p) { current = p || randomPiece(); invalidate(); }
function setNextPiece(p) { next = p || randomPiece(); invalidateNext(); }

function reset() {
    dt = 0;
    clearActions();
    clearBlocks();
    clearRows();
    clearScore();
    setCurrentPiece(next);
    setNextPiece();
}

function update(idt) {
    if (!playing) return;
    if (vscore < score) setVisualScore(vscore + 1);
    handle(actions.shift());
    dt = dt + idt;
    if (dt > step) {
        dt = dt - step;
        drop();
    }
}

function handle(action) {
    switch (action) {
        case DIR.LEFT: move(DIR.LEFT); break;
        case DIR.RIGHT: move(DIR.RIGHT); break;
        case DIR.UP: rotate(); break;
        case DIR.DOWN: drop(); break;
        case DIR.AI: agent(); break;
    }
}

function move(dir) {
    let x = current.x, y = current.y;
    if (dir === DIR.RIGHT) x = x + 1;
    else if (dir === DIR.LEFT) x = x - 1;
    else if (dir === DIR.DOWN) y = y + 1;

    if (unoccupied(current.type, x, y, current.dir)) {
        current.x = x; current.y = y; invalidate(); return true;
    }
    return false;
}

function rotate() {
    const newdir = (current.dir == DIR.MAX ? DIR.MIN : current.dir + 1);
    if (unoccupied(current.type, current.x, current.y, newdir)) {
        current.dir = newdir; invalidate();
    }
}

function drop() {
    if (!move(DIR.DOWN)) {
        // lock current piece
        dropPiece();
        const cleared = removeLines();
        if (cleared > 0) {
            addRows(cleared);
            addScore(100 * Math.pow(2, cleared - 1)); // Tetris-like scoring
        } else {
            addScore(10);
        }
        // spawn next
        setCurrentPiece(next);
        setNextPiece(randomPiece());
        clearActions();
        // lose if new piece collides immediately
        if (occupied(current.type, current.x, current.y, current.dir)) lose();
    }
}

function dropPiece() {
    eachblock(current.type, current.x, current.y, current.dir, function (x, y) {
        if (y >= 0 && y < ny) setBlock(x, y, current.type.color); // store COLOR STRING
    });
}

// returns number of cleared lines
function removeLines() {
    let cleared = 0;
    for (let y = ny - 1; y >= 0; --y) {
        let full = true;
        for (let x = 0; x < nx; ++x) {
            if (!getBlock(x, y)) { full = false; break; }
        }
        if (full) {
            removeLine(y);
            y = y + 1;   // re-check same row after collapsing
            cleared++;
        }
    }
    return cleared;
}

function removeLine(n) {
    for (let y = n; y >= 0; --y) {
        for (let x = 0; x < nx; ++x)
            setBlock(x, y, (y === 0) ? null : getBlock(x, y - 1));
    }
}

//-------------------------------------------------------------------------
// RENDERING
//-------------------------------------------------------------------------

var invalid = {};
function invalidate() { invalid.court = true; }
function invalidateNext() { invalid.next = true; }
function invalidateScore() { invalid.score = true; }
function invalidateRows() { invalid.rows = true; }

function draw() {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.translate(0.5, 0.5); // crisp 1px lines
    drawCourt();
    drawNext();
    drawScore();
    drawRows();
    ctx.restore();
}

function drawCourt() {
    if (!invalid.court) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (playing) drawPiece(ctx, current.type, current.x, current.y, current.dir);
    for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
            const cell = getBlock(x, y); // string color | null
            if (cell) drawBlock(ctx, x, y, typeof cell === 'string' ? cell : (cell.color || 'grey'));
        }
    }
    ctx.strokeRect(0, 0, nx * dx - 1, ny * dy - 1);
    invalid.court = false;
}

function drawNext() {
    if (!invalid.next) return;
    const padding = (nu - next.type.size) / 2;
    uctx.save();
    uctx.translate(0.5, 0.5);
    uctx.clearRect(0, 0, nu * dx, nu * dy);
    drawPiece(uctx, next.type, padding, padding, next.dir);
    uctx.strokeStyle = 'black';
    uctx.strokeRect(0, 0, nu * dx - 1, nu * dy - 1);
    uctx.restore();
    invalid.next = false;
}

function drawScore() {
    if (!invalid.score) return;
    html('score', ("00000" + Math.floor(vscore)).slice(-5));
    invalid.score = false;
}

function drawRows() {
    if (!invalid.rows) return;
    html('rows', rows);
    invalid.rows = false;
}

function drawPiece(ctx, type, x, y, dir) {
    eachblock(type, x, y, dir, function (bx, by) {
        drawBlock(ctx, bx, by, type.color);
    });
}

function drawBlock(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * dx, y * dy, dx, dy);
    ctx.strokeRect(x * dx, y * dy, dx, dy);
}

//-------------------------------------------------------------------------
// AI glue (keeps your original style, but safe)
//-------------------------------------------------------------------------

function copyBlocks(src) {
    const dst = [];
    for (let x = 0; x < nx; x++) {
        dst[x] = [];
        for (let y = 0; y < ny; y++) dst[x][y] = src && src[x] ? src[x][y] : null;
    }
    return dst;
}

function getDropPosition(piece, atX) {
    let y = 0;
    while (!occupied(piece.type, atX, y + 1, piece.dir)) {
        y++;
        if (y >= ny - 1) break;
    }
    if (occupied(piece.type, atX, y, piece.dir)) return null;
    return y;
}

function getPossibleMoves(piece) {
    const moves = [];
    for (let dir = 0; dir < 4; dir++) {
        const width = piece.type.size;
        for (let x = 0; x <= nx - width; x++) {
            const tp = { type: piece.type, dir, x, y: 0 };
            const y = getDropPosition(tp, x);
            if (y === null) continue;

            const newBoard = copyBlocks(blocks);
            eachblock(tp.type, x, y, dir, (bx, by) => {
                if (by >= 0 && by < ny) newBoard[bx][by] = tp.type.color; // color string
            });

            moves.push({ piece: tp, x, y, board: newBoard });
        }
    }
    return moves;
}

// Simple heuristic (compatible with heuristic_agent.js if you swap it out)
function evaluateBoard(board) {
    let colHeights = Array(nx).fill(0);
    let holes = 0, aggHeight = 0, bump = 0, fullLines = 0;

    // heights + holes
    for (let x = 0; x < nx; x++) {
        let found = false;
        for (let y = 0; y < ny; y++) {
            if (board[x][y]) {
                if (!found) {
                    colHeights[x] = ny - y;
                    aggHeight += colHeights[x];
                    found = true;
                }
            } else if (found) holes++;
        }
    }

    // bumpiness
    for (let x = 0; x < nx - 1; x++) bump += Math.abs(colHeights[x] - colHeights[x + 1]);

    // complete lines
    for (let y = 0; y < ny; y++) {
        let full = true;
        for (let x = 0; x < nx; x++) { if (!board[x][y]) { full = false; break; } }
        if (full) fullLines++;
    }

    const w = { aggHeight: -0.51, lines: 0.76, holes: -0.36, bump: -0.18 };
    return w.aggHeight * aggHeight + w.lines * fullLines + w.holes * holes + w.bump * bump;
}

function selectBestMove(piece) {
    const moves = getPossibleMoves(piece);
    let best = null, bestScore = -Infinity;
    for (const mv of moves) {
        const s = evaluateBoard(mv.board);
        if (s > bestScore) { bestScore = s; best = mv; }
    }
    return best;
}

// Place a chosen move without double-dropping
function placeMove(move) {
    if (!move) return;
    current.x = move.x;
    current.y = move.y;
    current.dir = move.piece.dir;

    // lock and advance (same logic as drop() after collision)
    dropPiece();
    const cleared = removeLines();
    if (cleared > 0) {
        addRows(cleared);
        addScore(100 * Math.pow(2, cleared - 1));
    } else {
        addScore(10);
    }
    setCurrentPiece(next);
    setNextPiece(randomPiece());
    clearActions();
    if (occupied(current.type, current.x, current.y, current.dir)) lose();
}

function agent() {
    const bestMove = selectBestMove(current, blocks);
    placeMove(bestMove); // no extra drop(), avoids the double-move bug
}

// If you need to auto-start
window.addEventListener('load', run);
