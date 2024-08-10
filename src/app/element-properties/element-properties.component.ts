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

import { CLASS_LIST_REGEX, ElementDefinition } from '../models';
import { parseClasses } from '../util';
import { FormsModule } from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel } from '@angular/material/form-field';

@Component({
  selector: 'element-properties',
  templateUrl: './element-properties.component.html',
  styleUrls: ['./element-properties.component.scss'],
  standalone: true,
  imports: [MatFormField, MatLabel, MatInput, FormsModule],
})
export class ElementPropertiesComponent {
  readonly classesPattern = CLASS_LIST_REGEX;
  @Input() set element(value: ElementDefinition) {
    this.id = value.data.id;
    this.label = value.data['label'] ?? '';
    this.classes = value.classes ?? [];
    this.description = value.data['description'] ?? '';
  }
  @Input() editMode = false;
  @Output() classesChange = new EventEmitter<string[]>();
  @Output() labelChange = new EventEmitter<string>();
  @Output() descriptionChange = new EventEmitter<string>();
  id = '';
  classes: string[] = [];
  label = '';
  description = '';

  onClassesChanged(classes: string) {
    this.classes = parseClasses(classes);
    this.classesChange.emit(this.classes);
  }
}
