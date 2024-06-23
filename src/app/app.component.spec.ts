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
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppComponent } from './app.component';
import { AppComponentHarness } from './app.component.harness';
import { CytoscapeHarness } from './cytoscape.harness';
import { TransformationListComponent } from './transformation-list/transformation-list.component';

let originalRequestAnimationFrame: (callback: FrameRequestCallback) => number;

describe('AppComponent', () => {
    beforeEach(async () => {
        originalRequestAnimationFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => {
            return 0;
        };

    await TestBed.configureTestingModule({
      declarations: [
        AppComponent,
        TransformationListComponent,
      ],
      imports: [
        FormsModule,
        MatButtonModule,
        MatChipsModule,
        MatDialogModule,
        MatExpansionModule,
        MatIconModule,
        MatInputModule,
        MatSelectModule,
        MatSidenavModule,
        MatSlideToggleModule,
        MatToolbarModule,
        MatTooltipModule,
        NoopAnimationsModule,
      ],
    }).compileComponents();
    });

    afterEach(() => {
        window.requestAnimationFrame = originalRequestAnimationFrame;
    });

    // Note that cytoscape doesn't work inside fakeAsync.
  it('should create the app', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
    fixture.detectChanges();
  });

    it('can collapse nodes', async () => {
        const fixture = TestBed.createComponent(AppComponent);
        fixture.detectChanges();
        const app = fixture.componentInstance;
        expect(() => {
            app.collapse('#website_network');
        }).not.toThrow();
    });

    it('menu respects edit mode', async () => {
        const fixture = TestBed.createComponent(AppComponent);
        const harness =
            await TestbedHarnessEnvironment.harnessForFixture(fixture, AppComponentHarness);
        const cy = new CytoscapeHarness(fixture.componentInstance);
        const menu = await harness.getMenu();

        cy.getNode('client_1').rightClick();
        expect(await menu.isVisible()).toBeTrue();
        expect(await menu.isItemVisible('add-edge')).toBeFalse();
        await harness.toggleSideNav();
        await harness.toggleGraphDefinition();
        await harness.setEditMode(true);
        cy.getNode('client_1').rightClick();
        expect(await menu.isVisible()).toBeTrue();
        expect(await menu.isItemVisible('add-edge')).toBeTrue();
    });
});
