import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        panel: "#0C130E",
        muted: "#181818",
        line: "#1F1F1F",
        mist: "#94A3B8",
        bone: "#E0E0E0",
        primary: "#00FF41",
        on: "#0F172A",
        accent: "#FF3333",
        warn: "#E6B325",
        emerald: "#00FF41",
        amber: "#E6B325",
        crimson: "#FF3333",
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
