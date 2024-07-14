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
import {formatEdge, formatExpression, formatLabelExpression, formatMapLiteral, formatPath, formatRemoveItem, formatSetItem, quoteIdentifier} from './formatter';
import {Edge, Graph, GraphMutation, Node} from './graph';
import {Create, Direction, Edge as ASTEdge, Expression, Delete, LabelExpression, Node as ASTNode, Path, Query as ASTQuery, ReadClause, RemoveClause, ReturnClause, SetClause, UpdateClause} from './parser';
import {booleanValue, checkCastNodeRef, EdgeRef, edgeRefValue, listValue, NodeRef, nodeRefValue, numberValue, serializeValue, stringValue, tryCastBoolean, tryCastEdgeRef, tryCastNodeRef, Value} from './values';

export interface QueryStats {
    nodesVisited: number,
}

export interface ExecuteQueryResult {
    graph: Graph<Value>,
    data: Array<Array<Value>>|undefined,
    stats: QueryStats,
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

    // TODO: optimize
    keys(): Set<K> {
        const keys = new Set(this.vars.keys());
        if (this.parent) {
            for (const k of this.parent.keys()) {
                keys.add(k);
            }
        }
        return keys;
    }

    clone(): Scope<K, V> {
        return new Scope(this.parent, new Map(this.vars));
    }

    toMap(): Map<K, V> {
        if (!this.parent) {
            return new Map(this.vars);
        }
        const map = this.parent.toMap();
        for (const [k, v] of this.vars) {
            map.set(k, v);
        }
        return map;
    }
}

// For every A in left and B in right such that their common keys map to the
// same values, output A+B.
function joinMatches(left: Match[], right: Match[]): Match[] {
    if (left.length === 0 || right.length === 0) {
        return [];
    }
    const m1 = left[0];
    const m2 = right[0];
    const commonKeys = [...intersection(m1.keys(), m2.keys())];
    commonKeys.sort();
    const joinKey = (match: Match) => JSON.stringify(commonKeys.map(k => serializeValue(match.get(k)!)));
    const leftByKey = new Map<string, Match[]>();
    for (const m of left) {
        const k = joinKey(m);
        let bucket = leftByKey.get(k);
        if (!bucket) {
            bucket = [];
            leftByKey.set(k, bucket);
        }
        bucket.push(m);
    }
    const result: Match[] = [];
    for (const m of right) {
        const k = joinKey(m);
        let bucket = leftByKey.get(k);
        for (const leftMatch of bucket ?? []) {
            const leftMap = leftMatch.toMap();
            const rightMap = m.toMap();
            for (const [kk, vv] of rightMap) {
                leftMap.set(kk, vv);
            }
            result.push(new Scope(undefined, leftMap));
        }
    }
    return result;
}

interface QueryStatsState {
    countNodeVisit: () => void,
}

interface State {
    graph: Graph<Value>,
    matches: Match[],
    returnValue: Array<Array<Value>>|undefined,
    createNodeID: () => string,
    createEdgeID: () => string,
    queryStats: QueryStatsState,
}

interface Stage extends QueryPlanStage {
    execute(state: State): void;
}

interface Stagelet extends QueryPlanStage {
    execute(matches: Match[], graph: Graph<Value>, queryStats: QueryStatsState): Match[];
}

interface WhereStagelet extends QueryPlanStage {
    execute(previousMatches: Match[], matches: Match[], graph: Graph<Value>, queryStats: QueryStatsState): Match[];
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

function nodeMatches(node: Node<Value>, pattern: ASTNode, queryStats: QueryStatsState): boolean {
    queryStats.countNodeVisit();
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

class BuildReachabilitySet implements QueryPlanStage {
    constructor(private readonly id: string,
                private readonly edge: ASTEdge) {
    }

    stageName(): string {
        return 'build_reachability_set';
    }

    stageChildren(): QueryPlanStage[] {
        return [];
    }

    stageData(): QueryPlanStageData {
        return [['id', this.id],
                ['edge', formatEdge(this.edge)]];
    }

    build(graph: Graph<Value>, queryStats: QueryStatsState): Set<string> {
        const start = graph.getNodeByID(this.id);
        const queue = [start];
        const nodes = new Set<string>();
        queryStats.countNodeVisit();
        nodes.add(this.id);
        while (true) {
            const head = queue.pop();
            if (!head) {
                break;
            }
            const edges = [];
            for (const [edge, next] of graph.outgoingNeighbors(head)) {
                edges.push({edge, next, forbiddenDirection: 'LEFT'});
            }
            for (const [edge, next] of graph.incomingNeighbors(head)) {
                edges.push({edge, next, forbiddenDirection: 'RIGHT'});
            }
            for (const {edge, next, forbiddenDirection} of edges) {
                if (this.edge.direction !== forbiddenDirection && edgeMatches(edge, this.edge)) {
                    if (!nodes.has(next.id)) {
                        queryStats.countNodeVisit();
                        queue.push(next);
                        nodes.add(next.id);
                    }
                }

            }
        }
        return nodes;
    }
}

class CheckReachabilitySet implements QueryPlanStage {
    constructor(private readonly name: string) {}

    stageName(): string {
        return 'check_reachability_set';
    }

    stageChildren(): QueryPlanStage[] {
        return [];
    }

    stageData(): QueryPlanStageData {
        return [['name', this.name]];
    }

    matches(reachability: Set<string>, match: Match): boolean {
        const id = checkCastNodeRef(match.get(this.name));
        if (id === undefined) {
            return false;
        }
        return reachability.has(id);
    }
}

abstract class MatchStep implements QueryPlanStage {
    abstract stageName(): string;
    abstract stageChildren(): QueryPlanStage[];
    abstract stageData(): QueryPlanStageData;
    abstract match(graph: Graph<Value>, pos: PathMatch, queryStats: QueryStatsState): PathMatch[];
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

class MoveHeadToID extends MatchInitializer {
    constructor(readonly id: string) {
        super();
    }

    override stageName(): string {
        return 'move_head_to_id';
    }

    override stageChildren(): QueryPlanStage[] {
        return [];
    }

    override stageData(): string {
        return quoteIdentifier(this.id);
    }

    override initial(match: Match, graph: Graph<Value>): PathMatch[] {
        const node = graph.getNodeByID(this.id);
        if (node === undefined) {
            throw new Error(`Node ${this.id} not found`);
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

function reverseDirection(direction: Direction): Direction {
    if (direction === 'LEFT') {
        return 'RIGHT';
    } else if (direction === 'RIGHT') {
        return 'LEFT';
    } else {
        return 'NONE';
    }
}

// Can be replaced by Array.toReversed once that's available.
function toReversed<T>(array: T[]): T[] {
    const out = [...array];
    out.reverse();
    return out;
}

function reversePath(path: Path): Path {
    return {
        nodes: toReversed(path.nodes),
        edges: toReversed(path.edges).map(e => ({
            ...e,
            direction: reverseDirection(e.direction),
        })),
    };
}

// Can be replaced by Set.intersection once that's available.
function intersection<T>(left: Set<T>, right: Set<T>): Set<T> {
    const result = new Set<T>();
    for (const k of left) {
        if (right.has(k)) {
            result.add(k);
        }
    }
    return result;
}

function matchPathExistence(expression: Expression): WhereStagelet[] {
    let path: Path;
    let inverted: boolean;
    if (expression.kind === 'path') {
        path = expression.value;
        inverted = false;
    } else if (expression.kind === 'not' && expression.value.kind === 'path') {
        path = expression.value.value;
        inverted = true;
    } else if (expression.kind === 'and') {
        return expression.value.map(matchPathExistence).flat();
    } else {
        throw new Error(`Unimplemented WHERE clause: ${JSON.stringify(expression)}`);
    }
    if (path.nodes.length === 2 &&
        path.edges[0].quantifier?.min === 0 &&
        path.edges[0].quantifier?.max === 1/0 &&
        !path.edges[0].name) {
        const last = path.nodes.length - 1;
        const firstID = fixedID(path.nodes[0]);
        const lastID = fixedID(path.nodes[last]);
        const goodForward = firstID && path.nodes[last].name && nodeOnlyMatchesID(path.nodes[0]);
        const goodBackward = lastID && path.nodes[0].name && nodeOnlyMatchesID(path.nodes[last]);
        if (goodForward || goodBackward) {
            let startID = firstID;
            if (!goodForward) {
                startID = lastID;
                path = reversePath(path);
            }
            const build = new BuildReachabilitySet(startID ?? '', path.edges[0]);
            const check = new CheckReachabilitySet(path.nodes[last].name ?? '');
            return [{
                stageName: () => 'match_path_existence',
                stageChildren(): QueryPlanStage[] {
                    return [build, check];
                },
                stageData: () => [['inverted', inverted.toString()]],
                execute(previousMatches: Match[], matches: Match[], graph: Graph<Value>, queryStats: QueryStatsState): Match[] {
                    const reachabilitySet = build.build(graph, queryStats);
                    return matches.filter(m => check.matches(reachabilitySet, m) !== inverted);
                },
            }];
        }
    }
    if (!path.nodes[0].name && path.nodes[path.nodes.length - 1].name) {
        path = reversePath(path);
    }
    if (path.nodes[0].name) {
        const initializer = new MoveHeadToVariable(path.nodes[0].name);
        const steps = matchSteps(path, false);
        return [{
            stageName: () => 'match_path_existence',
            stageChildren(): QueryPlanStage[] {
                return [initializer, ...steps];
            },
            stageData: () => null,
            execute(previousMatches: Match[], matches: Match[], graph: Graph<Value>, queryStats: QueryStatsState): Match[] {
                return matches.filter(match => {
                    const matches = expandMatch(initializer, steps, match, graph, queryStats);
                    const foundMatch = !matches.next().done;
                    return foundMatch !== inverted;
                });
            }
        }];
    }
    const stagelet = planReadPath(path, false);
    return [{
        stageName: () => 'match_path_existence',
        stageChildren(): QueryPlanStage[] {
            return [stagelet];
        },
        stageData: () => null,
        execute(previousMatches: Match[], matches: Match[], graph: Graph<Value>, queryStats: QueryStatsState): Match[] {
            return stagelet.execute(matches, graph, queryStats);
        },
    }];
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

    override match(graph: Graph<Value>, pos: PathMatch, queryStats: QueryStatsState): PathMatch[] {
        if (!nodeMatches(pos.head, this.node, queryStats)) {
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

    override match(graph: Graph<Value>, pos: PathMatch, queryStats: QueryStatsState): PathMatch[] {
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

    override match(graph: Graph<Value>, pos: PathMatch, queryStats: QueryStatsState): PathMatch[] {
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
                }, queryStats);
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

function* expandMatch(initializer: MatchInitializer, steps: MatchStep[], match: Match, graph: Graph<Value>, queryStats: QueryStatsState): IterableIterator<Match> {
    interface Submatch {
        pathMatch: PathMatch,
        step: number,
    }
    let submatches = initializer
        .initial(match, graph)
        .map(p => ({pathMatch: p, step: 0}));
    while (true) {
        const submatch = submatches.pop();
        if (!submatch) {
            return;
        }
        if (submatch.step == steps.length) {
            yield submatch.pathMatch.match;
        } else {
            submatches.push(...steps[submatch.step]
                .match(graph, submatch.pathMatch, queryStats)
                .map(p => ({pathMatch: p, step: submatch.step + 1})));
        }
    }
}

function fixedID(node: ASTNode): string|undefined {
    const idExpression = node.properties
        ?.filter(([k, v]) => k === '_ID')
        ?.map(([k, v]) => v)
        ?.[0];
    let id: string|undefined = undefined;
    if (idExpression?.kind === 'string') {
        return idExpression.value;
    }
    return undefined;
}

function nodeOnlyMatchesID(node: ASTNode): boolean {
    return node.name === null &&
        node.label === null &&
        !node.properties?.some(([k, v]) => k !== '_ID');
}

function planReadPath(path: Path, allowNewVariables: boolean): Stagelet {
    const firstID = fixedID(path.nodes[0]);
    const lastID = fixedID(path.nodes[path.nodes.length - 1]);
    let initializer: MatchInitializer;
    if (firstID) {
        initializer = new MoveHeadToID(firstID);
    } else if (lastID) {
        path = reversePath(path);
        initializer = new MoveHeadToID(lastID);
    } else {
        initializer = new ScanGraph();
    }
    const steps = matchSteps(path, allowNewVariables);
    return {
        stageName: () => 'read_path',
        stageChildren(): QueryPlanStage[] {
            return [initializer, ...steps];
        },
        stageData: () => null,
        execute(stateMatches: Match[], graph: Graph<Value>, queryStats: QueryStatsState): Match[] {
            const matches: Match[] = [];
            for (const match of stateMatches) {
                matches.push(...expandMatch(initializer, steps, match, graph, queryStats));
            }
            return matches;
        }
    };
}

function planRead(read: ReadClause): Stage {
    const stages = read.paths.map(p => planReadPath(p, true));
    let wheres: WhereStagelet[] = [];
    if (read.where) {
        wheres = matchPathExistence(read.where);
    }
    return {
        stageName: () => 'read',
        stageChildren(): QueryPlanStage[] {
            let children: QueryPlanStage[] = stages;
            return children.concat(wheres);
        },
        stageData: () => null,
        execute(state: State): void {
            let matches = state.matches;
            for (const stage of stages) {
                matches = stage.execute(matches, state.graph, state.queryStats);
            }
            for (const where of wheres) {
                matches = where.execute(state.matches, matches, state.graph, state.queryStats);
            }
            state.matches = matches;
        }
    };
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
                            return [k, v(match, state.graph, state.queryStats)];
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
                            return [k, v(match, state.graph, state.queryStats)];
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
            return (match: Match, graph: Graph<Value>, m: GraphMutation<Value>, queryStats: QueryStatsState) => {
                const value = match.get(variable);
                if (!value) {
                    throw new Error(`variable ${JSON.stringify(variable)} not defined`);
                }
                const nodeRef = tryCastNodeRef(value);
                if (nodeRef !== undefined) {
                    const v = expression(match, graph, queryStats);
                    m.updateNodeProperties(nodeRef, p => p.set(property, v));
                    return;
                }
                const edgeRef = tryCastEdgeRef(value);
                if (edgeRef !== undefined) {
                    const v = expression(match, graph, queryStats);
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
                        item(match, state.graph, m, state.queryStats);
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

type EvaluatePlan = (variables: Match, graph: Graph<Value>, queryStats: QueryStatsState) => Value;

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
        return (variables: Match, graph: Graph<Value>, queryStats: QueryStatsState) => {
            // TODO: test
            const b = tryCastBoolean(inner(variables, graph, queryStats));
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
        return (variables: Match, graph: Graph<Value>, queryStats: QueryStatsState) => {
            const matches = expandMatch(initializer, steps, variables, graph, queryStats);
            const foundMatch = !matches.next().done;
            return booleanValue(foundMatch);
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
            state.returnValue = state.matches.map(m => expressions.map(e => e(m, state.graph, state.queryStats)));
        }
    });
}

const DEFAULT_MAX_NODE_VISITS = 1000;

export interface QueryOptions {
    maxNodeVisits?: number,
}

export function planQuery(query: ASTQuery, options?: QueryOptions): QueryPlan {
    const stages: Array<Stage> = [];
    for (const read of query.reads) {
        stages.push(planRead(read));
    }
    for (const update of query.updates) {
        stages.push(planUpdate(update));
    }
    if (query.returnClause) {
        stages.push(planReturn(query.returnClause));
    }
    let nextNodeID = 0;
    let nextEdgeID = 0;
    let nodesVisited = 0;
    const maxNodeVisits = options?.maxNodeVisits ?? DEFAULT_MAX_NODE_VISITS;
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
                queryStats: {
                    countNodeVisit: () => {
                        if (++nodesVisited > maxNodeVisits) {
                            throw new Error(`Too many nodes visited (options.maxNodeVisits = ${maxNodeVisits})`);
                        }
                    },
                },
            };
            for (const stage of stages) {
                stage.execute(state);
            }
            return {
                graph: state.graph,
                data: state.returnValue,
                stats: {
                    nodesVisited,
                },
            };
        },
    };
}
