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
import { MatFormField, MatLabel } from '@angular/material/form-field';
import {
  MatChip,
  MatChipsModule,
  MatChipSet,
  MatChipRemove,
  MatChipEditedEvent,
  MatChipInputEvent,
} from '@angular/material/chips';
import { MatIcon } from '@angular/material/icon';

function intersection<T>(left: Set<T>, right: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const value of left) {
    if (right.has(value)) {
      result.add(value);
    }
  }
  return result;
}

function difference<T>(left: Set<T>, right: Set<T>): Set<T> {
  const result = new Set<T>(left);
  for (const value of right) {
    result.delete(value);
  }
  return result;
}

interface Classes {
  common: string[];
  disjoint: string[];
}

@Component({
  selector: 'multi-element-properties',
  templateUrl: './multi-element-properties.component.html',
  styleUrls: ['./multi-element-properties.component.scss'],
  imports: [
    MatChip,
    MatChipsModule,
    MatChipSet,
    MatChipRemove,
    MatFormField,
    MatIcon,
    MatLabel,
    FormsModule,
  ],
})
export class MultiElementPropertiesComponent {
  readonly separatorKeysCodes = [ENTER, COMMA] as const;
  private oldSelection: cytoscape.Collection | undefined = undefined;
  @Input() selection?: cytoscape.Collection = undefined;
  private oldElements?: ElementDefinition[];
  @Input() elements?: ElementDefinition[];
  @Input() editMode = false;
  @Output() classesAdded = new EventEmitter<string[]>();
  @Output() classesRemoved = new EventEmitter<string[]>();
  @Output() classEdited = new EventEmitter<[string, string]>();

  private _classes: Classes = {
    common: [],
    disjoint: [],
  };
  get classes(): Classes {
    if (this.elements !== this.oldElements) {
      this._classes = (() => {
        const elements = this.elements;
        if (!elements?.length) {
          return {
            common: [],
            disjoint: [],
          };
        }
        let common = new Set<string>(elements[0].classes);
        let union = new Set<string>(elements[0].classes);
        for (const element of elements) {
          common = intersection(common, new Set<string>(element.classes));
          for (const cls of element.classes ?? []) {
            union.add(cls);
          }
        }
        return {
          common: [...common].map((c) => c.replace(/^user_data_/, '')),
          disjoint: [...difference(union, common)].map((c) =>
            c.replace(/^user_data_/, ''),
          ),
        };
      })();
      this.oldElements = this.elements;
    }
    return this._classes;
  }

  editClass(cls: string, e: MatChipEditedEvent) {
    const newCls = e.value.trim();
    if (newCls) {
      this.classEdited.emit([cls, e.value]);
    } else {
      this.classesRemoved.emit([cls]);
    }
  }

  removeClass(cls: string) {
    this.classesRemoved.emit([cls]);
  }

  addClass(e: MatChipInputEvent) {
    const cls = e.value.trim();
    e.chipInput!.clear();
    if (!cls) {
      return;
    }
    this.classesAdded.emit([cls]);
  }
}
