# Dynamic Pre-Processor for GitHub Copilot

**A "Middleware" Agent for VS Code Chat.**
This extension intercepts your chat prompts, uses a fast, lightweight AI model to pre-process them (formatting, sanitization, or planning), and then forwards the optimized result to your main reasoning model (like Gemini 2.5 Pro, GPT-4, etc.) for the final answer.

![Icon](logo.ico)

## 🚀 Why use this?

Standard Copilot is great, but sometimes you need to **transform data** before asking a question.
* *Example:* "Convert this JSON to TOON format before analyzing."
* *Example:* "Anonymize sensitive IDs in this log file before fixing the bug."
* *Example:* "Summarize this massive file into a plan, then ask the main model to implement it."

Instead of doing this manually in two steps, this extension automates the chain:
`User Input` -> **Mini Model (Pre-Processor)** -> **Main/Selected Model** -> `Final Answer`

## ✨ Key Features

* **⚡ Dual-Engine Architecture:** Uses a cheap/fast model (e.g., `gpt-5-mini`) for text manipulation and a heavy model (e.g., `Claude Sonnet 4.5`) for deep reasoning.
* **🧠 Smart Context Logic:**
    * **Auto-Magic Context:** If you don't select any code, it automatically reads your active editor tab.
    * **Dual-Budgeting:** Sends a concise "summary" context to the Mini model (to prevent crashes) but the **Full-Fidelity** file content to the Main model.
* **🛡️ Safety First:** Dynamic limit detection ensures you never hit "Context Window Exceeded" errors, regardless of which model you select.
* **⚙️ Fully Configurable:** You define exactly what the Pre-processor should do via settings.

## ⚙️ Configuration

Go to **Settings** (`Ctrl+,`) and search for `Pre Processor`.

| Setting | Default | Description |
| :--- | :--- | :--- |
| `preProcessor.instructions` | `""` (Empty) | **The logic.** E.g., *"Convert any JSON in the prompt to TOON format."* If left empty, the extension acts as a standard passthrough. |
| `preProcessor.fastModelFamily` | `gpt-5-mini` | The model family to use for Step 1.

## 📖 Usage

1.  Open GitHub Copilot Chat.
2.  Select your desired **Main/Selected Model** from the dropdown (e.g., Claude Sonnet 4.5).
3.  Type `@preProcessor` followed by your query.

### Example Scenario: The "TOON" Converter

1.  **Set Instructions:** In settings, set `preProcessor.instructions` to:
    > "Check if there is any JSON in the user prompt. Convert that JSON into a TOON format. Do not answer the user question yet, just output the transformed prompt."
2.  **The Prompt:**
    ```text
    @preProcessor fix the logic error in this request: { "id": 1, "active": false }
    ```
3.  **What Happens:**
    * **Step 1 (Mini Model):** Sees the JSON. Converts it to TOON. Rewrites the prompt.
    * **Step 2 (Main Model):** Receives: *"Fix the logic error in this request: [TOON Data]"* and the full context of your open file.
    * **Result:** The Main Model answers your question using the cleaned data.

## 🏗️ Architecture

```mermaid
graph LR
    A[User Input] --> B{Instructions Set?};
    B -- No --> C[Direct Pass-through];
    B -- Yes --> D[Step 1: Mini Model];
    D -- "Context (Limited)" --> E[Refine/Format Prompt];
    E --> F[Step 2: Main Model];
    C --> F;
    F -- "Context (Full Fidelity)" --> G[Final Answer];