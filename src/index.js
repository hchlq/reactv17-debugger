// import './test/createRoot'

import * as React from "react";
import * as ReactDom from "react-dom";


const App = () => {
  const [state, setState] = React.useState(0)
  
  React.useEffect(() => {
      console.log(state)
  }, [state])
  
  return <h1 onClick={() => setState(state + 1)}>{ state }</h1>
}
ReactDom.render(<App />, document.getElementById("root"));
