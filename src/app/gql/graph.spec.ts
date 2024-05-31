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

import {Graph} from './graph';

describe('Graph.removeNode', () => {
    it('works', () => {
        const graph = Graph.new().withMutations(m => {
            m.createNode('n1')
                .createNode('n2')
                .createNode('n3')
                .createEdge('e1', 'n1', 'n2')
                .createEdge('e2', 'n2', 'n3')
                .createEdge('e3', 'n3', 'n1')
                .removeNode('n1')
        });
        expect([...graph.nodes].map(n => n.id).sort()).toEqual(['n2', 'n3']);
        expect([...graph.edges].map(e => e.id).sort()).toEqual(['e2']);
        expect(new Set(graph.getNodeByID('n2')?.incomingEdgeIDs)).toEqual(new Set([]));
        expect(new Set(graph.getNodeByID('n2')?.outgoingEdgeIDs)).toEqual(new Set(['e2']));
        expect(new Set(graph.getNodeByID('n3')?.incomingEdgeIDs)).toEqual(new Set(['e2']));
        expect(new Set(graph.getNodeByID('n3')?.outgoingEdgeIDs)).toEqual(new Set([]));
        expect(graph.getNodeByID('n1')).toBeUndefined();
        expect(graph.getNodeByID('n2')?.id).toEqual('n2');
        expect(graph.getNodeByID('n3')?.id).toEqual('n3');
        expect(graph.getEdgeByID('e1')).toBeUndefined();
        expect(graph.getEdgeByID('e2')?.id).toEqual('e2');
        expect(graph.getEdgeByID('e3')).toBeUndefined();
    });
});
