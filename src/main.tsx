import ReactDOM from "react-dom/client";
import App from "./App";

// Self-hosted webfaces (bundled, no runtime network) — the HUD type system:
// Chakra Petch = tactical chrome, Space Grotesk = titles/body, JetBrains Mono = data/terminal.
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";

import "./index.css";

// StrictMode intentionally omitted: the archetype animation uses timers, and
// double-invoked effects in dev make the descent stutter. Re-enable per-archetype.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
