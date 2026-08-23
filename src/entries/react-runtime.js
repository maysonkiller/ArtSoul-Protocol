import React from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot, hydrateRoot } from 'react-dom/client';

// Compatibility scripts such as artwork-card.js still expose React components
// through window. Keep them on the exact React instance used by Vite entries.
window.React = React;
window.ReactDOM = Object.assign(window.ReactDOM || {}, ReactDOM, { createRoot, hydrateRoot });

export { React, createRoot, hydrateRoot };
