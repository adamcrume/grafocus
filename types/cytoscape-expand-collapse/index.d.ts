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

// Repository: https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse

import cytoscape = require('cytoscape');

declare const cytoscapeExpandCollapse: cytoscape.Ext;

export = cytoscapeExpandCollapse;
export as namespace cytoscapeExpandCollapse;

declare namespace cytoscapeExpandCollapse {
    interface Options {
        layoutBy?: any, // TODO: stop using any
        undoable?: boolean,
        animationDuration?: number,
        groupEdgesOfSameTypeOnCollapse?: boolean,
    }

    interface Api {
        expand(nodes: cytoscape.NodeCollection, options: Options): unknown;
        collapse(nodes: cytoscape.NodeCollection, options: Options): unknown;
        expandRecursively(nodes: cytoscape.NodeCollection, options: Options): unknown;
        collapseRecursively(nodes: cytoscape.NodeCollection, options: Options): unknown;
        expandAll(options: Options): unknown;
        collapseAll(options: Options): unknown;
        getParent(nodeId: string): cytoscape.NodeCollection;
        isExpandable(node: cytoscape.NodeCollection): boolean;
        isCollapsible(node: cytoscape.NodeCollection): boolean;
    }
}

declare module 'cytoscape' {
    interface Core {
        expandCollapse(options: cytoscapeExpandCollapse.Options): cytoscapeExpandCollapse.Api;
    }
}
