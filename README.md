# NEX AI - Advanced AI-Powered Code Assistant

A professional desktop coding environment with integrated AI assistance, terminal, and multi-language support.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start in development mode (opens Electron + Vite dev server)
npm run dev
```

### Production Build

```bash
# Build the application
npm run build

# Start the built app
npm start

# Package as Windows installer
npm run package:win
```

## 📁 Project Structure

```
nex-ai/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── main.ts           # Window management, IPC, security
│   │   └── preload.ts        # Secure context bridge
│   └── renderer/             # React frontend
│       ├── main.tsx          # Entry point
│       ├── App.tsx           # Root component
│       ├── index.css         # Global styles + Tailwind
│       ├── store/            # Zustand state management
│       │   └── useStore.ts
│       ├── components/       # UI components
│       │   ├── TitleBar.tsx      # Custom title bar
│       │   ├── Sidebar.tsx       # Navigation sidebar
│       │   ├── FileExplorer.tsx  # File tree browser
│       │   ├── EditorPanel.tsx   # Monaco code editor
│       │   ├── ChatPanel.tsx     # AI chat interface
│       │   ├── TerminalPanel.tsx # Integrated terminal
│       │   ├── CommandPalette.tsx # Quick command menu
│       │   ├── StatusBar.tsx     # Bottom status bar
│       │   └── WelcomeScreen.tsx # Landing page
│       └── types/
│           └── electron.d.ts     # API type definitions
├── dist/                     # Build output
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.main.json
├── tailwind.config.js
└── postcss.config.js
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Command Palette |
| `` Ctrl+` `` | Toggle Terminal |
| `Ctrl+S` | Save Current File |
| `Ctrl+W` | Close Current File |

## 🛡️ Security Features

- Content Security Policy (CSP) headers
- Context isolation enabled
- Node integration disabled in renderer
- Permission blocking for unnecessary APIs
- Navigation prevention for external URLs

## 🔧 Tech Stack

- **Electron** - Desktop shell
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Monaco Editor** - Code editing (same as VS Code)
- **xterm.js** - Terminal emulation
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **Lucide React** - Icons

## 📦 Building for Distribution

```bash
# Windows NSIS installer
npm run package:win
```

The installer will be generated in the `release/` directory.
