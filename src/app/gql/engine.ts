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

import {
  createPerMatch,
  makeCreatePlan,
  planCreate,
  prepareCreate,
} from './engine-create';
import {
  fixedID,
  Func,
  Match,
  MatchInitializer,
  MatchStep,
  matchSteps,
  MoveHeadToID,
  MoveHeadToVariable,
  PathMatch,
  planEvaluate,
  prepareExpandMatch,
  QueryPlanStage,
  QueryPlanStageData,
  QueryStatsState,
  reversePath,
  ScanGraph,
  Scope,
  Stage,
  State,
} from './engine-core';
import {
  formatEdge,
  formatExpression,
  formatPath,
  formatRemoveItem,
  formatSetItem,
  quoteIdentifier,
} from './formatter';
import { Edge, Graph, GraphMutation, Node } from './graph';
import {
  Direction,
  Edge as ASTEdge,
  Expression,
  Merge,
  Node as ASTNode,
  Delete,
  Path,
  Query as ASTQuery,
  ReadClause,
  RemoveClause,
  ReturnClause,
  SingleQuery,
  SetClause,
  UpdateClause,
} from './parser';
import {
  listValue,
  serializeValue,
  stringValue,
  tryCastBoolean,
  tryCastEdgeRef,
  tryCastNodeRef,
  tryCastNull,
  Value,
  ValueArraySet,
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

  root(): QueryPlanStage;
}

export function describeQueryPlan(plan: QueryPlan): string {
  return describeQueryPlanStage(plan.root(), 0);
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
          if (typeof v === 'string') {
            details += v;
          } else {
            details += JSON.stringify(serializeValue(v));
          }
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
  prepare(
    graph: Graph<Value>,
    queryStats: QueryStatsState,
    functions: Map<string, Func>,
  ): PreparedStagelet;
}

interface PreparedStagelet {
  execute(matches: Match): IterableIterator<Match>;
}

interface FilterStage extends QueryPlanStage {
  execute(
    graph: Graph<Value>,
    queryStats: QueryStatsState,
    functions: Map<string, Func>,
  ): (match: Match) => boolean;
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

function filterMatches(filter: FilterStage): Stagelet {
  return {
    ...filter,
    prepare(
      graph: Graph<Value>,
      queryStats: QueryStatsState,
      functions: Map<string, Func>,
    ): PreparedStagelet {
      const matchFilter = filter.execute(graph, queryStats, functions);
      return {
        execute(match: Match): IterableIterator<Match> {
          return (function* () {
            if (matchFilter(match)) {
              yield match;
            }
          })();
        },
      };
    },
  };
}

function filterByExpression(expression: Expression): FilterStage {
  const evaluate = planEvaluate(expression);
  return {
    stageName: () => 'filter_by_expression',
    stageChildren(): QueryPlanStage[] {
      return [evaluate];
    },
    stageData: () => [['expression', formatExpression(expression)]],
    execute(
      graph: Graph<Value>,
      queryStats: QueryStatsState,
      functions: Map<string, Func>,
    ): (match: Match) => boolean {
      const matcher = evaluate.execute(graph, queryStats, functions);
      return (match: Match) => {
        const value = matcher(match);
        const b = tryCastBoolean(value);
        if (b !== undefined) {
          return b;
        }
        if (tryCastNull(value) !== undefined) {
          return false;
        }
        throw new Error(
          `Non-boolean value used as a predicate: ${JSON.stringify(serializeValue(value))}`,
        );
      };
    },
  };
}

// TODO: unify with planEvaluatePathExistence in engine-core.ts.
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
    prepare(
      graph: Graph<Value>,
      queryStats: QueryStatsState,
    ): PreparedStagelet {
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

interface ReadPlan {
  stages: Stagelet[];
}

interface PreparedReadPlan {
  stages: PreparedStagelet[];
}

function makeReadPlan(paths: Path[], where: Expression | null): ReadPlan {
  const stages = paths.map((p) => planReadPath(p, true));
  if (where) {
    stages.push(filterMatches(filterByExpression(where)));
  }
  return { stages };
}

function planRead(read: ReadClause): Stage {
  const plan = makeReadPlan(read.paths, read.where);
  return {
    stageName: () => 'read',
    stageChildren(): QueryPlanStage[] {
      return plan.stages;
    },
    stageData: () => null,
    execute(state: State): void {
      let matches = state.matches;
      for (const stage of plan.stages) {
        const preparedStage = stage.prepare(
          state.graph,
          state.queryStats,
          state.functions,
        );
        matches = matches.flatMap((m) => [...preparedStage.execute(m)]);
      }
      state.matches = matches;
    },
  };
}

function planMerge(merge: Merge): Stage {
  const readPlan = makeReadPlan([merge.path], null);
  const readStage: QueryPlanStage = {
    stageName: () => 'merge_read',
    stageChildren: () => readPlan.stages,
    stageData: () => null,
  };
  const createPlan = makeCreatePlan(merge.path);
  const createStage: QueryPlanStage = {
    stageName: () => 'merge_create',
    stageChildren: () => [],
    stageData: () => formatPath(merge.path),
  };
  return {
    stageName: () => 'merge',
    stageChildren: () => [readStage, createStage],
    stageData: () => null,
    execute(state: State): void {
      const preparedReadStages = readPlan.stages.map((s) =>
        s.prepare(state.graph, state.queryStats, state.functions),
      );
      const preparedCreate = prepareCreate(
        createPlan,
        state.graph,
        state.queryStats,
        state.functions,
      );
      const newMatches: Match[] = [];
      for (const stateMatch of state.matches) {
        let matches = [stateMatch];
        for (const stage of preparedReadStages) {
          matches = matches.flatMap((m) => [...stage.execute(m)]);
        }
        if (matches.length) {
          newMatches.push(...matches);
        } else {
          state.graph = state.graph.withMutations((mutation) => {
            newMatches.push(
              createPerMatch(stateMatch, preparedCreate, state, mutation),
            );
          });
        }
      }
      state.matches = newMatches;
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
        const partialExpression = expression.execute(
          graph,
          queryStats,
          functions,
        );
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
  } else if (update.kind === 'merge') {
    return planMerge(update);
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
        e.execute(state.graph, state.queryStats, state.functions),
      );
      state.returnValue = state.matches.map((m) =>
        partialExpressions.map((e) => e(m)),
      );
    },
  };
}

function planSequence(stages: Stage[]): Stage {
  if (stages.length === 1) {
    return stages[0];
  }
  return {
    stageName: () => 'sequential',
    stageChildren: () => stages,
    stageData: () => null,
    execute(state: State) {
      for (const stage of stages) {
        stage.execute(state);
      }
    },
  };
}

function planSingleQuery(singleQuery: SingleQuery): Stage {
  const stages: Array<Stage> = [];
  for (const read of singleQuery.reads) {
    stages.push(planRead(read));
  }
  for (const update of singleQuery.updates) {
    stages.push(planUpdate(update));
  }
  if (singleQuery.returnClause) {
    stages.push(planReturn(singleQuery.returnClause));
  }
  return planSequence(stages);
}

function planUnionAll(stages: Stage[]): Stage {
  return {
    stageName: () => 'union_all',
    stageChildren: () => stages,
    stageData: () => null,
    execute(state: State) {
      const result: Value[][] = [];
      for (const stage of stages) {
        state.returnValue = undefined;
        stage.execute(state);
        const data = state.returnValue;
        if (!data) {
          throw new Error(
            'Internal error: UNION subquery did not set return value',
          );
        }
        // There's some weird bug here.  If we inline tmp, we get:
        //   Type 'never' must have a '[Symbol.iterator]()' method that returns an iterator
        // This happens even if we explicitly give data the type Value[][]|undefined.
        const tmp: Value[][] = data;
        result.push(...tmp);
      }
      state.returnValue = result;
    },
  };
}

function planUnionDistinct(stages: Stage[]): Stage {
  return {
    stageName: () => 'union_distinct',
    stageChildren: () => stages,
    stageData: () => null,
    execute(state: State) {
      const result = new ValueArraySet();
      for (const stage of stages) {
        state.returnValue = undefined;
        stage.execute(state);
        const data = state.returnValue;
        if (!data) {
          throw new Error(
            'Internal error: UNION subquery did not set return value',
          );
        }
        // There's some weird bug here.  If we inline tmp, we get:
        //   Type 'never' must have a '[Symbol.iterator]()' method that returns an iterator
        // This happens even if we explicitly give data the type Value[][]|undefined.
        const tmp: Value[][] = data;
        for (const row of tmp) {
          result.add(row);
        }
      }
      state.returnValue = [...result];
    },
  };
}

const DEFAULT_MAX_NODE_VISITS = 1000;

export interface QueryOptions {
  maxNodeVisits?: number;
}

export function planQuery(query: ASTQuery, options?: QueryOptions): QueryPlan {
  let root = planSingleQuery(query.singleQuery);
  if (query.unions.length) {
    const all = query.unions[0].all;
    if (query.unions.some((u) => u.all !== all)) {
      throw new Error('Mixing UNION and UNION ALL is not allowed');
    }
    const parts = [root];
    for (const union of query.unions) {
      parts.push(planSingleQuery(union.singleQuery));
    }
    if (all) {
      root = planUnionAll(parts);
    } else {
      root = planUnionDistinct(parts);
    }
  }
  let nextNodeID = 0;
  let nextEdgeID = 0;
  let nodesVisited = 0;
  const maxNodeVisits = options?.maxNodeVisits ?? DEFAULT_MAX_NODE_VISITS;
  return {
    root: () => root,
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
      root.execute(state);
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
