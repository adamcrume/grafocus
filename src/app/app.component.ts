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

import {CdkDragDrop, moveItemInArray} from '@angular/cdk/drag-drop';
import {Component, ElementRef, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';

import cytoscape from 'cytoscape';
import context_menus from 'cytoscape-context-menus';
import expand_collapse from 'cytoscape-expand-collapse';
import fcose from 'cytoscape-fcose';
import Immutable from 'immutable';
import JSON5 from 'json5';
import {unionFind, UnionFind} from './union-find';
import {parseClasses} from './util';
import {CreateEdgeDialogComponent, CreateEdgeDialogInput, CreateEdgeDialogOutput} from './create-edge-dialog/create-edge-dialog.component';
import {CreateNodeDialogComponent, CreateNodeDialogInput, CreateNodeDialogOutput} from './create-node-dialog/create-node-dialog.component';
import {HelpDialogComponent} from './help-dialog/help-dialog.component';
import {MessageDialogComponent, MessageDialogInput} from './message-dialog/message-dialog.component';
import {ElementDefinition, SavedData, Stylesheet, validateSavedData} from './models';
import {quoteIdentifier} from './gql/formatter';
import {Graph, Node, Edge, SerializedGraph} from './gql/graph';
import {ListType, NUMBER} from './gql/types';
import {checkCastString, deserializeValue, isList, isNumber, numberList, primitiveValue, serializeValue, stringValue, tryCastNumber, valueType, Value} from './gql/values';
import {createTransformation, Transformation} from './transformation';

const PARENT_LABEL = '_PARENT';
const ALIGN_VERTICAL_LABEL = '_ALIGN_VERTICAL';
const ALIGN_HORIZONTAL_LABEL = '_ALIGN_HORIZONTAL';
const PLACE_RIGHT_OF_LABEL = '_PLACE_RIGHT_OF';
const PLACE_BELOW_LABEL = '_PLACE_BELOW';
const GAP_PROPERTY = 'gap';

const EDIT_MENUS = [
    'create-node',
    'add-edge',
    'set-parent',
    'remove',
];

function svgUrl(svgContent: string) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgContent);
}

function classArray(classes: string|string[]|undefined): string[] {
    if (!classes) {
        return [];
    } else if (typeof classes === 'object') {
        return classes;
    } else {
        return parseClasses(classes);
    }
}

function add(existing: string|string[]|undefined, toAdd: string[]): string[] {
    const existingReally = classArray(existing);
    const existingSet = new Set<string>(existingReally);
    const added = [];
    for (const value of toAdd) {
        if (!existingSet.has(value)) {
            added.push(value);
        }
    }
    return [...existingReally, ...added];
}

function remove(existing: string|string[]|undefined, toRemove: string[]): string[] {
    const removeSet = new Set<string>(toRemove);
    return classArray(existing).filter(c => !removeSet.has(c));
}

function checkCastPosition(value: Value): cytoscape.Position;
function checkCastPosition(value: Value|undefined): cytoscape.Position|undefined;
function checkCastPosition(value: Value|undefined): cytoscape.Position|undefined {
    if (!value) {
        return undefined;
    }
    if (isList(value) && value.value.length === 2 && isNumber(value.value[0]) && isNumber(value.value[1])) {
        return {x: value.value[0].value, y: value.value[1].value};
    }
    throw new Error(`Invalid position type: ${JSON.stringify(valueType(value))}`);
}

function parentOf(graph: Graph<Value>, node: Node<Value>): Node<Value>|undefined {
    for (const [edge, dst] of graph.outgoingNeighbors(node)) {
        if (edge.labels.has(PARENT_LABEL)) {
            return dst;
        }
    }
    return undefined;
}

function isSpecialEdge(edge: Edge<Value>): boolean {
    for (const label of edge.labels) {
        if (label.startsWith('_')) {
            return true;
        }
    }
    return false;
}

function toGraph(elements: ElementDefinition[]): Graph<Value> {
    return Graph.new<Value>().withMutations(m => {
        for (const element of elements) {
            if (element.data.source) {
                continue;
            }
            m.createNode(
                element.data.id,
                (element.classes ?? []).map(c => `user_data_${c}`),
                Object.entries(element.data).map(([k, v]) => [k, primitiveValue(v)]),
            );
        }
        for (const element of elements) {
            if (element.data.source) {
                m.createEdge(
                    element.data.id,
                    element.data.source,
                    element.data.target,
                    (element.classes ?? []).map(c => `user_data_${c}`),
                    Object.entries(element.data).map(([k, v]) => [k, primitiveValue(v)]),
                );
            } else if (element.data.parent) {
                m.createEdge(`__parent__${element.data.id}`, element.data.id, element.data.parent, [PARENT_LABEL]);
            }
        }
    });
}

function propertiesToData(properties: Immutable.Map<string, Value>): cytoscape.NodeDataDefinition|cytoscape.EdgeDataDefinition {
    const data: cytoscape.NodeDataDefinition|cytoscape.EdgeDataDefinition = {};
    for (const [k, v] of properties) {
        data[k] = serializeValue(v);
    }
    return data;
}

function nodeToElement(graph: Graph<Value>, node: Node<Value>): cytoscape.ElementDefinition {
    const attributes = propertiesToData(node.properties);
    return {
        data: {
            id: node.id,
            parent: parentOf(graph, node)?.id,
            label: attributes['label'],
            user_data: attributes,
        },
        classes: [...node.labels].map(c => `user_data_${c}`),
        position: checkCastPosition(node.properties.get('position')),
    };
}

function edgeToElement(edge: Edge<Value>): cytoscape.ElementDefinition {
    const attributes = propertiesToData(edge.properties);
    return {
        data: {
            id: edge.id,
            source: edge.srcID,
            target: edge.dstID,
            label: attributes['label'],
            user_data: attributes,
        },
        classes: [...edge.labels].map(c => `user_data_${c}`),
    };
}

function toElements(graph: Graph<Value>): cytoscape.ElementDefinition[] {
    const elements: cytoscape.ElementDefinition[] = [];
    for (const n of graph.nodes) {
        elements.push(nodeToElement(graph, n));
    }
    for (const e of graph.edges) {
        if (!isSpecialEdge(e)) {
            elements.push(edgeToElement(e));
        }
    }
    return elements;
}

function syncClasses(elt: cytoscape.CollectionReturnValue, classes: Immutable.Set<string>) {
    const oldClasses = new Set(elt.classes()
        .filter(c => c.startsWith('user_data_')));
    const newClasses = new Set([...classes].map(c => `user_data_${c}`));
    for (const c of oldClasses) {
        if (!newClasses.has(c)) {
            elt.removeClass(c);
        }
    }
    for (const c of newClasses) {
        if (!oldClasses.has(c)) {
            elt.addClass(c);
        }
    }
}

class MenuUpdater {
    private addedMenus: string[] = []

    constructor(
        private menus: contextMenus.ContextMenu,
        private parent: string,
        private onClick: (cls: string) => void
    ) {}

    updateMenus(event: cytoscape.EventObject) {
        for (let added of this.addedMenus) {
            this.menus.removeMenuItem(added);
        }
        this.addedMenus = [];
        for (let cls of event.target.classes()) {
            if (!cls.startsWith('user_data_')) {
                continue;
            }
            cls = cls.substring('user_data_'.length);
            const id = `${this.parent}-${cls}`;
            const addedItem = this.menus.appendMenuItem({
                id,
                selector: 'node, edge',
                content: cls,
                onClickFunction: () => {
                    this.onClick(cls);
                },
            }, this.parent);
            this.addedMenus.push(id);
        }
        if (this.addedMenus.length > 0) {
            this.menus.enableMenuItem(this.parent);
        } else {
            this.menus.disableMenuItem(this.parent);
        }
    }
}

function updateMenuVisibility(menus: contextMenus.ContextMenu, editMode: boolean): void {
    if (editMode) {
        for (let menu of EDIT_MENUS) {
            menus.showMenuItem(menu);
        }
    } else {
        for (let menu of EDIT_MENUS) {
            menus.hideMenuItem(menu);
        }
    }
}

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
    @ViewChild('graph', {static: true}) graph!: ElementRef<HTMLElement>;
    customData = '';
    transformations: Transformation[] = [];
    private cachedClasses: string[]|undefined = undefined;
    private expandCollapseApi: expand_collapse.Api|undefined = undefined;
    private cy: cytoscape.Core|undefined;
    get cyForTest(): cytoscape.Core|undefined {
        return this.cy;
    }
    private data: {
        title?: string,
        description?: string,
    } = {
        title: 'Sample graph',
        description: 'This graph is a basic demonstration of what the app can do.\n\n' +
            'Enable edit mode (under "Graph definition") to edit me.',
    };
    private serializedGraph: SerializedGraph = {
        nodes: [],
        edges: [],
    };
    private originalGraph = Graph.deserialize<Value>(this.serializedGraph, deserializeValue);
    private transformedGraph: Graph<Value>;
    private style: Stylesheet[] = [];
    selected: cytoscape.SingularElementReturnValue|undefined = undefined;
    selection: cytoscape.CollectionReturnValue|undefined = undefined;
    multipleSelected = false;
    private savedPositions = new Map<string, cytoscape.Position>();
    get title(): string {
        return this.cy?.data('title') ?? '';
    }
    get description(): string {
        return this.cy?.data('description') ?? '';
    }

    private menus: contextMenus.ContextMenu|undefined = undefined;
    private _editMode = false;
    get editMode(): boolean {
        return this._editMode;
    }
    set editMode(value: boolean) {
        this._editMode = value;
        if (this.menus) {
            updateMenuVisibility(this.menus, value);
        }
    }

    constructor(private dialog: MatDialog) {
        this.transformedGraph = this.transform(this.originalGraph);
        const dataSource = new URL(location.toString()).searchParams.get('graphUrl') || 'assets/example.json5';
        this.reloadFromUrl(dataSource);
    }

    ngOnInit() {
        cytoscape.use(context_menus);
        cytoscape.use(expand_collapse);
        cytoscape.use(fcose);
        this.init();
    }

    ngOnDestroy() {
        this.cy?.destroy();
        this.cy = undefined;
    }

    async reloadFromUrl(url: string) {
        try {
            const response = await fetch(url);
            const data = await response.text();
            this.reload(data);
        } catch(e: unknown) {
            let msg = `Error fetching graph definition from ${url}`;
            if (e) {
                msg += ': ' + e.toString();
            }
            this.dialog.open(MessageDialogComponent, {data: {
                title: 'Error',
                message: msg,
            }});
        }
    }

    reload(data: string) {
        let parsed: SavedData;
        try {
            parsed = validateSavedData(JSON5.parse(data));
        } catch(e: unknown) {
            let msg: string;
            if (e) {
                msg = e.toString();
            } else {
                msg = 'Error parsing JSON';
            }
            this.dialog.open(MessageDialogComponent, {data: {
                title: 'Parse Error',
                message: msg,
            }});
            return;
        }
        this.data = parsed.data;
        this.originalGraph = Graph.deserialize(parsed.graph, deserializeValue);
        this.cachedClasses = undefined;
        this.style = parsed.style;
        this.transformations = (parsed.transformations || [])
                                   .map(({name, query}) => createTransformation(name, query));
        this.transformedGraph = this.transform(this.originalGraph);
        this.updateCustomData();
        this.init();
    }

    private init() {
        this.savedPositions.clear();
        const cy = cytoscape({
            data: this.data,
            container: this.graph.nativeElement,
            elements: toElements(this.transformedGraph),
            style: this.style,
            layout: {
                ...this.generateLayout(this.transformedGraph, true),
                name: 'fcose',
            },
        });
        this.cy?.destroy();
        this.cy = cy;
        this.expandCollapseApi = cy.expandCollapse({
            layoutBy: () => {
                this.layout();
            },
            undoable: false, // TODO: should we install this?
            animationDuration: 200,
            groupEdgesOfSameTypeOnCollapse: true,
        });
        // Collapse edges when nodes are collapsed.  What we really want is
        // something like if collapsing a node results in redundant edges, then
        // they should be collapsed (i.e. make it local). We also need the
        // reverse (expand edges on expand). Collapsing edges is even more
        // complex if they have metadata, though.
        // cy.nodes().on("expandcollapse.aftercollapse", event => {
        //     api.collapseAllEdges();
        // });
        const menus = cy.contextMenus({
            menuItems: [
                {
                    id: 'create-node',
                    selector: '#nothing-should-have-this-id',
                    coreAsWell: true,
                    content: 'Create node',
                    onClickFunction: (e: cytoscape.EventObject) => {
                        const position = e.position;
                        const input: CreateNodeDialogInput = {
                            id: this.generateID('node'),
                        };
                        const dialogRef = this.dialog.open(CreateNodeDialogComponent, {data: input});
                        dialogRef.afterClosed().subscribe((result: CreateNodeDialogOutput) => {
                            if (result) {
                                const classes = parseClasses(result.classes);
                                this.cachedClasses = undefined;
                                this.originalGraph = this.originalGraph.createNode(
                                    result.id, classes,
                                    [['label', primitiveValue(result.label)], ['position', numberList([position.x, position.y])]]
                                );
                                this.transformGraph();
                                this.updateCustomData();
                            }
                        });
                    },
                },
                {
                    id: 'expand-class',
                    content: 'Expand all',
                    selector: 'node',
                    // Must be set so we don't get an error about no function and no submenu items.
                    onClickFunction: () => {},
                },
                {
                    id: 'collapse-class',
                    content: 'Collapse all',
                    selector: 'node',
                    // Must be set so we don't get an error about no function and no submenu items.
                    onClickFunction: () => {},
                    hasTrailingDivider: true,
                },
                {
                    id: 'hide-node',
                    content: 'Hide',
                    selector: 'node',
                    onClickFunction: (e: cytoscape.EventObject) => {
                        this.addTransformation(`hide node ${e.target.id()}`, `MATCH (n {_ID: ${JSON.stringify(e.target.id())}}) DELETE n`);
                    },
                },
                {
                    id: 'hide-node-and-descendants',
                    content: 'Hide including descendants',
                    selector: 'node',
                    onClickFunction: (e: cytoscape.EventObject) => {
                        this.addTransformation(`hide node ${e.target.id()} and descendants`, `MATCH ({_ID: ${JSON.stringify(e.target.id())}})<-[:_PARENT]-*(n) DELETE n`);
                    },
                },
                {
                    id: 'hide-edge',
                    content: 'Hide',
                    selector: 'edge',
                    onClickFunction: (e: cytoscape.EventObject) => {
                        this.addTransformation(`hide edge ${e.target.id()}`, `MATCH ()-[e {_ID: ${JSON.stringify(e.target.id())}}]-() DELETE e`);
                    },
                },
                {
                    id: 'hide-node-class',
                    content: 'Hide all nodes',
                    selector: 'node',
                    // Must be set so we don't get an error about no function and no submenu items.
                    onClickFunction: () => {},
                },
                {
                    id: 'hide-edge-class',
                    content: 'Hide all edges',
                    selector: 'edge',
                    // Must be set so we don't get an error about no function and no submenu items.
                    onClickFunction: () => {},
                },
                {
                    id: 'hide-node-class-negated',
                    content: 'Hide all nodes except',
                    selector: 'node',
                    // Must be set so we don't get an error about no function and no submenu items.
                    onClickFunction: () => {},
                },
                {
                    id: 'hide-edge-class-negated',
                    content: 'Hide all edges except',
                    selector: 'edge',
                    // Must be set so we don't get an error about no function and no submenu items.
                    onClickFunction: () => {},
                },
                {
                    id: 'hide-class-simple-node-negated',
                    content: 'Hide all simple nodes except',
                    selector: 'node',
                    // Must be set so we don't get an error about no function and no submenu items.
                    onClickFunction: () => {},
                    hasTrailingDivider: true,
                },
                {
                    id: 'add-edge',
                    content: 'Add edge to...',
                    selector: 'node',
                    onClickFunction: (e: cytoscape.EventObject) => {
                        const sourceID = e.target.id();
                        cy.nodes().once('click', (e2: cytoscape.EventObject) => {
                            const targetID = e2.target.id();
                            const input: CreateEdgeDialogInput = {
                                id: this.generateID(sourceID + '_to_' + targetID),
                                sourceID,
                                targetID,
                            };
                            const dialogRef = this.dialog.open(CreateEdgeDialogComponent, {data: input});
                            dialogRef.afterClosed().subscribe((result: CreateEdgeDialogOutput) => {
                                if (result) {
                                    const classes = parseClasses(result.classes);
                                    this.cachedClasses = undefined;
                                    this.originalGraph = this.originalGraph.createEdge(
                                        result.id,
                                        sourceID,
                                        targetID,
                                        classes,
                                        [['label', primitiveValue(result.label)]]
                                    );
                                    this.transformGraph();
                                    this.updateCustomData();
                                }
                            });
                        });
                    },
                },
                {
                    id: 'set-parent',
                    content: 'Set parent...',
                    selector: 'node',
                    onClickFunction: (e: cytoscape.EventObject) => {
                        const sourceID = e.target.id();
                        cy.nodes().once('click', (e2: cytoscape.EventObject) => {
                            const targetID = e2.target.id();
                            const node = this.originalGraph.getNodeByID(sourceID)!;
                            const parent = this.originalGraph.getNodeByID(targetID)!;
                            let alreadySet = false;
                            for (const [edge, dst] of this.originalGraph.outgoingNeighbors(node)) {
                                if (edge.labels.has(PARENT_LABEL)) {
                                    if (dst === parent) {
                                        alreadySet = true;
                                    } else {
                                        this.originalGraph = this.originalGraph.removeEdge(edge.id);
                                    }
                                }
                            }
                            if (!alreadySet) {
                                this.originalGraph = this.originalGraph.createEdge(`__parent__${sourceID}`, sourceID, targetID, [PARENT_LABEL]);
                            }
                            this.transformGraph();
                            this.updateCustomData();
                        });
                    },
                },
                {
                    id: 'remove',
                    content: 'Remove',
                    selector: 'node,edge',
                    onClickFunction: (e: cytoscape.EventObject) => {
                        this.remove(e.target);
                    },
                },
            ],
            contextMenuClasses: ['context-menu'],
            submenuIndicator: {
                src: svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-right"><polyline points="9 18 15 12 9 6"></polyline></svg>'),
                width: 12,
                height: 12,
            },
        });
        const updaters = [
            new MenuUpdater(menus, 'expand-class', cls => this.expand(`.${cls}`)),
            new MenuUpdater(menus, 'collapse-class', cls => this.collapse(`.${cls}`)),
            new MenuUpdater(menus, 'hide-node-class', cls =>
                this.addTransformation(`hide node class ${cls}`, `MATCH (n:${quoteIdentifier(cls)}) DELETE n`)),
            new MenuUpdater(menus, 'hide-edge-class', cls =>
                this.addTransformation(`hide edge class ${cls}`, `MATCH ()-[e:${quoteIdentifier(cls)}]-() DELETE e`)),
            new MenuUpdater(menus, 'hide-node-class-negated', cls =>
                this.addTransformation(`hide nodes except class ${cls}`, `MATCH (n:!${quoteIdentifier(cls)}) DELETE n`)),
            new MenuUpdater(menus, 'hide-edge-class-negated', cls =>
                this.addTransformation(`hide edges except class ${cls}`, `MATCH ()-[e:!_VIRTUAL&!${quoteIdentifier(cls)}]-() DELETE e`)),
            new MenuUpdater(menus, 'hide-class-simple-node-negated', cls =>
                this.addTransformation(`hide simple nodes except class ${cls}`, `MATCH (n:!${quoteIdentifier(cls)}) WHERE NOT (n)<-[:_PARENT]-() DELETE n`)),
        ];
        this.menus = menus;
        updateMenuVisibility(menus, this.editMode);
        cy.on('cxttap', '*', event => {
            for (let updater of updaters) {
                updater.updateMenus(event);
            }
        });
        cy.on('select', '*', event => {
            this.updateSelectionData();
        });
        cy.on('unselect', '*', event => {
            this.updateSelectionData();
        });
        this.updateSelectionData();
    }

    private updateSelectionData() {
        const selection = this.cy?.$('*:selected');
        this.selection = selection;
        if (selection?.length === 1) {
            this.selected = selection[0];
        } else {
            this.selected = undefined;
        }
        this.multipleSelected = (selection?.length ?? 0) > 1;
    }

    private updateCustomData() {
        this.customData = JSON.stringify({
            data: this.data,
            graph: this.originalGraph.serialize(serializeValue),
            style: this.style,
            transformations: this.transformations.map(t => ({name: t.name, query: t.query})),
        }, null, 2) + '\n';
        try {
            validateSavedData(JSON5.parse(this.customData));
        } catch(e: unknown) {
            let msg: string;
            if (e) {
                msg = e.toString();
            } else {
                msg = 'Error parsing JSON';
            }
            this.dialog.open(MessageDialogComponent, {data: {
                title: 'Internal Error',
                message: 'Generated saved data does not pass validation: ' + msg,
            }});
        }
    }

    private transform(graph: Graph<Value>): Graph<Value> {
        for (const transformation of this.transformations) {
            if (transformation.enabled) {
                graph = transformation.queryPlan.execute(graph).graph;
            }
        }
        return graph;
    }

    // TODO: Instead of recomputing everything, we should push diffs through.
    private transformGraph(): void {
        const oldTransformed = this.transformedGraph;

        this.transformedGraph = this.transform(this.originalGraph);
        if (!this.cy) {
            return;
        }
        for (const node of oldTransformed.nodes) {
            if (!this.transformedGraph.getNodeByID(node.id)) {
                const elt = this.cy.getElementById(node.id);
                if (elt && elt.length) {
                    this.savedPositions.set(node.id, elt.position());
                    for (const child of elt.children()) {
                        child.move({parent: null});
                    }
                }
                this.cy.remove('#' + node.id);
            }
        }
        for (const edge of oldTransformed.edges) {
            if (!this.transformedGraph.getEdgeByID(edge.id)) {
                this.cy.remove('#' + edge.id);
            }
        }
        for (const node of this.transformedGraph.nodes) {
            const oldNode = oldTransformed.getNodeByID(node.id);
            if (oldNode) {
                const elt = this.cy.getElementById(node.id);
                if (elt && elt.length) {
                    const id = elt.data('id');
                    const data = propertiesToData(node.properties);
                    elt.data('user_data', data);
                    elt.data('label', data['label']);
                    syncClasses(elt, node.labels);
                    // explicitly not resetting position on existing nodes
                    elt.move({parent: parentOf(this.transformedGraph, node)?.id || null});
                }
            } else {
                const elt = nodeToElement(this.transformedGraph, node);
                const pos = this.savedPositions.get(node.id);
                const newElt = this.cy.add(elt);
                if (pos) {
                    this.savedPositions.delete(node.id);
                    newElt.position(pos);
                }
            }
        }
        for (const edge of this.transformedGraph.edges) {
            if (edge.labels.has(PARENT_LABEL)) {
                const src = this.cy.getElementById(edge.srcID);
                if (src) {
                    src.move({parent: edge.dstID});
                }
            }
            if (isSpecialEdge(edge)) {
                continue;
            }
            const oldEdge = oldTransformed.getEdgeByID(edge.id);
            if (oldEdge) {
                const elt = this.cy.getElementById(edge.id);
                if (elt && elt.length) {
                    const data = propertiesToData(edge.properties);
                    elt.data('user_data', data);
                    elt.data('label', data['label']);
                    syncClasses(elt, edge.labels);
                }
            } else {
                this.cy.add(edgeToElement(edge));
            }
        }
    }

    private generateID(prefix: string): string {
        const cy = this.cy;
        if (!cy) {
            throw new Error('cy not initialized');
        }
        let id = prefix;
        let count = 0;
        while (!cy.$id(id).empty()) {
            id = prefix + '_' + count;
            count++;
        }
        return id;
    }

    classes(): string[] {
        let classes = this.cachedClasses;
        if (!classes) {
            const set = new Set<string>();
            for (const node of this.originalGraph.nodes) {
                for (const label of node.labels) {
                    set.add(label);
                }
            }
            for (const edge of this.originalGraph.edges) {
                for (const label of edge.labels) {
                    set.add(label);
                }
            }
            classes = [...set].sort();
            this.cachedClasses = classes;
        }
        return classes;
    }

    layout() {
        const opts: fcose.FcoseLayoutOptions = {
            ...this.generateLayout(this.transformedGraph, false),
            name: 'fcose',
            quality: 'proof',
            randomize: false,
        };
        this.cy?.layout(opts).run();
    }

    private uncollapsedAncestor(nodeId: string): cytoscape.NodeCollection|undefined {
        const cy = this.cy;
        if (!cy) {
            return undefined;
        }
        for (let i = 0; i < 100; i++) {
            const node = cy.getElementById(nodeId);
            if (node && node.length) {
                let n: cytoscape.CollectionReturnValue|cytoscape.NodeCollection|undefined = node;
                while (n && n.length) {
                    if (n.style('display') === 'none') {
                        return undefined;
                    }
                    n = this.expandCollapseApi?.getParent(n.data('id'));
                }
                return node;
            }
            nodeId = this.expandCollapseApi?.getParent(nodeId).data('id');
        }
        throw new Error("Infinite loop detected in uncollapsedAncestor");
    }

    private generateLayout(graph: Graph<Value>, initial: boolean): fcose.FcoseLayoutOptions {
        const verticalUF = new UnionFind<string>();
        const horizontalUF = new UnionFind<string>();
        const relativePlacementConstraint: fcose.FcoseRelativePlacementConstraint[] = [];
        for (const edge of graph.edges) {
            if (edge.labels.has(ALIGN_VERTICAL_LABEL)) {
                const src = initial ? edge.srcID : this.uncollapsedAncestor(edge.srcID)?.data('id');
                const dst = initial ? edge.dstID : this.uncollapsedAncestor(edge.dstID)?.data('id');
                if (src && dst && src !== dst) {
                    verticalUF.union(src, dst);
                }
            }
            if (edge.labels.has(ALIGN_HORIZONTAL_LABEL)) {
                const src = initial ? edge.srcID : this.uncollapsedAncestor(edge.srcID)?.data('id');
                const dst = initial ? edge.dstID : this.uncollapsedAncestor(edge.dstID)?.data('id');
                if (src && dst && src !== dst) {
                    horizontalUF.union(src, dst);
                }
            }
            if (edge.labels.has(PLACE_RIGHT_OF_LABEL)) {
                const left = initial ? edge.dstID : this.uncollapsedAncestor(edge.dstID)?.data('id');
                const right = initial ? edge.srcID : this.uncollapsedAncestor(edge.srcID)?.data('id');
                if (left && right && left !== right) {
                    relativePlacementConstraint.push({
                        left,
                        right,
                        gap: tryCastNumber(edge.properties.get(GAP_PROPERTY)),
                    });
                }
            }
            if (edge.labels.has(PLACE_BELOW_LABEL)) {
                const top = initial ? edge.dstID : this.uncollapsedAncestor(edge.dstID)?.data('id');
                const bottom = initial ? edge.srcID : this.uncollapsedAncestor(edge.srcID)?.data('id');
                if (top && bottom && top !== bottom) {
                    relativePlacementConstraint.push({
                        top,
                        bottom,
                        gap: tryCastNumber(edge.properties.get(GAP_PROPERTY)),
                    });
                }
            }
        }
        return {
            name: 'fcose',
            alignmentConstraint: {
                vertical: verticalUF.sets(),
                horizontal: horizontalUF.sets(),
            },
            relativePlacementConstraint,
        };
    }

    expand(selector: string) {
        const cy = this.cy;
        if (cy) {
            this.expandCollapseApi?.expandRecursively(cy.nodes(selector), {});
        }
    }

    collapse(selector: string) {
        const cy = this.cy;
        if (cy) {
            this.expandCollapseApi?.collapseRecursively(cy.nodes(selector), {});
        }
    }

    expandAll() {
        this.expandCollapseApi?.expandAll({});
    }

    collapseAll() {
        this.expandCollapseApi?.collapseAll({});
    }

    private removeIdsFromAlignmentConstraint(constraint: string[][], removed: Set<string>): string[][] {
        return constraint
            .map(c => c.filter(id => !removed.has(id)))
            .filter(c => c.length > 1);
    }

    private remove(element: cytoscape.Singular) {
        const ids = new Set<string>();
        ids.add(element.data('id'));
        if (element.isNode()) {
            this.originalGraph = this.originalGraph.withMutations(m => {
                m.removeNode(element.data('id'));
                element.descendants().forEach(descendant => {
                    const id = descendant.data('id');
                    if (typeof id === 'string') {
                        m.removeNode(id);
                        ids.add(id);
                    }
                });
            });
        } else {
            this.originalGraph = this.originalGraph.removeEdge(element.data('id'));
        }
        this.cachedClasses = undefined;
        this.transformGraph();
        this.updateCustomData();
    }

    onClassesChange(classes: string[]) {
        const selected = this.selected;
        if (selected) {
            if (selected.source().length > 0) {
                this.originalGraph = this.originalGraph.setEdgeLabels(selected.id(), Immutable.Set(classes));
            } else {
                this.originalGraph = this.originalGraph.setNodeLabels(selected.id(), Immutable.Set(classes));
            }
        }
        this.transformGraph();
        this.updateCustomData();
    }

    onLabelChange(label: string) {
        const selected = this.selected;
        if (selected) {
            if (selected.source().length > 0) {
                const edge = this.originalGraph.getEdgeByID(selected.id());
                if (edge) {
                    this.originalGraph = this.originalGraph.setEdgeProperties(edge.id, edge.properties.set('label', stringValue(label)));
                }
            } else {
                const node = this.originalGraph.getNodeByID(selected.id());
                if (node) {
                    this.originalGraph = this.originalGraph.setNodeProperties(node.id, node.properties.set('label', stringValue(label)));
                }
            }
        }
        this.transformGraph();
        this.updateCustomData();
    }

    onDescriptionChange(description: string) {
        const selected = this.selected;
        if (selected) {
            if (selected.source().length > 0) {
                const edge = this.originalGraph.getEdgeByID(selected.id());
                if (edge) {
                    this.originalGraph = this.originalGraph.setEdgeProperties(edge.id, edge.properties.set('description', stringValue(description)));
                }
            } else {
                const node = this.originalGraph.getNodeByID(selected.id());
                if (node) {
                    this.originalGraph = this.originalGraph.setNodeProperties(node.id, node.properties.set('description', stringValue(description)));
                }
            }
        }
        this.transformGraph();
        this.updateCustomData();
    }

    onClassesAdded(classes: string[]) {
        for (const selected of this.selection ?? []) {
            if (selected.source().length > 0) {
                const edge = this.originalGraph.getEdgeByID(selected.id());
                if (edge) {
                    this.originalGraph = this.originalGraph.setEdgeLabels(selected.id(), edge.labels.withMutations(labels => {
                        for (const c of classes) {
                            labels.add(c);
                        }
                    }));
                }
            } else {
                const node = this.originalGraph.getNodeByID(selected.id());
                if (node) {
                    this.originalGraph = this.originalGraph.setNodeLabels(selected.id(), node.labels.withMutations(labels => {
                        for (const c of classes) {
                            labels.add(c);
                        }
                    }));
                }
            }
        }
        this.transformGraph();
        this.updateCustomData();
    }

    onClassesRemoved(classes: string[]) {
        for (const selected of this.selection ?? []) {
            if (selected.source().length > 0) {
                const edge = this.originalGraph.getEdgeByID(selected.id());
                if (edge) {
                    this.originalGraph = this.originalGraph.setEdgeLabels(selected.id(), edge.labels.withMutations(labels => {
                        for (const c of classes) {
                            labels.delete(c);
                        }
                    }));
                }
            } else {
                const node = this.originalGraph.getNodeByID(selected.id());
                if (node) {
                    this.originalGraph = this.originalGraph.setNodeLabels(selected.id(), node.labels.withMutations(labels => {
                        for (const c of classes) {
                            labels.delete(c);
                        }
                    }));
                }
            }
        }
        this.transformGraph();
        this.updateCustomData();
    }

    onGraphTitleChange(title: string) {
        this.data.title = title;
        this.cy?.data('title', title);
        this.updateCustomData();
    }

    onGraphDescriptionChange(description: string) {
        this.data.description = description;
        this.cy?.data('description', description);
        this.updateCustomData();
    }

    copy(value: string) {
        navigator.clipboard.writeText(value);
    }

    help() {
        this.dialog.open(HelpDialogComponent);
    }

    addTransformation(name: string, query: string): void {
        this.transformations = [...this.transformations, createTransformation(name, query, true)];
        this.updateTransformations();
    }

    updateTransformations(): void {
        this.transformGraph();
        this.updateCustomData();
        this.layout(); // TODO: should we do this?
    }
}
