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

import { checkExhaustive } from '../util';

export interface TypeBase {
  kind: string;
  toString(): string;
}

export interface NothingType extends TypeBase {
  kind: 'nothing';
}

export const NOTHING: NothingType = {
  kind: 'nothing',
  toString() {
    return 'NOTHING';
  },
};

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

export const STRING_LIST: ListType = listOf(STRING);

export const ANY_LIST: ListType = listOf(ANY);

export interface UnionType extends TypeBase {
  kind: 'union';
  inner: Type[];
}

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
    return 'RELATIONSHIP';
  },
};

export type Type =
  | AnyType
  | BooleanType
  | EdgeRefType
  | ListType
  | NodeRefType
  | NothingType
  | NumberType
  | StringType
  | UnionType;

export function listOf(element: Type): ListType {
  return {
    kind: 'list',
    inner: element,
    toString() {
      return `LIST<${element}>`;
    },
  };
}

export function unionOf(types: Type[]): Type {
  const inner: Type[] = types.flatMap((t) => {
    if (t.kind === 'union') {
      return t.inner;
    } else {
      return [t];
    }
  });
  inner.sort(compareTypes);
  // TODO: There must be a more efficient way.
  // Possibly helpful:
  // https://arxiv.org/pdf/0707.1532v1
  // "Sorting and Selection in Posets"
  // Constantinos Daskalakis, Richard M. Karp, Elchanan Mossel,
  // Samantha Riesenfeld, Elad Verbin
  for (let i = 0; i < inner.length; i++) {
    for (let j = i + 1; j < inner.length; j++) {
      if (isSubtype(inner[i], inner[j])) {
        inner.splice(i, 1);
        i--;
        j--;
      }
      // We don't have to check for inner[j] being a subtype of
      // inner[i], because the sort using compareTypes
      // ensures that that will never happen.
    }
  }
  if (inner.length === 0) {
    return NOTHING;
  }
  if (inner.length === 1) {
    return inner[0];
  }
  return {
    kind: 'union',
    inner,
    toString() {
      if (inner.length === 0) {
        return 'UNION<>';
      } else if (inner.length === 1) {
        return `UNION<${inner[0]}>`;
      }
      return inner.map((t) => t.toString()).join(' | ');
    },
  };
}

// Values should be 1:1 with kinds.
// Specific values are subject to change.
function typeIndex(t: Type): number {
  const kind = t.kind;
  switch (kind) {
    case 'nothing':
      return 0;
    case 'boolean':
      return 1;
    case 'string':
      return 2;
    case 'number':
      return 3;
    case 'node_ref':
      return 4;
    case 'edge_ref':
      return 5;
    case 'list':
      return 6;
    case 'union':
      return 7;
    case 'any':
      return 8;
    default:
      checkExhaustive(kind);
  }
}

// This comparison always ensures that if A is a subtype of B, then A compares
// less than B. The converse is not true (e.g. boolean < string, but boolean is
// not a subtype of string).
function compareTypes(a: Type, b: Type): number {
  const ai = typeIndex(a);
  const bi = typeIndex(b);
  if (ai !== bi) {
    return ai - bi;
  }
  const kind = a.kind;
  switch (kind) {
    case 'nothing':
    case 'boolean':
    case 'string':
    case 'number':
    case 'node_ref':
    case 'edge_ref':
      return 0;
    case 'list':
      return compareTypes(a.inner, (b as ListType).inner);
    case 'union':
      const bb = b as UnionType;
      if (a.inner.length !== bb.inner.length) {
        return a.inner.length - bb.inner.length;
      }
      for (let i = 0; i < a.inner.length; i++) {
        const c = compareTypes(a.inner[i], bb.inner[i]);
        if (c !== 0) {
          return c;
        }
      }
      return 0;
    case 'any':
      return 0;
    default:
      checkExhaustive(kind);
  }
}

export function isSubtype(child: Type, parent: Type): boolean {
  if (child.kind === 'nothing') {
    return true;
  }
  if (parent.kind === 'any') {
    return true;
  }
  if (parent.kind === 'list' && child.kind === 'list') {
    // Lists are covariant because they're immutable.
    return isSubtype(child.inner, parent.inner);
  }
  if (parent.kind === 'union' && child.kind === 'union') {
    // TODO: Is there a more efficient way to do this?
    return child.inner.every((c) => parent.inner.some((p) => isSubtype(c, p)));
  }
  if (parent.kind === 'union') {
    return parent.inner.some((p) => isSubtype(child, p));
  }
  return parent.kind === child.kind;
}
