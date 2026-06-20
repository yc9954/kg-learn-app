/**
 * Minimal type shim for `cytoscape-fcose` (ships no types). It is registered
 * once via `cytoscape.use(fcose)`; we only reference it as a layout extension.
 */
declare module "cytoscape-fcose" {
  import type cytoscape from "cytoscape";
  const fcose: cytoscape.Ext;
  export default fcose;
}
