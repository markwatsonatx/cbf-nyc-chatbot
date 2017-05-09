'use strict';

const ConversationV1 = require('watson-developer-cloud/conversation/v1');
const prompt = require('prompt');
 
class MyBot {

    /**
     * Creates a new instance of MyBot.
     * @param {string} conversationUsername - The Watson Conversation username
     * @param {string} conversationPassword - The Watson Converation password
     * @param {string} conversationWorkspaceId - The Watson Conversation workspace ID
     */
    constructor(conversationUsername, conversationPassword, conversationWorkspaceId) {
        this.conversationService = new ConversationV1({
            username: conversationUsername,
            password: conversationPassword,
            version_date: '2017-04-21',
            minimum_confidence: 0.50 // (Optional) Default is 0.75
        });
        this.conversationWorkspaceId = conversationWorkspaceId;
        this.conversationContext = null;
    }

     /**
     * Runs the bot.
     */
    run() {
        prompt.start();
        this.promptUser();
    }

    /**
     * Prompts the user for the next message.
     */
    promptUser() {
        prompt.get([{name: 'message', message: 'Enter your message'}], (err, result) => {
            if (err || result.message == 'quit') {
                process.exit();
            }
            // The user's message is in result.message
            // Here we pass it to the processMessage function which will ultimately return a Promise
            // that when fulfilled contains the reply to send to the user.
            this.processMessage(result.message)
                .then((reply) => {
                    console.log('MyBot: ' + reply);
                    this.promptUser();
                });
        });
    }

    /**
     * Process the message entered by the user
     * @param {string} message - The message entered by the user
     * @returns {Promise.<string|Error>} - The reply to sent to the user if fulfilled, or an error if rejected
     */
    processMessage(message) {
        // The first step is to send the message entered by the user to Watson Conversation.
        // We send the conversationContext associated with the current user.
        // In this application there is only a single user, so we use the global conversationContext variable.
        // In a typical application you would associate the context with a user, and whenever
        // a new message is received you would look up that user based on the ID from the 
        // messaging platform (for example, the Slack ID) along with the context.
        let conversationResponse = null;
        return this.sendRequestToWatsonConversation(message, this.conversationContext)
            .then((response) => {
                conversationResponse = response;
                return this.handleResponseFromWatsonConversation(conversationResponse);
            })
            .then((reply) => {
                // Update our local conversationContext every time we receive a response from Watson Conversation.
                // This keeps track of the active dialog in the conversation.
                this.conversationContext = conversationResponse.context;
                // Reply to the user.
                return Promise.resolve(reply);
            })
            .catch((error) => {
                console.log(`Error: ${JSON.stringify(error,null,2)}`);
                let reply = 'Sorry, something went wrong!\n'
                return Promise.resolve(reply);
            });
    }

    /**
     * Sends the message entered by the user to Watson Conversation
     * along with the active Watson Conversation context that is used to keep track of the conversation.
     * @param {string} message - The message entered by the user
     * @param {object} conversationContext - The active Watson Conversation context
     * @returns {Proimse.<object|error>} - The response from Watson Conversation if fulfilled, or an error if rejected
     */
    sendRequestToWatsonConversation(message, conversationContext) {
        return new Promise((resolve, reject) => {
            var conversationRequest = {
                input: {text: message},
                context: conversationContext,
                workspace_id: this.conversationWorkspaceId,
            };
            this.conversationService.message(conversationRequest, (error, response) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(response);
                }
            });
        });
    }
    
    /**
     * Takes the response from Watson Conversation, performs any additional steps
     * that may be required, and returns the reply that should be sent to the user.
     * @param {object} conversationResponse - The response from Watson Conversation
     * @returns {Promise.<string|error>} - The reply to send to the user if fulfilled, or an error if rejected
     */
    handleResponseFromWatsonConversation(conversationResponse) {
        // In some cases we just return the response defined in Watson Conversation.
        // In others we need to take special steps to return a customized response.
        // For example, we may need to return the results of a databse lookup or 3rd party API call.
        // Here we look to see if a custom "action" has been configured in Watson Conversation and if we
        // need to return a custom response based on the action. 
        const action = conversationResponse.context.myaction;
        if (action == "xxx") {
             return this.handleXXXMessage(conversationResponse);
        }
        else {
            return this.handleGenericMessage(conversationResponse);
        }
    }

    /**
     * Returns a custom response to the user.
     * @param {object} conversationResponse - The response from Watson Conversation
     * @returns {Promise.<string|error>} - The reply to send to the user if fulfilled, or an error if rejected
     */
    handleXXXMessage(conversationResponse) {
        let reply = 'TBD';
        return Promise.resolve(reply);
    }

    /**
     * Handles a generic message from Watson Conversation, one that requires no additional steps.
     * Returns the reply that was configured in the Watson Conversation dialog.
     * @param {object} conversationResponse - The response from Watson Conversation
     * @returns {Promise.<string|error>} - The reply to send to the user if fulfilled, or an error if rejected
     */
    handleGenericMessage(conversationResponse) {
        let reply = '';
        for (let i = 0; i < conversationResponse.output.text.length; i++) {
            reply += conversationResponse.output.text[i] + '\n';
        }
        return Promise.resolve(reply);
    }
}

module.exports = MyBot;