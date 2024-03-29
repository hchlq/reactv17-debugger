/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import * as Scheduler from 'scheduler/unstable_mock';
import {
  getPublicRootInstance,
  createContainer,
  updateContainer,
  flushSync,
  injectIntoDevTools,
  batchedUpdates,
  act,
  IsThisRendererActing,
} from 'react-reconciler/src/ReactFiberReconciler';
import {findCurrentFiberUsingSlowPath} from 'react-reconciler/src/ReactFiberTreeReflection';
import {
  Fragment,
  FunctionComponent,
  ClassComponent,
  HostComponent,
  HostPortal,
  HostText,
  HostRoot,
  ContextConsumer,
  ContextProvider,
  Mode,
  ForwardRef,
  Profiler,
  MemoComponent,
  SimpleMemoComponent,
  Block,
  IncompleteClassComponent,
  ScopeComponent,
} from 'react-reconciler/src/ReactWorkTags';
import invariant from 'shared/invariant';
import getComponentName from 'shared/getComponentName';
import ReactVersion from 'shared/ReactVersion';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import enqueueTask from 'shared/enqueueTask';

import {getPublicInstance} from './ReactTestHostConfig';
import {ConcurrentRoot, LegacyRoot} from 'react-reconciler/src/ReactRootTags';

const {IsSomeRendererActing} = ReactSharedInternals;

const defaultTestOptions = {
  createNodeMock: function () {
    return null;
  },
};

function toJSON(inst) {
  if (inst.isHidden) {
    // Omit timed out children from output entirely. This seems like the least
    // surprising behavior. We could perhaps add a separate API that includes
    // them, if it turns out people need it.
    return null;
  }
  switch (inst.tag) {
    case 'TEXT':
      return inst.text;
    case 'INSTANCE': {
      /* eslint-disable no-unused-vars */
      // We don't include the `children` prop in JSON.
      // Instead, we will include the actual rendered children.
      const {children, ...props} = inst.props;
      /* eslint-enable */
      let renderedChildren = null;
      if (inst.children && inst.children.length) {
        for (let i = 0; i < inst.children.length; i++) {
          const renderedChild = toJSON(inst.children[i]);
          if (renderedChild !== null) {
            if (renderedChildren === null) {
              renderedChildren = [renderedChild];
            } else {
              renderedChildren.push(renderedChild);
            }
          }
        }
      }
      const json = {
        type: inst.type,
        props: props,
        children: renderedChildren,
      };
      Object.defineProperty(json, '$$typeof', {
        value: Symbol.for('react.test.json'),
      });
      return json;
    }
    default:
      throw new Error(`Unexpected node type in toJSON: ${inst.tag}`);
  }
}

function childrenToTree(node) {
  if (!node) {
    return null;
  }
  const children = nodeAndSiblingsArray(node);
  if (children.length === 0) {
    return null;
  } else if (children.length === 1) {
    return toTree(children[0]);
  }
  return flatten(children.map(toTree));
}

function nodeAndSiblingsArray(nodeWithSibling) {
  const array = [];
  let node = nodeWithSibling;
  while (node != null) {
    array.push(node);
    node = node.sibling;
  }
  return array;
}

function flatten(arr) {
  const result = [];
  const stack = [{i: 0, array: arr}];
  while (stack.length) {
    const n = stack.pop();
    while (n.i < n.array.length) {
      const el = n.array[n.i];
      n.i += 1;
      if (Array.isArray(el)) {
        stack.push(n);
        stack.push({i: 0, array: el});
        break;
      }
      result.push(el);
    }
  }
  return result;
}

function toTree(node) {
  if (node == null) {
    return null;
  }
  switch (node.tag) {
    case HostRoot:
      return childrenToTree(node.child);
    case HostPortal:
      return childrenToTree(node.child);
    case ClassComponent:
      return {
        nodeType: 'component',
        type: node.type,
        props: {...node.memoizedProps},
        instance: node.stateNode,
        rendered: childrenToTree(node.child),
      };
    case FunctionComponent:
    case SimpleMemoComponent:
      return {
        nodeType: 'component',
        type: node.type,
        props: {...node.memoizedProps},
        instance: null,
        rendered: childrenToTree(node.child),
      };
    case Block:
      return {
        nodeType: 'block',
        type: node.type,
        props: {...node.memoizedProps},
        instance: null,
        rendered: childrenToTree(node.child),
      };
    case HostComponent: {
      return {
        nodeType: 'host',
        type: node.type,
        props: {...node.memoizedProps},
        instance: null, // TODO: use createNodeMock here somehow?
        rendered: flatten(nodeAndSiblingsArray(node.child).map(toTree)),
      };
    }
    case HostText:
      return node.stateNode.text;
    case Fragment:
    case ContextProvider:
    case ContextConsumer:
    case Mode:
    case Profiler:
    case ForwardRef:
    case MemoComponent:
    case IncompleteClassComponent:
    case ScopeComponent:
      return childrenToTree(node.child);
    default:
      invariant(
        false,
        'toTree() does not yet know how to handle nodes with tag=%s',
        node.tag,
      );
  }
}

const validWrapperTypes = new Set([
  FunctionComponent,
  ClassComponent,
  HostComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
  Block,
  // Normally skipped, but used when there's more than one root child.
  HostRoot,
]);

function getChildren(parent) {
  const children = [];
  const startingNode = parent;
  let node = startingNode;
  if (node.child === null) {
    return children;
  }
  node.child.return = node;
  node = node.child;
  outer: while (true) {
    let descend = false;
    if (validWrapperTypes.has(node.tag)) {
      children.push(wrapFiber(node));
    } else if (node.tag === HostText) {
      children.push('' + node.memoizedProps);
    } else {
      descend = true;
    }
    if (descend && node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    while (node.sibling === null) {
      if (node.return === startingNode) {
        break outer;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
  return children;
}

class ReactTestInstance {
  _fiber;

  _currentFiber() {
    // Throws if this component has been unmounted.
    const fiber = findCurrentFiberUsingSlowPath(this._fiber);
    invariant(
      fiber !== null,
      "Can't read from currently-mounting component. This error is likely " +
        'caused by a bug in React. Please file an issue.',
    );
    return fiber;
  }

  constructor(fiber) {
    invariant(
      validWrapperTypes.has(fiber.tag),
      'Unexpected object passed to ReactTestInstance constructor (tag: %s). ' +
        'This is probably a bug in React.',
      fiber.tag,
    );
    this._fiber = fiber;
  }

  get instance() {
    if (this._fiber.tag === HostComponent) {
      return getPublicInstance(this._fiber.stateNode);
    } else {
      return this._fiber.stateNode;
    }
  }

  get type() {
    return this._fiber.type;
  }

  get props() {
    return this._currentFiber().memoizedProps;
  }

  get parent() {
    let parent = this._fiber.return;
    while (parent !== null) {
      if (validWrapperTypes.has(parent.tag)) {
        if (parent.tag === HostRoot) {
          // Special case: we only "materialize" instances for roots
          // if they have more than a single child. So we'll check that now.
          if (getChildren(parent).length < 2) {
            return null;
          }
        }
        return wrapFiber(parent);
      }
      parent = parent.return;
    }
    return null;
  }

  get children() {
    return getChildren(this._currentFiber());
  }

  // Custom search functions
  find(predicate) {
    return expectOne(
      this.findAll(predicate, {deep: false}),
      `matching custom predicate: ${predicate.toString()}`,
    );
  }

  findByType(type) {
    return expectOne(
      this.findAllByType(type, {deep: false}),
      `with node type: "${getComponentName(type) || 'Unknown'}"`,
    );
  }

  findByProps(props) {
    return expectOne(
      this.findAllByProps(props, {deep: false}),
      `with props: ${JSON.stringify(props)}`,
    );
  }

  findAll(predicate, options = null) {
    return findAll(this, predicate, options);
  }

  findAllByType(type, options = null) {
    return findAll(this, (node) => node.type === type, options);
  }

  findAllByProps(props, options = null) {
    return findAll(
      this,
      (node) => node.props && propsMatch(node.props, props),
      options,
    );
  }
}

function findAll(root, predicate, options) {
  const deep = options ? options.deep : true;
  const results = [];

  if (predicate(root)) {
    results.push(root);
    if (!deep) {
      return results;
    }
  }

  root.children.forEach((child) => {
    if (typeof child === 'string') {
      return;
    }
    results.push(...findAll(child, predicate, options));
  });

  return results;
}

function expectOne(all, message) {
  if (all.length === 1) {
    return all[0];
  }

  const prefix =
    all.length === 0
      ? 'No instances found '
      : `Expected 1 but found ${all.length} instances `;

  throw new Error(prefix + message);
}

function propsMatch(props, filter) {
  for (const key in filter) {
    if (props[key] !== filter[key]) {
      return false;
    }
  }
  return true;
}

function create(element, options) {
  let createNodeMock = defaultTestOptions.createNodeMock;
  let isConcurrent = false;
  if (typeof options === 'object' && options !== null) {
    if (typeof options.createNodeMock === 'function') {
      createNodeMock = options.createNodeMock;
    }
    if (options.unstable_isConcurrent === true) {
      isConcurrent = true;
    }
  }
  let container = {
    children: [],
    createNodeMock,
    tag: 'CONTAINER',
  };
  let root = createContainer(
    container,
    isConcurrent ? ConcurrentRoot : LegacyRoot,
    false,
    null,
  );
  invariant(root != null, 'something went wrong');
  updateContainer(element, root, null, null);

  const entry = {
    _Scheduler: Scheduler,

    root: undefined, // makes flow happy
    // we define a 'getter' for 'root' below using 'Object.defineProperty'
    toJSON() {
      if (root == null || root.current == null || container == null) {
        return null;
      }
      if (container.children.length === 0) {
        return null;
      }
      if (container.children.length === 1) {
        return toJSON(container.children[0]);
      }
      if (
        container.children.length === 2 &&
        container.children[0].isHidden === true &&
        container.children[1].isHidden === false
      ) {
        // Omit timed out children from output entirely, including the fact that we
        // temporarily wrap fallback and timed out children in an array.
        return toJSON(container.children[1]);
      }
      let renderedChildren = null;
      if (container.children && container.children.length) {
        for (let i = 0; i < container.children.length; i++) {
          const renderedChild = toJSON(container.children[i]);
          if (renderedChild !== null) {
            if (renderedChildren === null) {
              renderedChildren = [renderedChild];
            } else {
              renderedChildren.push(renderedChild);
            }
          }
        }
      }
      return renderedChildren;
    },
    toTree() {
      if (root == null || root.current == null) {
        return null;
      }
      return toTree(root.current);
    },
    update(newElement) {
      if (root == null || root.current == null) {
        return;
      }
      updateContainer(newElement, root, null, null);
    },
    unmount() {
      if (root == null || root.current == null) {
        return;
      }
      updateContainer(null, root, null, null);
      container = null;
      root = null;
    },
    getInstance() {
      if (root == null || root.current == null) {
        return null;
      }
      return getPublicRootInstance(root);
    },

    unstable_flushSync(fn) {
      return flushSync(fn);
    },
  };

  Object.defineProperty(entry, 'root', {
    configurable: true,
    enumerable: true,
    get: function () {
      if (root === null) {
        throw new Error("Can't access .root on unmounted test renderer");
      }
      const children = getChildren(root.current);
      if (children.length === 0) {
        throw new Error("Can't access .root on unmounted test renderer");
      } else if (children.length === 1) {
        // Normally, we skip the root and just give you the child.
        return children[0];
      } else {
        // However, we give you the root if there's more than one root child.
        // We could make this the behavior for all cases but it would be a breaking change.
        return wrapFiber(root.current);
      }
    },
  });

  return entry;
}

const fiberToWrapper = new WeakMap();
function wrapFiber(fiber) {
  let wrapper = fiberToWrapper.get(fiber);
  if (wrapper === undefined && fiber.alternate !== null) {
    wrapper = fiberToWrapper.get(fiber.alternate);
  }
  if (wrapper === undefined) {
    wrapper = new ReactTestInstance(fiber);
    fiberToWrapper.set(fiber, wrapper);
  }
  return wrapper;
}

// Enable ReactTestRenderer to be used to test DevTools integration.
injectIntoDevTools({
  findFiberByHostInstance: () => {
    throw new Error('TestRenderer does not support findFiberByHostInstance()');
  },
  bundleType: __DEV__ ? 1 : 0,
  version: ReactVersion,
  rendererPackageName: 'react-test-renderer',
});

let actingUpdatesScopeDepth = 0;

// This version of `act` is only used by our tests. Unlike the public version
// of `act`, it's designed to work identically in both production and
// development. It may have slightly different behavior from the public
// version, too, since our constraints in our test suite are not the same as
// those of developers using React — we're testing React itself, as opposed to
// building an app with React.
// TODO: Migrate our tests to use ReactNoop. Although we would need to figure
// out a solution for Relay, which has some Concurrent Mode tests.
function unstable_concurrentAct(scope) {
  if (Scheduler.unstable_flushAllWithoutAsserting === undefined) {
    throw Error(
      'This version of `act` requires a special mock build of Scheduler.',
    );
  }
  if (setTimeout._isMockFunction !== true) {
    throw Error(
      "This version of `act` requires Jest's timer mocks " +
        '(i.e. jest.useFakeTimers).',
    );
  }

  const previousActingUpdatesScopeDepth = actingUpdatesScopeDepth;
  const previousIsSomeRendererActing = IsSomeRendererActing.current;
  const previousIsThisRendererActing = IsThisRendererActing.current;
  IsSomeRendererActing.current = true;
  IsThisRendererActing.current = true;
  actingUpdatesScopeDepth++;

  const unwind = () => {
    actingUpdatesScopeDepth--;
    IsSomeRendererActing.current = previousIsSomeRendererActing;
    IsThisRendererActing.current = previousIsThisRendererActing;
    if (__DEV__) {
      if (actingUpdatesScopeDepth > previousActingUpdatesScopeDepth) {
        // if it's _less than_ previousActingUpdatesScopeDepth, then we can
        // assume the 'other' one has warned
        console.error(
          'You seem to have overlapping act() calls, this is not supported. ' +
            'Be sure to await previous act() calls before making a new one. ',
        );
      }
    }
  };

  // TODO: This would be way simpler if 1) we required a promise to be
  // returned and 2) we could use async/await. Since it's only our used in
  // our test suite, we should be able to.
  try {
    const thenable = batchedUpdates(scope);
    if (
      typeof thenable === 'object' &&
      thenable !== null &&
      typeof thenable.then === 'function'
    ) {
      return {
        then(resolve, reject) {
          thenable.then(
            () => {
              flushActWork(
                () => {
                  unwind();
                  resolve();
                },
                (error) => {
                  unwind();
                  reject(error);
                },
              );
            },
            (error) => {
              unwind();
              reject(error);
            },
          );
        },
      };
    } else {
      try {
        // TODO: Let's not support non-async scopes at all in our tests. Need to
        // migrate existing tests.
        let didFlushWork;
        do {
          didFlushWork = Scheduler.unstable_flushAllWithoutAsserting();
        } while (didFlushWork);
      } finally {
        unwind();
      }
    }
  } catch (error) {
    unwind();
    throw error;
  }
}

function flushActWork(resolve, reject) {
  // Flush suspended fallbacks
  // $FlowFixMe: Flow doesn't know about global Jest object
  jest.runOnlyPendingTimers();
  enqueueTask(() => {
    try {
      const didFlushWork = Scheduler.unstable_flushAllWithoutAsserting();
      if (didFlushWork) {
        flushActWork(resolve, reject);
      } else {
        resolve();
      }
    } catch (error) {
      reject(error);
    }
  });
}

export {
  Scheduler as _Scheduler,
  create,
  /* eslint-disable-next-line camelcase */
  batchedUpdates as unstable_batchedUpdates,
  act,
  unstable_concurrentAct,
};
