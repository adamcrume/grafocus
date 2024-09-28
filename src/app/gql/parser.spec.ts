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
  parseQuery,
  parseEdge,
  parseExpression,
  parseNode,
  Path,
} from './parser';

describe('cypher', () => {
  describe('parseQuery', () => {
    it('parses a match', () => {
      expect(
        parseQuery('match (a)--(b)-[x]->(c)\ndetach delete x\ndelete y'),
      ).toEqual(
        jasmine.objectContaining({
          kind: 'regularQuery',
          singleQuery: {
            reads: [
              {
                kind: 'match',
                paths: [
                  {
                    nodes: [
                      {
                        name: 'a',
                        label: null,
                        properties: null,
                      },
                      {
                        name: 'b',
                        label: null,
                        properties: null,
                      },
                      {
                        name: 'c',
                        label: null,
                        properties: null,
                      },
                    ],
                    edges: [
                      {
                        name: null,
                        direction: 'NONE',
                        label: null,
                        properties: null,
                        quantifier: null,
                      },
                      {
                        name: 'x',
                        direction: 'RIGHT',
                        label: null,
                        properties: null,
                        quantifier: null,
                      },
                    ],
                  },
                ],
                where: null,
              },
            ],
            updates: [
              {
                kind: 'delete',
                detach: true,
                name: 'x',
              },
              {
                kind: 'delete',
                detach: false,
                name: 'y',
              },
            ],
            returnClause: null,
          },
        }),
      );
    });

    it('parses a match with multiple paths', () => {
      expect(parseQuery('match (a), (b) return a, b')).toEqual({
        kind: 'regularQuery',
        singleQuery: jasmine.objectContaining({
          reads: [
            {
              kind: 'match',
              paths: [
                {
                  nodes: [
                    {
                      name: 'a',
                      label: null,
                      properties: null,
                    },
                  ],
                  edges: [],
                },
                {
                  nodes: [
                    {
                      name: 'b',
                      label: null,
                      properties: null,
                    },
                  ],
                  edges: [],
                },
              ],
              where: null,
            },
          ],
        }),
        unions: [],
      });
    });

    it('parses union', () => {
      expect(parseQuery('match (a) return a union match (b) return b')).toEqual(
        jasmine.objectContaining({
          kind: 'regularQuery',
          singleQuery: jasmine.objectContaining({
            reads: [jasmine.any(Object)],
            returnClause: jasmine.any(Object),
          }),
          unions: [
            {
              all: false,
              singleQuery: jasmine.objectContaining({
                reads: [jasmine.any(Object)],
                returnClause: jasmine.any(Object),
              }),
            },
          ],
        }),
      );
    });

    it('parses union all', () => {
      expect(
        parseQuery('match (a) return a union all match (b) return b'),
      ).toEqual(
        jasmine.objectContaining({
          kind: 'regularQuery',
          singleQuery: jasmine.objectContaining({
            reads: [jasmine.any(Object)],
            returnClause: jasmine.any(Object),
          }),
          unions: [
            {
              all: true,
              singleQuery: jasmine.objectContaining({
                reads: [jasmine.any(Object)],
                returnClause: jasmine.any(Object),
              }),
            },
          ],
        }),
      );
    });

    it('parses union multiple', () => {
      expect(
        parseQuery(
          'match (a) return a union match (b) return b union match (c) return c',
        ),
      ).toEqual(
        jasmine.objectContaining({
          kind: 'regularQuery',
          singleQuery: jasmine.objectContaining({
            reads: [jasmine.any(Object)],
            returnClause: jasmine.any(Object),
          }),
          unions: [
            {
              all: false,
              singleQuery: jasmine.objectContaining({
                reads: [jasmine.any(Object)],
                returnClause: jasmine.any(Object),
              }),
            },
            {
              all: false,
              singleQuery: jasmine.objectContaining({
                reads: [jasmine.any(Object)],
                returnClause: jasmine.any(Object),
              }),
            },
          ],
        }),
      );
    });
  });

  describe('parseNode', () => {
    it('parses empty', () => {
      expect(parseNode('()')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: null,
        }),
      );
    });

    it('parses identifier only', () => {
      expect(parseNode('(a)')).toEqual(
        jasmine.objectContaining({
          name: 'a',
          label: null,
        }),
      );
    });

    it('parses label only', () => {
      expect(parseNode('(:Foo)')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: {
            kind: 'identifier',
            value: 'Foo',
          },
        }),
      );
    });

    it('parses negated label', () => {
      expect(parseNode('(:!Foo)')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: {
            kind: 'negation',
            value: {
              kind: 'identifier',
              value: 'Foo',
            },
          },
        }),
      );
    });

    it('parses label expressions', () => {
      expect(parseNode('(:a&b&c)')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: {
            kind: 'conjunction',
            values: [
              {
                kind: 'identifier',
                value: 'a',
              },
              {
                kind: 'identifier',
                value: 'b',
              },
              {
                kind: 'identifier',
                value: 'c',
              },
            ],
          },
        }),
      );
      expect(parseNode('(:!a|b&c)')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: {
            kind: 'disjunction',
            values: [
              {
                kind: 'negation',
                value: {
                  kind: 'identifier',
                  value: 'a',
                },
              },
              {
                kind: 'conjunction',
                values: [
                  {
                    kind: 'identifier',
                    value: 'b',
                  },
                  {
                    kind: 'identifier',
                    value: 'c',
                  },
                ],
              },
            ],
          },
        }),
      );
    });

    it('parses identifier and label', () => {
      expect(parseNode('(a:Foo)')).toEqual(
        jasmine.objectContaining({
          name: 'a',
          label: {
            kind: 'identifier',
            value: 'Foo',
          },
        }),
      );
    });

    it('parses properties', () => {
      expect(parseNode('({})')).toEqual(
        jasmine.objectContaining({
          properties: [],
        }),
      );
      expect(parseNode('({abc: 123})')).toEqual(
        jasmine.objectContaining({
          properties: [['abc', { kind: 'number', value: 123 }]],
        }),
      );
      expect(parseNode('({abc: 123, def: 456})')).toEqual(
        jasmine.objectContaining({
          properties: [
            ['abc', { kind: 'number', value: 123 }],
            ['def', { kind: 'number', value: 456 }],
          ],
        }),
      );
      expect(parseNode('({abc: "xyz"})')).toEqual(
        jasmine.objectContaining({
          properties: [['abc', { kind: 'string', value: 'xyz' }]],
        }),
      );
      expect(parseNode("({abc: 'xyz'})")).toEqual(
        jasmine.objectContaining({
          properties: [['abc', { kind: 'string', value: 'xyz' }]],
        }),
      );
    });

    it('parses identifier and properties', () => {
      expect(parseNode('(x {abc: 123})')).toEqual(
        jasmine.objectContaining({
          name: 'x',
          properties: [['abc', { kind: 'number', value: 123 }]],
        }),
      );
    });

    it('parses label and properties', () => {
      expect(parseNode('(:x {abc: 123})')).toEqual(
        jasmine.objectContaining({
          label: {
            kind: 'identifier',
            value: 'x',
          },
          properties: [['abc', { kind: 'number', value: 123 }]],
        }),
      );
    });
  });

  describe('parseEdge', () => {
    it('parses emptier undirected', () => {
      expect(parseEdge('--')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: null,
          direction: 'NONE',
        }),
      );
    });

    it('parses emptier left', () => {
      expect(parseEdge('<--')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: null,
          direction: 'LEFT',
        }),
      );
    });

    it('parses emptier right', () => {
      expect(parseEdge('-->')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: null,
          direction: 'RIGHT',
        }),
      );
    });

    it('fails to parse emptier bidirectional', () => {
      expect(() => parseEdge('<-->')).toThrow();
    });

    it('parses empty undirected', () => {
      expect(parseEdge('-[]-')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: null,
          direction: 'NONE',
        }),
      );
    });

    it('parses empty left', () => {
      expect(parseEdge('<-[]-')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: null,
          direction: 'LEFT',
        }),
      );
    });

    it('parses empty right', () => {
      expect(parseEdge('-[]->')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: null,
          direction: 'RIGHT',
        }),
      );
    });

    it('fails to parse empty bidirectional', () => {
      expect(() => parseEdge('<-[]->')).toThrow();
    });

    it('parses identifier only', () => {
      expect(parseEdge('-[a]-')).toEqual(
        jasmine.objectContaining({
          name: 'a',
          label: null,
        }),
      );
    });

    it('parses label only', () => {
      expect(parseEdge('-[:Foo]-')).toEqual(
        jasmine.objectContaining({
          name: null,
          label: {
            kind: 'identifier',
            value: 'Foo',
          },
        }),
      );
    });

    it('parses identifier and label', () => {
      expect(parseEdge('-[a:Foo]-')).toEqual(
        jasmine.objectContaining({
          name: 'a',
          label: {
            kind: 'identifier',
            value: 'Foo',
          },
        }),
      );
    });

    it('parses properties', () => {
      expect(parseEdge('-[{abc: 123}]-')).toEqual(
        jasmine.objectContaining({
          name: null,
          properties: [['abc', { kind: 'number', value: 123 }]],
        }),
      );
    });

    it('parses star quantifier', () => {
      expect(parseEdge('--*')).toEqual(
        jasmine.objectContaining({
          name: null,
          quantifier: {
            min: 0,
            max: 1 / 0,
          },
        }),
      );
    });
  });

  describe('parseExpression', () => {
    it('parses ascii identifier', () => {
      expect(parseExpression('abc_2')).toEqual({
        kind: 'identifier',
        value: 'abc_2',
      });
    });

    it('parses quoted identifier', () => {
      expect(parseExpression('`abc 123``\\u0040`')).toEqual({
        kind: 'identifier',
        value: 'abc 123`@',
      });
    });

    it('parses path', () => {
      expect(parseExpression('(x)')).toEqual({
        kind: 'path',
        value: {
          nodes: [jasmine.objectContaining({ name: 'x' })],
          edges: [],
        },
      });
    });

    it('parses not path', () => {
      expect(parseExpression('not (x)')).toEqual({
        kind: 'not',
        value: {
          kind: 'path',
          value: {
            nodes: [jasmine.objectContaining({ name: 'x' })],
            edges: [],
          },
        },
      });
    });

    it('parses and path', () => {
      expect(parseExpression('(x) and (y)')).toEqual({
        kind: 'and',
        value: [
          {
            kind: 'path',
            value: {
              nodes: [jasmine.objectContaining({ name: 'x' })],
              edges: [],
            },
          },
          {
            kind: 'path',
            value: {
              nodes: [jasmine.objectContaining({ name: 'y' })],
              edges: [],
            },
          },
        ],
      });
    });

    it('parses not and path', () => {
      expect(parseExpression('not ((x) and (y))')).toEqual({
        kind: 'not',
        value: {
          kind: 'and',
          value: [
            {
              kind: 'path',
              value: {
                nodes: [jasmine.objectContaining({ name: 'x' })],
                edges: [],
              },
            },
            {
              kind: 'path',
              value: {
                nodes: [jasmine.objectContaining({ name: 'y' })],
                edges: [],
              },
            },
          ],
        },
      });
    });

    it('parses or path', () => {
      expect(parseExpression('(x) or (y)')).toEqual({
        kind: 'or',
        value: [
          {
            kind: 'path',
            value: {
              nodes: [jasmine.objectContaining({ name: 'x' })],
              edges: [],
            },
          },
          {
            kind: 'path',
            value: {
              nodes: [jasmine.objectContaining({ name: 'y' })],
              edges: [],
            },
          },
        ],
      });
    });
  });
});
