/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CLASS_LIST_REGEX } from '../models';
import { parseClasses } from '../util';

@Component({
  selector: 'element-properties',
  templateUrl: './element-properties.component.html',
  styleUrls: ['./element-properties.component.scss']
})
export class ElementPropertiesComponent {
    readonly classesPattern = CLASS_LIST_REGEX;
    private _element?: cytoscape.SingularElementReturnValue = undefined;
    @Input() set element(value: cytoscape.SingularElementReturnValue) {
        this._element = value;
        this.id = this._element.id();
        this.label = this._element.data('label') ?? '';
        const classes = this._element.classes();
        if (typeof classes === 'string') {
            this.classes = (classes as string).split(',').filter(c => c.startsWith('user_data_')).map(c => c.substring('user_data_'.length)).join(',');
        } else if (classes instanceof Array) {
            this.classes = classes.filter(c => c.startsWith('user_data_')).map(c => c.substring('user_data_'.length)).join(',');
        } else if (typeof classes === 'undefined') {
            this.classes = '';
        } else {
            throw new Error(`Unrecognized type of element.classes(): ${typeof classes}`);
        }
        this.description = this._element.data('description') ?? '';
    }
    @Input() editMode = false;
    @Output() classesChange = new EventEmitter<string[]>();
    @Output() labelChange = new EventEmitter<string>();
    @Output() descriptionChange = new EventEmitter<string>();
    id = '';
    classes = '';
    label = '';
    description = '';

    onClassesChanged() {
        this.classesChange.emit(parseClasses(this.classes));
    }
}
