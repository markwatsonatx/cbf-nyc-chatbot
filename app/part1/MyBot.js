'use strict';

const ConversationV1 = require('watson-developer-cloud/conversation/v1');
const prompt = require('prompt');
 
class MyBot {

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
     * Starts the bot.
     */
    run() {
        prompt.start();
        this.promptUser();
    }

    promptUser() {
        prompt.get([{name: 'message', message: 'Enter your message'}], (err, result) => {
            if (err || result.message == 'quit') {
                process.exit();
            }
            this.processMessage(result.message)
                .then((reply) => {
                    console.log('MyBot: ' + reply);
                    this.promptUser();
                });
        });
    }

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
                // Update our local conversationContext every time we receive a response
                // from Watson Conversation. This keeps track of the active dialog in the conversation.
                this.conversationContext = conversationResponse.context;
                // Reply to the user
                return Promise.resolve(reply);
            })
            .catch((error) => {
                console.log(`Error: ${JSON.stringify(error,null,2)}`);
                let reply = 'Sorry, something went wrong!\n'
                return Promise.resolve(reply);
            });
    }

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
     * Takes the initial response from Watson Conversation, performs any
     * additional steps that may be required, and updates the response to include
     * the reply that should be sent to the user.
     * @param {Object} conversationResponse - The initial response from Watson Conversation
     */
    handleResponseFromWatsonConversation(conversationResponse) {
        // Every dialog in our workspace has been configured with a custom "action".
        // that is sent in the Watson Conversation context
        // In some cases we need to take special steps and return a customized response
        // for an action (for example, return a the response of a 3rd party API call) 
        // In other cases we'll just return the response configured in the Watson Conversation dialog
        const action = conversationResponse.context.action;
        if (action == "xxx") {
            return this.handleXXXMessage(conversationResponse);
        }
        else {
            return this.handleGenericMessage(conversationResponse);
        }
    }

    /**
     * Handles a generic message from Watson Conversation, one that requires no additional steps
     * Returns the reply that was configured in the Watson Conversation dialog
     * @param {Object} conversationResponse - The response from Watson Conversation
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