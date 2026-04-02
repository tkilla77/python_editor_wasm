"""
canvas-shim.py  —  patches matplotlib, PIL and cv2 to render onto the
OffscreenCanvas registered via pyodide.canvas.setCanvas2D().

Injected into /home/pyodide/ at worker startup.  Libraries are patched
lazily via a sys.meta_path hook so this file has zero cost when none of
them are used.
"""
import sys as _sys


# ---------------------------------------------------------------------------
# Core drawing helper
# ---------------------------------------------------------------------------

def _draw_rgba(rgba_bytes, img_w, img_h):
    """Scale-fit raw RGBA bytes onto the OffscreenCanvas, centred."""
    import pyodide_js as _pjs
    from js import ImageData, Uint8ClampedArray, OffscreenCanvas as _JsOC
    from pyodide.ffi import to_js
    import numpy as _np

    canvas = _pjs.canvas.getCanvas2D()
    if canvas is None:
        return
    ctx = canvas.getContext('2d')
    cw, ch = int(canvas.width), int(canvas.height)

    scale = min(cw / img_w, ch / img_h)
    dw, dh = int(img_w * scale), int(img_h * scale)
    dx, dy = (cw - dw) // 2, (ch - dh) // 2

    ctx.clearRect(0, 0, cw, ch)

    # Blit at native resolution into a temp OffscreenCanvas, then scale-draw
    # onto the main canvas.  This is fully synchronous (no createImageBitmap).
    tmp = _JsOC.new(img_w, img_h)
    arr = _np.frombuffer(rgba_bytes, dtype=_np.uint8)
    clamped = Uint8ClampedArray.new(to_js(arr))
    tmp.getContext('2d').putImageData(ImageData.new(clamped, img_w, img_h), 0, 0)
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

    _orig_imshow = _cv2.__dict__.get('imshow')

    def _imshow(winname, mat):
        if mat.ndim == 2:                              # grayscale
            rgba = _np.stack([mat, mat, mat, _np.full_like(mat, 255)], axis=-1)
        elif mat.shape[2] == 3:                        # BGR
            r, g, b = mat[..., 2], mat[..., 1], mat[..., 0]
            rgba = _np.stack([r, g, b, _np.full_like(r, 255)], axis=-1)
        else:                                          # BGRA
            b, g, r, a = mat[..., 0], mat[..., 1], mat[..., 2], mat[..., 3]
            rgba = _np.stack([r, g, b, a], axis=-1)
        h, w = rgba.shape[:2]
        _draw_rgba(rgba.astype(_np.uint8).tobytes(), w, h)

    def _imshow_safe(winname, mat):
        # Try the canvas path first; fall back to the original if something
        # unexpected goes wrong (e.g. no canvas attached).
        try:
            _imshow(winname, mat)
        except Exception:
            if _orig_imshow is not None:
                try:
                    _orig_imshow(winname, mat)
                except Exception:
                    pass

    # Write directly to __dict__ to bypass any C-extension __setattr__ guard.
    _cv2.__dict__['imshow'] = _imshow_safe
    _cv2.__dict__['waitKey'] = lambda delay=0: 0
    _cv2.__dict__['destroyAllWindows'] = lambda: None
    _cv2.__dict__['destroyWindow'] = lambda name: None


# ---------------------------------------------------------------------------
# Import hook — intercepts library imports and applies the right patch once
# ---------------------------------------------------------------------------

_PATCHES = {
    'matplotlib': _patch_matplotlib,
    'PIL':        _patch_pil,
    'cv2':        _patch_cv2,
}


class _CanvasImportHook:
    def find_module(self, name, path=None):
        base = name.split('.')[0]
        return self if base in _PATCHES else None

    def load_module(self, name):
        base = name.split('.')[0]
        if name not in _sys.modules:
            # Remove ourselves to avoid recursion, then do the real import.
            _sys.meta_path.remove(self)
            try:
                __import__(name)
            finally:
                if self not in _sys.meta_path:
                    _sys.meta_path.insert(0, self)
        mod = _sys.modules[name]
        # Apply the patch for this base package exactly once.
        patch = _PATCHES.pop(base, None)
        if patch:
            try:
                patch()
            except Exception:
                pass
        return mod


_sys.meta_path.insert(0, _CanvasImportHook())

# Patch any libraries that were already imported before this shim loaded.
for _base, _patch in list(_PATCHES.items()):
    if _base in _sys.modules:
        try:
            _patch()
            del _PATCHES[_base]
        except Exception:
            pass
