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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { TransformationListComponent } from './transformation-list.component';

describe('TransformationListComponent', () => {
  let component: TransformationListComponent;
  let fixture: ComponentFixture<TransformationListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [
        FormsModule,
        MatChipsModule,
        MatIconModule,
        MatInputModule,
        NoopAnimationsModule,
        TransformationListComponent,
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(TransformationListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
