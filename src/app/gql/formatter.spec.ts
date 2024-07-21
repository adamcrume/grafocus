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

import { formatExpression, formatPath } from './formatter';
import { parseExpression, Path } from './parser';

describe('formatExpression', () => {
  function reformat(s: string): string {
    return formatExpression(parseExpression(s)).toString();
  }

  it('formats identifiers', () => {
    expect(reformat('x')).toEqual('x');
  });

  it('formats identifiers with special characters', () => {
    expect(reformat('`x `')).toEqual('`x `');
  });

  it('formats numbers', () => {
    expect(reformat('0')).toEqual('0');
  });

  it('formats negation', () => {
    expect(reformat('not x')).toEqual('not x');
  });

  it('formats and', () => {
    expect(reformat('x and y')).toEqual('x and y');
  });

  it('formats not and', () => {
    expect(reformat('not x and y')).toEqual('not x and y');
  });

  it('formats or', () => {
    expect(reformat('x or y')).toEqual('x or y');
  });

  it('formats paths', () => {
    expect(reformat('()--()')).toEqual('()--()');
  });
});

describe('formatPath', () => {
  function parsePath(s: string): Path {
    const e = parseExpression(s);
    if (e.kind !== 'path') {
      throw new Error('not a path');
    }
    return e.value;
  }

  function reformat(s: string): string {
    return formatPath(parsePath(s)).toString();
  }

  it('formats short paths', () => {
    expect(reformat('()')).toEqual('()');
  });

  it('formats long paths', () => {
    expect(reformat('()--()--()')).toEqual('()--()--()');
  });

  it('formats node name', () => {
    expect(reformat('(x)')).toEqual('(x)');
  });

  it('formats node name with special characters', () => {
    expect(reformat('(`x `)')).toEqual('(`x `)');
  });

  it('formats node label', () => {
    expect(reformat('(:Foo)')).toEqual('(:Foo)');
  });

  it('formats node label with special characters', () => {
    expect(reformat('(:`Foo `)')).toEqual('(:`Foo `)');
  });

  it('formats node name and label', () => {
    expect(reformat('(x:Foo)')).toEqual('(x:Foo)');
  });

  it('formats node properties', () => {
    expect(reformat('({foo: 1})')).toEqual('({foo: 1})');
  });

  it('formats node properties with special characters', () => {
    expect(reformat('({`foo `: 1})')).toEqual('({`foo `: 1})');
  });

  it('formats node name and properties', () => {
    expect(reformat('(x {foo: 1})')).toEqual('(x {foo: 1})');
  });

  it('formats node label and properties', () => {
    expect(reformat('(:Foo {foo: 1})')).toEqual('(:Foo {foo: 1})');
  });

  it('formats edge left', () => {
    expect(reformat('()<--()')).toEqual('()<--()');
  });

  it('formats edge right', () => {
    expect(reformat('()-->()')).toEqual('()-->()');
  });

  it('formats edge name', () => {
    expect(reformat('()-[x]-()')).toEqual('()-[x]-()');
  });

  it('formats edge name with special characters', () => {
    expect(reformat('()-[`x `]-()')).toEqual('()-[`x `]-()');
  });

  it('formats edge label', () => {
    expect(reformat('()-[:x]-()')).toEqual('()-[:x]-()');
  });

  it('formats edge label with special characters', () => {
    expect(reformat('()-[:`x `]-()')).toEqual('()-[:`x `]-()');
  });

  it('formats edge name and label', () => {
    expect(reformat('()-[x:Foo]-()')).toEqual('()-[x:Foo]-()');
  });

  it('formats edge properties', () => {
    expect(reformat('()-[{foo: 1}]-()')).toEqual('()-[{foo: 1}]-()');
  });

  it('formats edge properties with special characters', () => {
    expect(reformat('()-[{`foo `: 1}]-()')).toEqual('()-[{`foo `: 1}]-()');
  });

  it('formats edge name and properties', () => {
    expect(reformat('()-[x {foo: 1}]-()')).toEqual('()-[x {foo: 1}]-()');
  });

  it('formats edge label and properties', () => {
    expect(reformat('()-[:Foo {foo: 1}]-()')).toEqual('()-[:Foo {foo: 1}]-()');
  });

  it('formats multiple properties', () => {
    expect(reformat('({foo: 1, bar: "x"})')).toEqual('({foo: 1, bar: "x"})');
  });
});
