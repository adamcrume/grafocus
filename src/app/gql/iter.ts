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

export class Iter<T> {
  constructor(private readonly iterator: Iterator<T>) {}

  [Symbol.iterator](): this {
    return this;
  }

  next(): IteratorResult<T> {
    return this.iterator.next();
  }

  map<U>(f: (t: T) => U): Iter<U> {
    const iterator = this.iterator;
    return new Iter<U>({
      next(): IteratorResult<U> {
        const r = iterator.next();
        if (r.done) {
          return r;
        }
        return { value: f(r.value) };
      },
    });
  }
}

export function iter<T>(iterator: Iterator<T> | Iterable<T>): Iter<T> {
  if (Symbol.iterator in iterator) {
    return new Iter<T>(iterator[Symbol.iterator]());
  } else {
    return new Iter<T>(iterator);
  }
}
