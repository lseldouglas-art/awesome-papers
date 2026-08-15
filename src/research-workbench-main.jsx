import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ResearchAgentWorkbench } from "./components/ResearchAgentWorkbench";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ResearchAgentWorkbench />
  </StrictMode>,
);
