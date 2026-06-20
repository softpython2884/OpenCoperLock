import type { Config } from 'tailwindcss';

// Dark-first design system with a violet accent, inspired by a clean vault UI.
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#8b5cf6', // violet-500
          hover: '#7c4dff',
          soft: 'rgba(139, 92, 246, 0.14)',
        },
        ink: {
          // near-black surfaces with a faint violet tint
          950: '#0a0a0f',
          900: '#0e0e15',
          850: '#13131c',
          800: '#191925',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
};

export default config;
