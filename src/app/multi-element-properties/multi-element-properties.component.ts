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

import * as cytoscape from 'cytoscape';
import { CLASS_LIST_REGEX } from '../models';
import { parseClasses } from '../util';
import { MatButton } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel } from '@angular/material/form-field';

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
  standalone: true,
  imports: [MatFormField, MatLabel, MatInput, FormsModule, MatButton],
})
export class MultiElementPropertiesComponent {
  readonly classesPattern = CLASS_LIST_REGEX;
  private oldSelection: cytoscape.Collection | undefined = undefined;
  @Input() selection?: cytoscape.Collection = undefined;
  @Input() editMode = false;
  @Output() classesAdded = new EventEmitter<string[]>();
  @Output() classesRemoved = new EventEmitter<string[]>();
  classesInput = '';

  private _classes: Classes = {
    common: [],
    disjoint: [],
  };
  get classes(): Classes {
    if (this.selection !== this.oldSelection) {
      this._classes = (() => {
        const selection = this.selection;
        if (!selection || selection.empty()) {
          return {
            common: [],
            disjoint: [],
          };
        }
        let common = new Set<string>(selection[0].classes());
        let union = new Set<string>(selection[0].classes());
        for (const element of selection) {
          common = intersection(common, new Set<string>(element.classes()));
          for (const cls of element.classes()) {
            union.add(cls);
          }
        }
        return {
          common: [...common],
          disjoint: [...difference(union, common)],
        };
      })();
    }
    return this._classes;
  }

  removeClasses() {
    this.classesRemoved.emit(parseClasses(this.classesInput));
  }

  addClasses() {
    this.classesAdded.emit(parseClasses(this.classesInput));
  }
}
