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

export interface TypeBase {
  kind: string;
  toString(): string;
}

export interface AnyType extends TypeBase {
  kind: 'any';
}

export const ANY: AnyType = {
  kind: 'any',
  toString() {
    return 'ANY';
  },
};

export interface BooleanType extends TypeBase {
  kind: 'boolean';
}

export const BOOLEAN: BooleanType = {
  kind: 'boolean',
  toString() {
    return 'BOOLEAN';
  },
};

export interface StringType extends TypeBase {
  kind: 'string';
}

export const STRING: StringType = {
  kind: 'string',
  toString() {
    return 'STRING';
  },
};

export interface NumberType extends TypeBase {
  kind: 'number';
}

export const NUMBER: NumberType = {
  kind: 'number',
  toString() {
    return 'NUMBER';
  },
};

export interface ListType extends TypeBase {
  kind: 'list';
  inner: Type;
}

export const NUMBER_LIST: ListType = listOf(NUMBER);

export const ANY_LIST: ListType = listOf(ANY);

export interface NodeRefType extends TypeBase {
  kind: 'node_ref';
}

export const NODE_REF: NodeRefType = {
  kind: 'node_ref',
  toString() {
    return 'NODE';
  },
};

export interface EdgeRefType extends TypeBase {
  kind: 'edge_ref';
}

export const EDGE_REF: EdgeRefType = {
  kind: 'edge_ref',
  toString() {
    return 'EDGE';
  },
};

export type Type =
  | AnyType
  | BooleanType
  | EdgeRefType
  | ListType
  | NodeRefType
  | NumberType
  | StringType;

export function listOf(element: Type): ListType {
  return {
    kind: 'list',
    inner: element,
    toString() {
      return `LIST<${element}>`;
    },
  };
}

export function typesEqual(a: Type, b: Type): boolean {
  if (a.kind === 'list' && b.kind === 'list') {
    return typesEqual(a.inner, b.inner);
  }
  return a.kind === b.kind;
}
