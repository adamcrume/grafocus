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

import {describeQueryPlan, planQuery} from './engine';
import {Edge, Graph, Node} from './graph';
import {NUMBER} from './types';
import {checkCastEdgeRef, checkCastList, checkCastNodeRef, checkCastString, numberValue, stringValue, tryCastList, tryCastNodeRef, tryCastEdgeRef, Value} from './values';
import {parseQuery} from './parser';

function newGraph(): Graph<Value> {
    return Graph.new<Value>();
}

function nodeRows(result: Value[][]|undefined): string[][] {
    return [...result||[]]
        .map(r => r.map(v => {
            const id = tryCastNodeRef(v) ?? tryCastEdgeRef(v);
            if (id !== undefined) {
                return id;
            }
            let list = tryCastList(v);
            if (list !== undefined) {
                return list.map(elt => {
                    const eltId = tryCastNodeRef(elt) ?? tryCastEdgeRef(elt);
                    if (eltId !== undefined) {
                        return eltId;
                    }
                    throw new Error(`List value is unsupported: ${JSON.stringify(elt)}`);
                }).join(',');
            }
            throw new Error(`Value is unsupported: ${JSON.stringify(v)}`);
        }));
}

function sortStringArrays(rows: string[][]): string[][] {
    return rows.sort((a, b) => {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
            if (a[i] < b[i]) {
                return -1;
            } else if (a[i] > b[i]) {
                return 1;
            }
        }
        return a.length - b.length;
    });
}

function sortedNodeRows(result: Value[][]|undefined): string[][] {
    return sortStringArrays(nodeRows(result));
}

function executeQuery(query: string, graph: Graph<Value>): {graph: Graph<Value>, data: string[][]} {
    const {graph: graph2, data} = planQuery(parseQuery(query)).execute(graph);
    return {graph: graph2, data: sortedNodeRows(data)};
}

describe('describeQueryPlan', () => {
    it('can describe query', () => {
        const plan = planQuery(parseQuery('match (x) delete x'));
        expect(describeQueryPlan(plan)).toEqual(
`read_path
  scan_graph
  match_node: name=x
delete: x
`);
    });

    it('can describe long paths', () => {
        const plan = planQuery(parseQuery('match (n1)-[e1]-()-[e2:Foo {bar:1}]->(n3:Bar {baz:1}) return n1, n3'));
        expect(describeQueryPlan(plan)).toEqual(
`read_path
  scan_graph
  match_node: name=n1
  match_edge: name=e1
  match_node
  match_edge: name=e2, direction=RIGHT, label=Foo, properties={bar: 1}
  match_node: name=n3, label=Bar, properties={baz: 1}
return: n1, n3
`);
    });
});

describe('execute', () => {
    it('can delete everything', () => {
        const {graph} = executeQuery(
            'match (x) delete x',
            newGraph()
                .createNode('n1'));
        expect(Array.from(graph.nodes)).toEqual([]);
    });

    it('can filter by properties', () => {
        const {graph} = executeQuery(
            'match (x {foo: 123}) delete x',
            newGraph()
                .createNode('n1', [], [['foo', numberValue(123)]])
                .createNode('n2', [], [['foo', numberValue(456)]])
                .createNode('n3'));
        expect([...graph.nodes].map(n => n.id).sort()).toEqual(['n2', 'n3']);
    });

    it('can filter by ID', () => {
        const {graph} = executeQuery(
            'match (x {_ID: "n1"}) delete x',
            newGraph()
                .createNode('n1')
                .createNode('n2'));
        expect([...graph.nodes].map(n => n.id).sort()).toEqual(['n2']);
    });

    it('can filter by labels', () => {
        const {graph} = executeQuery(
            'match (x:Foo) delete x',
            newGraph()
                .createNode('n1')
                .createNode('n2', ['Foo'])
                .createNode('n3', ['Bar'])
                .createNode('n4', ['Foo', 'Bar']));
        expect([...graph.nodes].map(n => n.id).sort()).toEqual(['n1', 'n3']);
    });

    it('can filter by negated labels', () => {
        const {graph} = executeQuery(
            'match (x:!Foo) delete x',
            newGraph()
                .createNode('n1')
                .createNode('n2', ['Foo'])
                .createNode('n3', ['Bar'])
                .createNode('n4', ['Foo', 'Bar']));
        expect([...graph.nodes].map(n => n.id).sort()).toEqual(['n2', 'n4']);
    });

    it('can filter by labels and return values', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2', ['Foo'])
            .createNode('n3', ['Bar'])
            .createNode('n4', ['Foo', 'Bar']);
        const query = 'match (x:Foo) return x';
        expect(executeQuery(query, graph).data).toEqual([['n2'], ['n4']]);
    });

    it('can match paths', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x)--(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1', 'n2'],
            ['n2', 'n1'],
            ['n2', 'n3'],
            ['n3', 'n2'],
        ]);
    });

    it('can match edges by ID', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x)-[{_ID:"e1"}]->(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1', 'n2'],
        ]);
    });

    it('can match long paths', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x)--(y)--(z) return x, y, z';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1', 'n2', 'n3'],
            ['n3', 'n2', 'n1'],
        ]);
    });

    it('can match quantified paths', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createNode('n4')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3')
            .createEdge('e3', 'n3', 'n4');
        const query = 'match (x)-[e]->*(y) return x, e, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1', '', 'n1'],
            ['n1', 'e1', 'n2'],
            ['n1', 'e1,e2', 'n3'],
            ['n1', 'e1,e2,e3', 'n4'],
            ['n2', '', 'n2'],
            ['n2', 'e2', 'n3'],
            ['n2', 'e2,e3', 'n4'],
            ['n3', '', 'n3'],
            ['n3', 'e3', 'n4'],
            ['n4', '', 'n4'],
        ]);
    });

    it('can match right edges', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x)-->(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1', 'n2'],
            ['n2', 'n3'],
        ]);
    });

    it('can match left edges', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x)<--(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n2', 'n1'],
            ['n3', 'n2'],
        ]);
    });

    it('can filter by edge labels', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createNode('n4')
            .createNode('n5')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3', ['Foo'])
            .createEdge('e3', 'n3', 'n4', ['Bar'])
            .createEdge('e4', 'n4', 'n5', ['Foo', 'Bar']);
        const query = 'match (x)-[:Foo]->(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n2', 'n3'],
            ['n4', 'n5'],
        ]);
    });

    it('can filter by virtual edges', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createNode('n4')
            .createNode('n5')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3', ['_Foo'])
            .createEdge('e3', 'n3', 'n4', ['Bar'])
            .createEdge('e4', 'n4', 'n5', ['_Foo', 'Bar']);
        const query = 'match (x)-[:_VIRTUAL]->(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n2', 'n3'],
            ['n4', 'n5'],
        ]);
    });

    it('can negated filter by virtual edges', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createNode('n4')
            .createNode('n5')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3', ['_Foo'])
            .createEdge('e3', 'n3', 'n4', ['Bar'])
            .createEdge('e4', 'n4', 'n5', ['_Foo', 'Bar']);
        const query = 'match (x)-[:!_VIRTUAL]->(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1', 'n2'],
            ['n3', 'n4'],
        ]);
    });

    it('can filter by edge properties', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createNode('n4')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3', [], [['foo', numberValue(123)]])
            .createEdge('e3', 'n3', 'n4', [], [['foo', numberValue(456)]]);
        const query = 'match (x)-[{foo: 123}]->(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n2', 'n3'],
        ]);
    });

    it('can filter by path existence', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x), (y) where not (x)--(y) return x, y';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1', 'n1'],
            ['n1', 'n3'],
            ['n2', 'n2'],
            ['n3', 'n1'],
            ['n3', 'n3'],
        ]);
    });

    it('can filter by path existence from start', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x) where (x)-->() return x';
        expect(executeQuery(query, graph).data).toEqual([
            ['n1'],
            ['n2'],
        ]);
    });

    it('can filter by path existence from end', () => {
        const graph = newGraph()
            .createNode('n1')
            .createNode('n2')
            .createNode('n3')
            .createEdge('e1', 'n1', 'n2')
            .createEdge('e2', 'n2', 'n3');
        const query = 'match (x) where ()-->(x) return x';
        expect(executeQuery(query, graph).data).toEqual([
            ['n2'],
            ['n3'],
        ]);
    });

    it('can create', () => {
        const {graph} = executeQuery('create (:Foo{foo:123})-[:Bar{abc:"xyz"}]->(:Baz)', newGraph());
        const foo = [...graph.nodes].filter(n => n.labels.has('Foo'));
        expect(foo.length).toEqual(1);
        expect(foo[0].properties).toContain(['foo', numberValue(123)]);
        const edges = [...graph.outgoingNeighbors(foo[0])].map(([e, n]) => e);
        expect(edges.length).toEqual(1);
        expect(edges[0].properties).toContain(['abc', stringValue('xyz')]);
        expect(graph.getNodeByID(edges[0].dstID)?.labels).toContain('Baz');
    });

    it('can match and create', () => {
        const {graph} = executeQuery('match (x) create (x)-->(:Bar)',
                                     newGraph()
                                         .createNode('x'));
        const nodes = [...graph.nodes];
        expect(nodes.map(n => n.id)).toContain('x');
        const bar = nodes.filter(n => n.id != 'x');
        expect(bar.length).toEqual(1);
        expect(graph.getNodeByID(bar[0].id)?.labels).toContain('Bar');
        const x = graph.getNodeByID('x');
        if (!x) {
            throw new Error(`x not found`);
        }
        const edges = [...graph.outgoingNeighbors(x)].map(([e, n]) => e);
        expect(edges.length).toEqual(1);
        expect(edges[0].dstID).toBe(bar[0].id);
    });

    it('can set node properties', () => {
        const {graph} = executeQuery('match (x) set x.label="test"',
                                     newGraph()
                                         .createNode('x'));
        const x = graph.getNodeByID('x');
        if (!x) {
            throw new Error(`x not found`);
        }
        expect(checkCastString(x.properties.get('label'))).toEqual('test');
    });

    it('can set edge properties', () => {
        const {graph} = executeQuery('match (n1)-[e1]-(n2) set e1.label="test"',
                                     newGraph()
                                         .createNode('n1')
                                         .createNode('n2')
                                         .createEdge('e1', 'n1', 'n2'));
        const e1 = graph.getEdgeByID('e1');
        if (!e1) {
            throw new Error(`e1 not found`);
        }
        expect(checkCastString(e1.properties.get('label'))).toEqual('test');
    });

    it('can set node labels', () => {
        const {graph} = executeQuery('match (x) set x:label',
                                     newGraph()
                                         .createNode('x', ['foo']));
        const x = graph.getNodeByID('x');
        if (!x) {
            throw new Error(`x not found`);
        }
        expect([...x.labels]).toEqual(['foo', 'label']);
    });

    it('can set edge labels', () => {
        const {graph} = executeQuery('match (n1)-[e1]-(n2) set e1:label',
                                     newGraph()
                                         .createNode('n1')
                                         .createNode('n2')
                                         .createEdge('e1', 'n1', 'n2', ['foo']));
        const e1 = graph.getEdgeByID('e1');
        if (!e1) {
            throw new Error(`e1 not found`);
        }
        expect([...e1.labels]).toEqual(['foo', 'label']);
    });

    it('can remove node properties', () => {
        const {graph} = executeQuery('match (x) remove x.label',
                                     newGraph()
                                         .createNode('x', [], [['foo', stringValue('bar')], ['label', stringValue('x')]]));
        const x = graph.getNodeByID('x');
        if (!x) {
            throw new Error(`x not found`);
        }
        expect(checkCastString(x.properties.get('foo'))).toEqual('bar');
        expect(checkCastString(x.properties.get('label'))).toEqual(undefined);
    });

    it('can remove edge properties', () => {
        const {graph} = executeQuery('match (n1)-[e1]-(n2) remove e1.label',
                                     newGraph()
                                         .createNode('n1')
                                         .createNode('n2')
                                         .createEdge('e1', 'n1', 'n2', [], [['foo', stringValue('bar')], ['label', stringValue('x')]]));
        const e1 = graph.getEdgeByID('e1');
        if (!e1) {
            throw new Error(`e1 not found`);
        }
        expect(checkCastString(e1.properties.get('foo'))).toEqual('bar');
        expect(checkCastString(e1.properties.get('label'))).toEqual(undefined);
    });

    it('can remove node labels', () => {
        const {graph} = executeQuery('match (x) remove x:label',
                                     newGraph()
                                         .createNode('x', ['foo', 'label']));
        const x = graph.getNodeByID('x');
        if (!x) {
            throw new Error(`x not found`);
        }
        expect([...x.labels]).toEqual(['foo']);
    });

    it('can remove edge labels', () => {
        const {graph} = executeQuery('match (n1)-[e1]-(n2) remove e1:label',
                                     newGraph()
                                         .createNode('n1')
                                         .createNode('n2')
                                         .createEdge('e1', 'n1', 'n2', ['foo', 'label']));
        const e1 = graph.getEdgeByID('e1');
        if (!e1) {
            throw new Error(`e1 not found`);
        }
        expect([...e1.labels]).toEqual(['foo']);
    });
});
