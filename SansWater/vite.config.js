import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "es2020",
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: { host: "127.0.0.1" },
});
