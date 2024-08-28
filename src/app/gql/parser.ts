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

import * as parser from './parser_impl';

export interface Query {
  reads: ReadClause[];
  updates: UpdateClause[];
  returnClause: ReturnClause | undefined;
}

export interface Clause {
  kind: string;
}

export type ReadClause = Match;

export type UpdateClause = Delete | Create | Merge | SetClause | RemoveClause;

export interface Match extends Clause {
  kind: 'match';
  paths: Path[];
  where: Expression | null;
}

export interface Create extends Clause {
  kind: 'create';
  path: Path;
}

export interface Merge extends Clause {
  kind: 'merge';
  path: Path;
}

export interface Delete extends Clause {
  kind: 'delete';
  detach: boolean;
  name: string;
}

export interface PropertyExpression {
  kind: 'propertyExpression';
  root: string;
  chain: string[];
}

export interface SetProperty {
  kind: 'setProperty';
  property: PropertyExpression;
  expression: Expression;
}

export interface SetLabels {
  kind: 'setLabels';
  variable: string;
  labels: string[];
}

export type SetItem = SetProperty | SetLabels;

export interface SetClause extends Clause {
  kind: 'set';
  items: SetItem[];
}

export interface RemoveProperty {
  kind: 'removeProperty';
  property: PropertyExpression;
  expression: Expression;
}

export interface RemoveLabels {
  kind: 'removeLabels';
  variable: string;
  labels: string[];
}

export type RemoveItem = RemoveProperty | RemoveLabels;

export interface RemoveClause extends Clause {
  kind: 'remove';
  items: RemoveItem[];
}

export interface ReturnClause {
  values: Expression[];
}

export interface Path {
  nodes: Node[];
  edges: Edge[];
}

export interface ExpressionBase {
  kind: string;
}

export interface NumberLiteral {
  kind: 'number';
  value: number;
}

export interface StringLiteral {
  kind: 'string';
  value: string;
}

export interface Identifier {
  kind: 'identifier';
  value: string;
}

export interface Not {
  kind: 'not';
  value: Expression;
}

export interface And {
  kind: 'and';
  value: Expression[];
}

export interface Or {
  kind: 'or';
  value: Expression[];
}

export interface PathExpression {
  kind: 'path';
  value: Path;
}

export interface FunctionCall {
  kind: 'functionCall';
  name: string;
  args: Expression[];
}

export type Expression =
  | And
  | FunctionCall
  | Identifier
  | Not
  | NumberLiteral
  | Or
  | PathExpression
  | StringLiteral;

export type MapLiteral = Array<[string, Expression]>;

export interface LabelNegation {
  kind: 'negation';
  value: LabelExpression;
}

export interface LabelConjunction {
  kind: 'conjunction';
  values: LabelExpression[];
}

export interface LabelDisjunction {
  kind: 'disjunction';
  values: LabelExpression[];
}

export type LabelExpression =
  | Identifier
  | LabelNegation
  | LabelConjunction
  | LabelDisjunction;

export interface Node {
  name: string | null;
  label: LabelExpression | null;
  properties: MapLiteral | null;
}

export interface Quantifier {
  min: number;
  max: number;
}

export type Direction = 'LEFT' | 'RIGHT' | 'NONE';

export interface Edge {
  name: string | null;
  direction: Direction;
  label: LabelExpression | null;
  properties: MapLiteral | null;
  quantifier: Quantifier | null;
}

export function parseNode(s: string): Node {
  return parser.parse(s, { startRule: 'node' });
}

export function parseEdge(s: string): Edge {
  return parser.parse(s, { startRule: 'edge' });
}

export function parseExpression(s: string): Expression {
  return parser.parse(s, { startRule: 'expression' });
}

export function parseQuery(s: string): Query {
  return parser.parse(s);
}
