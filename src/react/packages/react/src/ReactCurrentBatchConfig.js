/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

/**
 * Keeps track of the current batch's configuration such as how long an update
 * should suspend for if it needs to.
 * 比如在 useDeferredValue 中，更新的时候会给其赋值
 */
const ReactCurrentBatchConfig = {
  transition: 0,
};

export default ReactCurrentBatchConfig;
