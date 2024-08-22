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

import { ComponentHarness } from '@angular/cdk/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import {
  MatChipInputHarness,
  MatChipHarness,
} from '@angular/material/chips/testing';

export class MultiElementPropertiesComponentHarness extends ComponentHarness {
  static hostSelector = 'multi-element-properties';

  getChips = this.locatorForAll(MatChipHarness);
  input = this.locatorFor(MatChipInputHarness);

  async classes(): Promise<string[]> {
    const chips = await this.getChips();
    const classes = [];
    for (const chip of chips) {
      classes.push(await chip.getText());
    }
    return classes;
  }

  async addClass(cls: string): Promise<void> {
    const input = await this.input();
    await input.setValue(cls);
    await input.blur();
  }

  async removeClass(cls: string): Promise<void> {
    const chips = await this.getChips();
    const classes = [];
    for (const chip of chips) {
      if (cls === (await chip.getText())) {
        await chip.remove();
      }
    }
  }
}
