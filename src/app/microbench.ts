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

class Test {
  sum = 0;
  sumSq = 0;

  constructor(
    readonly name: string,
    readonly f: () => void,
  ) {}
}

export class Bencher {
  private tests: Array<Test> = [];
  private count = 0;

  add(name: string, f: () => void): void {
    this.tests.push(new Test(name, f));
  }

  private tick(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  async run(m: number): Promise<void> {
    console.log('Warmup...');
    for (let i = 0; i < 1; i++) {
      for (const test of this.tests) {
        test.f();
      }
    }
    for (let i = 0; i < m; i++) {
      console.log(`-------------------`);
      console.log(`Iteration ${i} of ${m}`);
      const n = ++this.count;
      for (const test of this.tests) {
        const start = performance.now();
        test.f();
        const end = performance.now();
        test.sum += end - start;
        test.sumSq += Math.pow(end - start, 2);
        const avg = test.sum / n;
        const variance = ((test.sumSq / n - avg * avg) * n) / (n - 1);
        const moe = Math.sqrt(variance / n);
        console.log(`${test.name}: ${avg} +/- ${moe}`);
        await this.tick();
      }
    }
  }
}
