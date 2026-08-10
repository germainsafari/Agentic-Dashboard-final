import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A0A",
        inkSoft: "#3A3A3A",
        muted: "#5A5A5A",
        hairline: "#1A1A1A",
        paper: "#FFFFFF",
        subtleBg: "#F6F4EF",
        beige: "#EBDBC3",
        peach: "#F1D8BF",
        tangerine: "#FF5A3C",
        turquoise: "#00DDC2",
        gray01: "#D9D9D9",
        gray02: "#5A5A5A",
        gray03: "#B0B0B0",
      },
      fontFamily: {
        sans: [
          "Acumin Pro",
          "acumin-pro",
          "Source Sans 3",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      letterSpacing: {
        tightish: "-0.02em",
        wideish: "0.14em",
      },
      maxWidth: {
        shell: "1680px",
      },
      boxShadow: {
        page: "0 0 40px rgba(0,0,0,0.04)",
      },
      keyframes: {
        pulseDot: {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(1.15)" },
        },
      },
      animation: {
        pulseDot: "pulseDot 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
