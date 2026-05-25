/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#fff8ed',
          100: '#ffefd3',
          400: '#f59e0b',
          500: '#e07b0c',
          600: '#c4620a',
          700: '#9a4607',
          900: '#5c260a',
        },
        fuel: {
          petrol: '#3b82f6',
          diesel: '#f59e0b',
          cng:    '#10b981',
          premium:'#8b5cf6',
        }
      }
    },
  },
  plugins: [],
};
