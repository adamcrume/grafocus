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

// https://peggyjs.org/documentation.html

import * as parser from "./parser_impl";

export interface Query {
    reads: ReadClause[],
    updates: UpdateClause[],
    returnClause: ReturnClause|undefined,
}

export interface Clause {
    kind: string,
}

export type ReadClause = Match;

export type UpdateClause = Delete | Create;

export interface Match extends Clause {
    kind: 'match',
    paths: Path[],
    where: Expression|null,
}

export interface Create extends Clause {
    kind: 'create',
    path: Path,
}

export interface Delete extends Clause {
    kind: 'update',
    detach: boolean,
    name: string,
}

export interface ReturnClause {
    values: Expression[],
}

export interface Path {
    nodes: Node[],
    edges: Edge[],
}

export interface ExpressionBase {
    kind: string,
}

export interface NumberLiteral {
    kind: 'number',
    value: number,
}

export interface StringLiteral {
    kind: 'string',
    value: string,
}

export interface Identifier {
    kind: 'identifier',
    value: string,
}

export interface Not {
    kind: 'not',
    value: Expression,
}

export interface PathExpression {
    kind: 'path',
    value: Path,
}

export type Expression = StringLiteral | NumberLiteral | Identifier | Not | PathExpression;

export type MapLiteral = Array<[string, Expression]>;

export interface LabelNegation {
    kind: 'negation',
    value: LabelExpression,
}

export interface LabelConjunction {
    kind: 'conjunction',
    values: LabelExpression[],
}

export interface LabelDisjunction {
    kind: 'disjunction',
    values: LabelExpression[],
}

export type LabelExpression = Identifier | LabelNegation | LabelConjunction | LabelDisjunction;

export interface Node {
    name: string|null,
    label: LabelExpression|null,
    properties: MapLiteral|null,
}

export interface Quantifier {
    min: number,
    max: number,
}

export interface Edge {
    name: string|null,
    direction: 'LEFT'|'RIGHT'|'NONE',
    label: LabelExpression|null,
    properties: MapLiteral|null,
    quantifier: Quantifier|null,
}

export function parseNode(s: string): Node {
    return parser.parse(s, {startRule: 'node'});
}

export function parseEdge(s: string): Edge {
    return parser.parse(s, {startRule: 'edge'});
}

export function parseExpression(s: string): Expression {
    return parser.parse(s, {startRule: 'expression'});
}

export function parseQuery(s: string): Query {
    return parser.parse(s);
}

export function quoteIdentifier(id: string): string {
    if (/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(id)) {
        return id;
    }
    return '`' + id.replaceAll(/([\\`])/g, '\\$1') + '`';
}

export function formatLabelExpression(e: LabelExpression): string {
    return formatLabelExpressionImpl(e, 0);
}

function formatLabelExpressionImpl(e: LabelExpression, level: number): string {
    let result = '';
    if (e.kind === 'identifier') {
        result += quoteIdentifier(e.value);
    } else if (e.kind === 'negation') {
        result += '!';
        result += formatLabelExpressionImpl(e, 0);
    } else if (e.kind === 'conjunction') {
        if (level > 0) {
            result += '(';
        }
        let first = false;
        for (const child of e.values) {
            if (!first) {
                result += ' & ';
            }
            first = false;
            result += formatLabelExpressionImpl(child, 1);
        }
        if (level > 0) {
            result += ')';
        }
    } else if (e.kind === 'disjunction') {
        if (level > 1) {
            result += '(';
        }
        let first = false;
        for (const child of e.values) {
            if (!first) {
                result += ' | ';
            }
            first = false;
            result += formatLabelExpressionImpl(child, 2);
        }
        if (level > 1) {
            result += ')';
        }
    } else {
        throw new Error(`Unrecognized label expression: ${JSON.stringify(e)}`);
    }
    return result;
}

function formatNode(n: Node): string {
    let result = '';
    result += '(';
    if (n.name !== null) {
        result += quoteIdentifier(n.name);
    }
    if (n.label) {
        result += ':';
        result += formatLabelExpression(n.label);
    }
    if (n.properties) {
        if (n.name !== null || n.label) {
            result += ' ';
        }
        result += formatMapLiteral(n.properties);
    }
    result += ')';
    return result;
}

function formatEdge(e: Edge): string {
    let result = '';
    if (e.direction === 'LEFT') {
        result += '<';
    }
    result += '-';
    if (e.name !== null || e.label || e.properties) {
        result += '[';
        if (e.name !== null) {
            result += quoteIdentifier(e.name);
        }
        if (e.label) {
            result += ':';
            result += formatLabelExpression(e.label);
        }
        if (e.properties) {
            if (e.name !== null || e.label) {
                result += ' ';
            }
            result += formatMapLiteral(e.properties);
        }
        result += ']';
    }
    result += '-';
    if (e.direction === 'RIGHT') {
        result += '>';
    }
    if (e.quantifier) {
        if (e.quantifier.min === 0 && e.quantifier.max === 1/0) {
            result += '*';
        }
        throw new Error(`Unsupported quantifier: ${JSON.stringify(e.quantifier)}`);
    }
    return result;
}

export function formatPath(p: Path): string {
    let result = '';
    result += formatNode(p.nodes[0]);
    for (let i = 0; i < p.edges.length; i++) {
        result += formatEdge(p.edges[i]);
        result += formatNode(p.nodes[i + 1]);
    }
    return result;
}

export function formatMapLiteral(map: MapLiteral): string {
    let result = '';
    result += '{';
    let first = true;
    for (const [k, v] of map) {
        if (!first) {
            result += ', ';
        }
        first = false;
        result += quoteIdentifier(k);
        result += ': ';
        result += formatExpression(v);
    }
    result += '}';
    return result;
}

export function formatExpression(e: Expression): string {
    let result = '';
    if (e.kind === 'string' || e.kind === 'number') {
        result += JSON.stringify(e.value);
    } else if (e.kind === 'identifier') {
        result += quoteIdentifier(e.value);
    } else if (e.kind === 'not') {
        result += 'not ';
        result += formatExpression(e.value);
    } else if (e.kind === 'path') {
        result += formatPath(e.value);
    } else {
        throw new Error(`Unrecognized expression: ${JSON.stringify(e)}`);
    }
    return result;
}
