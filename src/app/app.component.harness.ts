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

import { MenuHarness } from './menu.harness';

export class AppComponentHarness extends ComponentHarness {
    static hostSelector = 'app-root';

    getMenu = this.locatorFor(MenuHarness);

    getSidePanelMenuButton = this.locatorFor('.sidenav-toggle');

    getGraphDefinitionHeader = this.locatorFor('.graph-definition mat-expansion-panel-header');

    getEditModeToggle = this.locatorFor(MatSlideToggleHarness.with({selector: '.edit-mode'}));

    async toggleSideNav(): Promise<void> {
        const button = await this.getSidePanelMenuButton();
        await button.click();
    }

    async toggleGraphDefinition(): Promise<void> {
        const header = await this.getGraphDefinitionHeader();
        await header.click();
    }

    async setEditMode(value: boolean): Promise<void> {
        const button = await this.getEditModeToggle();
        if (value) {
            await button.check();
        } else {
            await button.uncheck();
        }
    }
}
