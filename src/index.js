// import './test/createRoot'

import * as React from "react";
import * as ReactDom from "react-dom";
let count = 1;

const App2 = () => {
  const [state, setState] = React.useState(0);

  const handleClick = () => {
    if (count === 1) {
      // 第一次点击，满足条件 fiber.lanes === 0, alternate === null，
      setState(state + 1);
    } else if (count === 2) {
      // 第二次点击，不满足条件，fiber.lanes === 1
      setState(state + 1);
    } else if (count === 3) {
      // 第三次点击，不满足条件， fiber.alternate.lanes === 1
      setState(state);
    } else if (count === 4) {
      // 第四次点击，满足条件 fiber.lanes === 0, fiber.alternate.lanes === 0
      setState(state + 1);
    } else {
      setState(state + 1);
    }

    count++;
  };

  return <h1 onClick={handleClick}>{state}</h1>;
};
// 第一次点击：first.lanes === 1
// 第二次点击：first.alternate.lanes === 1
// 第三次点击：first.lanes === 1
// 第四次点击：first.alternate.lanes === 1
// 第五次点击：first.lanes === 0 && first.alternate.lanes === 0

// const Parent = () => {
//   const [state, setState] = React.useState(0);

//   useEvent(() => {
//     console.log(state)
//   })
//   return (
//     <div>
//       <h1>{state}</h1>
//       <button onClick={() => setState(state + 1)}>add</button>
//       <Child />
//     </div>
//   );
// };

// const Child = () => {
//   return <div>1</div>;
// };

// function useEvent(handler) {
//   const handlerRef = React.useRef(null);

//   // 更新的时机和执行的时机
//   React.useLayoutEffect(() => {
//     handlerRef.current = handler;
//   });

//   return React.useCallback((...args) => {
//     const fn = handlerRef.current;
//     return fn(...args);
//   }, []);
// }

function Parent() {
  React.useEffect(() => {
    console.log("Parent running");
  }, []);

  return <Child />;
};

function Child() {
  React.useEffect(() => {
    console.log("Child mount");
  }, []);

  return null;
};

ReactDom.render(<Parent />, document.getElementById("root"));
