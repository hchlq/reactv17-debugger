/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  enableDebugTracing,
  enableSchedulingProfiler,
  enableNewReconciler,
  decoupleUpdatePriorityFromScheduler,
} from 'shared/ReactFeatureFlags';

import {NoMode, BlockingMode, DebugTracingMode} from './ReactTypeOfMode';
import {
  NoLane,
  NoLanes,
  InputContinuousLanePriority,
  isSubsetOfLanes,
  mergeLanes,
  removeLanes,
  markRootEntangled,
  markRootMutableRead,
  getCurrentUpdateLanePriority,
  setCurrentUpdateLanePriority,
  higherLanePriority,
  DefaultLanePriority,
} from './ReactFiberLane';
import {readContext} from './ReactFiberNewContext.old';
import {
  Update as UpdateEffect,
  Passive as PassiveEffect,
} from './ReactFiberFlags';
import {
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Passive as HookPassive,
} from './ReactHookEffectTags';
import {
  getWorkInProgressRoot,
  scheduleUpdateOnFiber,
  requestUpdateLane,
  requestEventTime,
  warnIfNotCurrentlyActingEffectsInDEV,
  warnIfNotCurrentlyActingUpdatesInDev,
  warnIfNotScopedWithMatchingAct,
  markSkippedUpdateLanes,
} from './ReactFiberWorkLoop.old';

import invariant from 'shared/invariant';
import getComponentName from 'shared/getComponentName';
import is from 'shared/objectIs';
import {markWorkInProgressReceivedUpdate} from './ReactFiberBeginWork.old';
import {
  UserBlockingPriority,
  NormalPriority,
  runWithPriority,
  getCurrentPriorityLevel,
} from './SchedulerWithReactIntegration.old';
import {getIsHydrating} from './ReactFiberHydrationContext.old';
import {
  makeClientId,
  makeClientIdInDEV,
  makeOpaqueHydratingObject,
} from './ReactFiberHostConfig';
import {
  getWorkInProgressVersion,
  markSourceAsDirty,
  setWorkInProgressVersion,
  warnAboutMultipleRenderersDEV,
} from './ReactMutableSource.old';
import {getIsRendering} from './ReactCurrentFiber';
import {logStateUpdateScheduled} from './DebugTracing';
import {markStateUpdateScheduled} from './SchedulingProfiler';

const {ReactCurrentDispatcher, ReactCurrentBatchConfig} = ReactSharedInternals;

let didWarnAboutMismatchedHooksForComponent;
let didWarnAboutUseOpaqueIdentifier;
if (__DEV__) {
  didWarnAboutUseOpaqueIdentifier = {};
  didWarnAboutMismatchedHooksForComponent = new Set();
}

// These are set right before calling the component.
let renderLanes = NoLanes;
// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFiber = null;

// Hooks are stored as a linked list on the fiber's memoizedState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
let currentHook = null;
let workInProgressHook = null;

// Whether an update was scheduled at any point during the render phase. This
// does not get reset if we do another render pass; only when we're completely
// finished evaluating this component. This is an optimization so we know
// whether we need to clear render phase updates after a throw.
let didScheduleRenderPhaseUpdate = false;
// Where an update was scheduled only during the current render pass. This
// gets reset after each attempt.
// TODO: Maybe there's some way to consolidate this with
// `didScheduleRenderPhaseUpdate`. Or with `numberOfReRenders`.
let didScheduleRenderPhaseUpdateDuringThisPass = false;

const RE_RENDER_LIMIT = 25;

// In DEV, this is the name of the currently executing primitive hook
let currentHookNameInDev = null;

// In DEV, this list ensures that hooks are called in the same order between renders.
// The list stores the order of hooks used during the initial render (mount).
// Subsequent renders (updates) reference this list.
let hookTypesDev = null;
let hookTypesUpdateIndexDev = -1;

// In DEV, this tracks whether currently rendering component needs to ignore
// the dependencies for Hooks that need them (e.g. useEffect or useMemo).
// When true, such Hooks will always be "remounted". Only used during hot reload.
let ignorePreviousDependencies = false;

function mountHookTypesDev() {
  if (__DEV__) {
    const hookName = currentHookNameInDev;

    if (hookTypesDev === null) {
      hookTypesDev = [hookName];
    } else {
      hookTypesDev.push(hookName);
    }
  }
}

function updateHookTypesDev() {
  if (__DEV__) {
    const hookName = currentHookNameInDev;

    if (hookTypesDev !== null) {
      hookTypesUpdateIndexDev++;
      if (hookTypesDev[hookTypesUpdateIndexDev] !== hookName) {
        warnOnHookMismatchInDev(hookName);
      }
    }
  }
}

function checkDepsAreArrayDev(deps) {
  if (__DEV__) {
    if (deps !== undefined && deps !== null && !Array.isArray(deps)) {
      // Verify deps, but only on mount to avoid extra checks.
      // It's unlikely their type would change as usually you define them inline.
      console.error(
        '%s received a final argument that is not an array (instead, received `%s`). When ' +
          'specified, the final argument must be an array.',
        currentHookNameInDev,
        typeof deps,
      );
    }
  }
}

function warnOnHookMismatchInDev(currentHookName) {
  if (__DEV__) {
    const componentName = getComponentName(currentlyRenderingFiber.type);
    if (!didWarnAboutMismatchedHooksForComponent.has(componentName)) {
      didWarnAboutMismatchedHooksForComponent.add(componentName);

      if (hookTypesDev !== null) {
        let table = '';

        const secondColumnStart = 30;

        for (let i = 0; i <= hookTypesUpdateIndexDev; i++) {
          const oldHookName = hookTypesDev[i];
          const newHookName =
            i === hookTypesUpdateIndexDev ? currentHookName : oldHookName;

          let row = `${i + 1}. ${oldHookName}`;

          // Extra space so second column lines up
          // lol @ IE not supporting String#repeat
          while (row.length < secondColumnStart) {
            row += ' ';
          }

          row += newHookName + '\n';

          table += row;
        }

        console.error(
          'React has detected a change in the order of Hooks called by %s. ' +
            'This will lead to bugs and errors if not fixed. ' +
            'For more information, read the Rules of Hooks: https://reactjs.org/link/rules-of-hooks\n\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            '%s' +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n',
          componentName,
          table,
        );
      }
    }
  }
}

function throwInvalidHookError() {
  invariant(
    false,
    'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
      ' one of the following reasons:\n' +
      '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
      '2. You might be breaking the Rules of Hooks\n' +
      '3. You might have more than one copy of React in the same app\n' +
      'See https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.',
  );
}

function areHookInputsEqual(nextDeps, prevDeps) {
  if (__DEV__) {
    if (ignorePreviousDependencies) {
      // Only true when this component is being hot reloaded.
      return false;
    }
  }

  if (prevDeps === null) {
    if (__DEV__) {
      console.error(
        '%s received a final argument during this render, but not during ' +
          'the previous render. Even though the final argument is optional, ' +
          'its type cannot change between renders.',
        currentHookNameInDev,
      );
    }
    return false;
  }

  if (__DEV__) {
    // Don't bother comparing lengths in prod because these arrays should be
    // passed inline.
    if (nextDeps.length !== prevDeps.length) {
      console.error(
        'The final argument passed to %s changed size between renders. The ' +
          'order and size of this array must remain constant.\n\n' +
          'Previous: %s\n' +
          'Incoming: %s',
        currentHookNameInDev,
        `[${prevDeps.join(', ')}]`,
        `[${nextDeps.join(', ')}]`,
      );
    }
  }
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

export function renderWithHooks(
  current,
  workInProgress,
  Component,
  props,
  secondArg,
  nextRenderLanes,
) {
  // debugger
  // console.log('=====', workInProgress)
  renderLanes = nextRenderLanes;
  currentlyRenderingFiber = workInProgress;

  workInProgress.memoizedState = null;
  workInProgress.updateQueue = null;
  workInProgress.lanes = NoLanes;

  // The following should have already been reset
  // currentHook = null;
  // workInProgressHook = null;

  // didScheduleRenderPhaseUpdate = false;

  // TODO Warn if no hooks are used at all during mount, then some are used during update.
  // Currently we will identify the update render as a mount because memoizedState === null.
  // This is tricky because it's valid for certain types of components (e.g. React.lazy)

  // Using memoizedState to differentiate between mount/update only works if at least one stateful hook is used.
  // Non-stateful hooks (e.g. context) don't get added to memoizedState,
  // so memoizedState would be null during updates and mounts.
  ReactCurrentDispatcher.current =
    current === null || current.memoizedState === null
      ? HooksDispatcherOnMount
      : HooksDispatcherOnUpdate;

  let children = Component(props, secondArg);

  // Check if there was a render phase update
  if (didScheduleRenderPhaseUpdateDuringThisPass) {
    // Keep rendering in a loop for as long as render phase updates continue to
    // be scheduled. Use a counter to prevent infinite loops.
    let numberOfReRenders = 0;
    do {
      didScheduleRenderPhaseUpdateDuringThisPass = false;
      invariant(
        numberOfReRenders < RE_RENDER_LIMIT,
        'Too many re-renders. React limits the number of renders to prevent ' +
          'an infinite loop.',
      );

      numberOfReRenders += 1;

      // Start over from the beginning of the list
      currentHook = null;
      workInProgressHook = null;

      workInProgress.updateQueue = null;

      ReactCurrentDispatcher.current = HooksDispatcherOnRerender;

      // 重新执行一次
      children = Component(props, secondArg);
    } while (didScheduleRenderPhaseUpdateDuringThisPass);
  }

  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrancy.
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  if (__DEV__) {
    workInProgress._debugHookTypes = hookTypesDev;
  }

  // This check uses currentHook so that it works the same in DEV and prod bundles.
  // hookTypesDev could catch more cases (e.g. context) but only in DEV bundles.
  const didRenderTooFewHooks =
    currentHook !== null && currentHook.next !== null;

  renderLanes = NoLanes;
  currentlyRenderingFiber = null;

  currentHook = null;
  workInProgressHook = null;

  if (__DEV__) {
    currentHookNameInDev = null;
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;
  }

  didScheduleRenderPhaseUpdate = false;

  invariant(
    !didRenderTooFewHooks,
    'Rendered fewer hooks than expected. This may be caused by an accidental ' +
      'early return statement.',
  );

  return children;
}

export function bailoutHooks(current, workInProgress, lanes) {
  workInProgress.updateQueue = current.updateQueue;
  workInProgress.flags &= ~(PassiveEffect | UpdateEffect);
  current.lanes = removeLanes(current.lanes, lanes);
}

export function resetHooksAfterThrow() {
  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrancy.
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  if (didScheduleRenderPhaseUpdate) {
    // There were render phase updates. These are only valid for this render
    // phase, which we are now aborting. Remove the updates from the queues so
    // they do not persist to the next render. Do not remove updates from hooks
    // that weren't processed.
    //
    // Only reset the updates from the queue if it has a clone. If it does
    // not have a clone, that means it wasn't processed, and the updates were
    // scheduled before we entered the render phase.
    let hook = currentlyRenderingFiber.memoizedState;
    while (hook !== null) {
      const queue = hook.queue;
      if (queue !== null) {
        queue.pending = null;
      }
      hook = hook.next;
    }
    didScheduleRenderPhaseUpdate = false;
  }

  renderLanes = NoLanes;
  currentlyRenderingFiber = null;

  currentHook = null;
  workInProgressHook = null;

  if (__DEV__) {
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;

    currentHookNameInDev = null;

    isUpdatingOpaqueValueInRenderPhase = false;
  }

  didScheduleRenderPhaseUpdateDuringThisPass = false;
}

function mountWorkInProgressHook() {
  const hook = {
    memoizedState: null,

    baseState: null,
    baseQueue: null,
    queue: null,

    next: null,
  };

  if (workInProgressHook === null) {
    // This is the first hook in the list
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook;
  } else {
    // Append to the end of the list
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

function updateWorkInProgressHook() {
  // debugger;
  let nextCurrentHook;
  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate;
    if (current !== null) {
      nextCurrentHook = current.memoizedState;
    } else {
      nextCurrentHook = null;
    }
  } else {
    nextCurrentHook = currentHook.next;
  }

  // debugger
  let nextWorkInProgressHook;
  if (workInProgressHook === null) {
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState;
  } else {
    nextWorkInProgressHook = workInProgressHook.next;
  }
  // console.log(nextWorkInProgressHook);
  // if (nextWorkInProgressHook !== null) {
  //   debugger;
  // }

  if (nextWorkInProgressHook !== null) {
    // There's already a work-in-progress. Reuse it.
    workInProgressHook = nextWorkInProgressHook;
    nextWorkInProgressHook = workInProgressHook.next;

    currentHook = nextCurrentHook;
  } else {
    // Clone from the current hook.

    invariant(
      nextCurrentHook !== null,
      'Rendered more hooks than during the previous render.',
    );
    currentHook = nextCurrentHook;

    const newHook = {
      memoizedState: currentHook.memoizedState,

      baseState: currentHook.baseState,
      baseQueue: currentHook.baseQueue,
      queue: currentHook.queue,

      next: null,
    };

    if (workInProgressHook === null) {
      // This is the first hook in the list.
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook;
    } else {
      // Append to the end of the list.
      workInProgressHook = workInProgressHook.next = newHook;
    }
  }
  return workInProgressHook;
}

function createFunctionComponentUpdateQueue() {
  return {
    lastEffect: null,
  };
}

function basicStateReducer(state, action) {
  return typeof action === 'function' ? action(state) : action;
}

function mountReducer(reducer, initialArg, init) {
  const hook = mountWorkInProgressHook();
  let initialState;
  if (init !== undefined) {
    initialState = init(initialArg);
  } else {
    initialState = initialArg;
  }
  hook.memoizedState = hook.baseState = initialState;
  const queue = (hook.queue = {
    pending: null,
    dispatch: null,
    lastRenderedReducer: reducer,
    lastRenderedState: initialState,
  });
  const dispatch = (queue.dispatch = dispatchAction.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ));
  return [hook.memoizedState, dispatch];
}

function updateReducer(reducer, initialArg, init) {
  const hook = updateWorkInProgressHook();

  const queue = hook.queue;

  queue.lastRenderedReducer = reducer;

  const current = currentHook;

  // The last rebase update that is NOT part of the base state.
  let baseQueue = current.baseQueue;
  // console.log('newBaseQueueLast: 11', baseQueue)
  // The last pending update that hasn't been processed yet.
  const pendingQueue = queue.pending;
  if (pendingQueue !== null) {
    // We have new updates that haven't been processed yet.
    // We'll add them to the base queue.
    if (baseQueue !== null) {
      // Merge the pending queue and the base queue.
      const baseFirst = baseQueue.next;
      const pendingFirst = pendingQueue.next;
      baseQueue.next = pendingFirst;
      pendingQueue.next = baseFirst;
    }

    current.baseQueue = baseQueue = pendingQueue;
    queue.pending = null;
  }

  if (baseQueue !== null) {
    // We have a queue to process.
    const first = baseQueue.next;
    let newState = current.baseState;

    let newBaseState = null;
    let newBaseQueueFirst = null;
    let newBaseQueueLast = null;
    let update = first;
    do {
      const updateLane = update.lane;
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        const clone = {
          lane: updateLane,
          action: update.action,
          eagerReducer: update.eagerReducer,
          eagerState: update.eagerState,
          next: null,
        };
        if (newBaseQueueLast === null) {
          newBaseQueueFirst = newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          newBaseQueueLast = newBaseQueueLast.next = clone;
        }
        // Update the remaining priority in the queue.
        // TODO: Don't need to accumulate this. Instead, we can remove
        // renderLanes from the original lanes.
        currentlyRenderingFiber.lanes = mergeLanes(
          currentlyRenderingFiber.lanes,
          updateLane,
        );
        markSkippedUpdateLanes(updateLane);
      } else {
        // This update does have sufficient priority.

        if (newBaseQueueLast !== null) {
          const clone = {
            // This update is going to be committed so we never want uncommit
            // it. Using NoLane works because 0 is a subset of all bitmasks, so
            // this will never be skipped by the check above.
            lane: NoLane,
            action: update.action,
            eagerReducer: update.eagerReducer,
            eagerState: update.eagerState,
            next: null,
          };
          newBaseQueueLast = newBaseQueueLast.next = clone;
        }

        // Process this update.
        if (update.eagerReducer === reducer) {
          // If this update was processed eagerly, and its reducer matches the
          // current reducer, we can use the eagerly computed state.
          newState = update.eagerState;
        } else {
          const action = update.action;
          newState = reducer(newState, action);
        }
      }
      update = update.next;
    } while (update !== null && update !== first);

    if (newBaseQueueLast === null) {
      newBaseState = newState;
    } else {
      newBaseQueueLast.next = newBaseQueueFirst;
    }

    // Mark that the fiber performed work, but only if the new state is
    // different from the current state.
    // 前后两个值不一样
    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();
    }

    hook.memoizedState = newState;
    hook.baseState = newBaseState;
    // console.log('newBaseQueueLast: ', newBaseQueueLast)
    hook.baseQueue = newBaseQueueLast;

    queue.lastRenderedState = newState;
  }

  const dispatch = queue.dispatch;
  return [hook.memoizedState, dispatch];
}

function rerenderReducer(reducer, initialArg, init) {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;
  invariant(
    queue !== null,
    'Should have a queue. This is likely a bug in React. Please file an issue.',
  );

  queue.lastRenderedReducer = reducer;

  // This is a re-render. Apply the new render phase updates to the previous
  // work-in-progress hook.
  const dispatch = queue.dispatch;
  const lastRenderPhaseUpdate = queue.pending;
  let newState = hook.memoizedState;
  if (lastRenderPhaseUpdate !== null) {
    // The queue doesn't persist past this render pass.
    queue.pending = null;

    const firstRenderPhaseUpdate = lastRenderPhaseUpdate.next;
    let update = firstRenderPhaseUpdate;
    do {
      // Process this render phase update. We don't have to check the
      // priority because it will always be the same as the current
      // render's.
      const action = update.action;
      newState = reducer(newState, action);
      update = update.next;
    } while (update !== firstRenderPhaseUpdate);

    // Mark that the fiber performed work, but only if the new state is
    // different from the current state.
    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();
    }

    hook.memoizedState = newState;
    // Don't persist the state accumulated from the render phase updates to
    // the base state unless the queue is empty.
    // TODO: Not sure if this is the desired semantics, but it's what we
    // do for gDSFP. I can't remember why.
    if (hook.baseQueue === null) {
      hook.baseState = newState;
    }

    queue.lastRenderedState = newState;
  }
  return [newState, dispatch];
}

function readFromUnsubcribedMutableSource(root, source, getSnapshot) {
  const getVersion = source._getVersion;
  const version = getVersion(source._source);

  // Is it safe for this component to read from this source during the current render?
  let isSafeToReadFromSource = false;

  // Check the version first.
  // If this render has already been started with a specific version,
  // we can use it alone to determine if we can safely read from the source.
  const currentRenderVersion = getWorkInProgressVersion(source);
  if (currentRenderVersion !== null) {
    // It's safe to read if the store hasn't been mutated since the last time
    // we read something.
    isSafeToReadFromSource = currentRenderVersion === version;
  } else {
    // If there's no version, then this is the first time we've read from the
    // source during the current render pass, so we need to do a bit more work.
    // What we need to determine is if there are any hooks that already
    // subscribed to the source, and if so, whether there are any pending
    // mutations that haven't been synchronized yet.
    //
    // If there are no pending mutations, then `root.mutableReadLanes` will be
    // empty, and we know we can safely read.
    //
    // If there *are* pending mutations, we may still be able to safely read
    // if the currently rendering lanes are inclusive of the pending mutation
    // lanes, since that guarantees that the value we're about to read from
    // the source is consistent with the values that we read during the most
    // recent mutation.
    isSafeToReadFromSource = isSubsetOfLanes(
      renderLanes,
      root.mutableReadLanes,
    );

    if (isSafeToReadFromSource) {
      // If it's safe to read from this source during the current render,
      // store the version in case other components read from it.
      // A changed version number will let those components know to throw and restart the render.
      setWorkInProgressVersion(source, version);
    }
  }

  if (isSafeToReadFromSource) {
    const snapshot = getSnapshot(source._source);
    if (__DEV__) {
      if (typeof snapshot === 'function') {
        console.error(
          'Mutable source should not return a function as the snapshot value. ' +
            'Functions may close over mutable values and cause tearing.',
        );
      }
    }
    return snapshot;
  } else {
    // This handles the special case of a mutable source being shared between renderers.
    // In that case, if the source is mutated between the first and second renderer,
    // The second renderer don't know that it needs to reset the WIP version during unwind,
    // (because the hook only marks sources as dirty if it's written to their WIP version).
    // That would cause this tear check to throw again and eventually be visible to the user.
    // We can avoid this infinite loop by explicitly marking the source as dirty.
    //
    // This can lead to tearing in the first renderer when it resumes,
    // but there's nothing we can do about that (short of throwing here and refusing to continue the render).
    markSourceAsDirty(source);

    invariant(
      false,
      'Cannot read from mutable source during the current render without tearing. This is a bug in React. Please file an issue.',
    );
  }
}

function useMutableSource(hook, source, getSnapshot, subscribe) {
  const root = getWorkInProgressRoot();
  invariant(
    root !== null,
    'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
  );

  const getVersion = source._getVersion;
  const version = getVersion(source._source);

  const dispatcher = ReactCurrentDispatcher.current;

  // eslint-disable-next-line prefer-const
  let [currentSnapshot, setSnapshot] = dispatcher.useState(() =>
    readFromUnsubcribedMutableSource(root, source, getSnapshot),
  );
  let snapshot = currentSnapshot;

  // Grab a handle to the state hook as well.
  // We use it to clear the pending update queue if we have a new source.
  const stateHook = workInProgressHook;

  const memoizedState = hook.memoizedState;
  const refs = memoizedState.refs;
  const prevGetSnapshot = refs.getSnapshot;
  const prevSource = memoizedState.source;
  const prevSubscribe = memoizedState.subscribe;

  const fiber = currentlyRenderingFiber;

  hook.memoizedState = {
    refs,
    source,
    subscribe,
  };

  // Sync the values needed by our subscription handler after each commit.
  dispatcher.useEffect(() => {
    refs.getSnapshot = getSnapshot;

    // Normally the dispatch function for a state hook never changes,
    // but this hook recreates the queue in certain cases  to avoid updates from stale sources.
    // handleChange() below needs to reference the dispatch function without re-subscribing,
    // so we use a ref to ensure that it always has the latest version.
    refs.setSnapshot = setSnapshot;

    // Check for a possible change between when we last rendered now.
    const maybeNewVersion = getVersion(source._source);
    if (!is(version, maybeNewVersion)) {
      const maybeNewSnapshot = getSnapshot(source._source);
      if (__DEV__) {
        if (typeof maybeNewSnapshot === 'function') {
          console.error(
            'Mutable source should not return a function as the snapshot value. ' +
              'Functions may close over mutable values and cause tearing.',
          );
        }
      }

      if (!is(snapshot, maybeNewSnapshot)) {
        setSnapshot(maybeNewSnapshot);

        const lane = requestUpdateLane(fiber);
        markRootMutableRead(root, lane);
      }
      // If the source mutated between render and now,
      // there may be state updates already scheduled from the old source.
      // Entangle the updates so that they render in the same batch.
      markRootEntangled(root, root.mutableReadLanes);
    }
  }, [getSnapshot, source, subscribe]);

  // If we got a new source or subscribe function, re-subscribe in a passive effect.
  dispatcher.useEffect(() => {
    const handleChange = () => {
      const latestGetSnapshot = refs.getSnapshot;
      const latestSetSnapshot = refs.setSnapshot;

      try {
        latestSetSnapshot(latestGetSnapshot(source._source));

        // Record a pending mutable source update with the same expiration time.
        const lane = requestUpdateLane(fiber);

        markRootMutableRead(root, lane);
      } catch (error) {
        // A selector might throw after a source mutation.
        // e.g. it might try to read from a part of the store that no longer exists.
        // In this case we should still schedule an update with React.
        // Worst case the selector will throw again and then an error boundary will handle it.
        latestSetSnapshot(() => {
          throw error;
        });
      }
    };

    const unsubscribe = subscribe(source._source, handleChange);
    if (__DEV__) {
      if (typeof unsubscribe !== 'function') {
        console.error(
          'Mutable source subscribe function must return an unsubscribe function.',
        );
      }
    }

    return unsubscribe;
  }, [source, subscribe]);

  // If any of the inputs to useMutableSource change, reading is potentially unsafe.
  //
  // If either the source or the subscription have changed we can't can't trust the update queue.
  // Maybe the source changed in a way that the old subscription ignored but the new one depends on.
  //
  // If the getSnapshot function changed, we also shouldn't rely on the update queue.
  // It's possible that the underlying source was mutated between the when the last "change" event fired,
  // and when the current render (with the new getSnapshot function) is processed.
  //
  // In both cases, we need to throw away pending updates (since they are no longer relevant)
  // and treat reading from the source as we do in the mount case.
  if (
    !is(prevGetSnapshot, getSnapshot) ||
    !is(prevSource, source) ||
    !is(prevSubscribe, subscribe)
  ) {
    // Create a new queue and setState method,
    // So if there are interleaved updates, they get pushed to the older queue.
    // When this becomes current, the previous queue and dispatch method will be discarded,
    // including any interleaving updates that occur.
    const newQueue = {
      pending: null,
      dispatch: null,
      lastRenderedReducer: basicStateReducer,
      lastRenderedState: snapshot,
    };
    newQueue.dispatch = setSnapshot = dispatchAction.bind(
      null,
      currentlyRenderingFiber,
      newQueue,
    );
    stateHook.queue = newQueue;
    stateHook.baseQueue = null;
    snapshot = readFromUnsubcribedMutableSource(root, source, getSnapshot);
    stateHook.memoizedState = stateHook.baseState = snapshot;
  }

  return snapshot;
}

function mountMutableSource(source, getSnapshot, subscribe) {
  const hook = mountWorkInProgressHook();
  hook.memoizedState = {
    refs: {
      getSnapshot,
      setSnapshot: null,
    },
    source,
    subscribe,
  };
  return useMutableSource(hook, source, getSnapshot, subscribe);
}

function updateMutableSource(source, getSnapshot, subscribe) {
  const hook = updateWorkInProgressHook();
  return useMutableSource(hook, source, getSnapshot, subscribe);
}

function mountState(initialState) {
  const hook = mountWorkInProgressHook();
  if (typeof initialState === 'function') {
    // $FlowFixMe: Flow doesn't like mixed types
    initialState = initialState();
  }

  hook.memoizedState = hook.baseState = initialState;

  const queue = (hook.queue = {
    pending: null,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: initialState,
  });

  const dispatch = (queue.dispatch = dispatchAction.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ));

  return [hook.memoizedState, dispatch];
}

function updateState(initialState) {
  return updateReducer(basicStateReducer, initialState);
}

function rerenderState(initialState) {
  return rerenderReducer(basicStateReducer, initialState);
}

function pushEffect(tag, create, destroy, deps) {
  const effect = {
    tag,
    create,
    destroy,
    deps,
    // Circular
    next: null,
  };
  let componentUpdateQueue = currentlyRenderingFiber.updateQueue;
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = componentUpdateQueue;
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }
  return effect;
}

function mountRef(initialValue) {
  const hook = mountWorkInProgressHook();
  const ref = {current: initialValue};

  hook.memoizedState = ref;
  return ref;
}

function updateRef() {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

function mountEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = mountWorkInProgressHook();

  const nextDeps = deps === undefined ? null : deps;

  currentlyRenderingFiber.flags |= fiberFlags;

  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags,
    create,
    undefined,
    nextDeps,
  );
}

function updateEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy = undefined;
  if (currentHook !== null) {
    const prevEffect = currentHook.memoizedState;
    destroy = prevEffect.destroy;
    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        pushEffect(hookFlags, create, destroy, nextDeps);
        return;
      }
    }
  }

  currentlyRenderingFiber.flags |= fiberFlags;

  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags,
    create,
    destroy,
    nextDeps,
  );
}

function mountEffect(create, deps) {
  return mountEffectImpl(
    UpdateEffect | PassiveEffect,
    HookPassive,
    create,
    deps,
  );
}

function updateEffect(create, deps) {
  return updateEffectImpl(
    UpdateEffect | PassiveEffect,
    HookPassive,
    create,
    deps,
  );
}

function mountLayoutEffect(create, deps) {
  return mountEffectImpl(UpdateEffect, HookLayout, create, deps);
}

function updateLayoutEffect(create, deps) {
  return updateEffectImpl(UpdateEffect, HookLayout, create, deps);
}

/**
 * ref 是函数或者对象
 */
function imperativeHandleEffect(create, ref) {
  if (typeof ref === 'function') {
    const refCallback = ref;
    const inst = create();
    refCallback(inst);
    return () => {
      // 销毁函数
      refCallback(null);
    };
  } else if (ref !== null && ref !== undefined) {
    const refObject = ref;
    const inst = create();
    refObject.current = inst;
    return () => {
      // 销毁函数
      refObject.current = null;
    };
  }
}

function mountImperativeHandle(ref, create, deps) {
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  return mountEffectImpl(
    UpdateEffect,
    HookLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

function updateImperativeHandle(ref, create, deps) {
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  return updateEffectImpl(
    UpdateEffect,
    HookLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

function mountDebugValue(value, formatterFn) {
  // This hook is normally a no-op.
  // The react-debug-hooks package injects its own implementation
  // so that e.g. DevTools can display custom hook values.
}

const updateDebugValue = mountDebugValue;

function mountCallback(callback, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function updateCallback(callback, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps = prevState[1];
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function mountMemo(nextCreate, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function updateMemo(nextCreate, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (prevState !== null) {
    // Assume these are defined. If they're not, areHookInputsEqual will warn.
    if (nextDeps !== null) {
      const prevDeps = prevState[1];
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function mountDeferredValue(value) {
  const [prevValue, setValue] = mountState(value);
  mountEffect(() => {
    const prevTransition = ReactCurrentBatchConfig.transition;
    ReactCurrentBatchConfig.transition = 1;
    try {
      setValue(value);
    } finally {
      ReactCurrentBatchConfig.transition = prevTransition;
    }
  }, [value]);
  return prevValue;
}

function updateDeferredValue(value) {
  const [prevValue, setValue] = updateState(value);
  updateEffect(() => {
    const prevTransition = ReactCurrentBatchConfig.transition;
    ReactCurrentBatchConfig.transition = 1;
    try {
      setValue(value);
    } finally {
      ReactCurrentBatchConfig.transition = prevTransition;
    }
  }, [value]);
  return prevValue;
}

function rerenderDeferredValue(value) {
  const [prevValue, setValue] = rerenderState(value);
  updateEffect(() => {
    const prevTransition = ReactCurrentBatchConfig.transition;
    ReactCurrentBatchConfig.transition = 1;
    try {
      setValue(value);
    } finally {
      ReactCurrentBatchConfig.transition = prevTransition;
    }
  }, [value]);
  return prevValue;
}

function startTransition(setPending, callback) {
  const priorityLevel = getCurrentPriorityLevel();
  if (decoupleUpdatePriorityFromScheduler) {
    const previousLanePriority = getCurrentUpdateLanePriority();
    setCurrentUpdateLanePriority(
      higherLanePriority(previousLanePriority, InputContinuousLanePriority),
    );

    runWithPriority(
      priorityLevel < UserBlockingPriority
        ? UserBlockingPriority
        : priorityLevel,
      () => {
        setPending(true);
      },
    );

    // TODO: Can remove this. Was only necessary because we used to give
    // different behavior to transitions without a config object. Now they are
    // all treated the same.
    setCurrentUpdateLanePriority(DefaultLanePriority);

    runWithPriority(
      priorityLevel > NormalPriority ? NormalPriority : priorityLevel,
      () => {
        const prevTransition = ReactCurrentBatchConfig.transition;
        ReactCurrentBatchConfig.transition = 1;
        try {
          setPending(false);
          callback();
        } finally {
          if (decoupleUpdatePriorityFromScheduler) {
            setCurrentUpdateLanePriority(previousLanePriority);
          }
          ReactCurrentBatchConfig.transition = prevTransition;
        }
      },
    );
  } else {
    runWithPriority(
      priorityLevel < UserBlockingPriority
        ? UserBlockingPriority
        : priorityLevel,
      () => {
        setPending(true);
      },
    );

    runWithPriority(
      priorityLevel > NormalPriority ? NormalPriority : priorityLevel,
      () => {
        const prevTransition = ReactCurrentBatchConfig.transition;
        ReactCurrentBatchConfig.transition = 1;
        try {
          setPending(false);
          callback();
        } finally {
          ReactCurrentBatchConfig.transition = prevTransition;
        }
      },
    );
  }
}

function mountTransition() {
  const [isPending, setPending] = mountState(false);
  // The `start` method can be stored on a ref, since `setPending`
  // never changes.
  const start = startTransition.bind(null, setPending);
  mountRef(start);
  return [start, isPending];
}

function updateTransition() {
  const [isPending] = updateState(false);
  const startRef = updateRef();
  const start = startRef.current;
  return [start, isPending];
}

function rerenderTransition() {
  const [isPending] = rerenderState(false);
  const startRef = updateRef();
  const start = startRef.current;
  return [start, isPending];
}

let isUpdatingOpaqueValueInRenderPhase = false;
export function getIsUpdatingOpaqueValueInRenderPhaseInDEV() {
  if (__DEV__) {
    return isUpdatingOpaqueValueInRenderPhase;
  }
}

function warnOnOpaqueIdentifierAccessInDEV(fiber) {
  if (__DEV__) {
    // TODO: Should warn in effects and callbacks, too
    const name = getComponentName(fiber.type) || 'Unknown';
    if (getIsRendering() && !didWarnAboutUseOpaqueIdentifier[name]) {
      console.error(
        'The object passed back from useOpaqueIdentifier is meant to be ' +
          'passed through to attributes only. Do not read the ' +
          'value directly.',
      );
      didWarnAboutUseOpaqueIdentifier[name] = true;
    }
  }
}

function mountOpaqueIdentifier() {
  const makeId = __DEV__
    ? makeClientIdInDEV.bind(
        null,
        warnOnOpaqueIdentifierAccessInDEV.bind(null, currentlyRenderingFiber),
      )
    : makeClientId;

  if (getIsHydrating()) {
    let didUpgrade = false;
    const fiber = currentlyRenderingFiber;
    const readValue = () => {
      if (!didUpgrade) {
        // Only upgrade once. This works even inside the render phase because
        // the update is added to a shared queue, which outlasts the
        // in-progress render.
        didUpgrade = true;
        if (__DEV__) {
          isUpdatingOpaqueValueInRenderPhase = true;
          setId(makeId());
          isUpdatingOpaqueValueInRenderPhase = false;
          warnOnOpaqueIdentifierAccessInDEV(fiber);
        } else {
          setId(makeId());
        }
      }
      invariant(
        false,
        'The object passed back from useOpaqueIdentifier is meant to be ' +
          'passed through to attributes only. Do not read the value directly.',
      );
    };
    const id = makeOpaqueHydratingObject(readValue);

    const setId = mountState(id)[1];

    if ((currentlyRenderingFiber.mode & BlockingMode) === NoMode) {
      currentlyRenderingFiber.flags |= UpdateEffect | PassiveEffect;
      pushEffect(
        HookHasEffect | HookPassive,
        () => {
          setId(makeId());
        },
        undefined,
        null,
      );
    }
    return id;
  } else {
    const id = makeId();
    mountState(id);
    return id;
  }
}

function updateOpaqueIdentifier() {
  const id = updateState(undefined)[0];
  return id;
}

function rerenderOpaqueIdentifier() {
  const id = rerenderState(undefined)[0];
  return id;
}

function dispatchAction(fiber, queue, action) {
  const eventTime = requestEventTime();

  const lane = requestUpdateLane(fiber);

  const update = {
    lane,
    action,
    eagerReducer: null,
    eagerState: null,
    next: null,
  };

  // Append the update to the end of the list.
  const pending = queue.pending;
  if (pending === null) {
    // This is the first update. Create a circular list.
    update.next = update;
  } else {
    update.next = pending.next;
    pending.next = update;
  }

  queue.pending = update;

  // debugger
  const alternate = fiber.alternate;
  if (
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber)
  ) {
    // This is a render phase update. Stash it in a lazily-created map of
    // queue -> linked list of updates. After this render pass, we'll restart
    // and apply the stashed updates on top of the work-in-progress hook.
    didScheduleRenderPhaseUpdateDuringThisPass =
      didScheduleRenderPhaseUpdate = true;
  } else {
    // console.log(
    //   fiber.lanes,
    //   alternate?.lanes,
    //   fiber.lanes === NoLanes &&
    //     (alternate === null || alternate.lanes === NoLanes),
    // );
    // if (alternate?.lanes === 1) {
    //   window.hchlq = true
    // }
    if (
      fiber.lanes === NoLanes &&
      (alternate === null || alternate.lanes === NoLanes)
    ) {
      // The queue is currently empty, which means we can eagerly compute the
      // next state before entering the render phase. If the new state is the
      // same as the current state, we may be able to bail out entirely.
      const lastRenderedReducer = queue.lastRenderedReducer;
      if (lastRenderedReducer !== null) {
        try {
          const currentState = queue.lastRenderedState;
          const eagerState = lastRenderedReducer(currentState, action);
          // Stash the eagerly computed state, and the reducer used to compute
          // it, on the update object. If the reducer hasn't changed by the
          // time we enter the render phase, then the eager state can be used
          // without calling the reducer again.
          update.eagerReducer = lastRenderedReducer;
          update.eagerState = eagerState;
          if (is(eagerState, currentState)) {
            // Fast path. We can bail out without scheduling React to re-render.
            // It's still possible that we'll need to rebase this update later,
            // if the component re-renders for a different reason and by that
            // time the reducer has changed.
            return;
          }
        } catch (error) {}
      }
    }
    // if (fiber.lanes === 1) debugger
    // debugger
    // console.log(fiber.lanes)
    scheduleUpdateOnFiber(fiber, lane, eventTime);
  }
}

export const ContextOnlyDispatcher = {
  readContext,

  useCallback: throwInvalidHookError,
  useContext: throwInvalidHookError,
  useEffect: throwInvalidHookError,
  useImperativeHandle: throwInvalidHookError,
  useLayoutEffect: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useState: throwInvalidHookError,
  useDebugValue: throwInvalidHookError,
  useDeferredValue: throwInvalidHookError,
  useTransition: throwInvalidHookError,
  useMutableSource: throwInvalidHookError,
  useOpaqueIdentifier: throwInvalidHookError,

  unstable_isNewReconciler: enableNewReconciler,
};

const HooksDispatcherOnMount = {
  readContext,

  useCallback: mountCallback,
  useContext: readContext,
  useEffect: mountEffect,
  useImperativeHandle: mountImperativeHandle,
  useLayoutEffect: mountLayoutEffect,
  useMemo: mountMemo,
  useReducer: mountReducer,
  useRef: mountRef,
  useState: mountState,
  useDebugValue: mountDebugValue,
  useDeferredValue: mountDeferredValue,
  useTransition: mountTransition,
  useMutableSource: mountMutableSource,
  useOpaqueIdentifier: mountOpaqueIdentifier,

  unstable_isNewReconciler: enableNewReconciler,
};

const HooksDispatcherOnUpdate = {
  readContext,

  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: updateReducer,
  useRef: updateRef,
  useState: updateState,
  useDebugValue: updateDebugValue,
  useDeferredValue: updateDeferredValue,
  useTransition: updateTransition,
  useMutableSource: updateMutableSource,
  useOpaqueIdentifier: updateOpaqueIdentifier,

  unstable_isNewReconciler: enableNewReconciler,
};

const HooksDispatcherOnRerender = {
  readContext,

  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: rerenderReducer,
  useRef: updateRef,
  useState: rerenderState,
  useDebugValue: updateDebugValue,
  useDeferredValue: rerenderDeferredValue,
  useTransition: rerenderTransition,
  useMutableSource: updateMutableSource,
  useOpaqueIdentifier: rerenderOpaqueIdentifier,

  unstable_isNewReconciler: enableNewReconciler,
};

let HooksDispatcherOnMountInDEV = null;
let HooksDispatcherOnMountWithHookTypesInDEV = null;
let HooksDispatcherOnUpdateInDEV = null;
let HooksDispatcherOnRerenderInDEV = null;
let InvalidNestedHooksDispatcherOnMountInDEV = null;
let InvalidNestedHooksDispatcherOnUpdateInDEV = null;
let InvalidNestedHooksDispatcherOnRerenderInDEV = null;

if (__DEV__) {
  const warnInvalidContextAccess = () => {
    console.error(
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, but not ' +
        'inside Hooks like useReducer() or useMemo().',
    );
  };

  const warnInvalidHookAccess = () => {
    console.error(
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see ' +
        'https://reactjs.org/link/rules-of-hooks',
    );
  };

  HooksDispatcherOnMountInDEV = {
    readContext(context, observedBits) {
      return readContext(context, observedBits);
    },
    useCallback(callback, deps) {
      currentHookNameInDev = 'useCallback';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountCallback(callback, deps);
    },
    useContext(context, observedBits) {
      currentHookNameInDev = 'useContext';
      mountHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(create, deps) {
      currentHookNameInDev = 'useEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountEffect(create, deps);
    },
    useImperativeHandle(ref, create, deps) {
      currentHookNameInDev = 'useImperativeHandle';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(create, deps) {
      currentHookNameInDev = 'useLayoutEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountLayoutEffect(create, deps);
    },
    useMemo(create, deps) {
      currentHookNameInDev = 'useMemo';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer(reducer, initialArg, init) {
      currentHookNameInDev = 'useReducer';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef(initialValue) {
      currentHookNameInDev = 'useRef';
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    useState(initialState) {
      currentHookNameInDev = 'useState';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue(value, formatterFn) {
      currentHookNameInDev = 'useDebugValue';
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue(value) {
      currentHookNameInDev = 'useDeferredValue';
      mountHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition() {
      currentHookNameInDev = 'useTransition';
      mountHookTypesDev();
      return mountTransition();
    },
    useMutableSource(source, getSnapshot, subscribe) {
      currentHookNameInDev = 'useMutableSource';
      mountHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier() {
      currentHookNameInDev = 'useOpaqueIdentifier';
      mountHookTypesDev();
      return mountOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  HooksDispatcherOnMountWithHookTypesInDEV = {
    readContext(context, observedBits) {
      return readContext(context, observedBits);
    },
    useCallback(callback, deps) {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext(context, observedBits) {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(create, deps) {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle(ref, create, deps) {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(create, deps) {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo(create, deps) {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer(reducer, initialArg, init) {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef(initialValue) {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return mountRef(initialValue);
    },
    useState(initialState) {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue(value, formatterFn) {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue(value) {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition() {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return mountTransition();
    },
    useMutableSource(source, getSnapshot, subscribe) {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier() {
      currentHookNameInDev = 'useOpaqueIdentifier';
      updateHookTypesDev();
      return mountOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  HooksDispatcherOnUpdateInDEV = {
    readContext(context, observedBits) {
      return readContext(context, observedBits);
    },
    useCallback(callback, deps) {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext(context, observedBits) {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(create, deps) {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle(ref, create, deps) {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(create, deps) {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo(create, deps) {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer(reducer, initialArg, init) {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef(initialValue) {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState(initialState) {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue(value, formatterFn) {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue(value) {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return updateDeferredValue(value);
    },
    useTransition() {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return updateTransition();
    },
    useMutableSource(source, getSnapshot, subscribe) {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier() {
      currentHookNameInDev = 'useOpaqueIdentifier';
      updateHookTypesDev();
      return updateOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  HooksDispatcherOnRerenderInDEV = {
    readContext(context, observedBits) {
      return readContext(context, observedBits);
    },

    useCallback(callback, deps) {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext(context, observedBits) {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(create, deps) {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle(ref, create, deps) {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(create, deps) {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo(create, deps) {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer(reducer, initialArg, init) {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef(initialValue) {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState(initialState) {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue(value, formatterFn) {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue(value) {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return rerenderDeferredValue(value);
    },
    useTransition() {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return rerenderTransition();
    },
    useMutableSource(source, getSnapshot, subscribe) {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier() {
      currentHookNameInDev = 'useOpaqueIdentifier';
      updateHookTypesDev();
      return rerenderOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  InvalidNestedHooksDispatcherOnMountInDEV = {
    readContext(context, observedBits) {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },
    useCallback(callback, deps) {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext(context, observedBits) {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(create, deps) {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle(ref, create, deps) {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(create, deps) {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo(create, deps) {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer(reducer, initialArg, init) {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef(initialValue) {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    useState(initialState) {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue(value, formatterFn) {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue(value) {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition() {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountTransition();
    },
    useMutableSource(source, getSnapshot, subscribe) {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier() {
      currentHookNameInDev = 'useOpaqueIdentifier';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  InvalidNestedHooksDispatcherOnUpdateInDEV = {
    readContext(context, observedBits) {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },
    useCallback(callback, deps) {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext(context, observedBits) {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(create, deps) {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle(ref, create, deps) {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(create, deps) {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo(create, deps) {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer(reducer, initialArg, init) {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef(initialValue) {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState(initialState) {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue(value, formatterFn) {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue(value) {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDeferredValue(value);
    },
    useTransition() {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateTransition();
    },
    useMutableSource(source, getSnapshot, subscribe) {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier() {
      currentHookNameInDev = 'useOpaqueIdentifier';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };

  InvalidNestedHooksDispatcherOnRerenderInDEV = {
    readContext(context, observedBits) {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },

    useCallback(callback, deps) {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext(context, observedBits) {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(create, deps) {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle(ref, create, deps) {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(create, deps) {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo(create, deps) {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer(reducer, initialArg, init) {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef(initialValue) {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState(initialState) {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current =
        InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue(value, formatterFn) {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue(value) {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderDeferredValue(value);
    },
    useTransition() {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderTransition();
    },
    useMutableSource(source, getSnapshot, subscribe) {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useOpaqueIdentifier() {
      currentHookNameInDev = 'useOpaqueIdentifier';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderOpaqueIdentifier();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
}
