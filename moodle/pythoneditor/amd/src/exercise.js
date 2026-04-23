// AMD module: wire <bottom-exercise> test-result events to Moodle gradebook.
// Loaded by view.php via $PAGE->requires->js_call_amd('mod_pythoneditor/exercise', 'init', [cmid]).

import Ajax from 'core/ajax';
import Notification from 'core/notification';

/**
 * @param {number} cmid - Course module ID passed from view.php.
 */
export const init = (cmid) => {
    const exercise = document.querySelector('bottom-exercise');
    if (!exercise) return;

    exercise.addEventListener('test-result', (e) => {
        const report = e.detail;

        // Derive a proportional score from individual assertion results.
        // If all tests pass: 100. Partial credit: proportion of passing assertions.
        let score;
        if (report.passed) {
            score = 100;
        } else if (report.results?.length) {
            const passed = report.results.filter(r => r.passed).length;
            score = Math.round(passed / report.results.length * 100);
        } else {
            score = 0;
        }

        Ajax.call([{
            methodname: 'mod_pythoneditor_submit_attempt',
            args:       { cmid, score },
            fail:       Notification.exception,
        }]);
    });
};
