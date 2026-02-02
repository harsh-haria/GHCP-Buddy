const vscode = require("vscode");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const handler = async (request, context, stream, token) => {
    // 1. LOAD CONFIGURATION
    const config = vscode.workspace.getConfiguration("preProcessor");
    const instructions = config.get("instructions"); // No default fallback here
    const fastModelQuery = config.get("fastModelFamily") || "mini";

    try {
      let finalPrompt = request.prompt;

      // CHECK: Do we have instructions?
      if (!instructions || instructions.trim() === "") {
        // CASE A: NO INSTRUCTIONS -> SKIP PRE-PROCESSING
        stream.progress(
          "Direct pass-through (No pre-processing instructions found)...",
        );

        // We keep the prompt exactly as the user typed it
        finalPrompt = request.prompt;
      } else {
        // CASE B: INSTRUCTIONS FOUND -> RUN PRE-PROCESSOR
        stream.progress("Step 1: Pre-processing with fast model...");

        // Find the fast model
        const models = await vscode.lm.selectChatModels({
          family: fastModelQuery,
        });
        const preProcessorModel = models.length > 0 ? models[0] : request.model;

        const preProcMessages = [
          vscode.LanguageModelChatMessage.User(
            `You are a Prompt Pre-processor. 
                        YOUR INSTRUCTIONS: ${instructions}
                        
                        USER INPUT: "${request.prompt}"
                        
                        OUTPUT REQUIREMENT: Output ONLY the modified user prompt. Do not add conversational filler.`,
          ),
        ];

        // Execute transformation
        const preProcResponse = await preProcessorModel.sendRequest(
          preProcMessages,
          {},
          token,
        );

        let transformedPrompt = "";
        for await (const fragment of preProcResponse.text) {
          transformedPrompt += fragment;
        }

        // Show transparency to the user
        stream.markdown(
          `**Pre-processor Output (${preProcessorModel.name}):**\n\n`,
        );
        stream.markdown(`> ${transformedPrompt}\n\n`);
        stream.markdown(`---\n\n`);

        stream.progress("Step 2: Sending to main model...");

        // Update the prompt to use the transformed version
        finalPrompt = transformedPrompt;
      }

      // FINAL STEP: EXECUTE ON MAIN MODEL
      // (Runs for both Case A and Case B)
      const mainMessages = [vscode.LanguageModelChatMessage.User(finalPrompt)];

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

function handleError(err, stream) {
  if (err.message) {
    stream.markdown(`I'm sorry, an error occurred: ${err.message}`);
  } else {
    stream.markdown(`An unexpected error occurred.`);
  }
  console.error(err);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
