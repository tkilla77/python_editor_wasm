import { LitElement, html, unsafeCSS } from 'lit'
import { customElement } from 'lit/decorators.js'
import styles from './bottom-editor-canvas.css?inline';

const CANVAS_SIZE = 2000;

@customElement('bottom-editor-canvas')
export class BottomEditorCanvas extends LitElement {
    static styles = unsafeCSS(styles);

    private _zoom = 1;
    private _panX = 0;
    private _panY = 0;
    private _lastWidth = 0;    // tracked by ResizeObserver
    private _lastHeight = 0;
    private _dragging = false;
    private _dragLastX = 0;
    private _dragLastY = 0;

    private _resizeObserver = new ResizeObserver(entries => {
        const rect = entries[0]?.contentRect;
        const w = rect?.width ?? 0;
        const h = rect?.height ?? 0;
        if (w > 0 && this._lastWidth > 0) {
            const ratio = w / this._lastWidth;
            // panX scales proportionally with width (derived: panX_new = panX × ratio).
            this._panX *= ratio;
            // panY: keep the same canvas Y coordinate at the new host centre.
            // Derivation: cy = (lastH/2 − panY) / (lastW/CS × Z)
            //             panY_new = h/2 − cy × (w/CS × Z) = h/2 − (lastH/2 − panY) × ratio
            this._panY = h / 2 - (this._lastHeight / 2 - this._panY) * ratio;
            this._applyTransform();
        }
        if (w > 0) this._lastWidth = w;
        if (h > 0) this._lastHeight = h;
    });

    connectedCallback() {
        super.connectedCallback();
        this._resizeObserver.observe(this);
        this.addEventListener('wheel', this._onWheel, { passive: false });
        this.addEventListener('mousedown', this._onMouseDown);
        this.addEventListener('dblclick', this._onDblClick);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._resizeObserver.disconnect();
        this.removeEventListener('wheel', this._onWheel);
        this.removeEventListener('mousedown', this._onMouseDown);
        this.removeEventListener('dblclick', this._onDblClick);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
    }

    private _getCanvas(): HTMLCanvasElement | null {
        return this.shadowRoot?.querySelector('canvas') ?? null;
    }

    private _applyTransform(): void {
        const c = this._getCanvas();
        if (c) c.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
    }

    // Set zoom so 1 turtle unit = 1 CSS pixel, centred on the origin (0,0 world) in the host.
    private _resetView(): void {
        const w = Math.max(this.clientWidth, 1);
        const h = Math.max(this.clientHeight, 1);
        this._lastWidth = w;
        this._lastHeight = h;
        this._zoom = CANVAS_SIZE / w;
        // transform-origin is 0 0; the canvas CSS width equals w, so w/2 × zoom lands at
        // canvas centre. Pan so that point aligns with the host centre (w/2, h/2).
        this._panX = (w / 2) * (1 - this._zoom);
        this._panY = h / 2 - (w / 2) * this._zoom;
        this._applyTransform();
    }

    private _onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = this.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newZoom = Math.max(0.05, Math.min(50, this._zoom * factor));
        const k = newZoom / this._zoom;
        this._panX = mx - (mx - this._panX) * k;
        this._panY = my - (my - this._panY) * k;
        this._zoom = newZoom;
        this._applyTransform();
    };

    private _onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this._dragging = true;
        this._dragLastX = e.clientX;
        this._dragLastY = e.clientY;
        this.style.cursor = 'grabbing';
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
    };

    private _onMouseMove = (e: MouseEvent) => {
        if (!this._dragging) return;
        this._panX += e.clientX - this._dragLastX;
        this._panY += e.clientY - this._dragLastY;
        this._dragLastX = e.clientX;
        this._dragLastY = e.clientY;
        this._applyTransform();
    };

    private _onMouseUp = () => {
        this._dragging = false;
        this.style.cursor = '';
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
    };

    private _onDblClick = (e: MouseEvent) => {
        e.preventDefault();
        this._resetView();
    };

    transferToOffscreen(): OffscreenCanvas {
        // Replace with a fresh canvas on every call (transferControlToOffscreen is one-shot).
        const fresh = document.createElement('canvas');
        fresh.width = CANVAS_SIZE;
        fresh.height = CANVAS_SIZE;
        const existing = this.shadowRoot!.querySelector('canvas');
        if (existing) existing.replaceWith(fresh);
        this._resetView();
        return fresh.transferControlToOffscreen();
    }

    render() {
        return html`
            <canvas width="${CANVAS_SIZE}" height="${CANVAS_SIZE}"></canvas>
            <button @click=${this._resetView} title="Reset view">⊕</button>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor-canvas': BottomEditorCanvas
    }
}
