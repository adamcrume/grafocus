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

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  MatChip,
  MatChipsModule,
  MatChipSet,
  MatChipRemove,
} from '@angular/material/chips';

import { ElementPropertiesComponent } from './element-properties.component';
import { ElementPropertiesComponentHarness } from './element-properties.component.harness';

describe('ElementPropertiesComponent', () => {
  let component: ElementPropertiesComponent;
  let fixture: ComponentFixture<ElementPropertiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FormsModule,
        MatChip,
        MatChipsModule,
        MatChipSet,
        MatChipRemove,
        MatFormFieldModule,
        MatInputModule,
        NoopAnimationsModule,
        ElementPropertiesComponent,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ElementPropertiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('displays class chips', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ElementPropertiesComponentHarness,
    );
    component.element = {
      data: { id: 'x' },
      classes: ['foo', 'bar', 'baz'],
    };
    fixture.detectChanges();

    expect(await harness.classes()).toEqual(['foo', 'bar', 'baz']);
  });

  it('adds a class', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ElementPropertiesComponentHarness,
    );
    const changes: string[][] = [];
    component.classesChange.subscribe((ch) => changes.push(ch));
    component.editMode = true;
    component.element = {
      data: { id: 'x' },
      classes: ['foo', 'bar'],
    };
    fixture.detectChanges();
    await harness.addClass('baz');

    expect(await harness.classes()).toEqual(['foo', 'bar', 'baz']);
    expect(changes).toEqual([['foo', 'bar', 'baz']]);
  });

  it('removes a class', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ElementPropertiesComponentHarness,
    );
    const changes: string[][] = [];
    component.classesChange.subscribe((ch) => changes.push(ch));
    component.editMode = true;
    component.element = {
      data: { id: 'x' },
      classes: ['foo', 'bar', 'baz'],
    };
    fixture.detectChanges();
    await harness.removeClass('bar');

    expect(await harness.classes()).toEqual(['foo', 'baz']);
    expect(changes).toEqual([['foo', 'baz']]);
  });
});
