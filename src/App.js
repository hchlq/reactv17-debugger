import * as React from "react";

const { Suspense, lazy, memo, useState } = React

const OtherComponent = lazy(() => import("./test/lazy"));

const MemoComponent = memo(function X(){
  return <div>11111</div>
})

function App() {
  const [count, setCount] = useState(0)
  return (
    <div className="App">
      <header>header</header>
      <main>main</main>
      <footer>footer</footer>
      {/* <Suspense fallback={<div>Loading...</div>}>
        <OtherComponent />
      </Suspense> */}
      <h1 onClick={() => setCount(count + 1)}>{ count }</h1>
      <MemoComponent />
    </div>
  );
}

export default App;
