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

import cytoscape from 'cytoscape';
import { AppComponent } from './app.component';

export class CytoscapeHarness {
    constructor(private app: AppComponent) {}

    private get cy(): cytoscape.Core {
        const cy = this.app.cyForTest;
        if (!cy) {
            throw new Error('cytoscape not initialized');
        }
        return cy;
    }

    getNode(id: string): NodeHarness {
        const collection = this.cy.$id(id);
        if (collection.length === 0) {
            throw new Error(`Node ${id} not found`);
        }
        return new NodeHarness(collection);
    }
}

export class NodeHarness {
    constructor(private node: cytoscape.CollectionReturnValue) {}

    rightClick(): void {
        this.node.emit('cxttap');
    }
}
