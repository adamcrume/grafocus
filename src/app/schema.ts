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

export const schema = {
  $id: 'http://adamcrume.com/graph-explorer/SavedData',
  type: 'object',
  properties: {
    data: { $ref: '#/$defs/GraphData' },
    graph: { $ref: '#/$defs/Graph' },
    style: {
      type: 'array',
      items: { $ref: '#/$defs/Stylesheet' },
    },
    transformations: {
      type: 'array',
      items: { $ref: '#/$defs/Transformation' },
    },
  },
  required: ['data', 'graph', 'style'], // TODO: relax this
  additionalProperties: false,
  $defs: {
    GraphData: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
      },
      additionalProperties: false,
    },
    Properties: {
      type: 'object',
      additionalProperties: true,
    },
    Node: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        properties: { type: { $ref: '#/$defs/Properties' } },
      },
      required: ['id'],
    },
    Edge: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' },
        target: { type: 'string' },
        properties: { type: { $ref: '#/$defs/Properties' } },
      },
      required: ['id', 'source', 'target'],
    },
    Graph: {
      type: 'object',
      properties: {
        nodes: { type: 'array', items: { $ref: '#/$defs/Node' } },
        edges: { type: 'array', items: { $ref: '#/$defs/Edge' } },
      },
      required: ['nodes', 'edges'],
    },
    Style: {
      type: 'object',
      // TODO: validate style
    },
    Stylesheet: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        style: { $ref: '#/$defs/Style' },
      },
      required: ['selector', 'style'],
      additionalProperties: false,
    },
    Transformation: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['name', 'query'],
    },
  },
};
