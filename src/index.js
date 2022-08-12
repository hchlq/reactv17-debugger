// import './test/createRoot'

import * as React from "react";
import * as ReactDom from "react-dom";
// import App from "./App";

// const Test = () => {
//     return <h1 className="foo" onClick={ () => console.log('bar') }>header</h1>
// }

// console.log(<h1
//     className="foo"
//     onClick={ () => console.log('bar') }>
//         header
//     </h1>)

// ReactDom.render(<App />, document.getElementById("root"));
let a = 0
const App = () => {
  const [count, setCount] = React.useState(0);
  if (a === 1) {
      setCount(count + 1);
  }
  a++
  console.log(a)
  const memo = React.useMemo(() => {}, []);
  return <h1 onClick={() => setCount(count + 1)}>{count}</h1>;
};

ReactDom.render(<App />, document.getElementById("root"));
