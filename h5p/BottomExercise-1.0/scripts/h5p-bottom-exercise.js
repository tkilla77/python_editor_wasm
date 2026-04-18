/**
 * H5P wrapper for <bottom-exercise>.
 *
 * Implements the H5P Question Type contract:
 *   attach()            — mount the web component into the H5P iframe
 *   showSolutions()     — reveal solution (delegated to bottom-exercise)
 *   resetTask()         — reset editor and score state
 *   getScore()          — passed test count (0 if no tests)
 *   getMaxScore()       — total test count (1 if no tests: completion-only)
 *   getAnswerGiven()    — true once the student has run the code
 *
 * Scoring:
 *   With test assertions  → scored (passed/total); xAPI 'answered' on test-result
 *   Without test code     → completion-only; xAPI 'completed' on first run,
 *                           score 1/1 (the LMS treats it as pass/fail by attempt)
 *
 * The bottom-exercise IIFE bundle (bottom-exercise.iife.js) must be listed
 * before this file in library.json so that <bottom-exercise> is registered
 * when attach() runs.
 */
(function (H5P) {
    'use strict';

    H5P.BottomExercise = function (params, contentId, extras) {
        H5P.EventDispatcher.call(this);
        this._p         = (params.exercise  || {});
        this._behaviour = (params.behaviour || {});
        this._score     = 0;
        this._maxScore  = 0;
        this._answered  = false;
        this._element   = null;
    };

    H5P.BottomExercise.prototype = Object.create(H5P.EventDispatcher.prototype);
    H5P.BottomExercise.prototype.constructor = H5P.BottomExercise;

    H5P.BottomExercise.prototype.attach = function ($container) {
        const p = this._p;
        const b = this._behaviour;
        const ex = document.createElement('bottom-exercise');

        if (p.layout && p.layout !== 'console') ex.setAttribute('layout', p.layout);

        if (p.prompt) {
            const div = document.createElement('div');
            div.slot = 'prompt';
            div.innerHTML = p.prompt; // sanitised by H5P editor on save
            ex.appendChild(div);
        }

        if (p.starterCode) {
            const t = document.createElement('template');
            t.dataset.type = 'starter';
            t.content.textContent = p.starterCode;
            ex.appendChild(t);
        }

        if (p.testCode) {
            const t = document.createElement('template');
            t.dataset.type = 'test';
            t.content.textContent = p.testCode;
            ex.appendChild(t);
        }

        if (p.solutionCode && b.enableSolutionsButton !== false) {
            const t = document.createElement('template');
            t.dataset.type = 'solution';
            t.content.textContent = p.solutionCode;
            ex.appendChild(t);
        }

        // Scored exercises: test-result carries pass/fail per assertion
        ex.addEventListener('test-result', (e) => {
            const report = e.detail;
            this._score    = report.results.filter(r => r.passed).length;
            this._maxScore = report.results.length;
            this._answered = true;
            this._triggerXAPIAnswered(report.passed);
        });

        // Completion-only exercises (no test code): any run counts as an attempt
        if (!p.testCode) {
            ex.addEventListener('bottom-run', () => {
                if (!this._answered) {
                    this._answered = true;
                    this._score    = 1;
                    this._maxScore = 1;
                    this._triggerXAPICompleted();
                }
            }, { once: true });
        }

        // Keep H5P iframe height in sync with component size
        const ro = new ResizeObserver(() => this.trigger('resize'));
        ro.observe(ex);

        $container[0].appendChild(ex);
        this._element = ex;
    };

    // ── H5P Question Type contract ────────────────────────────────────────────

    H5P.BottomExercise.prototype.showSolutions = function () {
        if (this._element) this._element.showSolution();
    };

    H5P.BottomExercise.prototype.resetTask = function () {
        if (this._element) this._element.resetCode();
        this._score    = 0;
        this._answered = false;
    };

    H5P.BottomExercise.prototype.getScore       = function () { return this._score; };
    H5P.BottomExercise.prototype.getMaxScore    = function () { return this._maxScore || 1; };
    H5P.BottomExercise.prototype.getAnswerGiven = function () { return this._answered; };

    // ── xAPI helpers ──────────────────────────────────────────────────────────

    H5P.BottomExercise.prototype._triggerXAPIAnswered = function (passed) {
        const ev = this.createXAPIEvent('answered');
        ev.setScoredResult(this._score, this._maxScore, this, true, passed);
        this.trigger(ev);
    };

    H5P.BottomExercise.prototype._triggerXAPICompleted = function () {
        const ev = this.createXAPIEvent('completed');
        ev.setScoredResult(1, 1, this, true, true);
        this.trigger(ev);
    };

}(H5P));
