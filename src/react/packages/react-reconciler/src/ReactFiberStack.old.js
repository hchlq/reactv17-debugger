/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

const valueStack = [];

let fiberStack;

if (__DEV__) {
  fiberStack = [];
}

let index = -1;

function createCursor(defaultValue) {
  return {
    current: defaultValue,
  };
}

function isEmpty() {
  return index === -1;
}

function pop(cursor, fiber) {
  if (index < 0) {
    return;
  }

  cursor.current = valueStack[index];

  valueStack[index] = null;
  index--;
}

function push(cursor, value) {
  index++;

  // 将值放入栈中
  valueStack[index] = cursor.current;

  // 更新 current
  cursor.current = value;

}

function checkThatStackIsEmpty() {
  if (__DEV__) {
    if (index !== -1) {
      console.error(
        'Expected an empty stack. Something was not reset properly.',
      );
    }
  }
}

function resetStackAfterFatalErrorInDev() {
  if (__DEV__) {
    index = -1;
    valueStack.length = 0;
    fiberStack.length = 0;
  }
}

export {
  createCursor,
  isEmpty,
  pop,
  push,
  // DEV only:
  checkThatStackIsEmpty,
  resetStackAfterFatalErrorInDev,
};
