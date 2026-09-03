/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        nex: {
          bg: '#0a0a0f',
          surface: '#12121a',
          card: '#1a1a2e',
          border: '#2a2a3e',
          'border-light': '#3a3a5e',
          accent: '#6c5ce7',
          'accent-light': '#a29bfe',
          'accent-glow': 'rgba(108, 92, 231, 0.3)',
          success: '#00d2d3',
          warning: '#feca57',
          error: '#ff6b6b',
          text: '#e2e8f0',
          'text-dim': '#8892a4',
          'text-muted': '#4a5568',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'typing': 'typing 1.5s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 5px rgba(108, 92, 231, 0.2)' },
          '50%': { boxShadow: '0 0 20px rgba(108, 92, 231, 0.4)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'typing': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
    },
  },
  plugins: [],
};
