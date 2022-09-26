/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import {REACT_PROVIDER_TYPE, REACT_CONTEXT_TYPE} from 'shared/ReactSymbols';

export function createContext(defaultValue, calculateChangedBits) {
  if (calculateChangedBits === undefined) {
    calculateChangedBits = null;
  }

  const context = {
    $$typeof: REACT_CONTEXT_TYPE,
    _calculateChangedBits: calculateChangedBits,

    // 提供给不同的渲染器使用
    _currentValue: defaultValue, // React Native & React DOM
    _currentValue2: defaultValue, // Fabric & React ART

    // These are circular
    Provider: null,
    Consumer: null,
  };

  context.Provider = {
    $$typeof: REACT_PROVIDER_TYPE,
    _context: context,
  };

  context.Consumer = context;

  return context;
}
