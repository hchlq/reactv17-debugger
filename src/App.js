import * as React from "react";
const { createContext, useContext, useState } = React;

const ColorContext = createContext("black");

const Child = () => {
  console.log("Child render");
  const color = useContext(ColorContext);
  return (
    <div>
      <h1>Child color: {color}</h1>
      <SubChild />
    </div>
  );
};

const Sibling = () => {
  console.log("Sibling render");
  const color = useContext(ColorContext);
  return <h1>Sibling color: {color}</h1>;
};

const SubChild = () => {
  const color = useContext(ColorContext);
  return (
    <h1>
      SubChild color: {color}
      <ColorContext.Consumer>
        {(value) => <h2>consumer value: {value}</h2>}
      </ColorContext.Consumer>
      <ColorContext.Consumer>
        {(value) => <h2>consumer value: {value}</h2>}
      </ColorContext.Consumer>
    </h1>
  );
};

const Parent = () => {
  const color = useContext(ColorContext);
  return (
    <div>
      <h1>Parent color: {color}</h1>
      <Child />
      <Sibling />
    </div>
  );
};

const App = () => {
  const [color, setState] = useState("black");
  return (
    <div>
      <button onClick={() => setState("" + Math.random())}>update Color</button>
      <ColorContext.Provider value={color}>
        <Parent />
      </ColorContext.Provider>
    </div>
  );
};

export default App;
