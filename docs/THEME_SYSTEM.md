# Theme System Documentation

## Overview

ArtSoul uses a centralized theme management system with two themes:
- **Classic**: Dark theme with teal accents
- **Future**: Neon cyberpunk theme with purple/cyan accents

## Architecture

```
ThemeManager (Single Source of Truth)
    ├── localStorage persistence
    ├── Global application (html, body, components)
    ├── Event system for theme changes
    └── Component registration

ThemeValidator (Quality Assurance)
    ├── Validates all UI components
    ├── Reports issues (errors/warnings)
    └── Auto-fix capability
```

## Usage

### Basic Usage

```javascript
// Get current theme
const theme = ThemeManager.getTheme(); // 'classic' or 'future'

// Set theme
ThemeManager.setTheme('future');

// Toggle theme
ThemeManager.toggleTheme();

// Check if theme is active
if (ThemeManager.isTheme('classic')) {
    // Do something
}
```

### Component Registration

Register components to receive theme updates:

```javascript
ThemeManager.registerComponent('myComponent', (theme) => {
    console.log(`Theme changed to: ${theme}`);
    // Update component UI
});

// Unregister when component is destroyed
ThemeManager.unregisterComponent('myComponent');
```

### Theme Change Listeners

```javascript
// Add listener
const unsubscribe = ThemeManager.addListener((newTheme, oldTheme) => {
    console.log(`Theme changed from ${oldTheme} to ${newTheme}`);
});

// Remove listener
unsubscribe();
```

### Theme Validation

```javascript
// Create validator
const validator = new ThemeValidator(ThemeManager);

// Run validation
const passed = validator.validate();

// Get report
const report = validator.getReport();
console.log(report);
// {
//   passed: false,
//   errors: 2,
//   warnings: 5,
//   issues: [...]
// }

// Auto-fix issues
validator.autoFix();
```

## HTML Integration

### Required Scripts

```html
<head>
    <!-- Inline theme application (prevents flash) -->
    <script>
        (function() {
            const theme = localStorage.getItem('artsoul_theme') || 'classic';
            document.documentElement.className = theme;
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    document.body.className = theme;
                });
            } else {
                document.body.className = theme;
            }
        })();
    </script>
    
    <!-- Theme Manager -->
    <script src="src/ui/theme-manager.js"></script>
    <script src="src/ui/theme-validator.js"></script>
</head>
```

### Theme Toggle Buttons

```html
<button id="classicBtn" onclick="setTheme('classic')">Classic</button>
<button id="futureBtn" onclick="setTheme('future')">Future</button>
```

The `setTheme()` function is automatically available globally.

## CSS Guidelines

### Theme-Specific Styles

Use body class to scope theme styles:

```css
/* Classic theme */
body.classic {
    background: #010101;
    color: #a9ddd3;
}

body.classic .button {
    background: #a9ddd3;
    color: #010101;
}

/* Future theme */
body.future {
    background: #0a0a0a;
    color: #00f5ff;
}

body.future .button {
    background: linear-gradient(135deg, #bf00ff, #00f5ff);
    color: #ffffff;
}
```

### Component Inheritance

Components automatically inherit theme from body:

```html
<body class="classic">
    <div class="card">
        <!-- Inherits classic theme -->
    </div>
</body>
```

## Validation Rules

ThemeValidator checks:

1. **Buttons**: Must have theme class or inherit from parent
2. **Headers**: Text color must match theme (dark for classic, light for future)
3. **Dropdowns**: Must have theme class or inherit
4. **Avatar Button**: Must have theme class (critical)
5. **Network Badge**: Must have theme class (critical)
6. **Cards**: Must have theme class or inherit
7. **Modals**: Must have theme class (critical)

## Best Practices

### 1. Always Use ThemeManager

❌ **Don't:**
```javascript
document.body.className = 'future';
localStorage.setItem('artsoul_theme', 'future');
```

✅ **Do:**
```javascript
ThemeManager.setTheme('future');
```

### 2. Register Dynamic Components

If you create components dynamically, register them:

```javascript
function createCard(data) {
    const card = document.createElement('div');
    card.className = 'card';
    
    // Register for theme updates
    ThemeManager.registerComponent(`card-${data.id}`, (theme) => {
        card.classList.remove('classic', 'future');
        card.classList.add(theme);
    });
    
    return card;
}
```

### 3. Run Validation in Development

Add validation to your development workflow:

```javascript
if (process.env.NODE_ENV === 'development') {
    window.addEventListener('load', () => {
        const validator = new ThemeValidator(ThemeManager);
        validator.validate();
    });
}
```

### 4. Handle Theme Changes

Listen for theme changes in components:

```javascript
class MyComponent {
    constructor() {
        this.unsubscribe = ThemeManager.addListener((theme) => {
            this.updateTheme(theme);
        });
    }
    
    destroy() {
        this.unsubscribe();
    }
    
    updateTheme(theme) {
        // Update component for new theme
    }
}
```

## Troubleshooting

### Theme Not Applying

1. Check console for errors
2. Verify ThemeManager is loaded
3. Run validation: `window.themeValidator.validate()`
4. Check localStorage: `localStorage.getItem('artsoul_theme')`

### Mixed Styles

If you see mixed classic/future styles:

```javascript
// Run auto-fix
const validator = new ThemeValidator(ThemeManager);
validator.autoFix();
```

### Theme Flash on Load

Ensure inline script is in `<head>` before any CSS:

```html
<head>
    <script>
        (function() {
            const theme = localStorage.getItem('artsoul_theme') || 'classic';
            document.documentElement.className = theme;
        })();
    </script>
    <link rel="stylesheet" href="styles.css">
</head>
```

## API Reference

### ThemeManager

| Method | Description |
|--------|-------------|
| `init()` | Initialize theme system |
| `getTheme()` | Get current theme |
| `setTheme(theme)` | Set theme |
| `toggleTheme()` | Toggle between themes |
| `isTheme(theme)` | Check if theme is active |
| `registerComponent(name, fn)` | Register component |
| `unregisterComponent(name)` | Unregister component |
| `addListener(callback)` | Add theme change listener |
| `removeListener(callback)` | Remove listener |

### ThemeValidator

| Method | Description |
|--------|-------------|
| `validate()` | Run validation |
| `getReport()` | Get validation report |
| `autoFix()` | Auto-fix issues |

## Migration from theme-sync.js

Old code:
```javascript
window.ThemeSync.applyTheme('future');
```

New code:
```javascript
ThemeManager.setTheme('future');
```

Backward compatibility is maintained via `window.ThemeSync` alias.

---

**Status:** ✅ Production Ready  
**Version:** 1.0.0  
**Last Updated:** 2026-05-05
