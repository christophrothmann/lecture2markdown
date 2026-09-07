# Lecture2Markdown Desktop GUI (`l2m-gui`)

High-Performance Desktop GUI for **Lecture2Markdown** built with **Tauri v2**, **Tokio Async**, **React + TypeScript**, and **TailwindCSS**.

---

## ✨ Features

- 🃏 **Native Rust `.apkg` Deck Engine**: Pure-Rust export engine (`rusqlite`, `zip`, `sha1`) creating native Anki `.apkg` packages with SQLite database (`col`, `notes`, `cards`), embedded WebP slide images, and custom Active Recall note templates.
- 🖥️ **Integrated Flashcard Inspector**: Segmented view (`Markdown`, `Split-Screen`, `🃏 Lernkarten`) with synchronized PDF slide preview, inline card editing, and 1-click launch in Anki.
- 🖼️ **Visual Image Occlusion Builder**: Draw occlusion boxes directly onto lecture diagrams and schematics for "Hide One" and "Hide All" visual recall cards.
- 🔍 **Interactive Multi-Slide Hover Preview**: Seamless preview flyout in the history sidebar that stays open when hovering into it, allowing users to scroll through slides 1, 2, and beyond.
- ⚡ **Spotlight Quick-Drop Widget (`⌘ + ⇧ + L` / `Ctrl + Shift + L`)**: Global system hotkey to convert lectures from anywhere and copy the result directly into the OS clipboard.
- 🌐 **Multi-Provider AI Ingestion**: Direct native streaming for OpenAI, Google Gemini, Anthropic Claude, and Mistral AI.
- 📁 **Multi-File Batch Queue**: Batch convert lecture decks with custom page range selectors and live queue management.
- 🌍 **Full i18n**: Seamless runtime switching between German 🇩🇪 and English 🇬🇧.

---

## 🛠️ Development & Building

### Prerequisites
- Node.js / [Bun](https://bun.sh/)
- [Rust & Cargo](https://www.rust-lang.org/)

### Setup & Launch
```bash
# Install frontend dependencies
bun install

# Run in desktop development mode (Hot-Reload)
bun run tauri dev
```

### Production Build
```bash
# Run unit tests
bun test

# Build desktop application bundle (.dmg / .app on macOS, .msi / .exe on Windows)
bun run tauri build
```
