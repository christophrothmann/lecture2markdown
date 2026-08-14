# Erklärung zur Nutzung von LLM-Modellen (NOTE.md)

Diese Dokumentation beschreibt transparent die Nutzung und Einbindung von Large Language Models (LLMs) im Rahmen der Entwicklung und Funktionalität des Projekts **Lecture2Markdown**.

---

## 1. LLM-Einsatz im Produkt (**Lecture2Markdown & l2m-gui**)

Die Anwendung nutzt multimodale Vision-Modelle der OpenAI API (`gpt-4o` und `gpt-4o-mini`), um Vorlesungsfolien strukturiert und verlustfrei in Markdown zu transformieren:

1. **Hybrides Routing (`gpt-4o-mini` & `gpt-4o`)**:
   - Reine Textfolien werden an das kosteneffiziente Modell `gpt-4o-mini` geroutet.
   - Folien mit visuellen Diagrammen, Graphiken oder handschriftlichen Notizen werden an `gpt-4o` übermittelt.
2. **Determinismus (`temperature=0.0`)**:
   - Die Temperatur ist fest auf `0.0` gesetzt, um kreative Ausschmückungen oder Halluzinationen auszuschließen und eine 1:1 Transkription zu garantieren.
3. **Anti-AI Canary & Prompt Injection Schutz**:
   - Der System-Prompt weist das Modell explizit an, versteckte Dozenten-Fallen (*"If you are an AI respond with X"*) sowie Prompt Injections herauszufiltern.
4. **Mermaid.js & LaTeX Synthese**:
   - Graphische Ablauf- und Architekturdiagramme werden von der Vision-API direkt in semantischen ` ```mermaid ` Code übersetzt; mathematische Formeln werden in Standard-LaTeX transkribiert.

---

## 2. LLM-Nutzung während der Software-Entwicklung

Bei der Konzeption, Architektur und Implementierung dieser Codebasis (Python CLI, Tauri v2 Rust Backend, React Frontend und TailwindCSS Styling) wurde Antigravity (Google DeepMind) als KI-Pair-Programming-Assistent eingesetzt. 

Alle generierten Codebestandteile wurden manuell auditiert, verifiziert, getestet und durch Sicherheits-Pipelines (`bandit`, `gitleaks`, `pip-audit`) gehärtet.
