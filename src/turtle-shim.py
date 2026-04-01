"""
turtle.py  —  browser canvas shim for pyodide
Draws to the OffscreenCanvas registered via pyodide.canvas.setCanvas2D().
Coordinate system: (0,0) at centre, x right, y up (standard turtle mode).
Heading: 0 = east, 90 = north, counter-clockwise positive.
"""
import math
import time
import pyodide_js as _pjs

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ctx():
    return _pjs.canvas.getCanvas2D().getContext('2d')

def _wh():
    c = _pjs.canvas.getCanvas2D()
    return c.width, c.height

def _tc(x, y):
    """World → canvas coordinates."""
    w, h = _wh()
    return w / 2 + x, h / 2 - y

# Named colours (subset of CSS / Tk turtle palette)
_COLORS = {
    'red':'#ff0000','green':'#008000','blue':'#0000ff','yellow':'#ffff00',
    'orange':'#ffa500','purple':'#800080','pink':'#ffc0cb','white':'#ffffff',
    'black':'#000000','cyan':'#00ffff','magenta':'#ff00ff','brown':'#a52a2a',
    'gray':'#808080','grey':'#808080','lime':'#00ff00','navy':'#000080',
    'teal':'#008080','maroon':'#800000','violet':'#ee82ee','gold':'#ffd700',
    'silver':'#c0c0c0','aqua':'#00ffff','coral':'#ff7f50','salmon':'#fa8072',
    'turquoise':'#40e0d0','indigo':'#4b0082','khaki':'#f0e68c',
    'lavender':'#e6e6fa','beige':'#f5f5dc','crimson':'#dc143c',
}

# speed() value → sleep seconds per step
_SPEED_DELAY = {
    0: 0, 1: 0.1, 2: 0.07, 3: 0.05, 4: 0.03,
    5: 0.02, 6: 0.015, 7: 0.01, 8: 0.007, 9: 0.003, 10: 0,
}
_SPEED_NAMES = {'fastest': 0, 'fast': 10, 'normal': 6, 'slow': 3, 'slowest': 1}

def _parse_color(c):
    if isinstance(c, str):
        return _COLORS.get(c.lower(), c)
    if isinstance(c, (tuple, list)):
        v = list(c)
        if all(isinstance(x, float) and 0.0 <= x <= 1.0 for x in v):
            v = [round(x * 255) for x in v]
        return '#{:02x}{:02x}{:02x}'.format(int(v[0]), int(v[1]), int(v[2]))
    return str(c)


# ---------------------------------------------------------------------------
# Turtle class
# ---------------------------------------------------------------------------

class Turtle:
    def __init__(self):
        self._x = 0.0
        self._y = 0.0
        self._heading = 0.0      # degrees; 0=east, CCW positive
        self._down = True
        self._pencolor = 'black'
        self._fillcolor = 'black'
        self._penwidth = 1
        self._delay = _SPEED_DELAY[6]
        self._visible = True
        self._filling = False
        self._fill_pts = []

    # ---- internal draw ----------------------------------------------------

    def _draw_line(self, x1, y1, x2, y2):
        ctx = _ctx()
        ctx.beginPath()
        ctx.moveTo(*_tc(x1, y1))
        ctx.lineTo(*_tc(x2, y2))
        ctx.strokeStyle = _parse_color(self._pencolor)
        ctx.lineWidth = self._penwidth
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()

    def _step(self, x, y):
        if self._down:
            self._draw_line(self._x, self._y, x, y)
        if self._filling:
            self._fill_pts.append((x, y))
        self._x, self._y = x, y
        if self._delay:
            time.sleep(self._delay)

    # ---- movement ---------------------------------------------------------

    def forward(self, distance):
        r = math.radians(self._heading)
        self._step(self._x + distance * math.cos(r),
                   self._y + distance * math.sin(r))
    fd = forward

    def backward(self, distance):
        self.forward(-distance)
    bk = backward
    back = backward

    def left(self, angle):
        self._heading = (self._heading + angle) % 360
    lt = left

    def right(self, angle):
        self._heading = (self._heading - angle) % 360
    rt = right

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._step(float(x), float(y))
    setpos = goto
    setposition = goto

    def setx(self, x):
        self._step(float(x), self._y)

    def sety(self, y):
        self._step(self._x, float(y))

    def home(self):
        self._step(0.0, 0.0)
        self._heading = 0.0

    def setheading(self, angle):
        self._heading = float(angle) % 360
    seth = setheading

    def circle(self, radius, extent=360, steps=None):
        if steps is None:
            frac = abs(extent) / 360
            steps = max(1 + int(min(11 + abs(radius) / 6, 59) * frac), 4)
        w = float(extent) / steps
        w2 = w / 2
        l = 2 * radius * math.sin(math.radians(w2))
        if radius < 0:
            l, w, w2 = -l, -w, -w2
        self.left(w2)
        for _ in range(steps):
            self.forward(l)
            self.left(w)
        self.right(w2)

    def dot(self, size=None, *color):
        if size is None:
            size = max(self._penwidth + 4, 2 * self._penwidth)
        ctx = _ctx()
        cx, cy = _tc(self._x, self._y)
        c = _parse_color(color[0] if color else self._pencolor)
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, 2 * math.pi)
        ctx.fillStyle = c
        ctx.fill()

    # ---- pen state --------------------------------------------------------

    def penup(self):
        self._down = False
    pu = penup
    up = penup

    def pendown(self):
        self._down = True
    pd = pendown
    down = pendown

    def isdown(self):
        return self._down

    def pensize(self, width=None):
        if width is not None:
            self._penwidth = width
        return self._penwidth
    width = pensize
    penwidth = pensize

    def speed(self, s=None):
        if s is None:
            # reverse-lookup current delay to speed value
            for k, v in _SPEED_DELAY.items():
                if v == self._delay:
                    return k
            return 6
        if isinstance(s, str):
            s = _SPEED_NAMES.get(s, 6)
        self._delay = _SPEED_DELAY[max(0, min(10, int(s)))]

    # ---- colour -----------------------------------------------------------

    def pencolor(self, *args):
        if args:
            self._pencolor = args[0] if len(args) == 1 else tuple(args)
        return self._pencolor

    def fillcolor(self, *args):
        if args:
            self._fillcolor = args[0] if len(args) == 1 else tuple(args)
        return self._fillcolor

    def color(self, *args):
        if not args:
            return self._pencolor, self._fillcolor
        if len(args) == 1:
            self._pencolor = self._fillcolor = args[0]
        elif len(args) == 2:
            self._pencolor, self._fillcolor = args
        else:
            c = tuple(args)
            self._pencolor = self._fillcolor = c

    def colormode(self, mode=None):
        return 255  # always report 255; _parse_color handles both modes

    # ---- fill -------------------------------------------------------------

    def begin_fill(self):
        self._filling = True
        self._fill_pts = [(self._x, self._y)]

    def end_fill(self):
        if len(self._fill_pts) < 2:
            self._filling = False
            return
        ctx = _ctx()
        ctx.beginPath()
        ctx.moveTo(*_tc(*self._fill_pts[0]))
        for pt in self._fill_pts[1:]:
            ctx.lineTo(*_tc(*pt))
        ctx.closePath()
        ctx.fillStyle = _parse_color(self._fillcolor)
        ctx.fill()
        self._filling = False
        self._fill_pts = []

    def filling(self):
        return self._filling

    # ---- canvas / screen --------------------------------------------------

    def clear(self):
        ctx = _ctx()
        w, h = _wh()
        ctx.clearRect(0, 0, w, h)

    def reset(self):
        self.clear()
        self.__init__()

    def bgcolor(self, color):
        ctx = _ctx()
        w, h = _wh()
        ctx.fillStyle = _parse_color(color)
        ctx.fillRect(0, 0, w, h)

    def write(self, text, move=False, align='left',
              font=('Arial', 12, 'normal')):
        family = font[0] if len(font) > 0 else 'Arial'
        size   = font[1] if len(font) > 1 else 12
        style  = font[2] if len(font) > 2 else 'normal'
        ctx = _ctx()
        ctx.font = f'{style} {size}px {family}'
        ctx.fillStyle = _parse_color(self._pencolor)
        ctx.textAlign = align
        ctx.textBaseline = 'bottom'
        cx, cy = _tc(self._x, self._y)
        ctx.fillText(str(text), cx, cy)

    # ---- visibility -------------------------------------------------------

    def hideturtle(self):
        self._visible = False
    ht = hideturtle

    def showturtle(self):
        self._visible = True
    st = showturtle

    def isvisible(self):
        return self._visible

    # ---- queries ----------------------------------------------------------

    def pos(self):
        return (self._x, self._y)
    position = pos

    def xcor(self):
        return self._x

    def ycor(self):
        return self._y

    def heading(self):
        return self._heading

    def distance(self, x, y=None):
        if y is None:
            x, y = x
        return math.hypot(x - self._x, y - self._y)

    def towards(self, x, y=None):
        if y is None:
            x, y = x
        return math.degrees(math.atan2(y - self._y, x - self._x)) % 360

    # ---- no-ops (event/screen API not applicable in this context) ---------

    def tracer(self, *a, **kw): pass
    def update(self, *a): pass
    def done(self): pass
    mainloop = done
    def bye(self): pass
    def exitonclick(self): pass
    def stamp(self): return 0
    def clearstamp(self, *a): pass
    def clearstamps(self, *a): pass
    def undo(self): pass
    def onclick(self, *a, **kw): pass
    def onrelease(self, *a, **kw): pass
    def ondrag(self, *a, **kw): pass

    def setup(self, *a, **kw): pass
    def title(self, *a): pass
    def screensize(self, *a, **kw): return _wh()
    def window_width(self): return _wh()[0]
    def window_height(self): return _wh()[1]


# ---------------------------------------------------------------------------
# Screen singleton (stub — returns a Turtle-like object for compatibility)
# ---------------------------------------------------------------------------

class _Screen:
    """Minimal Screen stub so Screen().bgcolor() etc. work."""
    def bgcolor(self, color): _default_turtle().bgcolor(color)
    def tracer(self, *a, **kw): pass
    def update(self, *a): pass
    def mainloop(self): pass
    done = mainloop
    def bye(self): pass
    def exitonclick(self): pass
    def setup(self, *a, **kw): pass
    def title(self, *a): pass
    def colormode(self, mode=None): return 255
    def screensize(self, *a, **kw): return _wh()
    def window_width(self): return _wh()[0]
    def window_height(self): return _wh()[1]
    def onkey(self, *a, **kw): pass
    def onkeypress(self, *a, **kw): pass
    def onkeyrelease(self, *a, **kw): pass
    def listen(self, *a): pass
    def onclick(self, *a, **kw): pass

_screen_instance = _Screen()

def Screen():
    return _screen_instance


# ---------------------------------------------------------------------------
# Module-level default turtle + convenience functions
# ---------------------------------------------------------------------------

_default = None

def _default_turtle():
    global _default
    if _default is None:
        _default = Turtle()
    return _default

def _wrap(name):
    def f(*a, **kw):
        return getattr(_default_turtle(), name)(*a, **kw)
    f.__name__ = name
    return f

for _n in [
    'forward','fd','backward','bk','back',
    'left','lt','right','rt',
    'goto','setpos','setposition','setx','sety','home',
    'setheading','seth','circle','dot',
    'penup','pu','up','pendown','pd','down','isdown',
    'pensize','width','penwidth','speed',
    'pencolor','fillcolor','color','colormode',
    'begin_fill','end_fill','filling',
    'clear','reset','bgcolor','write',
    'hideturtle','ht','showturtle','st','isvisible',
    'pos','position','xcor','ycor','heading','distance','towards',
    'tracer','update','stamp','undo',
    'setup','title','screensize','window_width','window_height',
]:
    globals()[_n] = _wrap(_n)

def done(): pass
def mainloop(): pass
def bye(): pass
def exitonclick(): pass
