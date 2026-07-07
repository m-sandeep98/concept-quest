import Component from "./Component";
import { validate } from "./engine";

// Wiring file (templated by the archetype generator). The registry auto-discovers
// this GameModule via glob; it meets the shell only at the GameModule contract.
export const archetypeModule = {
  shape: "state-traversal",
  label: "State Traversal (2D)",
  component: Component,
  validate,
};
