<?php
defined('MOODLE_INTERNAL') || die();
require_once($CFG->dirroot . '/course/moodleform_mod.php');

class mod_bottomeditor_mod_form extends moodleform_mod {

    public function definition(): void {
        $mform = $this->_form;

        // ── Activity name ─────────────────────────────────────────────────────
        $mform->addElement('text', 'name', get_string('name'), ['size' => 64]);
        $mform->setType('name', PARAM_TEXT);
        $mform->addRule('name', null, 'required', null, 'client');

        $this->standard_intro_elements();

        // ── Exercise content ─────────────────────────────────────────────────
        $mform->addElement('header', 'exercisehdr', get_string('modulename', 'mod_bottomeditor'));

        $mform->addElement('editor', 'prompt_editor', get_string('prompt', 'mod_bottomeditor'),
            ['rows' => 6], ['maxfiles' => 0, 'noclean' => false]);
        $mform->setType('prompt_editor', PARAM_RAW);
        $mform->addHelpButton('prompt_editor', 'prompt', 'mod_bottomeditor');

        $mform->addElement('textarea', 'startercode', get_string('startercode', 'mod_bottomeditor'),
            ['rows' => 8, 'cols' => 70, 'class' => 'bottomeditor-code']);
        $mform->setType('startercode', PARAM_RAW);
        $mform->addHelpButton('startercode', 'startercode', 'mod_bottomeditor');

        $mform->addElement('textarea', 'testcode', get_string('testcode', 'mod_bottomeditor'),
            ['rows' => 6, 'cols' => 70, 'class' => 'bottomeditor-code']);
        $mform->setType('testcode', PARAM_RAW);
        $mform->addHelpButton('testcode', 'testcode', 'mod_bottomeditor');

        $mform->addElement('textarea', 'solutioncode', get_string('solutioncode', 'mod_bottomeditor'),
            ['rows' => 6, 'cols' => 70, 'class' => 'bottomeditor-code']);
        $mform->setType('solutioncode', PARAM_RAW);
        $mform->addHelpButton('solutioncode', 'solutioncode', 'mod_bottomeditor');

        // ── Appearance / behaviour ────────────────────────────────────────────
        $mform->addElement('select', 'layout', get_string('layout', 'mod_bottomeditor'), [
            'console' => get_string('layout_console', 'mod_bottomeditor'),
            'canvas'  => get_string('layout_canvas',  'mod_bottomeditor'),
            'split'   => get_string('layout_split',   'mod_bottomeditor'),
        ]);
        $mform->setDefault('layout', 'console');

        $mform->addElement('advcheckbox', 'enablesolution',
            get_string('enablesolution', 'mod_bottomeditor'));
        $mform->setDefault('enablesolution', 1);
        $mform->addHelpButton('enablesolution', 'enablesolution', 'mod_bottomeditor');

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
