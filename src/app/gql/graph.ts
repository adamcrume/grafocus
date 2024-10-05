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

export interface SerializedProperties {
  [key: string]: any;
}

export interface SerializedNode {
  id: string;
  labels?: string[];
  properties?: SerializedProperties;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  labels?: string[];
  properties?: SerializedProperties;
}

export interface SerializedGraph {
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

function serializeProperties<Value>(
  properties: Immutable.Map<string, Value>,
  serializeValue: (v: Value) => unknown,
): SerializedProperties {
  const p: SerializedProperties = {};
  for (const [k, v] of properties) {
    p[k] = serializeValue(v);
  }
  return p;
}

let newGraphMutation: <Value>(
  nodes: Immutable.Map<string, Node<Value>>,
  edges: Immutable.Map<string, Edge<Value>>,
) => GraphMutation<Value>;
export class GraphMutation<Value> {
  static {
    newGraphMutation = <Value>(
      nodes: Immutable.Map<string, Node<Value>>,
      edges: Immutable.Map<string, Edge<Value>>,
    ) => new GraphMutation(nodes, edges);
  }

  private constructor(
    readonly nodes: Immutable.Map<string, Node<Value>>,
    readonly edges: Immutable.Map<string, Edge<Value>>,
  ) {}

  createNode(
    id: string,
    labels: string[] | Immutable.Set<string> = Immutable.Set(),
    properties:
      | Array<[string, Value]>
      | Immutable.Map<string, Value> = Immutable.Map(),
  ): this {
    if (this.nodes.has(id)) {
      throw new Error(`Node with ID ${JSON.stringify(id)} already exists`);
    }
    const node = createNode(
      id,
      Immutable.Set(labels),
      Immutable.Map(properties),
      Immutable.Set(),
      Immutable.Set(),
    );
    this.nodes.set(id, node);
    return this;
  }

  createEdge(
    id: string,
    srcID: string,
    dstID: string,
    labels: string[] | Immutable.Set<string> = Immutable.Set(),
    properties:
      | Array<[string, Value]>
      | Immutable.Map<string, Value> = Immutable.Map(),
  ): this {
    if (this.edges.has(id)) {
      throw new Error(`Edge with ID ${JSON.stringify(id)} already exists`);
    }
    const src = this.nodes.get(srcID);
    if (!src) {
      throw new Error(`Source node ${JSON.stringify(srcID)} not found`);
    }
    const dst = this.nodes.get(dstID);
    if (!dst) {
      throw new Error(`Destination node ${JSON.stringify(dstID)} not found`);
    }
    const edge = createEdge(
      id,
      srcID,
      dstID,
      Immutable.Set(labels),
      Immutable.Map(properties),
    );
    this.nodes
      .set(src.id, nodeWithOutgoingEdgeIDs(src, src.outgoingEdgeIDs.add(id)))
      .set(dst.id, nodeWithIncomingEdgeIDs(dst, dst.incomingEdgeIDs.add(id)));
    this.edges.set(id, edge);
    return this;
  }

  updateNodeLabels(
    nodeID: string,
    update: (properties: Immutable.Set<string>) => Immutable.Set<string>,
  ): this {
    const node = this.nodes.get(nodeID);
    if (!node) {
      throw new Error(`Node not found: ${JSON.stringify(nodeID)}`);
    }
    this.nodes.set(nodeID, nodeWithLabels(node, update(node.labels)));
    return this;
  }

  updateEdgeLabels(
    edgeID: string,
    update: (properties: Immutable.Set<string>) => Immutable.Set<string>,
  ): this {
    const edge = this.edges.get(edgeID);
    if (!edge) {
      throw new Error(`Edge not found: ${JSON.stringify(edgeID)}`);
    }
    this.edges.set(edgeID, edgeWithLabels(edge, update(edge.labels)));
    return this;
  }

  updateNodeProperties(
    nodeID: string,
    update: (
      properties: Immutable.Map<string, Value>,
    ) => Immutable.Map<string, Value>,
  ): this {
    const node = this.nodes.get(nodeID);
    if (!node) {
      throw new Error(`Node not found: ${JSON.stringify(nodeID)}`);
    }
    this.nodes.set(nodeID, nodeWithProperties(node, update(node.properties)));
    return this;
  }

  updateEdgeProperties(
    edgeID: string,
    update: (
      properties: Immutable.Map<string, Value>,
    ) => Immutable.Map<string, Value>,
  ): this {
    const edge = this.edges.get(edgeID);
    if (!edge) {
      throw new Error(`Edge not found: ${JSON.stringify(edgeID)}`);
    }
    this.edges.set(edgeID, edgeWithProperties(edge, update(edge.properties)));
    return this;
  }

  removeNode(nodeID: string): this {
    const node = this.nodes.get(nodeID);
    if (!node) {
      return this;
    }
    for (const edgeID of node.incomingEdgeIDs) {
      const edge = this.edges.get(edgeID);
      if (edge) {
        this.edges.delete(edgeID);
        const src = this.nodes.get(edge.srcID)!;
        this.nodes.set(
          src.id,
          nodeWithOutgoingEdgeIDs(src, src.outgoingEdgeIDs.delete(edgeID)),
        );
      }
    }
    for (const edgeID of node.outgoingEdgeIDs) {
      const edge = this.edges.get(edgeID);
      if (edge) {
        this.edges.delete(edgeID);
        const dst = this.nodes.get(edge.dstID)!;
        this.nodes.set(
          dst.id,
          nodeWithIncomingEdgeIDs(dst, dst.incomingEdgeIDs.delete(edgeID)),
        );
      }
    }
    this.nodes.delete(nodeID);
    return this;
  }

  removeEdge(edgeID: string): this {
    const edge = this.edges.get(edgeID);
    if (!edge) {
      return this;
    }
    this.edges.delete(edgeID);
    const src = this.nodes.get(edge.srcID)!;
    const dst = this.nodes.get(edge.dstID)!;
    this.nodes
      .set(
        src.id,
        nodeWithOutgoingEdgeIDs(src, src.outgoingEdgeIDs.delete(edgeID)),
      )
      .set(
        dst.id,
        nodeWithIncomingEdgeIDs(dst, dst.incomingEdgeIDs.delete(edgeID)),
      );
    return this;
  }
}

export class Graph<Value> {
  private readonly _nodesByID: Immutable.Map<string, Node<Value>>;

  private readonly _edgesByID: Immutable.Map<string, Edge<Value>>;

  private constructor(
    nodes: Immutable.Map<string, Node<Value>>,
    edges: Immutable.Map<string, Edge<Value>>,
  ) {
    this._nodesByID = nodes;
    this._edgesByID = edges;
  }

  static new<V>(): Graph<V> {
    return new Graph(Immutable.Map(), Immutable.Map());
  }

  get nodes(): Iterable<Node<Value>> {
    return this._nodesByID.values();
  }

  get edges(): Iterable<Edge<Value>> {
    return this._edgesByID.values();
  }

  createNode(
    id: string,
    labels: string[] | Immutable.Set<string> = Immutable.Set(),
    properties:
      | Array<[string, Value]>
      | Immutable.Map<string, Value> = Immutable.Map(),
  ): Graph<Value> {
    return this.withMutations((m) => m.createNode(id, labels, properties));
  }

  getNodeByID(id: string): Node<Value> | undefined {
    return this._nodesByID.get(id);
  }

  createEdge(
    id: string,
    srcID: string,
    dstID: string,
    labels: string[] | Immutable.Set<string> = Immutable.Set(),
    properties:
      | Array<[string, Value]>
      | Immutable.Map<string, Value> = Immutable.Map(),
  ): Graph<Value> {
    return this.withMutations((m) =>
      m.createEdge(id, srcID, dstID, labels, properties),
    );
  }

  getEdgeByID(id: string): Edge<Value> | undefined {
    return this._edgesByID.get(id);
  }

  serialize(serializeValue: (v: Value) => unknown): SerializedGraph {
    const nodes = [];
    for (const n of this.nodes) {
      nodes.push({
        id: n.id,
        labels: [...n.labels],
        properties: serializeProperties(n.properties, serializeValue),
      });
    }
    const edges = [];
    for (const e of this.edges) {
      edges.push({
        id: e.id,
        source: e.srcID,
        target: e.dstID,
        labels: [...e.labels],
        properties: serializeProperties(e.properties, serializeValue),
      });
    }
    return {
      nodes,
      edges,
    };
  }

  static deserialize<Value>(
    graph: SerializedGraph,
    deserializeValue: (s: unknown) => Value,
  ): Graph<Value> {
    return Graph.new<Value>().withMutations((m) => {
      for (const node of graph.nodes) {
        const properties: Array<[string, Value]> = Object.entries(
          node.properties ?? {},
        ).map(([k, v]) => [k, deserializeValue(v)]);
        m.createNode(node.id, Immutable.Set(node.labels ?? []), properties);
      }
      for (const edge of graph.edges) {
        const properties: Array<[string, Value]> = Object.entries(
          edge.properties ?? {},
        ).map(([k, v]) => [k, deserializeValue(v)]);
        m.createEdge(
          edge.id,
          edge.source,
          edge.target,
          edge.labels ?? [],
          properties,
        );
      }
    });
  }

  debugString(): string {
    const parts = [];
    for (const node of this.nodes) {
      parts.push(node.id);
      parts.push(': ');
      let first = true;
      for (const label of node.labels) {
        if (!first) {
          parts.push(' & ');
        }
        parts.push(label);
        first = false;
      }
      parts.push('\n');
      for (const [k, v] of node.properties) {
        parts.push('  ');
        parts.push(k);
        parts.push(': ');
        parts.push(JSON.stringify(v));
        parts.push('\n');
      }
    }
    for (const edge of this.edges) {
      parts.push(edge.id);
      parts.push(': ');
      parts.push(edge.srcID);
      parts.push(' -> ');
      parts.push(edge.dstID);
      parts.push(': ');
      let first = true;
      for (const label of edge.labels) {
        if (!first) {
          parts.push(' & ');
        }
        parts.push(label);
        first = false;
      }
      parts.push('\n');
      for (const [k, v] of edge.properties) {
        parts.push('  ');
        parts.push(k);
        parts.push(': ');
        parts.push(JSON.stringify(v));
        parts.push('\n');
      }
    }
    return parts.join('');
  }

  setNodeLabels(nodeID: string, labels: Immutable.Set<string>): Graph<Value> {
    const node = this._nodesByID.get(nodeID);
    if (!node) {
      throw new Error(`Node not found: ${JSON.stringify(nodeID)}`);
    }
    return new Graph(
      this._nodesByID.set(nodeID, nodeWithLabels(node, labels)),
      this._edgesByID,
    );
  }

  setEdgeLabels(edgeID: string, labels: Immutable.Set<string>): Graph<Value> {
    const edge = this._edgesByID.get(edgeID);
    if (!edge) {
      throw new Error(`Edge not found: ${JSON.stringify(edgeID)}`);
    }
    return new Graph(
      this._nodesByID,
      this._edgesByID.set(edgeID, edgeWithLabels(edge, labels)),
    );
  }

  setNodeProperties(
    nodeID: string,
    properties: Immutable.Map<string, Value>,
  ): Graph<Value> {
    const node = this._nodesByID.get(nodeID);
    if (!node) {
      throw new Error(`Node not found: ${JSON.stringify(nodeID)}`);
    }
    return new Graph(
      this._nodesByID.set(nodeID, nodeWithProperties(node, properties)),
      this._edgesByID,
    );
  }

  setEdgeProperties(
    edgeID: string,
    properties: Immutable.Map<string, Value>,
  ): Graph<Value> {
    const edge = this._edgesByID.get(edgeID);
    if (!edge) {
      throw new Error(`Edge not found: ${JSON.stringify(edgeID)}`);
    }
    return new Graph(
      this._nodesByID,
      this._edgesByID.set(edge.id, edgeWithProperties(edge, properties)),
    );
  }

  *incomingNeighbors(node: Node<Value>): Iterable<[Edge<Value>, Node<Value>]> {
    for (const edgeID of node.incomingEdgeIDs) {
      const edge = this._edgesByID.get(edgeID)!;
      yield [edge, this._nodesByID.get(edge.srcID)!];
    }
  }

  *outgoingNeighbors(node: Node<Value>): Iterable<[Edge<Value>, Node<Value>]> {
    for (const edgeID of node.outgoingEdgeIDs) {
      const edge = this._edgesByID.get(edgeID)!;
      yield [edge, this._nodesByID.get(edge.dstID)!];
    }
  }

  removeNode(nodeID: string): Graph<Value> {
    return this.withMutations((m) => m.removeNode(nodeID));
  }

  removeEdge(edgeID: string): Graph<Value> {
    return this.withMutations((m) => m.removeEdge(edgeID));
  }

  withMutations(f: (mutation: GraphMutation<Value>) => void): Graph<Value> {
    let edges: Immutable.Map<string, Edge<Value>>;
    const nodes = this._nodesByID.withMutations((nn) => {
      edges = this._edgesByID.withMutations((ee) => {
        const mutation = newGraphMutation(nn, ee);
        f(mutation);
      });
    });
    return new Graph(nodes, edges!);
  }
}

function nodeWithIncomingEdgeIDs<V>(
  node: Node<V>,
  ids: Immutable.Set<string>,
): Node<V> {
  return createNode<V>(
    node.id,
    node.labels,
    node.properties,
    ids,
    node.outgoingEdgeIDs,
  );
}

function nodeWithOutgoingEdgeIDs<V>(
  node: Node<V>,
  ids: Immutable.Set<string>,
): Node<V> {
  return createNode<V>(
    node.id,
    node.labels,
    node.properties,
    node.incomingEdgeIDs,
    ids,
  );
}

function nodeWithLabels<V>(
  node: Node<V>,
  labels: Immutable.Set<string>,
): Node<V> {
  return createNode(
    node.id,
    labels,
    node.properties,
    node.incomingEdgeIDs,
    node.outgoingEdgeIDs,
  );
}

function nodeWithProperties<V>(
  node: Node<V>,
  properties: Immutable.Map<string, V>,
): Node<V> {
  return createNode(
    node.id,
    node.labels,
    properties,
    node.incomingEdgeIDs,
    node.outgoingEdgeIDs,
  );
}

function edgeWithLabels<V>(
  edge: Edge<V>,
  labels: Immutable.Set<string>,
): Edge<V> {
  return createEdge(edge.id, edge.srcID, edge.dstID, labels, edge.properties);
}

function edgeWithProperties<V>(
  edge: Edge<V>,
  properties: Immutable.Map<string, V>,
): Edge<V> {
  return createEdge(edge.id, edge.srcID, edge.dstID, edge.labels, properties);
}

// hack to make this visible within the module
let createNode: <V>(
  id: string,
  labels: Immutable.Set<string>,
  properties: Immutable.Map<string, V>,
  incomingEdgeIDs: Immutable.Set<string>,
  outgoingEdgeIDs: Immutable.Set<string>,
) => Node<V>;

export class Node<Value> {
  static {
    createNode = <V>(
      id: string,
      labels: Immutable.Set<string>,
      properties: Immutable.Map<string, V>,
      incomingEdgeIDs: Immutable.Set<string>,
      outgoingEdgeIDs: Immutable.Set<string>,
    ) => new Node<V>(id, labels, properties, incomingEdgeIDs, outgoingEdgeIDs);
  }

  private constructor(
    readonly id: string,
    readonly labels: Immutable.Set<string>,
    readonly properties: Immutable.Map<string, Value>,
    readonly incomingEdgeIDs: Immutable.Set<string>,
    readonly outgoingEdgeIDs: Immutable.Set<string>,
  ) {}
}

// hack to make this visible within the module
let createEdge: <V>(
  id: string,
  srcID: string,
  dstID: string,
  labels: Immutable.Set<string>,
  properties: Immutable.Map<string, V>,
) => Edge<V>;

export class Edge<Value> {
  static {
    createEdge = <V>(
      id: string,
      srcID: string,
      dstID: string,
      labels: Immutable.Set<string>,
      properties: Immutable.Map<string, V>,
    ) => new Edge<V>(id, srcID, dstID, labels, properties);
  }

  private constructor(
    readonly id: string,
    readonly srcID: string,
    readonly dstID: string,
    readonly labels: Immutable.Set<string>,
    readonly properties: Immutable.Map<string, Value>,
  ) {}
}
