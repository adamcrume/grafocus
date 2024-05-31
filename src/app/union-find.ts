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

interface Entry<T> {
    value: T,
    size: number,
    parent: Entry<T>|undefined,
}

function rootOf<T>(e: Entry<T>): Entry<T> {
    while (e.parent) {
        e = e.parent;
    }
    return e;
}

export class UnionFind<T> {
    private entries = new Map<T, Entry<T>>();

    private entry(data: T): Entry<T> {
        let entry = this.entries.get(data);
        if (!entry) {
            entry = {
                value: data,
                size: 1,
                parent: undefined,
            };
            this.entries.set(data, entry);
        }
        return entry;
    }
    
    private find(entry: Entry<T>): Entry<T> {
        const parent = entry.parent;
        if (!parent) {
            return entry;
        }
        const root = this.find(parent);
        if (parent != root) {
            entry.parent = root;
            parent.size -= entry.size;
        }
        return root;
    }

    union(left: T, right: T) {
        let x = this.find(this.entry(left));
        let y = this.find(this.entry(right));
        if (x === y) {
            return;
        }
        if (x.size < y.size) {
            [x, y] = [y, x];
        }
        y.parent = x;
        x.size += y.size;
    }

    sets(): T[][] {
        const sets = new Map<Entry<T>, T[]>();
        for (let [value, entry] of this.entries) {
            const root = this.find(entry);
            let set = sets.get(root);
            if (!set) {
                set = [];
                sets.set(root, set);
            }
            set.push(value);
        }
        return [...sets.values()];
    }
}

export function unionFind(data: string[][]): string[][] {
    const uf = new UnionFind<string>();
    for (const group of data) {
        if (group.length === 0) {
            continue;
        }
        uf.union(group[0], group[0]); // ensure that singletons exist
        for (let i = 1; i < group.length; i++) {
            uf.union(group[i - 1], group[i]);
        }
    }
    return uf.sets();
}
