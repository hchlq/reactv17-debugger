import * as React from "react";

const AppContext = React.createContext(0);

function App({ children }) {
  console.log('app render')
  const [count, setCount] = React.useState(0);

  const handleClick = () => {
    setCount(count + 1);
  };

  return (
    <div>
      <button onClick={handleClick}>count + 1</button>
      <AppContext.Provider value={count}>{children}</AppContext.Provider>
    </div>
  );
}

const Parent = () => {
  console.log("parent render");
  return (
    <div>
      Parent
    </div>
  );
};

export default function Test() {
  // debugger
  const [_, setState] = React.useState(0);
  return (
    <>
      <button onClick={() => setState(_ + 1)}>set State</button>
      <App>
        <Parent />
      </App>
    </>
  );
}
