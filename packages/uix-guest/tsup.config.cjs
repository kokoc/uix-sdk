const { defineConfig } = require("tsup");
const { config } = require("../../scripts/common-tsupconfig");
export default defineConfig({
  ...config,
  format: ["esm", "cjs", "iife"], // the guest library should be highly portable
  globalName: "AdobeUIXGuest",
  treeshake: false, // treeshake and globalName are not compatible in esbuild
});