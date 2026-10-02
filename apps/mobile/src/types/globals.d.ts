/**
 * src/constants/theme.ts does `import '@/global.css'` so that the font CSS
 * variables exist on web. TypeScript needs to be told that a bare .css import
 * is a valid side-effect import.
 */
declare module '*.css';