/**
 * H5P wrapper for <bottom-exercise>.
 *
 * Implements the H5P Question Type contract:
 *   registerDomElements() — mount the web component via H5P.Question.setContent()
 *   showSolutions()       — reveal solution (delegated to bottom-exercise)
 *   resetTask()           — reset editor and score state
 *   getScore()            — passed test count (0 if no tests)
 *   getMaxScore()         — total test count (1 if no tests: completion-only)
 *   getAnswerGiven()      — true once the student has run the code
 *
 * H5P.Question sets this.attach as an own instance property in its constructor,
 * which would shadow any prototype attach we define. The correct extension point
 * is registerDomElements(), which H5P.Question's own attach() calls after
 * building its wrapper DOM.
 *
 * Scoring:
 *   With test assertions  → scored (passed/total); xAPI 'answered' on test-result
 *   Without test code     → completion-only; xAPI 'completed' on first run,
 *                           score 1/1 (the LMS treats it as pass/fail by attempt)
 *
 * The bottom-exercise IIFE bundle (bottom-exercise.iife.js) must be listed
 * before this file in library.json so that <bottom-exercise> is registered
 * when registerDomElements() runs.
 */
(function (H5P) {
    'use strict';

    H5P.BottomExercise = function (params, contentId, extras) {
        H5P.Question.call(this, 'bottom-exercise');
        this.contentId  = contentId;
        this._p         = (params.exercise  || {});
        this._behaviour = (params.behaviour || {});
        this._score     = 0;
        this._maxScore  = 0;
        this._answered  = false;
        this._element   = null;
    };

    H5P.BottomExercise.prototype = Object.create(H5P.Question.prototype);
    H5P.BottomExercise.prototype.constructor = H5P.BottomExercise;

    // H5P.Question.prototype.attach() calls this method after building its
    // wrapper DOM. We inject <bottom-exercise> via setContent() so it lands
    // inside H5P.Question's content section.
    H5P.BottomExercise.prototype.registerDomElements = function () {
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
            tStarter.content.textContent = p.starterCode;
            ex.appendChild(tStarter);
        }

        if (p.testCode) {
            var tTest = document.createElement('template');
            tTest.dataset.type = 'test';
            tTest.content.textContent = p.testCode;
            ex.appendChild(tTest);
        }

        if (p.solutionCode && b.enableSolutionsButton !== false) {
            var tSolution = document.createElement('template');
            tSolution.dataset.type = 'solution';
            tSolution.content.textContent = p.solutionCode;
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

        self._element = ex;

        // setContent() expects a jQuery object; raw DOM elements go through
        // jQuery's .html() which would serialize the element instead of appending it.
        self.setContent(H5P.jQuery(ex));
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
        var ev = this.createXAPIEvent('answered');
        ev.setScoredResult(this._score, this._maxScore, this, true, passed);
        this.trigger(ev);
    };

    H5P.BottomExercise.prototype._triggerXAPICompleted = function () {
        var ev = this.createXAPIEvent('completed');
        ev.setScoredResult(1, 1, this, true, true);
        this.trigger(ev);
    };

}(H5P));
