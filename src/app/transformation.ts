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

import { planQuery, QueryPlan } from './gql/engine';
import { parseQuery } from './gql/parser';

export interface Transformation {
  name: string;
  query: string;
  queryPlan: QueryPlan;
  enabled: boolean;
}

export function createTransformation(
  name: string,
  query: string,
  enabled: boolean = false,
): Transformation {
  try {
    return {
      name,
      query,
      queryPlan: planQuery(parseQuery(query)),
      enabled,
    };
  } catch (e: unknown) {
    throw new Error(`Error creating transformation ${name}: ${e}`, {
      cause: e,
    });
  }
}
