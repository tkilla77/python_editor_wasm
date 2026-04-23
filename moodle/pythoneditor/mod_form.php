<?php
defined('MOODLE_INTERNAL') || die();
require_once($CFG->dirroot . '/course/moodleform_mod.php');

class mod_pythoneditor_mod_form extends moodleform_mod {

    public function definition(): void {
        $mform = $this->_form;

        // ── Activity name ─────────────────────────────────────────────────────
        $mform->addElement('text', 'name', get_string('activityname', 'moodle'), ['size' => 64]);
        $mform->setType('name', PARAM_TEXT);
        $mform->addRule('name', null, 'required', null, 'client');

        $this->standard_intro_elements();

        // ── Exercise content ─────────────────────────────────────────────────
        $mform->addElement('header', 'exercisehdr', get_string('modulename', 'mod_pythoneditor'));

        $mform->addElement('editor', 'prompt_editor', get_string('prompt', 'mod_pythoneditor'),
            ['rows' => 6], ['maxfiles' => 0, 'noclean' => false]);
        $mform->setType('prompt_editor', PARAM_RAW);
        $mform->addHelpButton('prompt_editor', 'prompt', 'mod_pythoneditor');

        $mform->addElement('textarea', 'startercode', get_string('startercode', 'mod_pythoneditor'),
            ['rows' => 8, 'cols' => 70, 'class' => 'pythoneditor-code']);
        $mform->setType('startercode', PARAM_RAW);
        $mform->addHelpButton('startercode', 'startercode', 'mod_pythoneditor');

        $mform->addElement('textarea', 'testcode', get_string('testcode', 'mod_pythoneditor'),
            ['rows' => 6, 'cols' => 70, 'class' => 'pythoneditor-code']);
        $mform->setType('testcode', PARAM_RAW);
        $mform->addHelpButton('testcode', 'testcode', 'mod_pythoneditor');

        $mform->addElement('textarea', 'solutioncode', get_string('solutioncode', 'mod_pythoneditor'),
            ['rows' => 6, 'cols' => 70, 'class' => 'pythoneditor-code']);
        $mform->setType('solutioncode', PARAM_RAW);
        $mform->addHelpButton('solutioncode', 'solutioncode', 'mod_pythoneditor');

        // ── Appearance / behaviour ────────────────────────────────────────────
        $mform->addElement('select', 'layout', get_string('layout', 'mod_pythoneditor'), [
            'console' => get_string('layout_console', 'mod_pythoneditor'),
            'canvas'  => get_string('layout_canvas',  'mod_pythoneditor'),
            'split'   => get_string('layout_split',   'mod_pythoneditor'),
        ]);
        $mform->setDefault('layout', 'console');

        $mform->addElement('advcheckbox', 'enablesolution',
            get_string('enablesolution', 'mod_pythoneditor'));
        $mform->setDefault('enablesolution', 1);
        $mform->addHelpButton('enablesolution', 'enablesolution', 'mod_pythoneditor');

        // ── Standard grading / completion elements ────────────────────────────
        $this->standard_grading_coursemodule_elements();
        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    // Map the editor element back to plain fields on save.
    public function data_postprocessing($data): void {
        parent::data_postprocessing($data);
        if (isset($data->prompt_editor)) {
            $data->prompt       = $data->prompt_editor['text'];
            $data->promptformat = $data->prompt_editor['format'];
        }
    }

    // Pre-populate the editor element when editing an existing instance.
    public function set_data($defaultvalues): void {
        if (!empty($defaultvalues->prompt)) {
            $defaultvalues->prompt_editor = [
                'text'   => $defaultvalues->prompt,
                'format' => $defaultvalues->promptformat ?? FORMAT_HTML,
            ];
        }
        parent::set_data($defaultvalues);
    }
}
