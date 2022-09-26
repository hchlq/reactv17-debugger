/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import {isPrimaryRenderer} from './ReactFiberHostConfig';
import {createCursor, push, pop} from './ReactFiberStack.old';
import {MAX_SIGNED_31_BIT_INT} from './MaxInts';
import {
  ContextProvider,
  ClassComponent,
  DehydratedFragment,
} from './ReactWorkTags';
import {
  NoLanes,
  NoTimestamp,
  isSubsetOfLanes,
  includesSomeLane,
  mergeLanes,
  pickArbitraryLane,
} from './ReactFiberLane';

import invariant from 'shared/invariant';
import is from 'shared/objectIs';
import {createUpdate, enqueueUpdate, ForceUpdate} from './ReactUpdateQueue.old';
import {markWorkInProgressReceivedUpdate} from './ReactFiberBeginWork.old';
import {enableSuspenseServerRenderer} from 'shared/ReactFeatureFlags';

const valueCursor = createCursor(null);

let rendererSigil;
if (__DEV__) {
  // Use this to detect multiple renderers using the same context
  rendererSigil = {};
}

let currentlyRenderingFiber = null;
let lastContextDependency = null;
let lastContextWithAllBitsObserved = null;

let isDisallowedContextReadInDEV = false;

export function resetContextDependencies() {
  // This is called right before React yields execution, to ensure `readContext`
  // cannot be called outside the render phase.
  currentlyRenderingFiber = null;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

export function enterDisallowedContextReadInDEV() {
  if (__DEV__) {
    isDisallowedContextReadInDEV = true;
  }
}

export function exitDisallowedContextReadInDEV() {
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

/**
 * 往栈中增加 Provider
 */
export function pushProvider(providerFiber, nextValue) {
  const context = providerFiber.type._context;

  // 1. { 0: null }  valueCursor.value: 'first'
  // 2. { 0: null, 1: 'first' } valueCursor.value: 'second'
  if (isPrimaryRenderer) {
    // react-dom 渲染

    // 1. 先加入到栈内
    // 2. 更新 value
    // debugger
    push(valueCursor, context._currentValue, providerFiber);
    context._currentValue = nextValue;
  } else {
    push(valueCursor, context._currentValue2, providerFiber);

    context._currentValue2 = nextValue;
  }
}

export function popProvider(providerFiber) {
  const currentValue = valueCursor.current;
  // debugger
  pop(valueCursor, providerFiber);

  const context = providerFiber.type._context;
  if (isPrimaryRenderer) {
    context._currentValue = currentValue;
  } else {
    context._currentValue2 = currentValue;
  }
}

export function calculateChangedBits(context, newValue, oldValue) {
  if (is(oldValue, newValue)) {
    // No change
    return 0;
  } else {
    const changedBits =
      typeof context._calculateChangedBits === 'function'
        ? context._calculateChangedBits(oldValue, newValue)
        : MAX_SIGNED_31_BIT_INT;

    return changedBits | 0;
  }
}

export function scheduleWorkOnParentPath(parent, renderLanes) {
  // Update the child lanes of all the ancestors, including the alternates.
  let node = parent;
  while (node !== null) {
    const alternate = node.alternate;
    if (!isSubsetOfLanes(node.childLanes, renderLanes)) {
      node.childLanes = mergeLanes(node.childLanes, renderLanes);
      if (alternate !== null) {
        alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
      }
    } else if (
      alternate !== null &&
      !isSubsetOfLanes(alternate.childLanes, renderLanes)
    ) {
      alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
    } else {
      // Neither alternate was updated, which means the rest of the
      // ancestor path already has sufficient priority.
      break;
    }
    node = node.return;
  }
}

export function propagateContextChange(
  workInProgress,
  context,
  changedBits,
  renderLanes,
) {
  let fiber = workInProgress.child;
  if (fiber !== null) {
    // Set the return pointer of the child to the work-in-progress fiber.
    fiber.return = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber;
    
    // Visit this fiber.
    const list = fiber.dependencies;
    if (list !== null) {
      console.log(fiber.type.name)
      // debugger;
      nextFiber = fiber.child;

      let dependency = list.firstContext;
      while (dependency !== null) {
        // Check if the context matches.
        if (
          dependency.context === context &&
          (dependency.observedBits & changedBits) !== 0
        ) {
          fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
          const alternate = fiber.alternate;

          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
          }

          scheduleWorkOnParentPath(fiber.return, renderLanes);

          // Mark the updated lanes on the list, too.
          list.lanes = mergeLanes(list.lanes, renderLanes);

          // Since we already found a match, we can stop traversing the
          // dependency list.
          break;
        }
        dependency = dependency.next;
      }
    } else if (fiber.tag === ContextProvider) {
      debugger
      // Don't scan deeper if this is a matching provider
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child;
    } else {
      // Traverse down.
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      // Set the return pointer of the child to the work-in-progress fiber.
      nextFiber.return = fiber;
    } else {
      // No child. Traverse to next sibling.
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // We're back to the root of this subtree. Exit.
          nextFiber = null;
          break;
        }
        const sibling = nextFiber.sibling;
        if (sibling !== null) {
          // Set the return pointer of the sibling to the work-in-progress fiber.
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        // No more siblings. Traverse up.
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

export function prepareToReadContext(workInProgress, renderLanes) {
  currentlyRenderingFiber = workInProgress;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;

  const dependencies = workInProgress.dependencies;
  if (dependencies !== null) {
    const firstContext = dependencies.firstContext;
    if (firstContext !== null) {
      if (includesSomeLane(dependencies.lanes, renderLanes)) {
        // Context list has a pending update. Mark that this fiber performed work.
        markWorkInProgressReceivedUpdate();
      }
      // Reset the work-in-progress list
      dependencies.firstContext = null;
    }
  }
}

export function readContext(context, observedBits) {
  if (lastContextWithAllBitsObserved === context) {
    // Nothing to do. We already observe everything in this context.
  } else if (observedBits === false || observedBits === 0) {
    // Do not observe any updates.
  } else {
    let resolvedObservedBits; // Avoid deopting on observable arguments or heterogeneous types.
    if (
      typeof observedBits !== 'number' ||
      observedBits === MAX_SIGNED_31_BIT_INT
    ) {
      // Observe all updates.
      lastContextWithAllBitsObserved = context;
      resolvedObservedBits = MAX_SIGNED_31_BIT_INT;
    } else {
      resolvedObservedBits = observedBits;
    }

    const contextItem = {
      context,
      observedBits: resolvedObservedBits,
      next: null,
    };

    // 构建依赖链表
    if (lastContextDependency === null) {
      // This is the first dependency for this component. Create a new list.
      lastContextDependency = contextItem;

      // 当前 Fiber 上依赖的
      // debugger
      currentlyRenderingFiber.dependencies = {
        lanes: NoLanes,
        firstContext: contextItem,
        responders: null,
      };
    } else {
      // Append a new context item.
      lastContextDependency = lastContextDependency.next = contextItem;
    }
  }

  return isPrimaryRenderer ? context._currentValue : context._currentValue2;
}
