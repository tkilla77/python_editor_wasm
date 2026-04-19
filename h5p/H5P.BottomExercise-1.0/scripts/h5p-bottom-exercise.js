/**
 * H5P wrapper for <bottom-exercise>.
 *
 * Extends H5P.EventDispatcher (not H5P.Question) so the library has no
 * preloadedDependencies and installs standalone on any H5P platform.
 * createXAPIEventTemplate / setScoredResult come from h5p-x-api.js which
 * is part of the H5P core and always present.
 *
 * Implements the H5P Question Type contract:
 *   attach()            — mount the web component into the H5P container
 *   showSolutions()     — reveal solution (delegated to bottom-exercise)
 *   resetTask()         — reset editor and score state
 *   getScore()          — passed test count (0 if no tests)
 *   getMaxScore()       — total test count (1 if no tests: completion-only)
 *   getAnswerGiven()    — true once the student has run the code
 *   getCurrentState()   — returns undefined (no persistent state)
 *
 * Scoring:
 *   With test assertions  → scored (passed/total); xAPI 'answered' on test-result
 *   Without test code     → completion-only; xAPI 'completed' on first run,
 *                           score 1/1
 *
 * The bottom-exercise IIFE bundle (bottom-exercise.iife.js) must be listed
 * before this file in library.json so that <bottom-exercise> is registered
 * when attach() runs.
 */
(function (H5P) {
    'use strict';

    H5P.BottomExercise = function (params, contentId, extras) {
        H5P.EventDispatcher.call(this);
        this.contentId  = contentId;
        this._p         = (params.exercise  || {});
        this._behaviour = (params.behaviour || {});
        this._score     = 0;
        this._maxScore  = 0;
        this._answered  = false;
        this._element   = null;
    };

    H5P.BottomExercise.prototype = Object.create(H5P.EventDispatcher.prototype);
    H5P.BottomExercise.prototype.constructor = H5P.BottomExercise;

    // H5P text fields are HTML-encoded on save ('→&#039;). Decode via textarea
    // which uses the browser's native HTML parser without executing scripts.
    function decodeHtml(str) {
        var ta = document.createElement('textarea');
        ta.innerHTML = str;
        return ta.value;
    }

    H5P.BottomExercise.prototype.attach = function ($container) {
        var p    = this._p;
        var b    = this._behaviour;
        var self = this;
        var ex   = document.createElement('bottom-exercise');

        if (p.layout && p.layout !== 'console') ex.setAttribute('layout', p.layout);

        if (p.prompt) {
            var div = document.createElement('div');
            div.slot = 'prompt';
            div.innerHTML = p.prompt; // sanitised by H5P editor on save
            ex.appendChild(div);
        }

        if (p.starterCode) {
            var tStarter = document.createElement('template');
            tStarter.dataset.type = 'starter';
            tStarter.content.textContent = decodeHtml(p.starterCode);
            ex.appendChild(tStarter);
        }

        if (p.testCode) {
            var tTest = document.createElement('template');
            tTest.dataset.type = 'test';
            tTest.content.textContent = decodeHtml(p.testCode);
            ex.appendChild(tTest);
        }

        if (p.solutionCode && b.enableSolutionsButton !== false) {
            var tSolution = document.createElement('template');
            tSolution.dataset.type = 'solution';
            tSolution.content.textContent = decodeHtml(p.solutionCode);
            ex.appendChild(tSolution);
        }

        // Scored exercises: test-result carries pass/fail per assertion
        ex.addEventListener('test-result', function (e) {
            var report = e.detail;
            self._score    = report.results.filter(function (r) { return r.passed; }).length;
            self._maxScore = report.results.length;
            self._answered = true;
            self._triggerXAPIAnswered(report.passed);
        });

        // Completion-only exercises (no test code): any run counts as an attempt
        if (!p.testCode) {
            ex.addEventListener('bottom-run', function () {
                if (!self._answered) {
                    self._answered = true;
                    self._score    = 1;
                    self._maxScore = 1;
                    self._triggerXAPICompleted();
                }
            }, { once: true });
        }

        // Keep H5P iframe height in sync with component size
        var ro = new ResizeObserver(function () { self.trigger('resize'); });
        ro.observe(ex);

        $container[0].appendChild(ex);
        self._element = ex;
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

    H5P.BottomExercise.prototype.getScore        = function () { return this._score; };
    H5P.BottomExercise.prototype.getMaxScore     = function () { return this._maxScore || 1; };
    H5P.BottomExercise.prototype.getAnswerGiven  = function () { return this._answered; };
    H5P.BottomExercise.prototype.getCurrentState = function () { return undefined; };

    // ── xAPI helpers ──────────────────────────────────────────────────────────

    H5P.BottomExercise.prototype._triggerXAPIAnswered = function (passed) {
        var ev = this.createXAPIEventTemplate('answered');
        ev.setScoredResult(this._score, this._maxScore, this, true, passed);
        this.trigger(ev);
    };

    H5P.BottomExercise.prototype._triggerXAPICompleted = function () {
        var ev = this.createXAPIEventTemplate('completed');
        ev.setScoredResult(1, 1, this, true, true);
        this.trigger(ev);
    };

}(H5P));
