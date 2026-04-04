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

# Beetle emoji faces up (north) by default.
# Rotation (radians) to point in each direction: right, down, left, up.
_DIR_ANGLE = [math.pi / 2, math.pi, 3 * math.pi / 2, 0]

def _kara_draw():
    canvas = _pjs.canvas.getCanvas2D()
    if not canvas:
        return
    ctx = canvas.getContext('2d')
    g = _kara_grid

    # Scale cells to fill the canvas, capped for readability.
    cell = min(_CS // max(g.width, 1), _CS // max(g.height, 1))
    cell = max(16, min(cell, 300))
    tw = g.width  * cell
    th = g.height * cell
    ox = (_CS - tw) // 2
    oy = (_CS - th) // 2

    font_size = int(cell * 0.72)
    ctx.font = f'{font_size}px serif'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'

    ctx.clearRect(0, 0, _CS, _CS)

    for y in range(g.height):
        for x in range(g.width):
            px = ox + x * cell
            py = oy + y * cell
            cx = px + cell / 2
            cy = py + cell / 2
            v  = g.cells[y][x]

            # Background: dark green for trees, light green otherwise.
            ctx.fillStyle = '#3a5c2e' if v == _TREE else '#c8e6c9'
            ctx.fillRect(px, py, cell, cell)

            # Grid lines
            ctx.strokeStyle = '#8fbc8f'
            ctx.lineWidth   = max(1, cell * 0.025)
            ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1)

            if   v == _TREE: ctx.fillText('🌳', cx, cy)
            elif v == _LEAF: ctx.fillText('🍀', cx, cy)
            elif v == _MUSH: ctx.fillText('🍄', cx, cy)

    # Draw Kara rotated to face her current direction.
    kx = ox + g.kara_x * cell + cell / 2
    ky = oy + g.kara_y * cell + cell / 2
    ctx.save()
    ctx.translate(kx, ky)
    ctx.rotate(_DIR_ANGLE[g.kara_dir])
    ctx.fillText('🐞', 0, 0)
    ctx.restore()
