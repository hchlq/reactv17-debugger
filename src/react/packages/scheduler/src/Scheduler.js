/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable no-var */

import {
  enableSchedulerDebugging,
  enableProfiling,
} from './SchedulerFeatureFlags';
import {
  requestHostCallback,
  requestHostTimeout,
  cancelHostTimeout,
  shouldYieldToHost,
  getCurrentTime,
  forceFrameRate,
  requestPaint,
} from './SchedulerHostConfig';
import {push, pop, peek} from './SchedulerMinHeap';

// TODO: Use symbols?
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from './SchedulerPriorities';
import {
  markTaskRun,
  markTaskYield,
  markTaskCompleted,
  markTaskCanceled,
  markTaskErrored,
  markSchedulerSuspended,
  markSchedulerUnsuspended,
  markTaskStart,
  stopLoggingProfilingEvents,
  startLoggingProfilingEvents,
} from './SchedulerProfiling';

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Times out immediately
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out
var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

// Tasks are stored on a min heap
var taskQueue = [];
var timerQueue = [];

// Incrementing id counter. Used to maintain insertion order.
// taskQueue 的数量
var taskIdCounter = 1;

// Pausing the scheduler is useful for debugging.
var isSchedulerPaused = false;

var currentTask = null;
// 默认是 NormalPriority
var currentPriorityLevel = NormalPriority;

// This is set while performing work, to prevent re-entrancy.
var isPerformingWork = false;

var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

/**
 * 提前确定已经到达执行时间的 timerQueue 中的 task，移动到 taskQueue 中
 * 1. 去掉已经取消的 timerQueue task
 * 2. 已经到达时间的 timerQueue task 添加到 taskQueue 中
 */
function advanceTimers(currentTime) {
  // Check for tasks that are no longer delayed and add them to the queue.
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // Timer was cancelled.
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      // Timer fired. Transfer to the task queue.
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);

      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // Remaining timers are pending.
      return;
    }
    timer = peek(timerQueue);
  }
}

function handleTimeout(currentTime) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      // 注册回调函数，用 flushWork 执行
      requestHostCallback(flushWork);
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

/**
 * 真正的处理回调
 */
function flushWork(hasTimeRemaining, initialTime) {
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // We'll need a host callback the next time work is scheduled.
  // 标记已经不在 `hostCallbackScheduled` 中了
  isHostCallbackScheduled = false;

  // 取消 hostTimeout 的调度
  if (isHostTimeoutScheduled) {
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  // 标记正在执行传入 scheduler 的回调
  isPerformingWork = true;

  // 保存当前的 `调度优先级`
  const previousPriorityLevel = currentPriorityLevel;
  try {
    // 性能相关，可以不关注
    if (enableProfiling) {
      try {
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          markTaskErrored(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // No catch in prod code path.
      return workLoop(hasTimeRemaining, initialTime);
    }
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}

/**
 * 循环的执行完成 taskQueue 的任务
 */
function workLoop(hasTimeRemaining, initialTime) {
  let currentTime = initialTime;

  advanceTimers(currentTime);

  // 获取 taskQueue 最快执行的任务
  currentTask = peek(taskQueue);

  while (
    currentTask !== null &&
    // enableSchedulerDebugging 或者 isSchedulerPaused 有一个为 false 即可
    // enableSchedulerDebugging: false
    !(enableSchedulerDebugging && isSchedulerPaused)
  ) {
    if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // 同时满足以下两个条件
      // 1. 没到该任务的过期时间
      // 2. 没有剩余的时间了 或者 执行完了这一时间片了（执行权交给浏览器）
      // This currentTask hasn't expired, and we've reached the deadline.
      break;
    }
    // 可能的条件：
    // 1. 到达了过期时间 或者
    // 2. 没到过期时间，还有剩余的时间 并且 没有执行完该时间片
    
    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      // 将 task.callback 置为空
      currentTask.callback = null;
      // 调度优先级
      currentPriorityLevel = currentTask.priorityLevel;

      // 判断该任务是否已经过期了
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;

      if (enableProfiling) {
        markTaskRun(currentTask, currentTime);
      }

      // 执行 callback，
      // callback 一般是 performanceSyncWorkOnRoot 或者 performanceConcurrentWorkOnRoot
      const continuationCallback = callback(didUserCallbackTimeout);

      currentTime = getCurrentTime();
      if (typeof continuationCallback === 'function') {
        // 返回了一个函数，说明是被中断的任务，在这里恢复
        currentTask.callback = continuationCallback;
        if (enableProfiling) {
          markTaskYield(currentTask, currentTime);
        }
      } else {
        if (enableProfiling) {
          markTaskCompleted(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        if (currentTask === peek(taskQueue)) {
          // 弹出当前任务
          pop(taskQueue);
        }
      }

      // 确定 timerQueue 已经到期的任务
      advanceTimers(currentTime);
    } else {
      // callback 不是一个函数
      pop(taskQueue);
    }

    // 取出最顶层的任务
    currentTask = peek(taskQueue);
  }

  // Return whether there's additional work
  if (currentTask !== null) {
    // 说明还有任务没有完成，继续调度
    return true;
  } else {
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

function unstable_runWithPriority(priorityLevel, eventHandler) {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_next(eventHandler) {
  var priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority;
      break;
    default:
      // Anything lower than normal priority should remain at the current level.
      // 比 NormalPriority 低的优先级，使用当前的优先级
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_wrapCallback(callback) {
  // 利用闭包保存调用时当前的调度优先级
  var parentPriorityLevel = currentPriorityLevel;
  return function () {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;

    // 使用闭包中的调度优先级
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

function unstable_scheduleCallback(priorityLevel, callback, options) {
  // 获取当前时间戳
  var currentTime = getCurrentTime();

  // 确定 startTime
  var startTime;
  if (typeof options === 'object' && options !== null) {
    // 存在 delay，currentTime 加上 delay
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime;
  }

  // 根据优先级，确定多少时间后任务过期
  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      // -1 说明需要立即执行
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      // 250 
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      // Math.pow(2, 30) - 1
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      // 10000 
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      // 5000
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  // 过期的时间戳  
  var expirationTime = startTime + timeout;

  // 创建一个任务
  var newTask = {
    id: taskIdCounter++,
    //! 保存这个时间过期后要执行的 `callback` 
    callback,
    // `Scheduler` 优先级
    priorityLevel,
    // 开始的时间
    startTime,
    // 过期的时间
    expirationTime,
    // 用于小顶堆的排序
    sortIndex: -1,
  };

  if (enableProfiling) {
    newTask.isQueued = false;
  }

  if (startTime > currentTime) {
    // 说明 `option.delay` 存在，需要延迟执行
    // This is a delayed task.
    // 使用 startTime 当作小顶堆排序的依据
    newTask.sortIndex = startTime;

    // 放入 timerQueue 小顶堆中
    push(timerQueue, newTask);
    
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // taskQueue 小顶堆没有任务了，取出 `timerQueue` 中最快到达时间的任务执行

      // All tasks are delayed, and this is the task with the earliest delay.
      if (isHostTimeoutScheduled) {
        // Cancel an existing timeout.
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      // Schedule a timeout.
      // 等待 startTime - currentTime 之后，执行 `handleTimeout`
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    // 以过期时间当作小顶堆排序的依据
    newTask.sortIndex = expirationTime;

    // 放入 taskQueue 小顶堆中
    push(taskQueue, newTask);

    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }

    // Schedule a host callback, if needed. If we're already performing work,
    // wait until the next time we yield.
    // 1. 没有在请求调度 `callback`
    // 2. 不是正在执行 `flushWork`
    if (!isHostCallbackScheduled && !isPerformingWork) {
      // `flushWork` 会将 `isHostCallbackScheduled` 标记为 false
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }

  return newTask;
}

/**
 * 暂定执行
 */
function unstable_pauseExecution() {
  isSchedulerPaused = true;
}

function unstable_continueExecution() {
  isSchedulerPaused = false;
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}

/**
 * 获取 taskQueue 小顶堆中最早到达时间的任务
 */
function unstable_getFirstCallbackNode() {
  return peek(taskQueue);
}

function unstable_cancelCallback(task) {
  if (enableProfiling) {
    if (task.isQueued) {
      const currentTime = getCurrentTime();
      markTaskCanceled(task, currentTime);
      task.isQueued = false;
    }
  }

  // Null out the callback to indicate the task has been canceled. (Can't
  // remove from the queue because you can't remove arbitrary nodes from an
  // array based heap, only the first one.)
  task.callback = null;
}

function unstable_getCurrentPriorityLevel() {
  return currentPriorityLevel;
}

const unstable_requestPaint = requestPaint;

function unstable_flushAllWithoutAsserting() {}

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback, // 注册回调
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  unstable_requestPaint,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
  unstable_flushAllWithoutAsserting
};

export const unstable_Profiling = enableProfiling
  ? {
      startLoggingProfilingEvents,
      stopLoggingProfilingEvents,
    }
  : null;
