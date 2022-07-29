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

const App = () => {
    return (
        <div>
            <h1></h1>
            <span></span>
            text
        </div>
    )
}


ReactDom.render(<App/>, document.getElementById('root'))
