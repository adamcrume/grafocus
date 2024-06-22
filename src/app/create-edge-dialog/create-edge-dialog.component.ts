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

import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { ID_REGEX } from '../models';

export interface CreateEdgeDialogInput {
    id: string,
    sourceID: string,
    targetID: string,
    label?: string,
    classes?: string,
}

export interface CreateEdgeDialogOutput {
    id: string,
    label: string,
    classes: string,
}

@Component({
  selector: 'create-edge-dialog',
  templateUrl: './create-edge-dialog.component.html',
  styleUrls: ['./create-edge-dialog.component.scss']
})
export class CreateEdgeDialogComponent {
    readonly idPattern = ID_REGEX;

    constructor(
        public dialogRef: MatDialogRef<CreateEdgeDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: CreateEdgeDialogInput,
    ) {}

    onCancelClicked() {
        this.dialogRef.close();
    }

    onCreateClicked() {
        const output: CreateEdgeDialogOutput = {
            ...this.data,
            label: this.data.label ?? '',
            classes: this.data.classes ?? '',
        };
        this.dialogRef.close(output);
    }
}
