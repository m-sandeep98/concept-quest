import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// StrictMode intentionally omitted: the archetype animation uses timers, and
// double-invoked effects in dev make the descent stutter. Re-enable per-archetype.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
