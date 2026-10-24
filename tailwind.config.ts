import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#07110D",
        panel: "#0E1C16",
        muted: "#143026",
        line: "#234536",
        mist: "#93A89C",
        bone: "#F3FBF5",
        primary: "#2DD4CF",
        on: "#04221F",
        accent: "#E5484D",
        warn: "#E6B35A",
        emerald: "#2DD4CF",
        amber: "#E6B35A",
        crimson: "#E5484D",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        drawer: "0 20px 25px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
