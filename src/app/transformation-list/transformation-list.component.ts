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

import {CdkDragDrop, moveItemInArray} from '@angular/cdk/drag-drop';
import {Component, Directive, EventEmitter, Input, Output} from '@angular/core';
import {AbstractControl, NG_VALIDATORS, Validator, ValidationErrors} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';

import {planQuery, QueryPlan} from '../gql/engine';
import {quoteIdentifier, parseQuery} from '../gql/parser';
import {createTransformation, Transformation} from '../transformation';

@Directive({
    selector: '[gqlQuery]',
    providers: [{
        provide: NG_VALIDATORS,
        useExisting: GqlQueryValidatorDirective,
        multi: true,
    }],
    standalone: true,
})
export class GqlQueryValidatorDirective implements Validator {
    validate(control: AbstractControl): ValidationErrors | null {
        if (!control.value) {
            return null;
        }
        try {
            planQuery(parseQuery(control.value));
            return null;
        } catch(e: unknown) {
            return {error: e};
        }
    }
}

@Component({
  selector: 'transformation-list',
  templateUrl: './transformation-list.component.html',
  styleUrls: ['./transformation-list.component.scss']
})
export class TransformationListComponent {
    @Input() transformations: Transformation[] = [];
    @Output() transformationsChange = new EventEmitter<Transformation[]>();
    // must be bound to with ngModel to enable validation
    userQuery = '';

    addTransformation(name: string, query: string) {
        this.transformations.push(createTransformation(name, query, true));
        this.transformationsChange.emit(this.transformations);
    }

    removeTransformation(transformation: Transformation) {
        const ix = this.transformations.indexOf(transformation);
        this.transformations.splice(ix, 1);
        this.transformationsChange.emit(this.transformations);
    }

    toggleTransformation(transformation: Transformation, value: boolean) {
        transformation.enabled = value;
        this.transformationsChange.emit(this.transformations);
    }

    transformationMoved(event: CdkDragDrop<unknown>) {
        moveItemInArray(this.transformations, event.previousIndex, event.currentIndex);
        this.transformationsChange.emit(this.transformations);
    }
}
