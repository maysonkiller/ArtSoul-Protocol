// Tailwind is compiled at build time. The pages previously loaded the Play CDN
// (cdn.tailwindcss.com), which ships ~400KB of JavaScript and generates the
// stylesheet in the browser on every page load. The CDN is documented as a
// development-only tool; this config produces the same utilities as a static
// file so no CSS work happens at runtime.
module.exports = {
  content: [
    './*.html',
    './src/**/*.{js,jsx}',
    './*.js'
  ],
  theme: { extend: {} },
  // The project owns its own base styles in unified-styles.css and the pages
  // load Tailwind after them, exactly as the CDN injected it.
  plugins: []
};
