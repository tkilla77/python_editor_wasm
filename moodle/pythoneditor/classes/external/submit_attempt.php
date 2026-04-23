<?php
namespace mod_pythoneditor\external;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->libdir . '/externallib.php');
require_once($CFG->dirroot . '/mod/pythoneditor/lib.php');

use external_api;
use external_function_parameters;
use external_single_structure;
use external_value;
use context_module;

/**
 * External function: record a test-run result and update the gradebook.
 *
 * Called by amd/src/exercise.js whenever <bottom-exercise> fires a
 * 'test-result' event. Score is 0-100 (proportion of assertions passed).
 */
class submit_attempt extends external_api {

    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid'  => new external_value(PARAM_INT,  'Course module ID'),
            'score' => new external_value(PARAM_INT,  'Score 0–100'),
        ]);
    }

    public static function execute(int $cmid, int $score): array {
        global $USER, $DB;

        ['cmid' => $cmid, 'score' => $score] =
            self::validate_parameters(self::execute_parameters(), compact('cmid', 'score'));

        $cm      = get_coursemodule_from_id('pythoneditor', $cmid, 0, false, MUST_EXIST);
        $context = context_module::instance($cm->id);
        self::validate_context($context);
        require_capability('mod/pythoneditor:submit', $context);

        $record = $DB->get_record('pythoneditor', ['id' => $cm->instance], '*', MUST_EXIST);

        $grade = (object)[
            'userid'   => $USER->id,
            'rawgrade' => max(0, min(100, $score)),
        ];
        pythoneditor_grade_item_update($record, [$USER->id => $grade]);

        return ['success' => true];
    }

    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'success' => new external_value(PARAM_BOOL, 'Whether the grade was saved'),
        ]);
    }
}
