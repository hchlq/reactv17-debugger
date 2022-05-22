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

const root = ReactDOM.createRoot(document.querySelector("#root"));
root.render(<App />);

// const render = () => {
//   a++;
//   root.render(<App />);
// };

// render();

// ReactDOM.render(<App />, document.querySelector('#root'))
