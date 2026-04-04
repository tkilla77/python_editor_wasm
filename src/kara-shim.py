"""
kara-shim.py — Kara beetle world for bottom-editor.

Injected as a code prefix by kara-editor.ts.  After this runs, `kara` is
available as a global and `_kara_setup(world_str, step_ms)` has been called.
"""
import asyncio
import math
import pyodide_js as _pjs

# Cell types
_EMPTY = 0
_TREE  = 1
_LEAF  = 2
_MUSH  = 3

# Directions: 0=right 1=down 2=left 3=up
_DIRS = [(1, 0), (0, 1), (-1, 0), (0, -1)]


class KaraException(Exception):
    pass


class _Grid:
    def __init__(self, s):
        lines = [l.rstrip() for l in s.strip().splitlines() if l.strip()]
        self.height = len(lines)
        self.width   = max(len(l) for l in lines) if lines else 1
        self.cells   = [[_EMPTY] * self.width for _ in range(self.height)]
        self.kara_x  = self.kara_y = self.kara_dir = 0
        _DIR = {'>': 0, 'v': 1, '<': 2, '^': 3}
        for y, row in enumerate(lines):
            for x, ch in enumerate(row):
                if   ch in ('#', 'T'):  self.cells[y][x] = _TREE
                elif ch == 'L':         self.cells[y][x] = _LEAF
                elif ch == 'M':         self.cells[y][x] = _MUSH
                elif ch in _DIR:
                    self.kara_x, self.kara_y = x, y
                    self.kara_dir = _DIR[ch]

    def at(self, x, y):
        if 0 <= x < self.width and 0 <= y < self.height:
            return self.cells[y][x]
        return _TREE  # out-of-bounds counts as tree


class _Kara:
    def __init__(self, g, step_ms):
        self._g  = g
        self._ms = step_ms

    # ------------------------------------------------------------------ moves

    async def move(self):
        g = self._g
        dx, dy = _DIRS[g.kara_dir]
        nx, ny = g.kara_x + dx, g.kara_y + dy
        front  = g.at(nx, ny)
        if front == _TREE:
            await self._step()
            raise KaraException('Tree blocking the path!')
        if front == _MUSH:
            mx2, my2 = nx + dx, ny + dy
            if g.at(mx2, my2) not in (_EMPTY, _LEAF):
                await self._step()
                raise KaraException('Cannot push mushroom — blocked!')
            g.cells[ny][nx]   = _EMPTY
            g.cells[my2][mx2] = _MUSH
        g.kara_x, g.kara_y = nx, ny
        await self._step()

    async def turnLeft(self):
        self._g.kara_dir = (self._g.kara_dir - 1) % 4
        await self._step()

    async def turnRight(self):
        self._g.kara_dir = (self._g.kara_dir + 1) % 4
        await self._step()

    async def putLeaf(self):
        g = self._g
        if g.cells[g.kara_y][g.kara_x] == _LEAF:
            raise KaraException('Already a leaf here!')
        g.cells[g.kara_y][g.kara_x] = _LEAF
        await self._step()

    async def removeLeaf(self):
        g = self._g
        if g.cells[g.kara_y][g.kara_x] != _LEAF:
            raise KaraException('No leaf here!')
        g.cells[g.kara_y][g.kara_x] = _EMPTY
        await self._step()

    # --------------------------------------------------------------- sensors

    def treeFront(self):
        g = self._g
        dx, dy = _DIRS[g.kara_dir]
        return g.at(g.kara_x + dx, g.kara_y + dy) == _TREE

    def treeLeft(self):
        g = self._g
        dx, dy = _DIRS[(g.kara_dir - 1) % 4]
        return g.at(g.kara_x + dx, g.kara_y + dy) == _TREE

    def treeRight(self):
        g = self._g
        dx, dy = _DIRS[(g.kara_dir + 1) % 4]
        return g.at(g.kara_x + dx, g.kara_y + dy) == _TREE

    def mushroomFront(self):
        g = self._g
        dx, dy = _DIRS[g.kara_dir]
        return g.at(g.kara_x + dx, g.kara_y + dy) == _MUSH

    def onLeaf(self):
        g = self._g
        return g.cells[g.kara_y][g.kara_x] == _LEAF

    # ---------------------------------------------------------------- internals

    async def _step(self):
        _kara_draw()
        if self._ms > 0:
            await asyncio.sleep(self._ms / 1000)


# ---------------------------------------------------------------------------
# World state (set by _kara_setup)
# ---------------------------------------------------------------------------

_kara_grid = None
kara       = None


def _kara_setup(world_str, step_ms):
    global _kara_grid, kara
    _kara_grid = _Grid(world_str)
    kara       = _Kara(_kara_grid, step_ms)
    _kara_draw()


# ---------------------------------------------------------------------------
# Canvas rendering
# ---------------------------------------------------------------------------

_CS = 2000  # OffscreenCanvas size (must match CANVAS_SIZE in bottom-editor-canvas.ts)

def _kara_draw():
    ctx = _pjs.canvas.getCanvas2D()
    if not ctx:
        return
    g = _kara_grid

    # Fit grid into canvas, capped so cells stay readable
    cell = min(_CS // g.width, _CS // g.height)
    cell = max(10, min(cell, 300))
    tw, th = g.width * cell, g.height * cell
    ox = (_CS - tw) // 2
    oy = (_CS - th) // 2

    ctx.clearRect(0, 0, _CS, _CS)

    for y in range(g.height):
        for x in range(g.width):
            px = ox + x * cell
            py = oy + y * cell
            v  = g.cells[y][x]

            # Cell background
            ctx.fillStyle = '#2d6a2d' if v == _TREE else '#c8e6c9'
            ctx.fillRect(px, py, cell, cell)

            # Grid line
            ctx.strokeStyle = '#80a080'
            ctx.lineWidth   = 1
            ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1)

            if v == _LEAF:
                _draw_leaf(ctx, px, py, cell)
            elif v == _MUSH:
                _draw_mushroom(ctx, px, py, cell)

    # Kara on top
    _draw_kara(ctx, ox + g.kara_x * cell, oy + g.kara_y * cell, cell, g.kara_dir)


def _draw_leaf(ctx, px, py, s):
    cx, cy = px + s / 2, py + s / 2
    r = s * 0.28
    ctx.fillStyle = '#1b5e20'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * math.pi)
    ctx.fill()
    # highlight
    ctx.fillStyle = '#4caf50'
    ctx.beginPath()
    ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, 2 * math.pi)
    ctx.fill()


def _draw_mushroom(ctx, px, py, s):
    cx, cy = px + s / 2, py + s / 2
    r = s * 0.28
    # stem
    ctx.fillStyle = '#ffe0b2'
    ctx.fillRect(cx - r * 0.4, cy - r * 0.1, r * 0.8, r * 1.1)
    # cap
    ctx.fillStyle = '#bf360c'
    ctx.beginPath()
    ctx.arc(cx, cy - r * 0.1, r, math.pi, 0)
    ctx.fill()
    # cap spots
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(cx - r * 0.3, cy - r * 0.4, r * 0.15, 0, 2 * math.pi)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx + r * 0.25, cy - r * 0.55, r * 0.12, 0, 2 * math.pi)
    ctx.fill()


def _draw_kara(ctx, px, py, s, direction):
    cx, cy = px + s / 2, py + s / 2
    r = s * 0.38
    # body
    ctx.fillStyle = '#b71c1c'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * math.pi)
    ctx.fill()
    # outline
    ctx.strokeStyle = '#7f0000'
    ctx.lineWidth   = max(1, s * 0.03)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * math.pi)
    ctx.stroke()
    # direction eye
    dx, dy = _DIRS[direction]
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(cx + dx * r * 0.5, cy + dy * r * 0.5, r * 0.25, 0, 2 * math.pi)
    ctx.fill()
    ctx.fillStyle = '#212121'
    ctx.beginPath()
    ctx.arc(cx + dx * r * 0.55, cy + dy * r * 0.55, r * 0.12, 0, 2 * math.pi)
    ctx.fill()
