const vscode = require("vscode");

// --- CONSTANTS & CONFIGURATION ---

// Fallback limits if API doesn't report them (in tokens)
const FALLBACK_LIMITS = {
  "gpt-4": 128000,
  "claude-3": 200000,
  "gemini-1.5": 1000000,
  flash: 1000000,
  mini: 128000,
};
// Default safe limit if completely unknown (in chars)
const SAFE_DEFAULT_CHARS = 12000;

// Performance Cap: Even if the fast model is huge, limit it to ~10k tokens
// to ensure the "Step 1" UI phase remains snappy (< 2 seconds).
const FAST_MODEL_SPEED_CAP_CHARS = 40000;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const handler = async (request, context, stream, token) => {
    try {
      // 1. CONFIGURATION
      const config = vscode.workspace.getConfiguration("preProcessor");
      const instructions = config.get("instructions");
      const fastModelQuery = config.get("fastModelFamily") || "mini";

      // 2. IDENTIFY MAIN MODEL LIMIT
      // We ask the selected model (e.g., Gemini) how much it can handle.
      const mainModelLimit = getDynamicLimit(request.model);

      // 3. CONTEXT GATHERING (The "Magic" Step)
      // We gather text from explicit references (user selections/attachments).
      // If none exist, we grab the "Active Editor" automatically.
      let rawContextData = await resolveReferences(request.references);

      if (rawContextData.length === 0) {
        // MAGIC: User didn't select anything, so let's look at what they are working on.
        const activeFile = getActiveEditorContext();
        if (activeFile) {
          rawContextData = [activeFile]; // Inject active file as context
          stream.progress("Auto-detected active file...");
        }
      }

      // 4. PREPARE DUAL CONTEXTS
      // Path A: Small context for Pre-processor (Capped for speed)
      const smallContextText = buildContextString(
        rawContextData,
        FAST_MODEL_SPEED_CAP_CHARS,
        stream,
        "Mini Model",
      );

      // Path B: Full context for Main Model (Based on actual capacity)
      const largeContextText = buildContextString(
        rawContextData,
        mainModelLimit,
        null,
        "Main Model",
      );

      let finalPromptForMainModel = "";

      // 5. LOGIC BRANCH
      if (!instructions || instructions.trim() === "") {
        // --- FAST PATH (No Instructions) ---
        // Skip the mini model entirely.
        stream.progress(
          `Passing through (Limit: ~${Math.round(mainModelLimit / 1000)}k chars)...`,
        );
        finalPromptForMainModel = combinePrompt(
          request.prompt,
          largeContextText,
        );
      } else {
        // --- SMART PATH (With Pre-processing) ---
        stream.progress("Step 1: Finding fast model...");

        // A. Find the specific fast model instance
        const models = await vscode.lm.selectChatModels({
          family: fastModelQuery,
        });
        const preProcessorModel = models.length > 0 ? models[0] : request.model;

        stream.progress(
          `Step 1: Pre-processing (${preProcessorModel.name})...`,
        );

        // B. Run Pre-processor with the "Small" Context
        const fastPrompt = combinePrompt(request.prompt, smallContextText);

        const preProcMessages = [
          vscode.LanguageModelChatMessage.User(
            `You are a Prompt Pre-processor. 
                        YOUR INSTRUCTIONS: ${instructions}
                        
                        USER INPUT:
                        """
                        ${fastPrompt}
                        """
                        
                        OUTPUT REQUIREMENT: Output ONLY the modified user query. 
                        Do NOT output the file content again.`,
          ),
        ];

        const preProcResponse = await preProcessorModel.sendRequest(
          preProcMessages,
          {},
          token,
        );

        let transformedUserQuery = "";
        for await (const fragment of preProcResponse.text) {
          transformedUserQuery += fragment;
        }

        // Show the user what happened
        stream.markdown(
          `**Pre-processor Plan:**\n> ${transformedUserQuery}\n\n---\n\n`,
        );

        // C. Merge: New Query + Big Context
        finalPromptForMainModel = combinePrompt(
          transformedUserQuery,
          largeContextText,
        );
      }

      // 6. EXECUTE MAIN MODEL
      stream.progress(`Step 2: Reasoning (${request.model.name})...`);

      const mainMessages = [
        vscode.LanguageModelChatMessage.User(finalPromptForMainModel),
      ];

      const mainResponse = await request.model.sendRequest(
        mainMessages,
        {},
        token,
      );

      for await (const fragment of mainResponse.text) {
        stream.markdown(fragment);
      }
    } catch (err) {
      handleError(err, stream);
    }

    return { metadata: { command: "" } };
  };

  const participant = vscode.chat.createChatParticipant(
    "chat.preProcessor",
    handler,
  );
  participant.iconPath = new vscode.ThemeIcon("beaker");
  context.subscriptions.push(participant);
}

/**
 * --- MAGIC HELPER: Get Active Editor Content ---
 * Returns a pseudo-reference object for the currently active file.
 */
function getActiveEditorContext() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  return {
    type: "file",
    uri: editor.document.uri,
    text: editor.document.getText(),
    header: `Active File: ${vscode.workspace.asRelativePath(editor.document.uri)}`,
  };
}

/**
 * --- HELPER: Resolve Explicit References ---
 * Reads files/selections from VS Code and returns them as raw objects.
 */
async function resolveReferences(references) {
  if (!references || references.length === 0) return [];

  const results = [];
  for (const ref of references) {
    try {
      if (ref.value instanceof vscode.Uri) {
        // File
        const fileContent = await vscode.workspace.fs.readFile(ref.value);
        results.push({
          type: "file",
          uri: ref.value,
          text: new TextDecoder().decode(fileContent),
          header: `File: ${ref.value.fsPath}`,
        });
      } else if (typeof ref.value === "object" && ref.value.uri) {
        // Selection
        const doc = await vscode.workspace.openTextDocument(ref.value.uri);
        const range =
          ref.value.range || new vscode.Range(0, 0, doc.lineCount, 0);
        results.push({
          type: "selection",
          uri: ref.value.uri,
          text: doc.getText(range),
          header: `Selection: ${ref.value.uri.fsPath}`,
        });
      }
    } catch (e) {
      console.error(`Failed to read reference: ${e}`);
    }
  }
  return results;
}

/**
 * --- HELPER: Build Context String with Limits ---
 * Stitches raw context objects together, stopping when the charLimit is reached.
 */
function buildContextString(contextItems, charLimit, stream, modelName) {
  if (!contextItems || contextItems.length === 0) return "";

  let accumulatedText = "";

  for (const item of contextItems) {
    if (accumulatedText.length >= charLimit) break;

    let textToAdd = item.text;
    const remaining = charLimit - accumulatedText.length;

    // Truncate if needed
    if (textToAdd.length > remaining) {
      textToAdd = textToAdd.substring(0, remaining) + "\n...[TRUNCATED]...";

      // Only warn if we are truncating significantly
      if (stream && remaining < item.text.length - 200) {
        stream.markdown(
          `> ⚠️ *Note:* Context for ${modelName} was truncated to fit capacity.\n\n`,
        );
      }
    }

    accumulatedText += `\n\n--- ${item.header} ---\n${textToAdd}`;
  }
  return accumulatedText;
}

/**
 * --- HELPER: Dynamic Limit Calculator ---
 */
function getDynamicLimit(model) {
  // 1. Trust API
  if (model.maxInputTokens) {
    return model.maxInputTokens * 3; // Safe chars estimation
  }

  // 2. Trust Fallback List
  const id = (model.id || "").toLowerCase();
  const family = (model.family || "").toLowerCase();

  for (const [key, limit] of Object.entries(FALLBACK_LIMITS)) {
    if (id.includes(key) || family.includes(key)) {
      return limit * 3;
    }
  }
  // 3. Default
  return SAFE_DEFAULT_CHARS;
}

function combinePrompt(query, context) {
  if (!context) return query;
  return `${query}\n\n=== CONTEXT DATA ===\n${context}`;
}

function handleError(err, stream) {
  const msg = err.message || "Unknown error";
  stream.markdown(`**Error:** ${msg}`);
  console.error(err);
}

function deactivate() {}

module.exports = { activate, deactivate };
