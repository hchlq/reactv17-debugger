// import './test/createRoot'

import * as React from "react";
import * as ReactDom from "react-dom";

// const App = () => {
//   const [state, setState] = React.useState(0);

//   React.useLayoutEffect(() => {
//     console.log(state);
//     if (state & 2 == 0) return () => {}
//     // return () => {}
//   }, [state]);

//   return <h1 onClick={() => setState(state + 1)}>{state}</h1>;
// };

const GlobalContext = React.createContext();
function Child() {
  const state = React.useContext(GlobalContext);
  React.useLayoutEffect(() => {
    return () => {
      console.log("Child effect1 unmount");
    };
  }, [state]);

  React.useLayoutEffect(() => {
    return () => {
      console.log("Child effect2 unmount");
    };
  }, [state]);

  return <div>Child</div>;
}

function Sibling() {
  const state = React.useContext(GlobalContext);
  React.useLayoutEffect(() => {
    return () => {
      console.log("Sibling unmount");
    };
  }, [state]);

  return <div>sibling</div>;
}

function Parent() {
  const state = React.useContext(GlobalContext);
  React.useLayoutEffect(() => {
    return () => {
      console.log("Parent unmount");
    };
  }, [state]);

  return (
    <>
      <h3>parent</h3>
      <Child />
      <Sibling />
    </>
  );
}

const App = () => {
  const [state, setState] = React.useState(0);

  return (
    <GlobalContext.Provider value={state}>
      {state <= 1 && <Parent />}
      <button
        onClick={() => {
          setState(state + 1);
        }}
      >
        {state === 0 ? "update dependency" : "unmount Parent"}
      </button>
    </GlobalContext.Provider>
  );
};

ReactDom.render(<App />, document.getElementById("root"));
