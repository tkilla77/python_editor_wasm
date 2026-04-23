<?php
// Student view for mod_bottomeditor.
// Renders <bottom-exercise> inline (no iframe) and wires grade submission
// via the mod_bottomeditor/exercise AMD module.

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/bottomeditor/lib.php');

$id = required_param('id', PARAM_INT); // course module id

$cm      = get_coursemodule_from_id('bottomeditor', $id, 0, false, MUST_EXIST);
$course  = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$record  = $DB->get_record('bottomeditor', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/bottomeditor:view', $context);

$PAGE->set_url('/mod/bottomeditor/view.php', ['id' => $id]);
$PAGE->set_title(format_string($record->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);

// Trigger course_module_viewed event and update completion state.
$event = \mod_bottomeditor\event\course_module_viewed::create([
    'objectid' => $record->id,
    'context'  => $context,
]);
$event->add_record_snapshot('course', $course);
$event->add_record_snapshot('bottomeditor', $record);
$event->trigger();

$completion = new completion_info($course);
$completion->set_module_viewed($cm);

// ── AMD module for grade submission ───────────────────────────────────────────
// Only wire grading if the student has the submit capability (not teachers).
if (has_capability('mod/bottomeditor:submit', $context)) {
    $PAGE->requires->js_call_amd('mod_bottomeditor/exercise', 'init', [$cm->id]);
}

// ── Script tag for the web component (ES module from CDN) ─────────────────────
$baseurl = get_config('mod_bottomeditor', 'scriptbaseurl') ?: 'https://bottom.ch/editor/stable';
$scripturl = rtrim($baseurl, '/') . '/bottom-exercise.js';

echo $OUTPUT->header();

// Inline <script type="module"> — $PAGE->requires->js() does not support modules.
echo html_writer::tag('script', '', [
    'type' => 'module',
    'src'  => $scripturl,
]);

// ── Exercise element ─────────────────────────────────────────────────────────
$attrs = ['showclear', 'norevert', 'resetmode'];
if ($record->layout !== 'console') {
    $attrs[] = 'layout="' . s($record->layout) . '"';
}
if (!$record->enablesolution) {
    $attrs[] = 'hidesolution';
}

echo '<bottom-exercise ' . implode(' ', $attrs) . '>';

if (!empty($record->prompt)) {
    echo '<div slot="prompt">';
    echo format_text($record->prompt, $record->promptformat, ['context' => $context]);
    echo '</div>';
}

foreach (['startercode' => 'starter', 'testcode' => 'test', 'solutioncode' => 'solution'] as $field => $type) {
    if (!empty($record->$field) && !($type === 'solution' && !$record->enablesolution)) {
        echo '<template data-type="' . $type . '">';
        echo s($record->$field);
        echo '</template>';
    }
}

echo '</bottom-exercise>';

echo $OUTPUT->footer();
