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

import { planCreate } from './engine-create';
import {
  edgeMatches,
  expandMatch,
  Func,
  Match,
  MatchInitializer,
  MatchStep,
  matchSteps,
  PathMatch,
  planEvaluate,
  QueryPlanStage,
  QueryPlanStageData,
  QueryStatsState,
  ScanGraph,
  Scope,
  Stage,
  State,
} from './engine-core';
import {
  formatEdge,
  formatExpression,
  formatRemoveItem,
  formatSetItem,
  quoteIdentifier,
} from './formatter';
import { Edge, Graph, GraphMutation, Node } from './graph';
import {
  Direction,
  Edge as ASTEdge,
  Expression,
  Delete,
  Node as ASTNode,
  Path,
  Query as ASTQuery,
  ReadClause,
  RemoveClause,
  ReturnClause,
  SetClause,
  UpdateClause,
} from './parser';
import {
  checkCastNodeRef,
  listValue,
  serializeValue,
  stringValue,
  tryCastEdgeRef,
  tryCastNodeRef,
  Value,
} from './values';

export interface QueryStats {
  nodesVisited: number;
}

export interface ExecuteQueryResult {
  graph: Graph<Value>;
  data: Array<Array<Value>> | undefined;
  stats: QueryStats;
}

export interface QueryPlan {
  execute(graph: Graph<Value>): ExecuteQueryResult;

  stages(): QueryPlanStage[];
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

// For every A in left and B in right such that their common keys map to the
// same values, output A+B.
function joinMatches(left: Match[], right: Match[]): Match[] {
  if (left.length === 0 || right.length === 0) {
    return [];
  }
  const m1 = left[0];
  const m2 = right[0];
  const commonKeys = [...m1.keys().intersect(m2.keys())];
  commonKeys.sort();
  const joinKey = (match: Match) =>
    JSON.stringify(commonKeys.map((k) => serializeValue(match.get(k)!)));
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
      const leftMap = leftMatch.toImmutableMap();
      const rightMap = m.toImmutableMap();
      result.push(new Scope(undefined, leftMap.merge(rightMap)));
    }
  }
  return result;
}

interface Stagelet extends QueryPlanStage {
  execute(
    matches: Match[],
    graph: Graph<Value>,
    queryStats: QueryStatsState,
  ): Match[];
}

interface FilterStage extends QueryPlanStage {
  execute(
    graph: Graph<Value>,
    queryStats: QueryStatsState,
  ): (match: Match) => boolean;
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

  override *initial(
    match: Match,
    graph: Graph<Value>,
  ): IterableIterator<PathMatch> {
    const value = match.get(this.variableName);
    if (value === undefined) {
      throw new Error(`Variable ${this.variableName} not defined`);
    }
    const nodeID = checkCastNodeRef(value);
    if (nodeID === undefined) {
      throw new Error(
        `Variable ${this.variableName} is not a node (${JSON.stringify(value)})`,
      );
    }
    const node = graph.getNodeByID(nodeID);
    if (node === undefined) {
      throw new Error(
        `Node ${nodeID} (from variable ${this.variableName}) not found`,
      );
    }
    yield {
      match,
      head: node,
      // This won't work once we use this class within the same graph pattern, i.e. multiple
      // paths within the same MATCH.
      traversedEdges: new Set(),
    };
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

  override *initial(
    match: Match,
    graph: Graph<Value>,
  ): IterableIterator<PathMatch> {
    const node = graph.getNodeByID(this.id);
    if (node === undefined) {
      throw new Error(`Node ${this.id} not found`);
    }
    yield {
      match,
      head: node,
      // This won't work once we use this class within the same graph pattern, i.e. multiple
      // paths within the same MATCH.
      traversedEdges: new Set(),
    };
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

  override *match(
    graph: Graph<Value>,
    pos: PathMatch,
  ): IterableIterator<PathMatch> {
    for (const startNode of graph.nodes) {
      yield {
        match: pos.match,
        head: startNode,
        traversedEdges: pos.traversedEdges,
      };
    }
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
    edges: toReversed(path.edges).map((e) => ({
      ...e,
      direction: reverseDirection(e.direction),
    })),
  };
}

function filterMatches(filter: FilterStage): Stagelet {
  return {
    ...filter,
    execute(
      matches: Match[],
      graph: Graph<Value>,
      queryStats: QueryStatsState,
    ): Match[] {
      return matches.filter(filter.execute(graph, queryStats));
    },
  };
}

function filterByExpression(expression: Expression): FilterStage {
  if (expression.kind === 'path') {
    return filterByPathExistence(expression.value);
  } else if (expression.kind === 'not') {
    const child = filterByExpression(expression.value);
    return {
      stageName: () => 'filter_not',
      stageChildren(): QueryPlanStage[] {
        return [child];
      },
      stageData: () => [],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
      ): (match: Match) => boolean {
        const childFilter = child.execute(graph, queryStats);
        return (match) => !childFilter(match);
      },
    };
  } else if (expression.kind === 'and') {
    const children = expression.value.map(filterByExpression);
    return {
      stageName: () => 'filter_and',
      stageChildren(): QueryPlanStage[] {
        return children;
      },
      stageData: () => [],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
      ): (match: Match) => boolean {
        const childFilters = children.map((c) => c.execute(graph, queryStats));
        return (match) => childFilters.every((c) => c(match));
      },
    };
  } else if (expression.kind === 'or') {
    const children = expression.value.map(filterByExpression);
    return {
      stageName: () => 'filter_or',
      stageChildren(): QueryPlanStage[] {
        return children;
      },
      stageData: () => [],
      execute(
        graph: Graph<Value>,
        queryStats: QueryStatsState,
      ): (match: Match) => boolean {
        const childFilters = children.map((c) => c.execute(graph, queryStats));
        return (match) => childFilters.some((c) => c(match));
      },
    };
  } else {
    throw new Error(
      `Unimplemented WHERE clause: ${JSON.stringify(expression)}`,
    );
  }
}

function filterByPathExistence(path: Path): FilterStage {
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
        stageName: () => 'match_path_existence',
        stageChildren(): QueryPlanStage[] {
          return [build, check];
        },
        stageData: () => [],
        execute(
          graph: Graph<Value>,
          queryStats: QueryStatsState,
        ): (match: Match) => boolean {
          const reachabilitySet = build.build(graph, queryStats);
          return (m) => check.matches(reachabilitySet, m);
        },
      };
    }
  }
  let initializer: MatchInitializer;
  const firstID = fixedID(path.nodes[0]);
  const lastID = fixedID(path.nodes[path.nodes.length - 1]);
  if (firstID) {
    initializer = new MoveHeadToID(firstID);
  } else if (lastID) {
    path = reversePath(path);
    initializer = new MoveHeadToID(lastID);
  } else if (path.nodes[0].name || path.nodes[path.nodes.length - 1].name) {
    if (!path.nodes[0].name && path.nodes[path.nodes.length - 1].name) {
      path = reversePath(path);
    }
    initializer = new MoveHeadToVariable(path.nodes[0].name!);
  } else {
    initializer = new ScanGraph();
  }
  const steps = matchSteps(path, false);
  return {
    stageName: () => 'match_path_existence',
    stageChildren(): QueryPlanStage[] {
      return [initializer, ...steps];
    },
    stageData: () => null,
    execute(
      graph: Graph<Value>,
      queryStats: QueryStatsState,
    ): (match: Match) => boolean {
      return (match) => {
        const expanded = expandMatch(
          initializer,
          steps,
          match,
          graph,
          queryStats,
        );
        return !expanded.next().done;
      };
    },
  };
}

function fixedID(node: ASTNode): string | undefined {
  const idExpression = node.properties
    ?.filter(([k, v]) => k === '_ID')
    ?.map(([k, v]) => v)?.[0];
  let id: string | undefined = undefined;
  if (idExpression?.kind === 'string') {
    return idExpression.value;
  }
  return undefined;
}

function nodeOnlyMatchesID(node: ASTNode): boolean {
  return (
    node.name === null &&
    node.label === null &&
    !node.properties?.some(([k, v]) => k !== '_ID')
  );
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
    execute(
      stateMatches: Match[],
      graph: Graph<Value>,
      queryStats: QueryStatsState,
    ): Match[] {
      const matches: Match[] = [];
      for (const match of stateMatches) {
        matches.push(
          ...expandMatch(initializer, steps, match, graph, queryStats),
        );
      }
      return matches;
    },
  };
}

function planRead(read: ReadClause): Stage {
  const stages = read.paths.map((p) => planReadPath(p, true));
  if (read.where) {
    stages.push(filterMatches(filterByExpression(read.where)));
  }
  return {
    stageName: () => 'read',
    stageChildren(): QueryPlanStage[] {
      return stages;
    },
    stageData: () => null,
    execute(state: State): void {
      let matches = state.matches;
      for (const stage of stages) {
        matches = stage.execute(matches, state.graph, state.queryStats);
      }
      state.matches = matches;
    },
  };
}

function planDelete(delete_: Delete): Stage {
  return {
    stageName: () => 'delete',
    stageChildren: () => [],
    stageData: () => quoteIdentifier(delete_.name),
    execute(state: State): void {
      state.graph = state.graph.withMutations((m) => {
        for (const match of state.matches) {
          const value = match.get(delete_.name);
          if (!value) {
            throw new Error(
              `variable ${JSON.stringify(delete_.name)} not defined`,
            );
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
          throw new Error(
            `variable ${JSON.stringify(delete_.name)} is not a node or edge`,
          );
        }
      });
    },
  };
}

function planSet(set_: SetClause): Stage {
  const items = set_.items.map((item) => {
    if (item.kind === 'setProperty') {
      if (item.property.chain.length !== 1) {
        throw new Error(`SET only supports VARIABLE.PROPERTY, with no nesting`);
      }
      const variable = item.property.root;
      const property = item.property.chain[0];
      const expression = planEvaluate(item.expression);
      return (
        graph: Graph<Value>,
        m: GraphMutation<Value>,
        queryStats: QueryStatsState,
        functions: Map<string, Func>,
      ) => {
        const partialExpression = expression(graph, queryStats, functions);
        return (match: Match) => {
          const value = match.get(variable);
          if (!value) {
            throw new Error(`variable ${JSON.stringify(variable)} not defined`);
          }
          const nodeRef = tryCastNodeRef(value);
          if (nodeRef !== undefined) {
            const v = partialExpression(match);
            m.updateNodeProperties(nodeRef, (p) => p.set(property, v));
            return;
          }
          const edgeRef = tryCastEdgeRef(value);
          if (edgeRef !== undefined) {
            const v = partialExpression(match);
            m.updateEdgeProperties(edgeRef, (p) => p.set(property, v));
            return;
          }
          throw new Error(
            `variable ${JSON.stringify(variable)} is not a node or edge`,
          );
        };
      };
    } else {
      const variable = item.variable;
      const labels = item.labels;
      return (graph: Graph<Value>, m: GraphMutation<Value>) =>
        (match: Match) => {
          const value = match.get(variable);
          if (!value) {
            throw new Error(`variable ${JSON.stringify(variable)} not defined`);
          }
          const nodeRef = tryCastNodeRef(value);
          if (nodeRef !== undefined) {
            m.updateNodeLabels(nodeRef, (s) => s.union(labels));
            return;
          }
          const edgeRef = tryCastEdgeRef(value);
          if (edgeRef !== undefined) {
            m.updateEdgeLabels(edgeRef, (s) => s.union(labels));
            return;
          }
          throw new Error(
            `variable ${JSON.stringify(variable)} is not a node or edge`,
          );
        };
    }
  });
  return {
    stageName: () => 'set',
    stageChildren(): QueryPlanStage[] {
      return set_.items.map((item) => ({
        stageName: () => 'set_item',
        stageChildren: () => [],
        stageData: () => formatSetItem(item),
      }));
    },
    stageData: () => null,
    execute(state: State): void {
      state.graph = state.graph.withMutations((m) => {
        const partialItems = items.map((item) =>
          item(state.graph, m, state.queryStats, state.functions),
        );
        for (const match of state.matches) {
          for (const item of partialItems) {
            item(match);
          }
        }
      });
    },
  };
}

function planRemove(remove_: RemoveClause): Stage {
  const items = remove_.items.map((item) => {
    if (item.kind === 'removeProperty') {
      if (item.property.chain.length !== 1) {
        throw new Error(
          `REMOVE only supports VARIABLE.PROPERTY, with no nesting`,
        );
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
          m.updateNodeProperties(nodeRef, (p) => p.remove(property));
          return;
        }
        const edgeRef = tryCastEdgeRef(value);
        if (edgeRef !== undefined) {
          m.updateEdgeProperties(edgeRef, (p) => p.remove(property));
          return;
        }
        throw new Error(
          `variable ${JSON.stringify(variable)} is not a node or edge`,
        );
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
          m.updateNodeLabels(nodeRef, (s) => s.subtract(labels));
          return;
        }
        const edgeRef = tryCastEdgeRef(value);
        if (edgeRef !== undefined) {
          m.updateEdgeLabels(edgeRef, (s) => s.subtract(labels));
          return;
        }
        throw new Error(
          `variable ${JSON.stringify(variable)} is not a node or edge`,
        );
      };
    }
  });
  return {
    stageName: () => 'remove',
    stageChildren(): QueryPlanStage[] {
      return remove_.items.map((item) => ({
        stageName: () => 'remove_item',
        stageChildren: () => [],
        stageData: () => formatRemoveItem(item),
      }));
    },
    stageData: () => null,
    execute(state: State): void {
      state.graph = state.graph.withMutations((m) => {
        for (const match of state.matches) {
          for (const item of items) {
            item(match, state.graph, m);
          }
        }
      });
    },
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

function makeNodeOrEdgeFunc(f: (a: Node<Value> | Edge<Value>) => Value): Func {
  return (graph: Graph<Value>, queryStats: QueryStatsState) => {
    return (args: Value[], variables: Match) => {
      if (args.length !== 1) {
        throw new Error(`Expected 1 argument, found ${args.length}`);
      }
      const arg = args[0];
      let id = tryCastNodeRef(args[0]);
      if (id !== undefined) {
        const node = graph.getNodeByID(id);
        if (node === undefined) {
          throw new Error(`Node ${id} not found`);
        }
        return f(node);
      }
      id = tryCastEdgeRef(args[0]);
      if (id !== undefined) {
        const edge = graph.getEdgeByID(id);
        if (edge === undefined) {
          throw new Error(`Edge ${id} not found`);
        }
        return f(edge);
      }
      throw new Error(`Expected a node or edge, found ${args[0].type.kind}`);
    };
  };
}

const funcLabels: Func = makeNodeOrEdgeFunc(
  (x: Node<Value> | Edge<Value>): Value =>
    listValue([...x.labels].map(stringValue)),
);

function planReturn(returnClause: ReturnClause): Stage {
  const expressions = returnClause.values.map(planEvaluate);
  return {
    stageName: () => 'return',
    stageChildren: () => [],
    stageData(): QueryPlanStageData {
      return returnClause.values.map(formatExpression);
    },
    execute(state: State): void {
      const partialExpressions = expressions.map((e) =>
        e(state.graph, state.queryStats, state.functions),
      );
      state.returnValue = state.matches.map((m) =>
        partialExpressions.map((e) => e(m)),
      );
    },
  };
}

const DEFAULT_MAX_NODE_VISITS = 1000;

export interface QueryOptions {
  maxNodeVisits?: number;
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
              throw new Error(
                `Too many nodes visited (options.maxNodeVisits = ${maxNodeVisits})`,
              );
            }
          },
        },
        functions: new Map<string, Func>([['labels', funcLabels]]),
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
