// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // // Use the console to output diagnostic information (console.log) and errors (console.error)
  // // This line of code will only be executed once when your extension is activated
  // console.log('Congratulations, your extension "ghcp-buddy" is now active!');

  // vscode.version; // Get the VS Code version

  // // The command has been defined in the package.json file
  // // Now provide the implementation of the command with  registerCommand
  // // The commandId parameter must match the command field in package.json
  // const disposable = vscode.commands.registerCommand('ghcp-buddy.helloWorld', function () {
  // 	// The code you place here will be executed every time your command is executed

  // 	// Display a message box to the user
  // 	vscode.window.showInformationMessage('Hello World from GHCP Buddy!');
  // });

  // context.subscriptions.push(disposable);

  // new here
  vscode.chat.createChatParticipant(
    "vscode-preprocessor-chat",
    async (request, context, response, token) => {
      console.log(
        `printing entire request object: \n ${JSON.stringify(request)}`
      );
      const userQuery = request.prompt;

      response.progress("Analyzing the user input and modifying it before sending to GHCP....");

      const chatModels = await vscode.lm.selectChatModels({
        family: "gpt-5-mini",
      });

      // Get the instruction prompt from settings (default is defined in package.json)
      const config = vscode.workspace.getConfiguration('ghcpBuddy');
      const instructionsPrompt = config.get('enterPreprocessorPrompt');
      
      const messages = [
        vscode.LanguageModelChatMessage.User(instructionsPrompt),
        vscode.LanguageModelChatMessage.User(userQuery),
      ];

      const chatRequest = await chatModels[0].sendRequest(
        messages,
        undefined,
        token
      );

      console.log("Starting to collect converted message from gpt-5-mini...");

      // Collect the full converted message from gpt-5-mini
      let convertedMessage = "";
      for await (const chunk of chatRequest.text) {
        convertedMessage += chunk;
      }

      console.log(`Converted message length: ${convertedMessage.length}`);
      console.log(
        `Converted message preview: ${convertedMessage.substring(0, 200)}`
      );

      response.progress("Sending to your selected model...");

      // Use the user's selected model directly from the request
      const userSelectedModel = request.model;
      console.log(`User selected model: ${userSelectedModel.id}`);

      console.log("Creating initial finalMessages array...");
      const finalMessages = [
        vscode.LanguageModelChatMessage.User(convertedMessage),
      ];

      console.log(
        `Initial message created. finalMessages length: ${finalMessages.length}`
      );
      console.log(
        `Final message being sent to user selected model: \n ${JSON.stringify(
          finalMessages
        )}`
      );

      // // Process references and add their content to the request
      // if (request.references && request.references.length > 0) {
      //   console.log(`Processing ${request.references.length} references...`);
      //   for (const reference of request.references) {
      //     console.log(`Processing reference: ${JSON.stringify(reference)}`);
      //     // Show in UI which references are being used
      //     response.reference(reference);

      //     console.log(`Reference value: ${reference.value}`);
      //     // Add reference content to the messages for the model
      //     if (reference.value) {
      //       console.log(`Reference value type: ${typeof reference.value}`);
      //       if (typeof reference.value === "string") {
      //         console.log(`Processing string reference: ${reference.value}`);
      //         // It's a string reference (like repository info)
      //         const refMessage = vscode.LanguageModelChatMessage.User(
      //           `${reference.name || "Reference"}:\n${reference.value}`
      //         );
      //         console.log(`Created reference message: ${JSON.stringify(refMessage)}`);
      //         finalMessages.push(refMessage);
      //       } else if (reference.value.scheme === "file") {
      //         console.log(
      //           `Processing file reference: ${reference.value.fsPath}`
      //         );
      //         // It's a file reference (Uri object)
      //         try {
      //           const doc = await vscode.workspace.openTextDocument(
      //             reference.value
      //           );
      //           const fileContent = doc.getText();
      //           console.log(`File content length: ${fileContent.length}`);
      //           const fileMessage = vscode.LanguageModelChatMessage.User(
      //             `File: ${reference.value.fsPath}\n\n${fileContent}`
      //           );
      //           console.log(`Created file message: ${JSON.stringify(fileMessage).substring(0, 200)}`);
      //           finalMessages.push(fileMessage);
      //         } catch (error) {
      //           console.log(`Error reading file reference: ${error}`);
      //           console.error(
      //             `Failed to read reference file: ${reference.value.fsPath}`,
      //             error
      //           );
      //         }
      //       }
      //     }
      //   }
      // }

      console.log(`Total messages to send: ${finalMessages.length}`);
      console.log(
        `All messages are defined: ${finalMessages.every(
          (m) => m !== undefined
        )}`
      );

      console.log("About to send request to user selected model...");
      const finalRequest = await userSelectedModel.sendRequest(
        finalMessages,
        {},
        token
      );
      console.log("Request sent successfully!");

      // Stream the response from the user's selected model
      for await (const chunk of finalRequest.text) {
        response.markdown(chunk);
      }
    }
  );
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
