/** Strip common leading whitespace from all non-empty lines, then trim. */
export function dedentWorld(s: string): string {
    const lines = s.split('\n');
    const nonEmpty = lines.filter(l => l.trim());
    if (!nonEmpty.length) return '';
    const indent = Math.min(...nonEmpty.map(l => l.match(/^ */)![0].length));
    return lines.map(l => l.slice(indent)).join('\n').trim();
}

// Must match kara-shim.py constants.
const _EMPTY = 0, _TREE = 1, _LEAF = 2, _MUSH = 3;
const _CS = 2000;  // OffscreenCanvas size — same as bottom-editor-canvas.ts
const _DIR_ANGLE = [Math.PI / 2, Math.PI, 3 * Math.PI / 2, 0]; // right, down, left, up

interface KaraGrid {
    width: number; height: number;
    cells: number[][];
    karaX: number; karaY: number; karaDir: number;
    hasKara: boolean;
}

export function parseKaraWorld(s: string): KaraGrid {
    const raw = s.split('\n').map(l => l.trimEnd());
    while (raw.length && !raw[0].trim())           raw.shift();
    while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
    const height = raw.length;
    const width  = raw.reduce((m, l) => Math.max(m, l.length), 1);
    const cells  = Array.from({ length: height }, () => new Array(width).fill(_EMPTY));
    let karaX = 0, karaY = 0, karaDir = 0, hasKara = false;
    const DIR:      Record<string, number> = { '>': 0, 'v': 1, 'b': 2, '^': 3, '<': 2 };
    const DIR_LEAF: Record<string, number> = { 'e': 0, 's': 1, 'w': 2, 'n': 3 };
    for (let y = 0; y < raw.length; y++) {
        for (let x = 0; x < raw[y].length; x++) {
            const ch = raw[y][x];
            if (ch === '#' || ch === 'T')    cells[y][x] = _TREE;
            else if (ch === 'L')             cells[y][x] = _LEAF;
            else if (ch === 'M')             cells[y][x] = _MUSH;
            else if (ch in DIR)            { karaX = x; karaY = y; karaDir = DIR[ch]; hasKara = true; }
            else if (ch in DIR_LEAF)       { karaX = x; karaY = y; karaDir = DIR_LEAF[ch]; cells[y][x] = _LEAF; hasKara = true; }
        }
    }
    return { width, height, cells, karaX, karaY, karaDir, hasKara };
}

/** Render a Kara world string to a canvas (main-thread equivalent of kara-shim.py _kara_draw). */
export function renderKaraWorld(canvas: HTMLCanvasElement, worldStr: string): void {
    const grid = parseKaraWorld(worldStr);
    const ctx  = canvas.getContext('2d');
    if (!ctx) return;
    const cell = Math.max(16, Math.min(300, Math.floor(_CS / Math.max(grid.width, grid.height, 1))));
    const tw = grid.width * cell, th = grid.height * cell;
    const ox = (_CS - tw) >> 1,   oy = (_CS - th) >> 1;
    ctx.font          = `${Math.floor(cell * 0.72)}px serif`;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.clearRect(0, 0, _CS, _CS);
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const px = ox + x * cell, py = oy + y * cell;
            const cx = px + cell / 2, cy = py + cell / 2;
            const v  = grid.cells[y][x];
            ctx.fillStyle = v === _TREE ? '#3a5c2e' : '#c8e6c9';
            ctx.fillRect(px, py, cell, cell);
            ctx.strokeStyle = '#8fbc8f';
            ctx.lineWidth   = Math.max(1, cell * 0.025);
            ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
            if      (v === _TREE) ctx.fillText('🌳', cx, cy);
            else if (v === _LEAF) ctx.fillText('🍀', cx, cy);
            else if (v === _MUSH) ctx.fillText('🍄', cx, cy);
        }
    }
    if (grid.hasKara) {
        const kx = ox + grid.karaX * cell + cell / 2;
        const ky = oy + grid.karaY * cell + cell / 2;
        ctx.save();
        ctx.translate(kx, ky);
        ctx.rotate(_DIR_ANGLE[grid.karaDir]);
        ctx.fillText('🐞', 0, 0);
        ctx.restore();
    }
}
