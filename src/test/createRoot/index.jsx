import * as React from "react";
import * as ReactDOM from "react-dom";

const App = () => {
  const [count, setCount] = React.useState(0);
  const handleClick = () => {
    setCount(count + 1);
    setCount(count + 1);
    setCount(count + 1);
  };
  return <h3 onClick={handleClick}>{count}</h3>;
};

// const list = [];
// for (let i = 0; i < 10000; i++) {
//   list.push(i);
// }

// const App = () => {
//   return (
//     <>
//       <ul>
//         {list.map((item) => (
//           <li key={item}>{item}</li>
//         ))}
//       </ul>
//     </>
//   );
// };

const root = ReactDOM.createRoot(document.querySelector("#root"));
// const root = ReactDOM.createBlockingRoot(document.querySelector("#root"));
root.render(<App />);
// ReactDOM.render(<App />, document.querySelector('#root'))

// const render = () => {
//   a++;
//   root.render(<App />);
// };

// render();

