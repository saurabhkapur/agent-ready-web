import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { useAgentStore, viewContextOf } from "./agent/store";
import { PATHS, reachablePathIds } from "./agent/paths";
import { executeTool } from "./agent/tools";
import { buildInstructions, buildTools } from "./agent/session";
import "./styles.css";

// Dev handle for poking the agent store from the console, e.g.
//   agent.store.getState().navigate("category.desserts", "voice")
//   agent.reachable("home")
if (import.meta.env.DEV) {
  // executeTool/buildInstructions/buildTools/viewContextOf are also used by the benchmark harness (bench/).
  Object.assign(window, {
    agent: {
      store: useAgentStore,
      paths: PATHS,
      reachable: reachablePathIds,
      executeTool,
      buildInstructions,
      buildTools,
      viewContextOf,
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
