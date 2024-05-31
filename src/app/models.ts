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

import * as cytoscape from 'cytoscape'; // TODO: remove
import * as jsonschema from 'jsonschema';
import {SerializedGraph} from './gql/graph';
import {schema} from './schema';

interface ElementDataDefinition {
    id: string;
}

interface NodeDataDefinition extends ElementDataDefinition {
    parent?: string | undefined;
    [key: string]: any;
}

interface EdgeDataDefinition extends ElementDataDefinition {
    source: string;
    target: string;
    [key: string]: any;
}

export interface ElementDefinition {
    data: NodeDataDefinition | EdgeDataDefinition;
    classes?: string[],
    position?: {x: number, y: number},
}

export interface Stylesheet {
    selector: string;
    // TODO: use own types, not from cytoscape
    style: cytoscape.Css.Node | cytoscape.Css.Edge | cytoscape.Css.Core;
}

interface GraphData {
    title?: string,
    description?: string,
}

export interface SavedData {
    data: GraphData,
    graph: SerializedGraph,
    style: Stylesheet[],
}

export const ID_REGEX_PART: string = '[_a-zA-Z][-_a-zA-Z0-9]*';

export const ID_REGEX: string = '^' + ID_REGEX_PART + '$';

export const CLASS_LIST_REGEX = `^${ID_REGEX_PART}(, *${ID_REGEX_PART})*$`;

function validateElements(elements: ElementDefinition[]): Map<string, ElementDefinition> {
    const idRE = new RegExp(ID_REGEX);
    const elementsByID = new Map<string, ElementDefinition>();
    for (const element of elements) {
        const id = element.data.id;
        if (elementsByID.has(id)) {
            throw new Error(`Duplicate element ID: ${id}`);
        }
        if (!idRE.test(id)) {
            throw new Error(`Invalid ID: ${id}`);
        }
        elementsByID.set(id, element);
    }
    for (const element of elements) {
        let elt = element;
        while (elt.data.parent) {
            if (elt.data.parent === element.data.id) {
                throw new Error(`Parent cycle detected involving element ${element.data.id}`);
            }
            const parent = elementsByID.get(elt.data.parent);
            if (!parent) {
                throw new Error(`Parent ${elt.data.parent} of element ${elt.data.id} not found`);
            }
            elt = parent;
        }
        if (element.data.source) {
            if (!elementsByID.has(element.data.source)) {
                throw new Error(`Source ${element.data.source} of edge ${element.data.id} not found`);
            }
        }
        if (element.data.target) {
            if (!elementsByID.has(element.data.target)) {
                throw new Error(`Target ${element.data.target} of edge ${element.data.id} not found`);
            }
        }
    }
    return elementsByID;
}

export function validateSavedData(input: any): SavedData {
    const result = jsonschema.validate(input, schema);
    if (result.errors.length > 0) {
        throw new Error(result.errors.map(e => `${e.path.join('.')} ${e.message}`).join('\n'));
    }
    const data: SavedData = input;
    return data;
}
