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
