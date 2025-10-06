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
import { formatLabelExpression, formatMapLiteral } from './formatter';
import { Edge, Graph, Node } from './graph';
import { iter } from './iter';
import {
  Edge as ASTEdge,
  Expression,
  LabelExpression,
  Node as ASTNode,
  Path,
} from './parser';
import {
  NULL,
  booleanValue,
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
  | Array<[string, string | null]>;

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

export type EvaluatePlan = (
  graph: Graph<Value>,
  queryStats: QueryStatsState,
  functions: Map<string, Func>,
) => (variables: Match) => Value;

export function planEvaluate(expression: Expression): EvaluatePlan {
  if (expression.kind === 'string') {
    const v = stringValue(expression.value);
    return () => () => v;
  } else if (expression.kind === 'number') {
    const v = numberValue(expression.value);
    return () => () => v;
  } else if (expression.kind === 'identifier') {
    return (graph: Graph<Value>) => (variables: Match) => {
      const v = variables.get(expression.value);
      if (!v) {
        throw new Error(
          `Variable ${JSON.stringify(expression.value)} not found`,
        );
      }
      return v;
    };
  } else if (expression.kind === 'not') {
    const inner = planEvaluate(expression.value);
    return (
      graph: Graph<Value>,
      queryStats: QueryStatsState,
      functions: Map<string, Func>,
    ) => {
      const evaluate = inner(graph, queryStats, functions);
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
    };
  } else if (expression.kind === 'path') {
    // TODO: test
    const steps = matchSteps(expression.value, false);
    // TODO: choose better
    const initializer = new ScanGraph();
    return (graph: Graph<Value>, queryStats: QueryStatsState) => {
      const expandMatch = prepareExpandMatch(
        initializer,
        steps,
        graph,
        queryStats,
      );
      return (variables: Match) => {
        const matches = expandMatch(variables);
        const foundMatch = !matches.next().done;
        return booleanValue(foundMatch);
      };
    };
  } else if (expression.kind === 'functionCall') {
    const plans = expression.args.map(planEvaluate);
    return (
      graph: Graph<Value>,
      queryStats: QueryStatsState,
      functions: Map<string, Func>,
    ) => {
      const func = functions.get(expression.name);
      if (!func) {
        throw new Error(`Unrecognized function: ${expression.name}`);
      }
      const funcEvaluate = func(graph, queryStats);
      const argsEvaluate = plans.map((arg: EvaluatePlan) =>
        arg(graph, queryStats, functions),
      );
      return (variables: Match) => {
        const argValues = argsEvaluate.map((arg: (m: Match) => Value) =>
          arg(variables),
        );
        return funcEvaluate(argValues, variables);
      };
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
    return (
      graph: Graph<Value>,
      queryStats: QueryStatsState,
      functions: Map<string, Func>,
    ) => {
      const evaluateLeft = leftPlan(graph, queryStats, functions);
      const evaluateRight = rightPlan(graph, queryStats, functions);
      return (variables: Match) => {
        return compare(
          compareValues(evaluateLeft(variables), evaluateRight(variables)),
        );
      };
    };
  } else {
    throw new Error(`Unrecognized expression: ${JSON.stringify(expression)}`);
  }
}
