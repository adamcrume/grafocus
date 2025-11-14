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
import {
  formatEdge,
  formatLabelExpression,
  formatMapLiteral,
  quoteIdentifier,
} from './formatter';
import { Edge, Graph, Node } from './graph';
import { iter } from './iter';
import {
  Direction,
  Edge as ASTEdge,
  Expression,
  LabelExpression,
  Node as ASTNode,
  Path,
} from './parser';
import {
  FALSE,
  NULL,
  TRUE,
  booleanValue,
  checkCastNodeRef,
  compareValues,
  edgeRefValue,
  listValue,
  nodeRefValue,
  numberValue,
  stringValue,
  tryCastBoolean,
  tryCastEdgeRef,
  tryCastNodeRef,
  Value,
} from './values';

export type QueryPlanStageData =
  | null
  | string
  | string[]
  | Array<[string, Value | string | null]>;

export interface QueryPlanStage {
  stageName(): string;

  stageChildren(): QueryPlanStage[];

  stageData(): QueryPlanStageData;
}

export type Match = Scope<string, Value>;

export class Scope<K, V> {
  private readonly vars: Immutable.Map<K, V>;

  constructor(
    private readonly parent?: Scope<K, V>,
    vars?: Map<K, V> | Immutable.Map<K, V>,
  ) {
    this.vars = Immutable.Map(vars);
  }

  ownVars(): Immutable.Map<K, V> {
    return this.vars;
  }

  has(key: K): boolean {
    return this.vars.has(key) || this.parent?.has(key) || false;
  }

  get(key: K): V | undefined {
    return this.vars.get(key) ?? this.parent?.get(key);
  }

  set(key: K, value: V): Scope<K, V> {
    return new Scope(this.parent, this.vars.set(key, value));
  }

  keys(): Immutable.Set<K> {
    return (this.parent?.keys() ?? Immutable.Set()).withMutations((keys) => {
      for (const k of this.vars.keys()) {
        keys.add(k);
      }
    });
  }

  toImmutableMap(): Immutable.Map<K, V> {
    if (!this.parent) {
      return this.vars;
    }
    return this.parent.toImmutableMap().withMutations((map) => {
      for (const [k, v] of this.vars) {
        map.set(k, v);
      }
    });
  }
}

export interface QueryStatsState {
  countNodeVisit: () => void;
}

export interface State {
  graph: Graph<Value>;
  matches: Match[];
  returnValue: Array<Array<Value>> | undefined;
  createNodeID: () => string;
  createEdgeID: () => string;
  queryStats: QueryStatsState;
  functions: Map<string, Func>;
}

export interface Stage extends QueryPlanStage {
  execute(state: State): void;
}

export interface MatchExpander {
  execute(matches: Match): IterableIterator<Match>;
}

export interface MatchExpandStage extends QueryPlanStage {
  prepare(
    graph: Graph<Value>,
    queryStats: QueryStatsState,
    functions: Map<string, Func>,
  ): MatchExpander;
}

function labelsMatch(
  labels: Immutable.Set<string>,
  pattern: LabelExpression,
): boolean {
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
    return pattern.values.every((x) => labelsMatch(labels, x));
  } else if (pattern.kind === 'disjunction') {
    return pattern.values.some((x) => labelsMatch(labels, x));
  } else {
    throw new Error(`Unrecognized label pattern ${JSON.stringify(pattern)}`);
  }
}

function valueMatches(value: Value | undefined, pattern: Expression): boolean {
  if (pattern.kind === 'functionCall') {
    throw new Error(`Matching properties with function is not yet implemented`);
  } else if (pattern.kind === 'comparison') {
    throw new Error(
      `Matching properties with comparisons is not yet implemented`,
    );
  }
  // TODO: make smarter
  return value?.value === pattern.value;
}

function nodeMatches(
  node: Node<Value>,
  pattern: ASTNode,
  queryStats: QueryStatsState,
): boolean {
  queryStats.countNodeVisit();
  if (pattern.label !== null) {
    if (!labelsMatch(node.labels, pattern.label)) {
      return false;
    }
  }
  if (pattern.properties !== null) {
    for (const [k, v] of pattern.properties) {
      if (k === '_ID') {
        if (!valueMatches(stringValue(node.id), v)) {
          return false;
        }
      } else if (!valueMatches(node.properties.get(k), v)) {
        return false;
      }
    }
  }
  return true;
}

export function edgeMatches(edge: Edge<Value>, pattern: ASTEdge): boolean {
  if (pattern.label !== null) {
    if (!labelsMatch(edge.labels, pattern.label)) {
      return false;
    }
  }
  if (pattern.properties !== null) {
    for (const [k, v] of pattern.properties) {
      if (k === '_ID') {
        if (!valueMatches(stringValue(edge.id), v)) {
          return false;
        }
      } else if (!valueMatches(edge.properties.get(k), v)) {
        return false;
      }
    }
  }
  return true;
}

export abstract class MatchStep implements QueryPlanStage {
  abstract stageName(): string;
  abstract stageChildren(): QueryPlanStage[];
  abstract stageData(): QueryPlanStageData;
  abstract match(
    graph: Graph<Value>,
    pos: PathMatch,
    queryStats: QueryStatsState,
  ): IterableIterator<PathMatch>;
}

export abstract class MatchInitializer implements QueryPlanStage {
  abstract stageName(): string;
  abstract stageChildren(): QueryPlanStage[];
  abstract stageData(): QueryPlanStageData;
  abstract prepareInitial(
    graph: Graph<Value>,
  ): (match: Match) => IterableIterator<PathMatch>;
}

export class ScanGraph extends MatchInitializer {
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

  override prepareInitial(
    graph: Graph<Value>,
  ): (match: Match) => IterableIterator<PathMatch> {
    return function* (match: Match) {
      for (const startNode of graph.nodes) {
        yield {
          match,
          head: startNode,
          traversedEdges: new Set(),
        };
      }
    };
  }
}

export class MoveHeadToVariable extends MatchInitializer {
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

  override prepareInitial(
    graph: Graph<Value>,
  ): (match: Match) => IterableIterator<PathMatch> {
    const self = this;
    return function* (match: Match) {
      const value = match.get(self.variableName);
      if (value === undefined) {
        throw new Error(`Variable ${self.variableName} not defined`);
      }
      const nodeID = checkCastNodeRef(value);
      if (nodeID === undefined) {
        throw new Error(
          `Variable ${self.variableName} is not a node (${JSON.stringify(value)})`,
        );
      }
      const node = graph.getNodeByID(nodeID);
      if (node === undefined) {
        throw new Error(
          `Node ${nodeID} (from variable ${self.variableName}) not found`,
        );
      }
      yield {
        match,
        head: node,
        // This won't work once we use this class within the same graph pattern, i.e. multiple
        // paths within the same MATCH.
        traversedEdges: new Set(),
      };
    };
  }
}

export class MoveHeadToID extends MatchInitializer {
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

  override prepareInitial(
    graph: Graph<Value>,
  ): (match: Match) => IterableIterator<PathMatch> {
    const node = graph.getNodeByID(this.id);
    if (node === undefined) {
      throw new Error(`Node ${this.id} not found`);
    }
    return function* (match: Match) {
      yield {
        match,
        head: node,
        // This won't work once we use this class within the same graph pattern, i.e. multiple
        // paths within the same MATCH.
        traversedEdges: new Set(),
      };
    };
  }
}

class BuildReachabilitySet implements QueryPlanStage {
  constructor(
    private readonly id: string,
    private readonly edge: ASTEdge,
  ) {}

  stageName(): string {
    return 'build_reachability_set';
  }

  stageChildren(): QueryPlanStage[] {
    return [];
  }

  stageData(): QueryPlanStageData {
    return [
      ['id', this.id],
      ['edge', formatEdge(this.edge)],
    ];
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
        edges.push({ edge, next, forbiddenDirection: 'LEFT' });
      }
      for (const [edge, next] of graph.incomingNeighbors(head)) {
        edges.push({ edge, next, forbiddenDirection: 'RIGHT' });
      }
      for (const { edge, next, forbiddenDirection } of edges) {
        if (
          this.edge.direction !== forbiddenDirection &&
          edgeMatches(edge, this.edge)
        ) {
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

class MatchNode extends MatchStep {
  constructor(
    readonly node: ASTNode,
    readonly allowNewVariables: boolean,
  ) {
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
    return [
      ['name', n.name],
      ['label', n.label === null ? null : formatLabelExpression(n.label)],
      [
        'properties',
        n.properties === null ? null : formatMapLiteral(n.properties),
      ],
    ];
  }

  override *match(
    graph: Graph<Value>,
    pos: PathMatch,
    queryStats: QueryStatsState,
  ): IterableIterator<PathMatch> {
    if (!nodeMatches(pos.head, this.node, queryStats)) {
      return;
    }
    const name = this.node.name;
    let match = pos.match;
    if (name) {
      if (pos.match.has(name)) {
        const old = pos.match.get(name);
        if (tryCastNodeRef(old) !== pos.head.id) {
          return;
        }
      } else if (!this.allowNewVariables) {
        throw new Error(
          `Attempting to bind variable ${JSON.stringify(name)} in a position where it is not allowed`,
        );
      } else {
        match = match.set(name, nodeRefValue(pos.head.id));
      }
    }
    yield {
      match,
      traversedEdges: pos.traversedEdges,
      head: pos.head,
    };
  }
}

class MatchEdge extends MatchStep {
  constructor(
    readonly edge: ASTEdge,
    readonly allowNewVariables: boolean,
  ) {
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
    return [
      ['name', e.name],
      ['direction', e.direction === 'NONE' ? null : e.direction],
      ['label', e.label === null ? null : formatLabelExpression(e.label)],
      [
        'properties',
        e.properties === null ? null : formatMapLiteral(e.properties),
      ],
      [
        'quantifier',
        e.quantifier === null ? null : JSON.stringify(e.quantifier),
      ],
    ];
  }

  override *match(
    graph: Graph<Value>,
    pos: PathMatch,
    queryStats: QueryStatsState,
  ): IterableIterator<PathMatch> {
    const edges = [];
    for (const [edge, next] of graph.outgoingNeighbors(pos.head)) {
      edges.push({ edge, next, forbiddenDirection: 'LEFT' });
    }
    for (const [edge, next] of graph.incomingNeighbors(pos.head)) {
      edges.push({ edge, next, forbiddenDirection: 'RIGHT' });
    }
    for (const { edge, next, forbiddenDirection } of edges) {
      const direction = this.edge.direction;
      if (
        !pos.traversedEdges.has(edge) &&
        direction !== forbiddenDirection &&
        edgeMatches(edge, this.edge)
      ) {
        const name = this.edge.name;
        let match = pos.match;
        if (name) {
          if (pos.match.has(name)) {
            const old = pos.match.get(name);
            if (tryCastEdgeRef(old) !== edge.id) {
              continue;
            }
          } else if (!this.allowNewVariables) {
            throw new Error(
              `Attempting to bind variable ${JSON.stringify(name)} in a position where it is not allowed`,
            );
          } else {
            match = match.set(name, edgeRefValue(edge.id));
          }
        }
        const subTraversed = new Set(pos.traversedEdges);
        subTraversed.add(edge);
        yield {
          match,
          traversedEdges: subTraversed,
          head: next,
        };
      }
    }
  }
}

class MatchQuantified extends MatchStep {
  constructor(
    readonly inner: MatchStep,
    readonly min: number,
    readonly max: number,
    readonly freeVariables: Set<string>,
  ) {
    super();
  }

  override stageName(): string {
    return 'match_quantified';
  }

  override stageChildren(): QueryPlanStage[] {
    return [this.inner];
  }

  override stageData(): Array<[string, string]> {
    return [
      ['min', this.min.toString()],
      ['max', this.max.toString()],
    ];
  }

  override *match(
    graph: Graph<Value>,
    pos: PathMatch,
    queryStats: QueryStatsState,
  ): IterableIterator<PathMatch> {
    const emptyVariables = new Map<string, Array<Value>>();
    for (const k of this.freeVariables) {
      emptyVariables.set(k, []);
    }
    let matches = [
      {
        pathMatch: pos,
        variables: emptyVariables,
      },
    ];
    let length = 0;
    while (length < this.max && matches.length) {
      if (length >= this.min) {
        for (const m of matches) {
          let match = pos.match;
          for (const [k, v] of m.variables) {
            match = match.set(k, listValue(v));
          }
          yield {
            match,
            head: m.pathMatch.head,
            traversedEdges: m.pathMatch.traversedEdges,
          };
        }
      }
      const newMatches = [];
      for (const p of matches) {
        const scope = new Scope(pos.match);
        const innerMatches = this.inner.match(
          graph,
          {
            match: scope,
            head: p.pathMatch.head,
            traversedEdges: p.pathMatch.traversedEdges,
          },
          queryStats,
        );
        for (const m of innerMatches) {
          const variables = new Map(p.variables);
          for (const [k, v] of m.match.ownVars()) {
            variables.set(k, [...(variables.get(k) ?? []), v]);
          }
          newMatches.push({
            pathMatch: m,
            variables,
          });
        }
      }
      matches = newMatches;
      length++;
    }
  }
}

export interface PathMatch {
  match: Match;
  head: Node<Value>;
  traversedEdges: Set<Edge<Value>>;
}

export function matchSteps(
  path: Path,
  allowNewVariables: boolean,
): MatchStep[] {
  const steps: MatchStep[] = [];
  steps.push(new MatchNode(path.nodes[0], allowNewVariables));
  for (let i = 0; i < path.edges.length; i++) {
    const edge = path.edges[i];
    if (edge.quantifier) {
      const freeVariables = new Set<string>();
      if (edge.name) {
        freeVariables.add(edge.name);
      }
      steps.push(
        new MatchQuantified(
          new MatchEdge(edge, allowNewVariables),
          edge.quantifier.min,
          edge.quantifier.max,
          freeVariables,
        ),
      );
    } else {
      steps.push(new MatchEdge(edge, allowNewVariables));
    }
    steps.push(new MatchNode(path.nodes[i + 1], allowNewVariables));
  }
  return steps;
}

// TODO: Should this take an Iterator<Match> as input?
export function prepareExpandMatch(
  initializer: MatchInitializer,
  steps: MatchStep[],
  graph: Graph<Value>,
  queryStats: QueryStatsState,
): (match: Match) => IterableIterator<Match> {
  interface Submatch {
    pathMatch: PathMatch;
    step: number;
  }
  const preparedInitializer = initializer.prepareInitial(graph);
  return function* (match: Match) {
    let submatchIters = [
      iter(preparedInitializer(match)).map((p) => ({
        pathMatch: p,
        step: 0,
      })),
    ];
    while (true) {
      const submatches = submatchIters.pop();
      if (!submatches) {
        return;
      }
      for (const submatch of submatches) {
        if (submatch.step == steps.length) {
          yield submatch.pathMatch.match;
        } else {
          submatchIters.push(
            iter(
              steps[submatch.step].match(graph, submatch.pathMatch, queryStats),
            ).map((p) => ({ pathMatch: p, step: submatch.step + 1 })),
          );
        }
      }
    }
  };
}

type FunctionPlan = (args: Value[], variables: Match) => Value;

export type Func = (
  graph: Graph<Value>,
  queryStats: QueryStatsState,
) => FunctionPlan;

export interface EvaluateStage extends QueryPlanStage {
  execute(
    graph: Graph<Value>,
    queryStats: QueryStatsState,
    functions: Map<string, Func>,
  ): (variables: Match) => Value;
}

export function fixedID(node: ASTNode): string | undefined {
  const idExpression = node.properties
    ?.filter(([k, v]) => k === '_ID')
    ?.map(([k, v]) => v)?.[0];
  let id: string | undefined = undefined;
  if (idExpression?.kind === 'string') {
    return idExpression.value;
  }
  return undefined;
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

export function reversePath(path: Path): Path {
  return {
    nodes: toReversed(path.nodes),
    edges: toReversed(path.edges).map((e) => ({
      ...e,
      direction: reverseDirection(e.direction),
    })),
  };
}

function planConstant(value: Value): EvaluateStage {
  return {
    stageName: () => 'constant',
    stageChildren(): QueryPlanStage[] {
      return [];
    },
    stageData: () => [['value', value]],
    execute(
      graph: Graph<Value>,
      queryStats: QueryStatsState,
      functions: Map<string, Func>,
    ): (variables: Match) => Value {
      return () => value;
    },
  };
}

export function planReadPath(
  path: Path,
  allowNewVariables: boolean,
): MatchExpandStage {
  if (
    path.nodes.length === 2 &&
    path.edges[0].quantifier?.min === 0 &&
    path.edges[0].quantifier?.max === 1 / 0 &&
    !path.edges[0].name
  ) {
    const last = path.nodes.length - 1;
    const firstID = fixedID(path.nodes[0]);
    const lastID = fixedID(path.nodes[last]);
    const goodForward =
      firstID && path.nodes[last].name && nodeOnlyMatchesID(path.nodes[0]);
    const goodBackward =
      lastID && path.nodes[0].name && nodeOnlyMatchesID(path.nodes[last]);
    if (goodForward || goodBackward) {
      let startID = firstID;
      if (!goodForward) {
        startID = lastID;
        path = reversePath(path);
      }
      const build = new BuildReachabilitySet(startID ?? '', path.edges[0]);
      const check = new CheckReachabilitySet(path.nodes[last].name ?? '');
      return {
        stageName: () => 'read_path',
        stageChildren(): QueryPlanStage[] {
          return [build, check];
        },
        stageData: () => [],
        prepare(
          graph: Graph<Value>,
          queryStats: QueryStatsState,
        ): MatchExpander {
          const reachabilitySet = build.build(graph, queryStats);
          return {
            execute(match: Match): IterableIterator<Match> {
              return (function* () {
                if (check.matches(reachabilitySet, match)) {
                  yield match;
                }
              })();
            },
          };
        },
      };
    }
  }
  const firstID = fixedID(path.nodes[0]);
  const lastID = fixedID(path.nodes[path.nodes.length - 1]);
  let initializer: MatchInitializer;
  if (firstID) {
    initializer = new MoveHeadToID(firstID);
  } else if (lastID) {
    path = reversePath(path);
    initializer = new MoveHeadToID(lastID);
  } else if (
    !allowNewVariables &&
    (path.nodes[0].name || path.nodes[path.nodes.length - 1].name)
  ) {
    // TODO: Use this initializer if the variable is guaranteed to be set, not
    // just if allowNewVariables is false.
    if (!path.nodes[0].name && path.nodes[path.nodes.length - 1].name) {
      path = reversePath(path);
    }
    initializer = new MoveHeadToVariable(path.nodes[0].name!);
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
    prepare(graph: Graph<Value>, queryStats: QueryStatsState): MatchExpander {
      const expandMatch = prepareExpandMatch(
        initializer,
        steps,
        graph,
        queryStats,
      );
      return {
        execute(match: Match): IterableIterator<Match> {
          return expandMatch(match);
        },
      };
    },
  };
}

function planEvaluatePathExistence(path: Path): EvaluateStage {
  const readPath = planReadPath(path, false);
  return {
    stageName: () => 'match_path_existence',
    stageChildren(): QueryPlanStage[] {
      return [readPath];
    },
    stageData: () => null,
    execute(
      graph: Graph<Value>,
      queryStats: QueryStatsState,
      functions: Map<string, Func>,
    ): (match: Match) => Value {
      const read = readPath.prepare(graph, queryStats, functions);
      return (match) => {
        return booleanValue(!read.execute(match).next().done);
      };
    },
  };
}

function nodeOnlyMatchesID(node: ASTNode): boolean {
  return (
    node.name === null &&
    node.label === null &&
    !node.properties?.some(([k, v]) => k !== '_ID')
  );
}

export function planEvaluate(expression: Expression): EvaluateStage {
  if (expression.kind === 'string') {
    return planConstant(stringValue(expression.value));
  } else if (expression.kind === 'number') {
    return planConstant(numberValue(expression.value));
  } else if (expression.kind === 'identifier') {
    return {
      stageName: () => 'identifier',
      stageChildren(): QueryPlanStage[] {
        return [];
      },
      stageData: () => [['name', expression.value]],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
        functions: Map<string, Func>,
      ): (variables: Match) => Value {
        return (variables: Match) => {
          const v = variables.get(expression.value);
          if (!v) {
            throw new Error(
              `Variable ${JSON.stringify(expression.value)} not found`,
            );
          }
          return v;
        };
      },
    };
  } else if (expression.kind === 'and') {
    const children = expression.value.map(planEvaluate);
    return {
      stageName: () => 'and',
      stageChildren(): QueryPlanStage[] {
        return children;
      },
      stageData: () => [],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
        functions: Map<string, Func>,
      ): (variables: Match) => Value {
        const evaluates = children.map((c) =>
          c.execute(graph, queryStats, functions),
        );
        return (variables: Match) => {
          for (const evaluate of evaluates) {
            // TODO: test
            const b = tryCastBoolean(evaluate(variables));
            if (b === undefined) {
              throw new Error(
                `Expression is not a boolean: ${JSON.stringify(expression.value)}`,
              );
            }
            if (!b) {
              return FALSE;
            }
          }
          return TRUE;
        };
      },
    };
  } else if (expression.kind === 'or') {
    const children = expression.value.map(planEvaluate);
    return {
      stageName: () => 'or',
      stageChildren(): QueryPlanStage[] {
        return children;
      },
      stageData: () => [],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
        functions: Map<string, Func>,
      ): (variables: Match) => Value {
        const evaluates = children.map((c) =>
          c.execute(graph, queryStats, functions),
        );
        return (variables: Match) => {
          for (const evaluate of evaluates) {
            // TODO: test
            const b = tryCastBoolean(evaluate(variables));
            if (b === undefined) {
              throw new Error(
                `Expression is not a boolean: ${JSON.stringify(expression.value)}`,
              );
            }
            if (b) {
              return TRUE;
            }
          }
          return FALSE;
        };
      },
    };
  } else if (expression.kind === 'not') {
    const inner = planEvaluate(expression.value);
    return {
      stageName: () => 'not',
      stageChildren(): QueryPlanStage[] {
        return [inner];
      },
      stageData: () => [],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
        functions: Map<string, Func>,
      ): (variables: Match) => Value {
        const evaluate = inner.execute(graph, queryStats, functions);
        return (variables: Match) => {
          // TODO: test
          const b = tryCastBoolean(evaluate(variables));
          if (b === undefined) {
            throw new Error(
              `Expression is not a boolean: ${JSON.stringify(expression.value)}`,
            );
          }
          return booleanValue(!b);
        };
      },
    };
  } else if (expression.kind === 'path') {
    return planEvaluatePathExistence(expression.value);
  } else if (expression.kind === 'functionCall') {
    const plans = expression.args.map(planEvaluate);
    return {
      stageName: () => 'functionCall',
      stageChildren(): QueryPlanStage[] {
        return plans;
      },
      stageData: () => [['function', expression.name]],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
        functions: Map<string, Func>,
      ): (variables: Match) => Value {
        const func = functions.get(expression.name);
        if (!func) {
          throw new Error(`Unrecognized function: ${expression.name}`);
        }
        const funcEvaluate = func(graph, queryStats);
        const argsEvaluate = plans.map((arg: EvaluateStage) =>
          arg.execute(graph, queryStats, functions),
        );
        return (variables: Match) => {
          const argValues = argsEvaluate.map((arg: (m: Match) => Value) =>
            arg(variables),
          );
          return funcEvaluate(argValues, variables);
        };
      },
    };
  } else if (expression.kind === 'comparison') {
    const leftPlan = planEvaluate(expression.left);
    const rightPlan = planEvaluate(expression.right);
    let compare: (c: number | null) => Value;
    if (expression.op === '<>') {
      compare = (c) => {
        if (c === null) {
          return NULL;
        }
        return booleanValue(c != 0);
      };
    } else {
      throw new Error(
        `Unrecognized comparison: ${JSON.stringify(expression.op)}`,
      );
    }
    return {
      stageName: () => 'comparison',
      stageChildren(): QueryPlanStage[] {
        return [leftPlan, rightPlan];
      },
      stageData: () => [['op', expression.op]],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
        functions: Map<string, Func>,
      ): (variables: Match) => Value {
        const evaluateLeft = leftPlan.execute(graph, queryStats, functions);
        const evaluateRight = rightPlan.execute(graph, queryStats, functions);
        return (variables: Match) => {
          return compare(
            compareValues(evaluateLeft(variables), evaluateRight(variables)),
          );
        };
      },
    };
  } else {
    throw new Error(`Unrecognized expression: ${JSON.stringify(expression)}`);
  }
}
