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
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
} from '@angular/material/dialog';

import { ID_REGEX } from '../models';
import { MatButton } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { CdkScrollable } from '@angular/cdk/scrolling';

export interface CreateNodeDialogInput {
  id: string;
  label?: string;
  classes?: string;
}

export interface CreateNodeDialogOutput {
  id: string;
  label: string;
  classes: string;
}

@Component({
  selector: 'create-node-dialog',
  templateUrl: './create-node-dialog.component.html',
  styleUrls: ['./create-node-dialog.component.scss'],
  standalone: true,
  imports: [
    MatDialogTitle,
    CdkScrollable,
    MatDialogContent,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatDialogActions,
    MatButton,
  ],
})
export class CreateNodeDialogComponent {
  readonly idPattern = ID_REGEX;

  constructor(
    public dialogRef: MatDialogRef<CreateNodeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CreateNodeDialogInput,
  ) {}

  onCancelClicked() {
    this.dialogRef.close();
  }

  onCreateClicked() {
    const output: CreateNodeDialogOutput = {
      ...this.data,
      label: this.data.label ?? '',
      classes: this.data.classes ?? '',
    };
    this.dialogRef.close(output);
  }
}
