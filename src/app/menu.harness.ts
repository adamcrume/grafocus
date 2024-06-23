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

export class MenuHarness extends ComponentHarness {
    static hostSelector = '.cy-context-menus-cxt-menu';

    async isVisible(): Promise<boolean> {
        const host = await this.host();
        const display = await host.getCssValue('display');
        return display !== 'none';
    }

    async isItemVisible(id: string): Promise<boolean> {
        const item = await (this.locatorFor('#' + id))();
        const display = await item.getCssValue('display');
        return display !== 'none';
    }
}
