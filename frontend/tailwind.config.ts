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
        // Light surfaces — semantic names preserved from the dark version
        // so we don't have to rename utilities everywhere. The VALUES are flipped.
        ink: {
          DEFAULT: "#faf8f3",     // page bg — warm cream
          50: "#ffffff",          // raised / card
          100: "#f4f2eb",         // input bg
          200: "#e8e6df",
          300: "#d4d2cb",
          400: "#a8a6a0",
        },
        bone: "#0f0f17",          // primary text — deep ink

        // Cool, modern accent palette
        accent: {
          DEFAULT: "#7c3aed",     // brand violet
          soft: "#ede9fe",        // pale lavender bg tint
          deep: "#5b21b6",
          fade: "rgba(124,58,237,0.10)",
        },
        sky: "#0ea5e9",
        mint: "#10b981",
        peach: "#fb923c",
        coral: "#fb7185",
        violet: "#0ea5e9",        // remapped so existing `text-violet` reads as cool sky
        amber: "#f59e0b",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Bricolage Grotesque", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,58,237,0.18), 0 16px 40px -14px rgba(124,58,237,0.40)",
        soft: "0 1px 2px 0 rgba(15,15,23,0.04), 0 14px 36px -18px rgba(15,15,23,0.10)",
        card: "0 1px 2px 0 rgba(15,15,23,0.04), 0 10px 30px -14px rgba(15,15,23,0.10)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(124,58,237,0.30)" },
          "50%": { boxShadow: "0 0 0 12px rgba(124,58,237,0)" },
        },
      },
      animation: {
        shimmer: "shimmer 3s linear infinite",
        float: "float 4s ease-in-out infinite",
        pulseGlow: "pulseGlow 2s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
