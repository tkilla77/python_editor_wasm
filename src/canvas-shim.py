"""
canvas-shim.py  —  patches matplotlib, PIL and cv2 to render onto the
OffscreenCanvas registered via pyodide.canvas.setCanvas2D().

Injected into /home/pyodide/ at worker startup.
Libraries are patched lazily via a sys.meta_path hook so this file has
zero cost when none of them are used.
"""
import sys as _sys


# ---------------------------------------------------------------------------
# Core drawing helper
# ---------------------------------------------------------------------------

def _draw_rgba(rgba_bytes, img_w, img_h):
    """Blit RGBA bytes onto the OffscreenCanvas, scaled to fit."""
    import pyodide_js as _pjs
    from js import OffscreenCanvas as _JsOC, ImageData, Uint8ClampedArray
    from pyodide.ffi import to_js
    import numpy as _np

    canvas = _pjs.canvas.getCanvas2D()
    if canvas is None:
        print('[canvas-shim] No canvas attached — use layout="canvas" or layout="split"')
        return
    ctx = canvas.getContext('2d')
    cw, ch = int(canvas.width), int(canvas.height)

    scale = min(cw / img_w, ch / img_h)
    dw, dh = int(img_w * scale), int(img_h * scale)
    dx, dy = (cw - dw) // 2, (ch - dh) // 2

    ctx.clearRect(0, 0, cw, ch)

    # Build ImageData: numpy uint8 → JS Uint8Array → grab its ArrayBuffer
    # → wrap as Uint8ClampedArray (same bytes, correct type for ImageData).
    arr = _np.frombuffer(rgba_bytes, dtype=_np.uint8).copy()
    js_arr = to_js(arr)                              # Uint8Array
    clamped = Uint8ClampedArray.new(js_arr.buffer)   # Uint8ClampedArray (same buffer)
    image_data = ImageData.new(clamped, img_w, img_h)

    # Draw into a temporary OffscreenCanvas at native size, then scale-blit.
    tmp = _JsOC.new(img_w, img_h)
    tmp.getContext('2d').putImageData(image_data, 0, 0)
    ctx.drawImage(tmp, dx, dy, dw, dh)


# ---------------------------------------------------------------------------
# Per-library patches
# ---------------------------------------------------------------------------

def _patch_matplotlib():
    import matplotlib as _mpl
    _mpl.use('agg')
    import matplotlib.pyplot as _plt

    def _show(*args, **kwargs):
        fig = _plt.gcf()
        fig.canvas.draw()
        w, h = fig.canvas.get_width_height()
        _draw_rgba(bytes(fig.canvas.buffer_rgba()), w, h)

    _plt.__dict__['show'] = _show


def _patch_pil():
    from PIL import Image as _Img
    import numpy as _np

    def _show(self, title=None, command=None):
        rgba = _np.array(self.convert('RGBA'))
        h, w = rgba.shape[:2]
        _draw_rgba(rgba.tobytes(), w, h)

    _Img.Image.show = _show


def _patch_cv2():
    import cv2 as _cv2
    import numpy as _np

    def _imshow(winname, mat):
        if mat.ndim == 2:                               # grayscale
            rgba = _np.stack([mat, mat, mat,
                              _np.full_like(mat, 255)], axis=-1)
        elif mat.shape[2] == 3:                         # BGR
            b, g, r = mat[..., 0], mat[..., 1], mat[..., 2]
            rgba = _np.stack([r, g, b,
                              _np.full(mat.shape[:2], 255, dtype=_np.uint8)], axis=-1)
        else:                                           # BGRA
            b, g, r, a = mat[..., 0], mat[..., 1], mat[..., 2], mat[..., 3]
            rgba = _np.stack([r, g, b, a], axis=-1)
        h, w = rgba.shape[:2]
        _draw_rgba(rgba.astype(_np.uint8).tobytes(), w, h)

    # Write via __dict__ to bypass C-extension __setattr__ guards.
    _cv2.__dict__['imshow'] = _imshow
    _cv2.__dict__['waitKey'] = lambda delay=0: 0
    _cv2.__dict__['destroyAllWindows'] = lambda: None
    _cv2.__dict__['destroyWindow'] = lambda name: None


_PATCHES = {
    'matplotlib': _patch_matplotlib,
    'PIL':        _patch_pil,
    'cv2':        _patch_cv2,
}


# ---------------------------------------------------------------------------
# Public: re-apply any pending patches for libraries now in sys.modules.
# Called from the worker after each user code run.
# ---------------------------------------------------------------------------

def apply_pending():
    for base in list(_PATCHES):
        if base in _sys.modules:
            patch = _PATCHES.pop(base)
            try:
                patch()
            except Exception as e:
                print(f'[canvas-shim] patch for {base} failed: {e}')


# ---------------------------------------------------------------------------
# Modern meta_path hook (find_spec / exec_module, Python 3.4+)
# Intercepts top-level package imports and applies the patch immediately
# after the real import completes.
# ---------------------------------------------------------------------------

import importlib.abc as _abc
import importlib.machinery as _machinery


class _CanvasPatchLoader(_abc.Loader):
    """Wraps the real loader; calls the canvas patch after exec_module."""
    def __init__(self, real_loader, base):
        self._real = real_loader
        self._base = base

    def create_module(self, spec):
        return self._real.create_module(spec)

    def exec_module(self, module):
        self._real.exec_module(module)
        patch = _PATCHES.pop(self._base, None)
        if patch:
            try:
                patch()
            except Exception as e:
                print(f'[canvas-shim] patch for {self._base} failed: {e}')


class _CanvasImportHook(_abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        # Only intercept the top-level package (e.g. 'PIL', not 'PIL.Image').
        if fullname not in _PATCHES:
            return None
        # Find the real spec from every other finder.
        for finder in _sys.meta_path:
            if finder is self:
                continue
            spec = getattr(finder, 'find_spec', None)
            if spec is None:
                continue
            result = spec(fullname, path, target)
            if result is not None:
                result.loader = _CanvasPatchLoader(result.loader, fullname)
                return result
        return None


_sys.meta_path.insert(0, _CanvasImportHook())

# Patch anything already imported before this shim loaded.
apply_pending()
