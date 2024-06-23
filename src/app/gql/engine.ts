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

import Immutable from 'immutable';
import {formatExpression, formatLabelExpression, formatMapLiteral, formatPath, formatRemoveItem, formatSetItem, quoteIdentifier} from './formatter';
import {Edge, Graph, GraphMutation, Node} from './graph';
import {Create, Edge as ASTEdge, Expression, Delete, LabelExpression, Node as ASTNode, Path, Query as ASTQuery, ReadClause, RemoveClause, ReturnClause, SetClause, UpdateClause} from './parser';
import {booleanValue, checkCastNodeRef, EdgeRef, edgeRefValue, listValue, NodeRef, nodeRefValue, numberValue, stringValue, tryCastBoolean, tryCastEdgeRef, tryCastNodeRef, Value} from './values';

export interface ExecuteQueryResult {
    graph: Graph<Value>,
    data: Array<Array<Value>>|undefined,
}

export interface QueryPlan {
    execute(graph: Graph<Value>): ExecuteQueryResult;

    stages(): QueryPlanStage[];
}

export type QueryPlanStageData = null|string|string[]|Array<[string, string|null]>

export interface QueryPlanStage {
    stageName(): string;

    stageChildren(): QueryPlanStage[];

    stageData(): QueryPlanStageData;
}

export function describeQueryPlan(plan: QueryPlan): string {
    let result = '';
    for (const stage of plan.stages()) {
        result += describeQueryPlanStage(stage, 0);
    }
    return result;
}

function describeQueryPlanStage(stage: QueryPlanStage, indent: number): string {
    let result = '';
    for (let i = 0; i < indent; i++) {
        result += '  ';
    }
    result += stage.stageName();
    const stageData = stage.stageData();
    if (stageData !== null) {
        let details = '';
        if (Array.isArray(stageData)) {
            let first = true;
            for (const element of stageData) {
                if (Array.isArray(element)) {
                    const [k, v] = element;
                    if (v === null) {
                        continue;
                    }
                    if (!first) {
                        details += ', ';
                    }
                    first = false;
                    details += k;
                    details += '=';
                    details += v;
                } else {
                    if (!first) {
                        details += ', ';
                    }
                    first = false;
                    details += element;
                }
            }
        } else {
            details += stageData;
        }
        if (details.length) {
            result += ': ';
            result += details;
        }
    }
    result += '\n';
    for (const child of stage.stageChildren()) {
        result += describeQueryPlanStage(child, indent + 1);
    }
    return result;
}

type Match = Scope<string, Value>;

class Scope<K, V> {
    vars: Map<K, V>;

    constructor(readonly parent?: Scope<K, V>, vars?: Map<K, V>) {
        if (vars) {
            this.vars = vars;
        } else {
            this.vars = new Map();
        }
    }

    has(key: K): boolean {
        return this.vars.has(key) || this.parent?.has(key) || false;
    }

    get(key: K): V|undefined {
        return this.vars.get(key) ?? this.parent?.get(key);
    }

    set(key: K, value: V): void {
        this.vars.set(key, value);
    }

    clone(): Scope<K, V> {
        return new Scope(this.parent, new Map(this.vars));
    }
}

interface State {
    graph: Graph<Value>,
    matches: Match[],
    returnValue: Array<Array<Value>>|undefined,
    createNodeID: () => string,
    createEdgeID: () => string,
}

interface Stage extends QueryPlanStage {
    execute(state: State): void;
}

function labelsMatch(labels: Immutable.Set<string>, pattern: LabelExpression): boolean {
    if (pattern.kind === 'identifier') {
        if (pattern.value === '_VIRTUAL') {
            for (const x of labels) {
                if (x.startsWith('_')) {
                    return true;
                }
            }
            return false;
        } else {
            return labels.has(pattern.value);
        }
    } else if (pattern.kind === 'negation') {
        return !labelsMatch(labels, pattern.value);
    } else if (pattern.kind === 'conjunction') {
        return pattern.values.every(x => labelsMatch(labels, x));
    } else if (pattern.kind === 'disjunction') {
        return pattern.values.some(x => labelsMatch(labels, x));
    } else {
        throw new Error(`Unrecognized label pattern ${JSON.stringify(pattern)}`);
    }
}

function valueMatches(value: Value|undefined, pattern: Expression): boolean {
    // TODO: make smarter
    return value?.value === pattern.value;
}

function nodeMatches(node: Node<Value>, pattern: ASTNode): boolean {
    if (pattern.label !== null) {
        if (!labelsMatch(node.labels, pattern.label)) {
            return false;
        }
    }
    if (pattern.properties !== null) {
        for (const [k, v] of pattern.properties) {
            if (k === '_ID') {
                if (node.id !== v.value) {
                    return false;
                }
            } else if (!valueMatches(node.properties.get(k), v)) {
                return false;
            }
        }
    }
    return true;
}

function edgeMatches(edge: Edge<Value>, pattern: ASTEdge): boolean {
    if (pattern.label !== null) {
        if (!labelsMatch(edge.labels, pattern.label)) {
            return false;
        }
    }
    if (pattern.properties !== null) {
        for (const [k, v] of pattern.properties) {
            if (k === '_ID') {
                if (edge.id !== v.value) {
                    return false;
                }
            } else if (!valueMatches(edge.properties.get(k), v)) {
                return false;
            }
        }
    }
    return true;
}

abstract class MatchStep implements QueryPlanStage {
    abstract stageName(): string;
    abstract stageChildren(): QueryPlanStage[];
    abstract stageData(): QueryPlanStageData;
    abstract match(graph: Graph<Value>, pos: PathMatch): PathMatch[];
}

abstract class MatchInitializer implements QueryPlanStage {
    abstract stageName(): string;
    abstract stageChildren(): QueryPlanStage[];
    abstract stageData(): QueryPlanStageData;
    abstract initial(match: Match, graph: Graph<Value>): PathMatch[];
}

class ScanGraph extends MatchInitializer {
    constructor() {
        super();
    }

    override stageName(): string {
        return 'scan_graph';
    }

    override stageChildren(): QueryPlanStage[] {
        return [];
    }

    override stageData(): null {
        return null;
    }

    override initial(match: Match, graph: Graph<Value>): PathMatch[] {
        let pathMatches: PathMatch[] = [];
        for (const startNode of graph.nodes) {
            pathMatches.push({
                match,
                head: startNode,
                traversedEdges: new Set(),
            });
        }
        return pathMatches;
    }
}

class MoveHeadToVariable extends MatchInitializer {
    constructor(readonly variableName: string) {
        super();
    }

    override stageName(): string {
        return 'move_head_to_variable';
    }

    override stageChildren(): QueryPlanStage[] {
        return [];
    }

    override stageData(): string {
        return quoteIdentifier(this.variableName);
    }

    override initial(match: Match, graph: Graph<Value>): PathMatch[] {
        const value = match.get(this.variableName);
        if (value === undefined) {
            throw new Error(`Variable ${this.variableName} not defined`);
        }
        const nodeID = checkCastNodeRef(value);
        if (nodeID === undefined) {
            throw new Error(`Variable ${this.variableName} is not a node (${JSON.stringify(value)})`);
        }
        const node = graph.getNodeByID(nodeID);
        if (node === undefined) {
            throw new Error(`Node ${nodeID} (from variable ${this.variableName}) not found`);
        }
        return [{
            match,
            head: node,
            // This won't work once we use this class within the same graph pattern, i.e. multiple
            // paths within the same MATCH.
            traversedEdges: new Set(),
        }];
    }
}

class ScanGraphStep extends MatchStep {
    constructor() {
        super();
    }

    override stageName(): string {
        return 'scan_graph';
    }

    override stageChildren(): QueryPlanStage[] {
        return [];
    }

    override stageData(): QueryPlanStageData {
        return null;
    }

    override match(graph: Graph<Value>, pos: PathMatch): PathMatch[] {
        let pathMatches: PathMatch[] = [];
        for (const startNode of graph.nodes) {
            pathMatches.push({
                match: pos.match,
                head: startNode,
                traversedEdges: pos.traversedEdges,
            });
        }
        return pathMatches;
    }
}

function matchPathExistance(expression: Expression): Stage {
    let path: Path;
    let inverted: boolean;
    if (expression.kind === 'path') {
        path = expression.value;
        inverted = false;
    } else if (expression.kind === 'not' && expression.value.kind === 'path') {
        path = expression.value.value;
        inverted = true;
    } else {
        throw new Error(`Unimplemented WHERE clause: ${JSON.stringify(expression)}`);
    }
    if (!path.nodes[0].name) {
        throw new Error(`WHERE clauses currently require the first node to be an existing variable`);
    }
    const initializer = new MoveHeadToVariable(path.nodes[0].name);
    const steps = matchSteps(path, false);
    return {
        stageName: () => 'match_path_existance',
        stageChildren(): QueryPlanStage[] {
            return [initializer, ...steps];
        },
        stageData: () => null,
        execute(state: State): void {
            state.matches = state.matches.filter(match => {
                const matches = expandMatch(initializer, steps, match, state.graph, true);
                return matches.length > 0 !== inverted;
            });
        }
    };
}

class MatchNode extends MatchStep {
    constructor(readonly node: ASTNode, readonly allowNewVariables: boolean) {
        super();
    }

    override stageName(): string {
        return 'match_node';
    }

    override stageChildren(): QueryPlanStage[] {
        return [];
    }

    override stageData(): QueryPlanStageData {
        const n = this.node;
        return [['name', n.name],
                ['label', n.label === null ? null : formatLabelExpression(n.label)],
                ['properties', n.properties === null ? null : formatMapLiteral(n.properties)]];
    }

    override match(graph: Graph<Value>, pos: PathMatch): PathMatch[] {
        if (!nodeMatches(pos.head, this.node)) {
            return [];
        }
        const name = this.node.name;
        let match = pos.match;
        if (name) {
            if (pos.match.has(name)) {
                const old = pos.match.get(name);
                if (tryCastNodeRef(old) !== pos.head.id) {
                    return [];
                }
            } else if (!this.allowNewVariables) {
                throw new Error(`Attempting to bind variable ${JSON.stringify(name)} in a position where it is not allowed`);
            } else {
                match = match.clone();
                match.set(name, nodeRefValue(pos.head.id));
            }
        }
        return [{
            match,
            traversedEdges: pos.traversedEdges,
            head: pos.head,
        }];
    }
}

class MatchEdge extends MatchStep {
    constructor(readonly edge: ASTEdge, readonly allowNewVariables: boolean) {
        super();
    }

    override stageName(): string {
        return 'match_edge';
    }

    override stageChildren(): QueryPlanStage[] {
        return [];
    }

    override stageData(): QueryPlanStageData {
        const e = this.edge;
        return [['name', e.name],
                ['direction', e.direction === 'NONE' ? null : e.direction],
                ['label', e.label === null ? null : formatLabelExpression(e.label)],
                ['properties', e.properties === null ? null : formatMapLiteral(e.properties)],
                ['quantifier', e.quantifier === null ? null : JSON.stringify(e.quantifier)]];
    }

    override match(graph: Graph<Value>, pos: PathMatch): PathMatch[] {
        const matches = [];
        const edges = [];
        for (const [edge, next] of graph.outgoingNeighbors(pos.head)) {
            edges.push({edge, next, forbiddenDirection: 'LEFT'});
        }
        for (const [edge, next] of graph.incomingNeighbors(pos.head)) {
            edges.push({edge, next, forbiddenDirection: 'RIGHT'});
        }
        for (const {edge, next, forbiddenDirection} of edges) {
            const direction = this.edge.direction;
            if (!pos.traversedEdges.has(edge) && direction !== forbiddenDirection && edgeMatches(edge, this.edge)) {
                const name = this.edge.name;
                let match = pos.match;
                if (name) {
                    if (pos.match.has(name)) {
                        const old = pos.match.get(name);
                        if (tryCastEdgeRef(old) !== edge.id) {
                            continue;
                        }
                    } else if (!this.allowNewVariables) {
                        throw new Error(`Attempting to bind variable ${JSON.stringify(name)} in a position where it is not allowed`);
                    } else {
                        match = match.clone();
                        match.set(name, edgeRefValue(edge.id));
                    }
                }
                const subTraversed = new Set(pos.traversedEdges);
                subTraversed.add(edge);
                matches.push({
                    match,
                    traversedEdges: subTraversed,
                    head: next,
                });
            }
        }
        return matches;
    }
}

class MatchQuantified extends MatchStep {
    constructor(readonly inner: MatchStep, readonly min: number, readonly max: number, readonly freeVariables: Set<string>) {
        super();
    }

    override stageName(): string {
        return 'match_quantified';
    }

    override stageChildren(): QueryPlanStage[] {
        return [this.inner];
    }

    override stageData(): Array<[string, string]> {
        return [['min', this.min.toString()], ['max', this.max.toString()]];
    }

    override match(graph: Graph<Value>, pos: PathMatch): PathMatch[] {
        const result = [];
        const emptyVariables = new Map<string, Array<Value>>();
        for (const k of this.freeVariables) {
            emptyVariables.set(k, []);
        }
        let matches = [{
            pathMatch: pos,
            variables: emptyVariables,
        }];
        let length = 0;
        while (length < this.max && matches.length) {
            if (length >= this.min) {
                result.push(matches);
            }
            const newMatches = [];
            for (const p of matches) {
                const scope = new Scope(pos.match);
                const innerMatches = this.inner.match(graph, {
                    match: scope,
                    head: p.pathMatch.head,
                    traversedEdges: p.pathMatch.traversedEdges,
                });
                newMatches.push(innerMatches.map(m => {
                    const variables = new Map(p.variables);
                    for (const [k, v] of m.match.vars) {
                        variables.set(k, [...variables.get(k) ?? [], v]);
                    }
                    return {
                        pathMatch: m,
                        variables,
                    }
                }));
            }
            matches = newMatches.flat();
            length++;
        }
        return result.flat().map(m => {
            const match = pos.match.clone();
            for (const [k, v] of m.variables) {
                match.set(k, listValue(v));
            }
            return {
                match,
                head: m.pathMatch.head,
                traversedEdges: m.pathMatch.traversedEdges,
            };
        });
    }
}

interface PathMatch {
    match: Match,
    head: Node<Value>,
    traversedEdges: Set<Edge<Value>>,
}

function matchSteps(path: Path, allowNewVariables: boolean): MatchStep[] {
    const steps: MatchStep[] = [];
    steps.push(new MatchNode(path.nodes[0], allowNewVariables));
    for (let i = 0; i < path.edges.length; i++) {
        const edge = path.edges[i];
        if (edge.quantifier) {
            const freeVariables = new Set<string>();
            if (edge.name) {
                freeVariables.add(edge.name);
            }
            steps.push(new MatchQuantified(new MatchEdge(edge, allowNewVariables), edge.quantifier.min, edge.quantifier.max, freeVariables));
        } else {
            steps.push(new MatchEdge(edge, allowNewVariables));
        }
        steps.push(new MatchNode(path.nodes[i + 1], allowNewVariables));
    }
    return steps;
}

function expandMatch(initializer: MatchInitializer, steps: MatchStep[], match: Match, graph: Graph<Value>, stopAtFirst: boolean): Match[] {
    let pathMatches = initializer.initial(match, graph);
    for (const step of steps) {
        const stepMatches: PathMatch[] = [];
        for (const pathMatch of pathMatches) {
            stepMatches.push(...step.match(graph, pathMatch));
        }
        pathMatches = stepMatches;
    }
    return pathMatches.map(p => p.match);
}

function planReadPath(path: Path): Stage {
    const steps = matchSteps(path, true);
    const initializer: MatchInitializer = new ScanGraph();
    return {
        stageName: () => 'read_path',
        stageChildren(): QueryPlanStage[] {
            return [initializer, ...steps];
        },
        stageData: () => null,
        execute(state: State): void {
            const matches: Match[] = [];
            for (const match of state.matches) {
                matches.push(...expandMatch(initializer, steps, match, state.graph, false));
            }
            state.matches = matches;
        }
    };
}

function planRead(read: ReadClause): Stage[] {
    const stages = read.paths.map(planReadPath);
    if (read.where) {
        stages.push(matchPathExistance(read.where));
    }
    return stages;
}

function planCreate(create: Create): Stage {
    for (const e of create.path.edges) {
        if (e.direction === 'NONE') {
            throw new Error('Edges must specify a direction in create clauses');
        }
    }
    interface NodePlan {
        name: string|null,
        labels: string[],
        properties: Array<[string, EvaluatePlan]>,
    }
    const pathNodes: Array<NodePlan> = create.path.nodes.map(n => {
        const labels: string[] = [];
        if (n.label !== null) {
            if (n.label.kind !== 'identifier') {
                throw new Error(`Only plain label identifiers are allowed in CREATE clauses, but found ${JSON.stringify(n.label)}`);
            }
            labels.push(n.label.value);
        }
        return {
            name: n.name,
            labels,
            properties: (n.properties ?? []).map(([k, v]) => [k, planEvaluate(v)]),
        };
    });
    interface EdgePlan {
        srcOffset: number,
        dstOffset: number,
        labels: string[],
        properties: Array<[string, EvaluatePlan]>,
    }
    const pathEdges: Array<EdgePlan> = create.path.edges.map(e => {
        const labels: string[] = [];
        if (e.label !== null) {
            if (e.label.kind !== 'identifier') {
                throw new Error(`Only plain label identifiers are allowed in CREATE clauses, but found ${JSON.stringify(e.label)}`);
            }
            labels.push(e.label.value);
        }
        let properties: Array<[string, EvaluatePlan]> = (e.properties ?? []).map(([k, v]) => {
            return [k, planEvaluate(v)];
        });
        return {
            srcOffset: e.direction === 'RIGHT' ? 0 : 1,
            dstOffset: e.direction === 'RIGHT' ? 1 : 0,
            labels,
            properties: (e.properties ?? []).map(([k, v]) => [k, planEvaluate(v)]),
        };
    });
    return {
        stageName: () => 'create',
        stageChildren: () => [],
        stageData: () => formatPath(create.path),
        execute(state: State): void {
            state.graph = state.graph.withMutations(mutation => {
                for (const match of state.matches) {
                    const nodeIDs: string[] = pathNodes.map(n => {
                        if (n.name !== null) {
                            const element = match.get(n.name);
                            if (!element) {
                                throw new Error(`variable ${JSON.stringify(n.name)} not defined`);
                            }
                            const nodeRef = tryCastNodeRef(element);
                            if (nodeRef === undefined) {
                                throw new Error(`variable ${JSON.stringify(n.name)} is not a node`);
                            }
                            return nodeRef;
                        }
                        let properties: Array<[string, Value]> = n.properties.map(([k, v]) => {
                            return [k, v(match, state.graph)];
                        });
                        const id = state.createNodeID();
                        mutation.createNode(id, n.labels, properties);
                        return id;
                    });
                    for (let i = 0; i < pathEdges.length; i++) {
                        const e = pathEdges[i];
                        const srcID = nodeIDs[e.srcOffset + i];
                        const dstID = nodeIDs[e.dstOffset + i];
                        let properties: Array<[string, Value]> = e.properties.map(([k, v]) => {
                            return [k, v(match, state.graph)];
                        });
                        const edgeID = state.createEdgeID();
                        mutation.createEdge(edgeID, srcID, dstID, e.labels, properties);
                    }
                }
            });
        }
    };
}

function planDelete(delete_: Delete): Stage {
    return {
        stageName: () => 'delete',
        stageChildren: () => [],
        stageData: () => quoteIdentifier(delete_.name),
        execute(state: State): void {
            state.graph = state.graph.withMutations(m => {
                for (const match of state.matches) {
                    const value = match.get(delete_.name);
                    if (!value) {
                        throw new Error(`variable ${JSON.stringify(delete_.name)} not defined`);
                    }
                    const nodeRef = tryCastNodeRef(value);
                    if (nodeRef !== undefined) {
                        m.removeNode(nodeRef);
                        continue;
                    }
                    const edgeRef = tryCastEdgeRef(value);
                    if (edgeRef !== undefined) {
                        m.removeEdge(edgeRef);
                        continue;
                    }
                    throw new Error(`variable ${JSON.stringify(delete_.name)} is not a node or edge`);
                }
            });
        }
    };
}

function planSet(set_: SetClause): Stage {
    const items = set_.items.map(item => {
        if (item.kind === 'setProperty') {
            if (item.property.chain.length !== 1) {
                throw new Error(`SET only supports VARIABLE.PROPERTY, with no nesting`);
            }
            const variable = item.property.root;
            const property = item.property.chain[0];
            const expression = planEvaluate(item.expression);
            return (match: Match, graph: Graph<Value>, m: GraphMutation<Value>) => {
                const value = match.get(variable);
                if (!value) {
                    throw new Error(`variable ${JSON.stringify(variable)} not defined`);
                }
                const nodeRef = tryCastNodeRef(value);
                if (nodeRef !== undefined) {
                    const v = expression(match, graph);
                    m.updateNodeProperties(nodeRef, p => p.set(property, v));
                    return;
                }
                const edgeRef = tryCastEdgeRef(value);
                if (edgeRef !== undefined) {
                    const v = expression(match, graph);
                    m.updateEdgeProperties(edgeRef, p => p.set(property, v));
                    return;
                }
                throw new Error(`variable ${JSON.stringify(variable)} is not a node or edge`);
            };
        } else {
            const variable = item.variable;
            const labels = item.labels;
            return (match: Match, graph: Graph<Value>, m: GraphMutation<Value>) => {
                const value = match.get(variable);
                if (!value) {
                    throw new Error(`variable ${JSON.stringify(variable)} not defined`);
                }
                const nodeRef = tryCastNodeRef(value);
                if (nodeRef !== undefined) {
                    m.updateNodeLabels(nodeRef, s => s.union(labels));
                    return;
                }
                const edgeRef = tryCastEdgeRef(value);
                if (edgeRef !== undefined) {
                    m.updateEdgeLabels(edgeRef, s => s.union(labels));
                    return;
                }
                throw new Error(`variable ${JSON.stringify(variable)} is not a node or edge`);
            };
        }
    });
    return {
        stageName: () => 'set',
        stageChildren(): QueryPlanStage[] {
            return set_.items.map(item => ({
                stageName: () => 'set_item',
                stageChildren: () => [],
                stageData: () => formatSetItem(item),
            }));
        },
        stageData: () => null,
        execute(state: State): void {
            state.graph = state.graph.withMutations(m => {
                for (const match of state.matches) {
                    for (const item of items) {
                        item(match, state.graph, m);
                    }
                }
            });
        }
    };
}

function planRemove(remove_: RemoveClause): Stage {
    const items = remove_.items.map(item => {
        if (item.kind === 'removeProperty') {
            if (item.property.chain.length !== 1) {
                throw new Error(`REMOVE only supports VARIABLE.PROPERTY, with no nesting`);
            }
            const variable = item.property.root;
            const property = item.property.chain[0];
            return (match: Match, graph: Graph<Value>, m: GraphMutation<Value>) => {
                const value = match.get(variable);
                if (!value) {
                    throw new Error(`variable ${JSON.stringify(variable)} not defined`);
                }
                const nodeRef = tryCastNodeRef(value);
                if (nodeRef !== undefined) {
                    m.updateNodeProperties(nodeRef, p => p.remove(property));
                    return;
                }
                const edgeRef = tryCastEdgeRef(value);
                if (edgeRef !== undefined) {
                    m.updateEdgeProperties(edgeRef, p => p.remove(property));
                    return;
                }
                throw new Error(`variable ${JSON.stringify(variable)} is not a node or edge`);
            };
        } else {
            const variable = item.variable;
            const labels = item.labels;
            return (match: Match, graph: Graph<Value>, m: GraphMutation<Value>) => {
                const value = match.get(variable);
                if (!value) {
                    throw new Error(`variable ${JSON.stringify(variable)} not defined`);
                }
                const nodeRef = tryCastNodeRef(value);
                if (nodeRef !== undefined) {
                    m.updateNodeLabels(nodeRef, s => s.subtract(labels));
                    return;
                }
                const edgeRef = tryCastEdgeRef(value);
                if (edgeRef !== undefined) {
                    m.updateEdgeLabels(edgeRef, s => s.subtract(labels));
                    return;
                }
                throw new Error(`variable ${JSON.stringify(variable)} is not a node or edge`);
            };
        }
    });
    return {
        stageName: () => 'remove',
        stageChildren(): QueryPlanStage[] {
            return remove_.items.map(item => ({
                stageName: () => 'remove_item',
                stageChildren: () => [],
                stageData: () => formatRemoveItem(item),
            }));
        },
        stageData: () => null,
        execute(state: State): void {
            state.graph = state.graph.withMutations(m => {
                for (const match of state.matches) {
                    for (const item of items) {
                        item(match, state.graph, m);
                    }
                }
            });
        }
    };
}

function planUpdate(update: UpdateClause): Stage {
    if (update.kind === 'create') {
        return planCreate(update);
    } else if (update.kind === 'delete') {
        return planDelete(update);
    } else if (update.kind === 'set') {
        return planSet(update);
    } else {
        return planRemove(update);
    }
}

type EvaluatePlan = (variables: Match, graph: Graph<Value>) => Value;

function planEvaluate(expression: Expression): EvaluatePlan {
    if (expression.kind === 'string') {
        const v = stringValue(expression.value);
        return () => v;
    } else if (expression.kind === 'number') {
        const v = numberValue(expression.value);
        return () => v;
    } else if (expression.kind === 'identifier') {
        return (variables: Match, graph: Graph<Value>) => {
            const v = variables.get(expression.value);
            if (!v) {
                throw new Error(`Variable ${JSON.stringify(expression.value)} not found`);
            }
            return v;
        };
    } else if (expression.kind === 'not') {
        const inner = planEvaluate(expression.value);
        return (variables: Match, graph: Graph<Value>) => {
            // TODO: test
            const b = tryCastBoolean(inner(variables, graph));
            if (b === undefined) {
                throw new Error(`Expression is not a boolean: ${JSON.stringify(expression.value)}`);
            }
            return booleanValue(!b);
        };
    } else if (expression.kind === 'path') {
        // TODO: test
        const steps = matchSteps(expression.value, false);
        // TODO: choose better
        const initializer = new ScanGraph();
        return (variables: Match, graph: Graph<Value>) => {
            return booleanValue(expandMatch(initializer, steps, variables, graph, true).length > 0);
        };
    } else {
        throw new Error(`Unrecognized expression: ${JSON.stringify(expression)}`);
    }
}

function planReturn(returnClause: ReturnClause): Stage {
    const expressions = returnClause.values.map(planEvaluate);
    return ({
        stageName: () => 'return',
        stageChildren: () => [],
        stageData(): QueryPlanStageData {
            return returnClause.values.map(formatExpression);
        },
        execute(state: State): void {
            state.returnValue = state.matches.map(m => expressions.map(e => e(m, state.graph)));
        }
    });
}

export function planQuery(query: ASTQuery): QueryPlan {
    const stages: Array<Stage> = [];
    for (const read of query.reads) {
        stages.push(...planRead(read));
    }
    for (const update of query.updates) {
        stages.push(planUpdate(update));
    }
    if (query.returnClause) {
        stages.push(planReturn(query.returnClause));
    }
    let nextNodeID = 0;
    let nextEdgeID = 0;
    return {
        stages: () => {
            return stages;
        },
        execute: (graph: Graph<Value>) => {
            const state = {
                graph,
                matches: [new Scope<string, Value>()],
                returnValue: undefined,
                createNodeID: () => {
                    while (true) {
                        const id = `node_${nextNodeID}`;
                        nextNodeID++;
                        if (!graph.getNodeByID(id)) {
                            return id;
                        }
                    }
                },
                createEdgeID: () => {
                    while (true) {
                        const id = `edge_${nextEdgeID}`;
                        nextEdgeID++;
                        if (!graph.getEdgeByID(id)) {
                            return id;
                        }
                    }
                },
            };
            for (const stage of stages) {
                stage.execute(state);
            }
            return {
                graph: state.graph,
                data: state.returnValue,
            };
        },
    };
}
