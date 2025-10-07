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
  ANY,
  ANY_LIST,
  BOOLEAN,
  EDGE_REF,
  isSubtype,
  listOf,
  NODE_REF,
  NOTHING,
  unionOf,
  STRING,
  STRING_LIST,
  NULL,
  NUMBER,
  NUMBER_LIST,
} from './types';

describe('toString', () => {
  it('works', () => {
    expect('' + listOf(STRING)).toEqual('LIST<STRING NOT NULL> NOT NULL');
    expect('' + unionOf([])).toEqual('NOTHING');
    expect('' + unionOf([STRING])).toEqual('STRING NOT NULL');
    expect('' + unionOf([STRING, NULL])).toEqual('STRING');
    expect('' + unionOf([STRING, NUMBER])).toEqual(
      'STRING NOT NULL | NUMBER NOT NULL',
    );
    expect('' + unionOf([STRING, NUMBER, NULL])).toEqual('STRING | NUMBER');
    expect('' + listOf(unionOf([STRING, NUMBER]))).toEqual(
      'LIST<STRING NOT NULL | NUMBER NOT NULL> NOT NULL',
    );
  });
});

describe('isSubtype', () => {
  it('works for equal types', () => {
    expect(isSubtype(ANY, ANY));
    expect(isSubtype(BOOLEAN, BOOLEAN));
    expect(isSubtype(EDGE_REF, EDGE_REF));
    expect(isSubtype(NUMBER_LIST, NUMBER_LIST));
    expect(isSubtype(STRING_LIST, STRING_LIST));
    expect(isSubtype(NODE_REF, NODE_REF));
    expect(isSubtype(NOTHING, NOTHING));
    expect(isSubtype(NUMBER, NUMBER));
    expect(isSubtype(STRING, STRING));
    expect(isSubtype(unionOf([STRING, NUMBER]), unionOf([STRING, NUMBER])));
  });

  it('everything is subtype of any', () => {
    expect(isSubtype(ANY, ANY));
    expect(isSubtype(BOOLEAN, ANY));
    expect(isSubtype(EDGE_REF, ANY));
    expect(isSubtype(NUMBER_LIST, ANY));
    expect(isSubtype(STRING_LIST, ANY));
    expect(isSubtype(NODE_REF, ANY));
    expect(isSubtype(NOTHING, ANY));
    expect(isSubtype(NUMBER, ANY));
    expect(isSubtype(STRING, ANY));
    expect(isSubtype(unionOf([STRING, NUMBER]), ANY));
    expect(!isSubtype(ANY, BOOLEAN));
    expect(!isSubtype(ANY, EDGE_REF));
    expect(!isSubtype(ANY, NUMBER_LIST));
    expect(!isSubtype(ANY, STRING_LIST));
    expect(!isSubtype(ANY, NODE_REF));
    expect(!isSubtype(ANY, NOTHING));
    expect(!isSubtype(ANY, NUMBER));
    expect(!isSubtype(ANY, STRING));
    expect(!isSubtype(ANY, unionOf([STRING, NUMBER])));
  });

  it('nothing is a subtype of everything', () => {
    expect(isSubtype(NOTHING, ANY));
    expect(isSubtype(NOTHING, BOOLEAN));
    expect(isSubtype(NOTHING, EDGE_REF));
    expect(isSubtype(NOTHING, NUMBER_LIST));
    expect(isSubtype(NOTHING, STRING_LIST));
    expect(isSubtype(NOTHING, NODE_REF));
    expect(isSubtype(NOTHING, NOTHING));
    expect(isSubtype(NOTHING, NUMBER));
    expect(isSubtype(NOTHING, STRING));
    expect(isSubtype(NOTHING, unionOf([STRING, NUMBER])));
    expect(!isSubtype(ANY, NOTHING));
    expect(!isSubtype(BOOLEAN, NOTHING));
    expect(!isSubtype(EDGE_REF, NOTHING));
    expect(!isSubtype(NUMBER_LIST, NOTHING));
    expect(!isSubtype(STRING_LIST, NOTHING));
    expect(!isSubtype(NODE_REF, NOTHING));
    expect(!isSubtype(NUMBER, NOTHING));
    expect(!isSubtype(STRING, NOTHING));
    expect(!isSubtype(unionOf([STRING, NUMBER]), NOTHING));
  });

  it('list respects subtypes', () => {
    expect(isSubtype(NUMBER_LIST, ANY_LIST));
    expect(!isSubtype(ANY_LIST, NUMBER_LIST));
  });

  it('union', () => {
    expect(isSubtype(STRING, unionOf([STRING, NUMBER])));
    expect(isSubtype(NUMBER, unionOf([STRING, NUMBER])));
    expect(isSubtype(NUMBER_LIST, unionOf([STRING, ANY_LIST])));
    expect(
      isSubtype(unionOf([STRING, NUMBER_LIST]), unionOf([STRING, ANY_LIST])),
    );
    expect(
      isSubtype(
        unionOf([STRING, NUMBER_LIST]),
        unionOf([STRING, NUMBER, ANY_LIST]),
      ),
    );
    expect(!isSubtype(unionOf([STRING, NUMBER]), STRING));
    expect(!isSubtype(unionOf([STRING, NUMBER]), NUMBER));
    expect(!isSubtype(unionOf([STRING, ANY_LIST]), NUMBER_LIST));
    expect(
      !isSubtype(unionOf([STRING, ANY_LIST]), unionOf([STRING, NUMBER_LIST])),
    );
    expect(
      !isSubtype(
        unionOf([STRING, NUMBER, ANY_LIST]),
        unionOf([STRING, NUMBER_LIST]),
      ),
    );
  });

  it('normalizes unions of one', () => {
    expect(isSubtype(STRING, unionOf([STRING])));
    expect(isSubtype(unionOf([STRING]), STRING));
  });

  it('normalizes empty unions', () => {
    expect(isSubtype(NOTHING, unionOf([])));
    expect(isSubtype(unionOf([]), NOTHING));
  });

  it('normalizes nested unions', () => {
    expect(
      isSubtype(
        unionOf([STRING, unionOf([NUMBER, NUMBER_LIST])]),
        unionOf([unionOf([STRING, NUMBER]), NUMBER_LIST]),
      ),
    );
    expect(
      isSubtype(
        unionOf([unionOf([STRING, NUMBER]), NUMBER_LIST]),
        unionOf([STRING, unionOf([NUMBER, NUMBER_LIST])]),
      ),
    );
  });

  it('normalizes unions with subtypes', () => {
    expect(
      isSubtype(
        unionOf([ANY_LIST, NUMBER]),
        unionOf([ANY_LIST, NUMBER_LIST, NUMBER]),
      ),
    );
    expect(
      isSubtype(
        unionOf([ANY_LIST, NUMBER_LIST, NUMBER]),
        unionOf([ANY_LIST, NUMBER]),
      ),
    );
  });
});
