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

start = query

hexDigit = [0-9a-fA-F]

identifier "identifier" = plainIdentifier / quotedIdentifier

plainIdentifier = $([_a-zA-Z] [_a-zA-Z0-9]*)

quotedIdentifier = "`" chars:(
  "``" {return "`"} /
  ("\\u" h:$hexDigit|4| {return String.fromCharCode(parseInt(h, 16))})  /
  [^`\\]
)+ "`"
{
  return chars.join('');
}

sp "space" = [\u0009-\u000D\u001C-\u0020\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*

query = reads:readClause|.., sp| sp tail:(
  r:return {return {updates: [], returnClause:r};} /
  u:updateClause|1.., sp| sp r:return? {return {updates:u, returnClause:r};}
  ) {
  return {
    reads,
    updates: tail.updates,
    returnClause: tail.returnClause,
  }
}

readClause = match

updateClause = create / delete / set / remove

// query = clauses:clause |1.., sp| {
//   return {
//     clauses,
//   };
// }

// clause = match / delete

create = "create"i sp path:path {
  return {
    kind: 'create',
    path,
  };
}

delete = detach:"detach"i? sp "delete"i sp name:identifier {
  return {
    kind: 'delete',
    detach: !!detach,
    name,
  };
}

propertyExpression = root:identifier chain:(sp "." sp @identifier)+ {
  return {
    kind: 'propertyExpression',
    root,
    chain,
  }
}

setProperty = p:propertyExpression sp "=" sp e:expression {
  return {
    kind: 'setProperty',
    property: p,
    expression: e,
  }
}

setLabels = variable:identifier labels:(sp ":" sp @identifier)+ {
  return {
    kind: 'setLabels',
    variable,
    labels,
  }
}

setItem = setProperty / setLabels

set = "set"i sp items:setItem|1.., sp "," sp| {
  return {
    kind: 'set',
    items,
  };
}

removeProperty = p:propertyExpression {
  return {
    kind: 'removeProperty',
    property: p,
  }
}

removeLabels = variable:identifier labels:(sp ":" sp @identifier)+ {
  return {
    kind: 'removeLabels',
    variable,
    labels,
  }
}

removeItem = removeProperty / removeLabels

remove = "remove"i sp items:removeItem|1.., sp "," sp| {
  return {
    kind: 'remove',
    items,
  };
}

match = "match"i sp paths:path|1.., sp "," sp| where:(sp "where"i sp @expression)? {
  return {
    kind: 'match',
    paths,
    where,
  };
}

return = "return"i sp values:expression|.., sp "," sp| {
  return {
    values,
  };
}

labelPrimary = "(" sp e:labelExpression sp ")" {return e} /
               i:identifier {return {kind: 'identifier', value: i}}

labelNegation = neg:("!" sp)* e:labelPrimary {
  if (neg && neg.length % 2 === 1) {
    return {
      kind: 'negation',
      value: e,
    };
  } else {
    return e;
  }
}

labelConjunction = head:labelNegation tail:(sp "&" sp @labelNegation)* {
  if (tail && tail.length > 0) {
    return {
      kind: 'conjunction',
      values: [head, ...tail],
    };
  } else {
    return head;
  }
}

labelDisjunction = head:labelConjunction tail:(sp "|" sp @labelConjunction)* {
  if (tail && tail.length > 0) {
    return {
      kind: 'disjunction',
      values: [head, ...tail],
    };
  } else {
    return head;
  }
}

labelExpression = labelDisjunction

node = "(" sp
       name:identifier? sp
       label:(":" sp @labelExpression sp)?
       properties:mapLiteral? sp
       ")" {
  return {
    name,
    label,
    properties,
  };
}

integerLiteral = [-+]? ("0" / [1-9] [0-9]*) {
  return parseInt(text(), 10);
}

floatLiteral = [-+]? ([0-9]+ "." [0-9]* / [0-9]* "." [0-9]+) ([eE] [-+]? [0-9]+)? {
  return parseFloat(text(), 10);
}

numberLiteral = integerLiteral / floatLiteral

escapeSequence = "\\" @(
  "u" hexShort:$hexDigit|4| {return String.fromCharCode(parseInt(hexShort, 16))} /
  "U" hexLong:$hexDigit|8| {return String.fromCharCode(parseInt(hexLong, 16))} /
  @"\\" /
  @"'" /
  @'"' /
  "b" {return "\b"} /
  "f" {return "\f"} /
  "n" {return "\n"} /
  "r" {return "\r"} /
  "t" {return "\t"}
)

singleQuoteLiteral = "'" chars:(escapeSequence / [^'\\])* "'" {
  return chars.join('');
}

doubleQuoteLiteral = '"' chars:(escapeSequence / [^"\\])* '"' {
  return chars.join('');
}

stringLiteral = singleQuoteLiteral / doubleQuoteLiteral

literal = n:numberLiteral {return {kind: 'number', value: n}} /
          s:stringLiteral {return {kind: 'string', value: s}}

atom = literal /
       i:identifier {return {kind: 'identifier', value: i}} /
       p:path {return {kind: 'path', value: p}}

expression = andExpression

andExpression = e:notExpression|1.., sp "and"i sp| {
  if (e.length === 1) {
    return e[0];
  }
  return {
    kind: 'and',
    value: e,
  };
}

notExpression = not:("not"i sp)* a:atom {
  if (not.length % 2) {
    return {kind: 'not', value: a};
  }
  return a;
}

mapLiteral = "{" sp @(k:identifier sp ":" sp v:expression {return [k, v]})|.., sp "," sp| sp "}"

quantifier = "*" {
  return {
    min: 0,
    max: 1/0,
  };
}

edge = left:"<"? "-" sp namelabel:(
    "[" sp
    @identifier? sp
    @(":" sp @labelExpression sp)?
    @mapLiteral? sp
    "]" sp
  )? "-" right:">"? quantifier:quantifier? {
  if (left && right) {
   error(`edge ${JSON.stringify(name)} has both left and right arrows`);
  }
  return {
    name: namelabel ? namelabel[0] : null,
    label: namelabel ? namelabel[1] : null,
    properties: namelabel ? namelabel[2] : null,
    direction: left ? 'LEFT' : right ? 'RIGHT' : 'NONE',
    quantifier,
  };
}

path = head:node sp tail:(@edge sp @node sp)* {
  return {
    nodes: [head, ...tail.map(([e, n]) => n)],
    edges: tail.map(([e, n]) => e),
  };
}
