<p align="center">
  <img src="assets/icon.png" alt="Lecture2Markdown Icon" width="120" height="120" style="border-radius: 24px;" />
</p>

<h1 align="center">Lecture2Markdown</h1>

<p align="center">
  <strong>Convert academic PDF lecture slides into clean, structured, and LLM-optimized Markdown</strong>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.10%2B-blue" alt="Python Version"></a>
  <a href="https://github.com/astral-sh/uv"><img src="https://img.shields.io/badge/package%20manager-uv-de5b43.svg" alt="Package Manager: uv"></a>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Desktop%20App-Tauri%20v2-24C8D8.svg?logo=tauri&logoColor=white" alt="Tauri v2"></a>
</p>

A high-performance tool designed to convert academic PDF lecture slides into clean, structured, and LLM-optimized Markdown using leading Multimodal Vision APIs (OpenAI, Gemini, Claude, Mistral).

Specially engineered for students and researchers to upload lecture content into ChatGPT, Claude, Notion, or Obsidian with **zero hallucinations** and maximum context fidelity.

---

## 🎬 Demo

https://github.com/user-attachments/assets/5054e824-ed83-4a9d-9486-140a4f571a28

---

## ✨ Features

- 🌐 **Multi-Provider Support**: Choose between 4 leading multimodal AI providers:
  - **OpenAI**: `gpt-4o` & `gpt-4o-mini` (with adaptive detail tiling)
  - **Google Gemini**: `gemini-pro-latest` & `gemini-flash-latest` (with 15-RPM pacing rate limiter)
  - **Anthropic Claude**: `claude-3-7-sonnet` & `claude-3-5-haiku`
  - **Mistral AI**: `mistral-ocr-latest` (dedicated document OCR) & `pixtral-12b`
- 🖥️ **Pure-Rust Native Desktop GUI (`l2m-gui`)**: High-performance desktop application built with **Tauri v2**, **Tokio Async**, **React + TypeScript**, and **TailwindCSS** with 1-click provider switching.
- ⚡ **Content-Addressed Slide Cache (SHA-256)**: Instant 0 ms slide cache with 180-day TTL — re-converting previously seen slides costs 0.00 € and requires 0 API tokens.
- 🔀 **Smart Hybrid Routing**: Intelligent visual complexity heuristic that automatically routes text-heavy slides to fast mini/flash models and dense figures to high-end vision models.
- 📊 **Real-Time Progress & LiteLLM Cost Calculator**: Live slide-by-slide progress streaming, live in-progress history entries, dynamic cost estimation, and instant conversion cancellation.
- 🏷️ **Explicit Slide Anchors (`## [Folie X]`)**: Structures every slide with explicit anchors so you can reference specific slides directly in ChatGPT prompts.
- 📊 **Mermaid.js Diagram Synthesis**: Converts flowcharts, state machines, and architecture diagrams into native, editable ` ```mermaid ` code blocks instead of static images.
- 📐 **LaTeX Formula Extraction**: Automatically translates all mathematical equations into standard inline (`$...$`) or block (`$$...$$`) LaTeX.
- 🛡️ **Anti-AI Canary & Prompt Injection Hardened**: Built-in security rules strip out hidden text, white-on-white professor trap instructions (*"If you are an AI respond with X"*), and prompt injection vectors.
- 🎯 **100% Deterministic Output**: Runs at `temperature=0.0` to eliminate creative hallucination and guarantee strict transcription fidelity.

---

## 🛠️ Installation & Setup

### Prerequisites
- Python 3.10 or higher
- An OpenAI API Key (`OPENAI_API_KEY`)
- [uv](https://github.com/astral-sh/uv) (Recommended package manager)

### 1. Install `uv` (if not already installed)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Set Up Virtual Environment & Dependencies
```bash
# Clone the repository
git clone https://github.com/christophrothmann/lecture2markdown.git
cd lecture2markdown

# Initialize virtualenv and install dependencies
uv venv
uv pip install -r requirements.txt
```

### 3. Configure API Key
Create a `.env` file in the project root:
```bash
cp .env.example .env
```
Open `.env` and add your OpenAI API Key:
```env
OPENAI_API_KEY=sk-proj-your-actual-api-key-here
```

---

## 🚀 Quick Start
 
 ### Option A: Native Desktop GUI
 1. Navigate to the GUI folder and install dependencies with `bun`:
    ```bash
    cd l2m-gui
    bun install
    ```
 2. Launch the desktop application:
    ```bash
    bun run tauri dev
    ```
 3. Drag and drop your lecture PDF, enter your OpenAI API key in the onboarding modal, and click **"Konvertierung starten"**!

 ### Option B: Python CLI
 1. **Place your PDF slide deck** in the `lectures/` directory (e.g., `lectures/input-2.pdf`).
 2. **Run the converter** using `uv run`:
    ```bash
    uv run python lecture2md.py
    ```
 3. **Find your converted Markdown** in the `output/` directory (e.g., `output/output-2.md`).

---

## ⚙️ Configuration Options

You can easily adjust project parameters directly at the top of `lecture2md.py`:

```python
DEFAULT_MODEL = "gpt-4o"          # Primary vision model for complex diagrams
FAST_MODEL = "gpt-4o-mini"        # Fast, cost-efficient model for text slides
ENABLE_HYBRID_ROUTING = True      # Enable automatic cost-saving model selection
LECTURES_DIR = "lectures"         # Folder for input PDFs
OUTPUT_DIR = "output"             # Folder for output Markdown files
INPUT_PDF_FILENAME = "input.pdf" # Input PDF filename
OUTPUT_MD_FILENAME = "output.md" # Output Markdown filename
DPI = 200                         # Image rendering resolution for Vision API
MAX_WORKERS = 3                   # Concurrent parallel slide workers
```

---

## ⚖️ Legal Disclaimer & Copyright Notice

> [!WARNING]
> **Important Notice on Copyright & Fair Use:**
> 
> 1. **User Responsibility**: University lecture slides, textbooks, and academic materials are generally protected by copyright law and intellectual property rights owned by professors, universities, or academic publishers. Users are solely responsible for ensuring they possess the appropriate legal rights, permissions, or applicable statutory exceptions (such as personal study or fair use) to process and convert third-party documents.
> 2. **Personal Study Use Only**: Converted Markdown files generated by this tool should be used strictly for private study, non-commercial personal reference, and individual learning workflows. Do not publicly redistribute or re-publish copyrighted lecture materials without explicit written consent from the copyright holder.
> 3. **Limitation of Liability**: The authors and contributors of `Lecture2Markdown` assume no liability or responsibility for any misuse, unauthorized distribution, or copyright infringement committed by end users of this software.

---

## 📂 Project Structure

```
lecture2markdown/
├── .github/
│   └── workflows/
│       └── release.yml        # CI/CD Release & Security Pipeline
├── lectures/
│   └── .gitkeep               # Place your PDF slides here
├── output/
│   └── .gitkeep               # Converted Markdown outputs appear here
├── .env.example               # Example API key template
├── .gitignore                 # Excludes secrets, virtual environments & PDFs
├── CHANGELOG.md               # Version history
├── LICENSE                    # MIT Open-Source License
├── MODULES.md                 # Technical code and function documentation
├── NOTE.md                    # LLM usage attribution
├── lecture2md.py              # Main Python converter script
├── pyproject.toml             # Project build configuration
├── requirements.txt           # Python dependency requirements
└── README.md                  # Project documentation
```

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/christophrothmann/lecture2markdown/issues).
