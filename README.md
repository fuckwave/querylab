<div align="center">

# QueryLab

**A zero-install, in-browser PostgreSQL learning platform with AI-powered SQL assistance**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![PGlite](https://img.shields.io/badge/PGlite-PostgreSQL%20WASM-38bdf8?style=for-the-badge)](https://github.com/electric-sql/pglite)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-Edge-orange?style=for-the-badge&logo=cloudflare)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-Framework-00d4aa?style=for-the-badge)](https://hono.dev/)

**[🌐 Live Demo](https://querylab.zamdev.dev)** • **[📖 Documentation](#-documentation)** • **[🚀 Getting Started](#-quick-start)**

</div>

---

QueryLab is a full-stack application for learning SQL in your browser. It features a Monaco editor, client-side PostgreSQL execution powered by PGlite (the best engine matching standard SQL format), AI-powered SQL generation, and a beautiful mobile-first UI.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or pnpm
- DeepSeek API key (for AI features)
- Resend API key (for email verification)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/zamdevio/querylab.git
   cd querylab
   ```

2. **Set up Backend**:
   ```bash
   cd Backend
   npm install
   # Configure ENVIRONMENT in wrangler.jsonc (development or production)
   # Set secrets via .dev.vars (local) or Wrangler secrets (production)
   # See Backend/README.md for detailed setup instructions
   ```

3. **Set up Frontend**:
   ```bash
   cd Frontend
   npm install
   # Configure NEXT_PUBLIC_API_URL in .env.local or edit "DEFAULT_API_URL" in Frontend/src/lib/config.ts
   # See Frontend/README.md for detailed setup instructions
   ```

For detailed setup and deployment guides, see:
- **[Backend README](Backend/README.md)** - Backend setup, configuration, and deployment
- **[Frontend README](Frontend/README.md)** - Frontend setup, configuration, and deployment

## 📁 Project Structure

```
QueryLab/
├── Backend/              # Hono backend (Cloudflare Workers)
│   ├── src/
│   │   ├── app.ts       # Main Hono app
│   │   ├── routes/      # API routes
│   │   └── lib/         # Services and utilities
│   ├── wrangler.jsonc   # Cloudflare Workers config
│   └── README.md        # Backend documentation
│
├── Frontend/            # Next.js frontend
│   ├── app/             # Next.js App Router pages
│   ├── src/
│   │   ├── components/  # React components
│   │   └── lib/        # Utilities and clients
│   ├── public/         # Static assets
│   └── README.md       # Frontend documentation
│
└── Documentations/      # Detailed documentation (markdown files)
```

## ✨ Features

### Core Features
- 🎨 Beautiful UI with light/dark mode
- 📱 Mobile-first responsive design
- 💻 Monaco SQL editor with syntax highlighting
- 🗄️ **PGlite**: PostgreSQL compiled to WebAssembly - the best engine matching standard SQL format
- 🤖 AI-powered SQL generation and error fixing
- 💾 IndexedDB persistence for databases
- 📤 Import/Export .sql files
- ⌨️ Keyboard shortcuts (Cmd/Ctrl+Enter to run)
- 📊 Interactive schema explorer
- 🔐 Email-based authentication
- ⚡ Rate limiting and security

### Technical Highlights
- **Client-Side Execution**: All SQL runs in your browser - your data never leaves your device
- **Edge-Ready Backend**: Cloudflare Workers for global performance
- **AI Integration**: DeepSeek AI for intelligent SQL assistance
- **Modern Stack**: Next.js 16, React 19, Hono, PGlite

## 🎯 Usage

1. **Write SQL**: Type your SQL queries in the Monaco editor
2. **Run Query**: Press `Cmd/Ctrl+Enter` or click "Run Query"
3. **Ask AI**: Click "Ask AI" to generate SQL from natural language
4. **Fix Errors**: Use "Fix With AI" when you encounter SQL errors
5. **Explore Schema**: Click on tables in the schema explorer
6. **Import/Export**: Use the buttons to import or export .sql files

## 📚 Documentation

### Full Documentation

- **[Backend README](Backend/README.md)** - Complete backend setup, configuration, API reference, and deployment guide
- **[Frontend README](Frontend/README.md)** - Complete frontend setup, configuration, and deployment guide

### Detailed Guides

> 📖 **Getting Started**: See [`Documentations/getting-started.md`](Documentations/getting-started.md) for a complete beginner's guide

> 📖 **API Reference**: See [`Documentations/api-reference.md`](Documentations/api-reference.md) for detailed API documentation

> 📖 **Deployment Guide**: See [`Documentations/deployment.md`](Documentations/deployment.md) for step-by-step deployment instructions

> 📖 **Authentication**: See [`Documentations/authentication.md`](Documentations/authentication.md) for authentication flow and security details

> 📖 **Database Management**: See [`Documentations/database-management.md`](Documentations/database-management.md) for database operations guide

> 📖 **SQL Editor**: See [`Documentations/sql-editor.md`](Documentations/sql-editor.md) for SQL editor features and shortcuts

> 📖 **AI Features**: See [`Documentations/ai-features.md`](Documentations/ai-features.md) for AI-powered SQL generation and fixing

> 📖 **Troubleshooting**: See [`Documentations/troubleshooting.md`](Documentations/troubleshooting.md) for common issues and solutions

## 🛠️ Tech Stack

**Frontend:**
- Next.js 16 (App Router) + React 19
- PGlite (PostgreSQL compiled to WebAssembly)
- Monaco Editor (VS Code editor)
- Tailwind CSS
- IndexedDB

**Backend:**
- Hono (web framework)
- Cloudflare Workers (edge runtime)
- Durable Objects (state management)
- DeepSeek AI (SQL generation)
- Resend (email service)

See [Backend/README.md](Backend/README.md) and [Frontend/README.md](Frontend/README.md) for detailed tech stack information.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a PR.



