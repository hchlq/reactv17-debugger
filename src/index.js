// import './test/createRoot'

import * as React from "react";
import * as ReactDom from "react-dom";

// const GlobalContext = React.createContext(0);
// function App() {
//   const [state, setState] = React.useState(0);

//   const update = React.useCallback(() => {
//     setState(Math.random());
//   }, []);
//   return (
//     <GlobalContext.Provider value={state}>
//       App
//       <Child update={update} />
//       <Sibling />
//     </GlobalContext.Provider>
//   );
// }

// const Sibling = () => {
//   console.log("Sibling render");
//   return <h1>Sibling</h1>;
// };

// const Child = React.memo(({ update }) => {
//   const [state, setState] = React.useState(0);
//   console.log("Child render");
//   const handleClick = () => {
//     setState(state);
//     update();
//   };

//   return (
//     <div>
//       <h1 onClick={handleClick}>{state} child</h1>
//       <SubChild />
//       <SubChild2 />
//     </div>
//   );
// });

// function SubChild() {
//   console.log("SubChild render");
//   React.useContext(GlobalContext);
//   return (
//     <div>
//       SubChild <X />
//     </div>
//   );
// }

// function SubChild2() {
//   console.log("SubChild2 render");
//   return (
//     <div>
//       SubChild2
//     </div>
//   );
// }

// const X = () => {
//   console.log("x render");
//   return null;
// };

// function App() {
//   const [state, setState] = React.useState(0);

//   const callback = React.useCallback(() => {
//     // ...
//   }, []);

//   const memo = React.useMemo(() => {
//     return {};
//   }, []);

//   return (
//     <div>
//       <button onClick={() => setState(state + 1)}>更新</button>
//       <Child memo={memo} callback={callback} name="App" />
//     </div>
//   );
// }

// const Child = React.memo(() => {
//   console.log('Child render')
//   return <div>Child</div>;
// });

class App extends React.Component {
  state = {
    count: 0,
  };

  handleClick = () => {
    this.setState({
      count: this.state.count + 1,
    });
  };

  render() {
    return (
      <div>
        <h1 onClick={this.handleClick}>Parent: {this.state.count}</h1>
        <Child foo="foo" num={0} />
      </div>
    );
  }
}

class Child extends React.PureComponent {
  render() {
    console.log("render");
    return <h1>Child</h1>;
  }
}

ReactDom.render(<App foo="foo" />, document.getElementById("root"));
