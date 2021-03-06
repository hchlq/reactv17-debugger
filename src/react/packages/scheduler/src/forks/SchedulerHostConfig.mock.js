/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

let currentTime = 0;
let scheduledCallback = null;
let scheduledTimeout = null;
let timeoutTime = -1;
let yieldedValues = null;
let expectedNumberOfYields = -1;
let didStop = false;
let isFlushing = false;
let needsPaint = false;
let shouldYieldForPaint = false;

export function requestHostCallback(callback) {
  scheduledCallback = callback;
}

export function cancelHostCallback() {
  scheduledCallback = null;
}

export function requestHostTimeout(callback, ms) {
  scheduledTimeout = callback;
  timeoutTime = currentTime + ms;
}

export function cancelHostTimeout() {
  scheduledTimeout = null;
  timeoutTime = -1;
}

export function shouldYieldToHost() {
  if (
    (expectedNumberOfYields !== -1 &&
      yieldedValues !== null &&
      yieldedValues.length >= expectedNumberOfYields) ||
    (shouldYieldForPaint && needsPaint)
  ) {
    // We yielded at least as many values as expected. Stop flushing.
    didStop = true;
    return true;
  }
  return false;
}

export function getCurrentTime() {
  return currentTime;
}

export function forceFrameRate() {
  // No-op
}

export function reset() {
  if (isFlushing) {
    throw new Error('Cannot reset while already flushing work.');
  }
  currentTime = 0;
  scheduledCallback = null;
  scheduledTimeout = null;
  timeoutTime = -1;
  yieldedValues = null;
  expectedNumberOfYields = -1;
  didStop = false;
  isFlushing = false;
  needsPaint = false;
}

// Should only be used via an assertion helper that inspects the yielded values.
export function unstable_flushNumberOfYields(count) {
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    const cb = scheduledCallback;
    expectedNumberOfYields = count;
    isFlushing = true;
    try {
      let hasMoreWork = true;
      do {
        hasMoreWork = cb(true, currentTime);
      } while (hasMoreWork && !didStop);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
    } finally {
      expectedNumberOfYields = -1;
      didStop = false;
      isFlushing = false;
    }
  }
}

export function unstable_flushUntilNextPaint() {
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    const cb = scheduledCallback;
    shouldYieldForPaint = true;
    needsPaint = false;
    isFlushing = true;
    try {
      let hasMoreWork = true;
      do {
        hasMoreWork = cb(true, currentTime);
      } while (hasMoreWork && !didStop);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
    } finally {
      shouldYieldForPaint = false;
      didStop = false;
      isFlushing = false;
    }
  }
}

export function unstable_flushExpired() {
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    isFlushing = true;
    try {
      const hasMoreWork = scheduledCallback(false, currentTime);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
    } finally {
      isFlushing = false;
    }
  }
}

export function unstable_flushAllWithoutAsserting() {
  // Returns false if no work was flushed.
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    const cb = scheduledCallback;
    isFlushing = true;
    try {
      let hasMoreWork = true;
      do {
        hasMoreWork = cb(true, currentTime);
      } while (hasMoreWork);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
      return true;
    } finally {
      isFlushing = false;
    }
  } else {
    return false;
  }
}

export function unstable_clearYields() {
  if (yieldedValues === null) {
    return [];
  }
  const values = yieldedValues;
  yieldedValues = null;
  return values;
}

export function unstable_flushAll() {
  if (yieldedValues !== null) {
    throw new Error(
      'Log is not empty. Assert on the log of yielded values before ' +
        'flushing additional work.',
    );
  }
  unstable_flushAllWithoutAsserting();
  if (yieldedValues !== null) {
    throw new Error(
      'While flushing work, something yielded a value. Use an ' +
        'assertion helper to assert on the log of yielded values, e.g. ' +
        'expect(Scheduler).toFlushAndYield([...])',
    );
  }
}

export function unstable_yieldValue(value) {
  // eslint-disable-next-line react-internal/no-production-logging
  if (console.log.name === 'disabledLog') {
    // If console.log has been patched, we assume we're in render
    // replaying and we ignore any values yielding in the second pass.
    return;
  }
  if (yieldedValues === null) {
    yieldedValues = [value];
  } else {
    yieldedValues.push(value);
  }
}

export function unstable_advanceTime(ms) {
  // eslint-disable-next-line react-internal/no-production-logging
  if (console.log.name === 'disabledLog') {
    // If console.log has been patched, we assume we're in render
    // replaying and we ignore any time advancing in the second pass.
    return;
  }
  currentTime += ms;
  if (scheduledTimeout !== null && timeoutTime <= currentTime) {
    scheduledTimeout(currentTime);
    timeoutTime = -1;
    scheduledTimeout = null;
  }
}

export function requestPaint() {
  needsPaint = true;
}
