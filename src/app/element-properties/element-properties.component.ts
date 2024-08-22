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

import { ElementDefinition } from '../models';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { FormsModule } from '@angular/forms';
import {
  MatChip,
  MatChipsModule,
  MatChipSet,
  MatChipRemove,
  MatChipEditedEvent,
  MatChipInputEvent,
} from '@angular/material/chips';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel } from '@angular/material/form-field';

@Component({
  selector: 'element-properties',
  templateUrl: './element-properties.component.html',
  styleUrls: ['./element-properties.component.scss'],
  standalone: true,
  imports: [
    MatChip,
    MatChipsModule,
    MatChipSet,
    MatChipRemove,
    MatFormField,
    MatIcon,
    MatLabel,
    MatInput,
    FormsModule,
  ],
})
export class ElementPropertiesComponent {
  readonly separatorKeysCodes = [ENTER, COMMA] as const;
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

  removeClass(cls: string) {
    this.classes = this.classes.filter((c) => c !== cls);
    this.classesChange.emit(this.classes);
  }

  editClass(cls: string, e: MatChipEditedEvent) {
    const newCls = e.value.trim();
    if (newCls && !this.classes.includes(newCls)) {
      this.classes = this.classes.map((c) => (c === cls ? e.value : c));
    } else {
      this.classes = this.classes.filter((c) => c !== cls);
    }
    this.classesChange.emit(this.classes);
  }

  addClass(e: MatChipInputEvent) {
    const cls = e.value.trim();
    e.chipInput!.clear();
    if (!cls || this.classes.includes(cls)) {
      return;
    }
    this.classes.push(cls);
    this.classesChange.emit(this.classes);
  }
}
