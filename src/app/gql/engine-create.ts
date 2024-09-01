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
  EvaluatePlan,
  Func,
  Match,
  matchSteps,
  planEvaluate,
  QueryStatsState,
  Stage,
  State,
} from './engine-core';
import { formatPath } from './formatter';
import { Graph, GraphMutation } from './graph';
import { Create, Edge as ASTEdge, Node as ASTNode, Path } from './parser';
import {
  edgeRefValue,
  nodeRefValue,
  tryCastEdgeRef,
  tryCastNodeRef,
  Value,
} from './values';

interface CreateNodePlan {
  name: string | null;
  labels: string[];
  properties: Array<[string, EvaluatePlan]>;
}

interface CreateEdgePlan {
  name: string | null;
  srcOffset: number;
  dstOffset: number;
  labels: string[];
  properties: Array<[string, EvaluatePlan]>;
}

interface PartiallyEvaluatedCreateNodePlan {
  name: string | null;
  labels: string[];
  properties: Array<[string, (match: Match) => Value]>;
}

interface PartiallyEvaluatedCreateEdgePlan {
  name: string | null;
  srcOffset: number;
  dstOffset: number;
  labels: string[];
  properties: Array<[string, (match: Match) => Value]>;
}

interface CreatePlan {
  pathNodes: Array<CreateNodePlan>;
  pathEdges: Array<CreateEdgePlan>;
}

interface PartiallyEvaluatedCreatePlan {
  partiallyEvaluatedPathNodes: PartiallyEvaluatedCreateNodePlan[];
  partiallyEvaluatedPathEdges: PartiallyEvaluatedCreateEdgePlan[];
}

function planCreateNode(n: ASTNode): CreateNodePlan {
  const labels: string[] = [];
  if (n.label !== null) {
    if (n.label.kind !== 'identifier') {
      throw new Error(
        `Only plain label identifiers are allowed in CREATE clauses, but found ${JSON.stringify(n.label)}`,
      );
    }
    labels.push(n.label.value);
  }
  return {
    name: n.name,
    labels,
    properties: (n.properties ?? []).map(([k, v]) => [k, planEvaluate(v)]),
  };
}

function planCreateEdge(e: ASTEdge): CreateEdgePlan {
  const labels: string[] = [];
  if (e.label !== null) {
    if (e.label.kind !== 'identifier') {
      throw new Error(
        `Only plain label identifiers are allowed in CREATE clauses, but found ${JSON.stringify(e.label)}`,
      );
    }
    labels.push(e.label.value);
  }
  let properties: Array<[string, EvaluatePlan]> = (e.properties ?? []).map(
    ([k, v]) => {
      return [k, planEvaluate(v)];
    },
  );
  return {
    name: e.name,
    srcOffset: e.direction === 'RIGHT' ? 0 : 1,
    dstOffset: e.direction === 'RIGHT' ? 1 : 0,
    labels,
    properties: (e.properties ?? []).map(([k, v]) => [k, planEvaluate(v)]),
  };
}

function partiallyEvaluateCreate(
  createPlan: CreatePlan,
  graph: Graph<Value>,
  queryStats: QueryStatsState,
  functions: Map<string, Func>,
): PartiallyEvaluatedCreatePlan {
  return {
    partiallyEvaluatedPathNodes: createPlan.pathNodes.map((n) => ({
      ...n,
      properties: n.properties.map(([k, v]) => {
        return [k, v(graph, queryStats, functions)];
      }),
    })),
    partiallyEvaluatedPathEdges: createPlan.pathEdges.map((e) => ({
      ...e,
      properties: e.properties.map(([k, v]) => {
        return [k, v(graph, queryStats, functions)];
      }),
    })),
  };
}

function createPerMatch(
  match: Match,
  partiallyEvaluatedPlan: PartiallyEvaluatedCreatePlan,
  state: State,
  mutation: GraphMutation<Value>,
): Match {
  const nodeIDs: string[] =
    partiallyEvaluatedPlan.partiallyEvaluatedPathNodes.map((n) => {
      let properties: Array<[string, Value]> = n.properties.map(([k, v]) => {
        return [k, v(match)];
      });
      if (n.name !== null) {
        const element = match.get(n.name);
        if (!element) {
          const id = state.createNodeID();
          mutation.createNode(id, n.labels, properties);
          match = match.set(n.name, nodeRefValue(id));
          return id;
        }
        const nodeRef = tryCastNodeRef(element);
        if (nodeRef === undefined) {
          throw new Error(`variable ${JSON.stringify(n.name)} is not a node`);
        }
        return nodeRef;
      }
      const id = state.createNodeID();
      mutation.createNode(id, n.labels, properties);
      return id;
    });
  for (
    let i = 0;
    i < partiallyEvaluatedPlan.partiallyEvaluatedPathEdges.length;
    i++
  ) {
    const e = partiallyEvaluatedPlan.partiallyEvaluatedPathEdges[i];
    const srcID = nodeIDs[e.srcOffset + i];
    const dstID = nodeIDs[e.dstOffset + i];
    let properties: Array<[string, Value]> = e.properties.map(([k, v]) => {
      return [k, v(match)];
    });
    if (e.name !== null) {
      const element = match.get(e.name);
      if (!element) {
        const edgeID = state.createEdgeID();
        mutation.createEdge(edgeID, srcID, dstID, e.labels, properties);
        match = match.set(e.name, edgeRefValue(edgeID));
        continue;
      }
      const edgeRef = tryCastEdgeRef(element);
      if (edgeRef === undefined) {
        throw new Error(`variable ${JSON.stringify(e.name)} is not a edge`);
      }
    }
    const edgeID = state.createEdgeID();
    mutation.createEdge(edgeID, srcID, dstID, e.labels, properties);
  }
  return match;
}

function makeCreatePlan(path: Path): CreatePlan {
  return {
    pathNodes: path.nodes.map(planCreateNode),
    pathEdges: path.edges.map(planCreateEdge),
  };
}

export function planCreate(create: Create): Stage {
  for (const e of create.path.edges) {
    if (e.direction === 'NONE') {
      throw new Error('Edges must specify a direction in create clauses');
    }
  }
  const createPlan = makeCreatePlan(create.path);
  return {
    stageName: () => 'create',
    stageChildren: () => [],
    stageData: () => formatPath(create.path),
    execute(state: State): void {
      const partiallyEvaluated = partiallyEvaluateCreate(
        createPlan,
        state.graph,
        state.queryStats,
        state.functions,
      );
      state.graph = state.graph.withMutations((mutation) => {
        state.matches = state.matches.map((match) => {
          return createPerMatch(match, partiallyEvaluated, state, mutation);
        });
      });
    },
  };
}
