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
  ANY_LIST,
  BOOLEAN,
  BooleanType,
  EDGE_REF,
  EdgeRefType,
  ListType,
  NODE_REF,
  NodeRefType,
  NUMBER,
  NUMBER_LIST,
  NumberType,
  STRING,
  StringType,
  Type,
} from './types';

export interface ValueBase {
  type: Type;
  value: unknown;
}

export interface BooleanValue extends ValueBase {
  type: BooleanType;
  value: boolean;
}

export const TRUE: BooleanValue = {
  type: BOOLEAN,
  value: true,
};

export const FALSE: BooleanValue = {
  type: BOOLEAN,
  value: false,
};

export interface NumberValue extends ValueBase {
  type: NumberType;
  value: number;
}

export interface StringValue extends ValueBase {
  type: StringType;
  value: string;
}

export interface List extends ValueBase {
  type: ListType;
  value: Value[];
}

export interface NodeRef extends ValueBase {
  type: NodeRefType;
  value: string;
}

export interface EdgeRef extends ValueBase {
  type: EdgeRefType;
  value: string;
}

export type Value =
  | BooleanValue
  | EdgeRef
  | List
  | NodeRef
  | NumberValue
  | StringValue;

export function valueType(value: Value): Type {
  return value.type;
}

export function isList(value: Value): value is List {
  return valueType(value).kind === 'list';
}

export function isNumber(value: Value): value is NumberValue {
  return valueType(value).kind === 'number';
}

export function cloneValue(value: Value): Value {
  if (isList(value)) {
    return {
      type: value.type,
      value: value.value.map((v) => cloneValue(v)),
    };
  } else {
    return value;
  }
}

export function booleanValue(value: boolean): Value {
  if (value) {
    return TRUE;
  } else {
    return FALSE;
  }
}

export function numberValue(value: number): Value {
  return {
    type: NUMBER,
    value,
  };
}

export function stringValue(value: string): Value {
  return {
    type: STRING,
    value,
  };
}

export function primitiveValue(value: boolean | number | string): Value {
  if (typeof value === 'boolean') {
    return booleanValue(value);
  } else if (typeof value === 'number') {
    return numberValue(value);
  } else {
    return stringValue(value);
  }
}

export function nodeRefValue(value: string): Value {
  return {
    type: NODE_REF,
    value,
  };
}

export function edgeRefValue(value: string): Value {
  return {
    type: EDGE_REF,
    value,
  };
}

export function numberList(values: number[]): Value {
  return {
    type: NUMBER_LIST,
    value: values.map(primitiveValue),
  };
}

export function tryCastString(value: Value | undefined): string | undefined {
  if (value?.type?.kind === 'string') {
    return value.value as string;
  }
  return undefined;
}

export function tryCastBoolean(value: Value | undefined): boolean | undefined {
  if (value?.type?.kind === 'boolean') {
    return value.value as boolean;
  }
  return undefined;
}

export function tryCastNumber(value: Value | undefined): number | undefined {
  if (value?.type?.kind === 'number') {
    return value.value as number;
  }
  return undefined;
}

export function checkCastString(value: Value): string;
export function checkCastString(value: Value | undefined): string | undefined;
export function checkCastString(value: Value | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.type.kind === 'string') {
    return value.value as string;
  }
  throw new Error(`${JSON.stringify(value)} is not a string`);
}

export function tryCastList(value: Value | undefined): Value[] | undefined {
  if (value?.type?.kind === 'list') {
    return value.value as Value[];
  }
  return undefined;
}

export function checkCastList(value: Value): Value[];
export function checkCastList(value: Value | undefined): Value[] | undefined;
export function checkCastList(value: Value | undefined): Value[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.type.kind === 'list') {
    return value.value as Value[];
  }
  throw new Error(`${JSON.stringify(value)} is not a list`);
}

export function tryCastNodeRef(value: Value | undefined): string | undefined {
  if (value?.type?.kind === 'node_ref') {
    return value.value as string;
  }
  return undefined;
}

export function checkCastNodeRef(value: Value): string;
export function checkCastNodeRef(value: Value | undefined): string | undefined;
export function checkCastNodeRef(value: Value | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.type.kind === 'node_ref') {
    return value.value as string;
  }
  throw new Error(`${JSON.stringify(value)} is not a node ref`);
}

export function tryCastEdgeRef(value: Value | undefined): string | undefined {
  if (value?.type?.kind === 'edge_ref') {
    return value.value as string;
  }
  return undefined;
}

export function checkCastEdgeRef(value: Value): string;
export function checkCastEdgeRef(value: Value | undefined): string | undefined;
export function checkCastEdgeRef(value: Value | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.type.kind === 'edge_ref') {
    return value.value as string;
  }
  throw new Error(`${JSON.stringify(value)} is not a edge ref`);
}

export function listValue(values: Value[]): Value {
  if (values.length === 0) {
    return {
      type: ANY_LIST,
      value: values,
    };
  } else {
    return {
      type: {
        kind: 'list',
        inner: values[0].type,
      },
      value: values,
    };
  }
}

export function serializeValue(value: Value): any {
  const kind = value.type.kind;
  if (kind === 'boolean' || kind === 'string' || kind === 'number') {
    return value.value;
  }
  if (isList(value)) {
    return value.value.map(serializeValue);
  }
  return value;
}

export function deserializeValue(value: any): Value {
  if (typeof value === 'boolean') {
    return booleanValue(value);
  }
  if (typeof value === 'string') {
    return stringValue(value);
  }
  if (typeof value === 'number') {
    return numberValue(value);
  }
  if (Array.isArray(value)) {
    return listValue(value.map(deserializeValue));
  }
  throw new Error(`Unrecognized type: ${JSON.stringify(value)}`);
}
