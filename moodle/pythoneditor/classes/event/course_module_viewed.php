<?php
namespace mod_pythoneditor\event;

class course_module_viewed extends \core\event\course_module_viewed {
    protected function init(): void {
        $this->data['objecttable'] = 'pythoneditor';
        parent::init();
    }
}
