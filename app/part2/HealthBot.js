'use strict';

const ConversationV1 = require('watson-developer-cloud/conversation/v1');
const SlackBot = require('slackbots');
const WebSocketBotServer = require('./WebSocketBotServer');
const Foursquare = require('foursquarevenues');
 
class HealthBot {

    constructor(userStore, dialogStore, conversationUsername, conversationPassword, conversationWorkspaceId, foursquareClientId, foursquareClientSecret, slackToken, httpServer) {
        this.userStore = userStore;
        this.dialogStore = dialogStore;
        this.dialogQueue = [];
        this.conversationService = new ConversationV1({
            username: conversationUsername,
            password: conversationPassword,
            version_date: '2017-04-21',
            minimum_confidence: 0.50 // (Optional) Default is 0.75
        });
        this.conversationWorkspaceId = conversationWorkspaceId;
        if (foursquareClientId && foursquareClientSecret) {
            this.foursquareClient = Foursquare(foursquareClientId, foursquareClientSecret);
        }
        this.slackToken = slackToken;
        this.httpServer = httpServer;
    }

     /**
     * Starts the bot, initializing the necessary databases, botkit controllers, etc.
     */
    run() {
        Promise.all([
            this.userStore.init(),
            this.dialogStore.init()
        ])
            .then(() => {
                if (this.slackToken) {
                    this.initSlackBot();
                }
                if (this.httpServer) {
                    this.initWebSocketBot();
                }
            })
            .catch((error) => {
                console.log(`Error: ${error}`);
                process.exit();
            });
    }

    /**
     * Initializes the Slack Bot
     */
    initSlackBot() {
        this.slackBot = new SlackBot({
            token: this.slackToken,
            name: 'bot'
        });
        this.slackBot.on('start', () => {
            console.log('Slackbot running.')
        });
        this.slackBot.on('message', (data) => {
            if (data.type == 'message' && data.channel.startsWith('D')) {
                if (!data.bot_id) {
                    let messageSender = data.user;
                    let message = data.text;
                    this.processMessage(messageSender, message)
                        .then((reply) => {
                            this.slackBot.postMessage(data.channel, reply.text, {});
                        });
                }
                else {
                    // ignore messages from the bot (messages we sent)
                }
            }
        });       
    }

    /**
     * Initializes the bot that will be used for clients connecting via WebSockets.
     */
    initWebSocketBot() {
        this.webSocketBotServer = new WebSocketBotServer();
        this.webSocketBotServer.start(this.httpServer);
        this.webSocketBotServer.on('start', () => {
            console.log('WebSocketBotServer running.')
        });
        this.webSocketBotServer.on('connected', (client) => {
            client.on('disconnect', (message) => {
                // Clean up, if necessary
            });
            client.on('message', (message) => {
                this.onWebSocketClientMessage(client, message)
            });
        });
    }

    onWebSocketClientMessage(client, msg) {
        if (msg.type == 'ping') {
            client.send({type: 'ping'});
        }
        else {
            let messageSender = msg.userId;
            let message = msg.text;
            this.processMessage(messageSender, message)
                .then((reply) => {
                    var replyMsg = {
                        type: 'msg',
                        text: reply.text,
                        watsonData: reply.conversationResponse
                    };
                    client.send(replyMsg);
                });
        }
    }

    getOrCreateUserInMemory(messageSender) {
        return new Promise((resolve, reject) => {
            if (! this.userMap) {
                this.userMap = {};
            }
            var user = this.userMap[messageSender];
            if (!user) {
                user = {
                    _id: messageSender
                };
                this.userMap[messageSender] = user;
                console.log(`Created new user with ID ${user._id}.`);
            }
            else {
                console.log(`User with ID ${user._id} already exists.`);
            }
            resolve(user);
        });
    }

    /**
     * Retrieves ID of the user doc in the Cloudant database associated
     * with the current user interacting with the bot
     * First checks if the user is stored in Cloudant
     * If not, creates the user in Cloudant
     * @param {string} messageSender - The ID of the user from the messaging platform (Slack ID, or unique ID associated with the WebSocket client) 
     */
    getOrCreateUserInCloudant(messageSender) {
        return this.userStore.addUser(messageSender);
    }

    getOrCreateUser(messageSender) {
        return this.getOrCreateUserInCloudant(messageSender);
    }

    updateUserWithWatsonConversationContextInMemory(user, context) {
        return new Promise((resolve, reject) => {
            user.conversationContext = context;
            resolve(user);
        });
    }

    updateUserWithWatsonConversationContextInCloudant(user, context) {
        return this.userStore.updateUser(user, context);
    }

    updateUserWithWatsonConversationContext(user, context) {
        return this.updateUserWithWatsonConversationContextInCloudant(user, context);
    }

    /**
     * Retrieves ID of the active conversation doc in the Cloudant log database for the current user
     * If this is the start of a new converation then a new document is created in Cloudant,
     * and the ID of the document is associated with the Watson Conversation context
     * @param {string} user - The active user
     * @param {Object} conversationResponse - The response from Watson Conversation
     */
    getOrCreateActiveConversationId(user, conversationResponse) {
        const newConversation = conversationResponse.context.newConversation;
        if (newConversation) {
            conversationResponse.context.newConversation = false;
            return this.dialogStore.addConversation(user._id)
                .then((conversationDoc) => {
                    conversationResponse.context.conversationDocId = conversationDoc.id;
                    return Promise.resolve(conversationDoc.id);
                });
        }
        else {
            return Promise.resolve(conversationResponse.context.conversationDocId);
        }
    }

    processMessage(messageSender, message) {
        let user = null;
        let conversationResponse = null;
        let reply = null;
        console.log('Getting user...');
        return this.getOrCreateUser(messageSender)
            .then((u) => {
                user = u;
                console.log('Sending request to Watson Conversation...');
                return this.sendRequestToWatsonConversation(message, user.conversationContext);
            })
            .then((response) => {
                conversationResponse = response;
                console.log('Processing response from Watson Conversation...');
                return this.handleResponseFromWatsonConversation(message, user, conversationResponse);
            })
            .then((replyText) => {
                reply = replyText;
                console.log('Updating user with Watson Conversation context...');
                return this.updateUserWithWatsonConversationContext(user, conversationResponse.context);
            })
            .then((u) => {
                console.log('Replying to user...');
                return Promise.resolve({conversationResponse: conversationResponse, text:reply});
            })
            .catch((error) => {
                console.log(`Error: ${JSON.stringify(error,null,2)}`);
                let reply = "Sorry, something went wrong!";
                return Promise.resolve({conversationResponse: conversationResponse, text:reply});
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
     * @param {string} message - The message sent by the user
     * @param {string} user - The user...
     * @param {Object} conversationResponse - The initial response from Watson Conversation
     */
    handleResponseFromWatsonConversation(message, user, conversationResponse) {
        // getConversationDocId will retrieve the current conversation
        // for the current user from our Cloudant log database
        // A new conversation doc is created anytime a new conversation is started
        // It will also add the conversationDocId to the Watson Conversation context
        // which is managed by Botkit and is available to us anytime a new message is sent by the user
        return this.getOrCreateActiveConversationId(user, conversationResponse)
            .then(() => {
                // Here we handle the action
                // Every dialog in our workspace has been configured with a custom "action"
                // that is sent in the Watson Conversation context
                // In some cases we need to take special steps and return a customized response
                // for an action (for example, return a list of recipes) 
                // In other cases we'll just return the response configured in the Watson Conversation dialog
                const action = conversationResponse.context.action;
                if (action == "findDoctorLocation") {
                    return this.handleFindDoctorLocationMessage(conversationResponse);
                }
                else {
                    return this.handleGenericMessage(conversationResponse);
                }
            })
            .then((reply) => {
                // Finally, we log every action performed as part of this unique conversation
                // in our Cloudant dialog database
                // Then we return the reply
                this.logDialog(
                    conversationResponse.context.conversationDocId,
                    conversationResponse.context.action,
                    message,
                    reply
                );
                return Promise.resolve(reply);
            });
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

    /**
     * Handles a generic message from Watson Conversation, one that requires no additional steps
     * Returns the reply that was configured in the Watson Conversation dialog
     * @param {Object} conversationResponse - The response from Watson Conversation
     */
    handleFindDoctorLocationMessage(conversationResponse) {
        let location = '';
        for (let i=0; i<conversationResponse.entities.length; i++) {
            if (conversationResponse.entities[0].entity == 'sys-location') {
                if (location.length > 0) {
                    location += ' ';
                }
                location += conversationResponse.entities[0].value;
            }
        }
        return new Promise((resolve, reject) => {
            let query = 'doctor';
            let params = {
                "near": location,
                "radius": 5000
            };
            this.foursquareClient.getVenues(params, function(error, venues) {
                let reply = '';
                if (error) {
                    console.log(error);
                    reply = 'Sorry, I couldn\'t find any doctors near you.';
                }
                else {
                    console.log(JSON.stringify(venues.response.venues,null,2));
                    for (var i=0; i<venues.response.venues.length; i++) {
                        if (reply.length == 0) {
                            reply += '\n';
                        }
                        reply += venues.response.venues[i].name;
                    }
                }
                resolve(reply);
            });
        });
    }

    /**
     * Logs the dialog traversed in Watson Conversation by the current user
     * to the Cloudant log database
     * @param {string} conversationDocId - The ID of the active conversation doc in Cloudant 
     * @param {string} name - The name of the dialog (action)
     * @param {string} message - The message sent by the user
     * @param {string} reply - The reply sent to the user
     */
    logDialog(conversationDocId, name, message, reply) {
        if (! conversationDocId) {
            return;
        }
        // queue up dialog to be saved asynchronously
        this.dialogQueue.push({conversationDocId: conversationDocId, name: name, message: message, reply: reply, date: Date.now()});
        if (this.dialogQueue.length > 1) {
            return;
        }
        else {
            setTimeout( () => {
                this.saveQueuedDialog();
            }, 1);
        }
    }

    saveQueuedDialog() {
        let dialog = this.dialogQueue.shift();
        let dialogDoc = {name:dialog.name, message:dialog.message, reply:dialog.reply, date:dialog.date};
        this.dialogStore.addDialog(dialog.conversationDocId, dialogDoc)
            .then(() => {
                if (this.dialogQueue.length > 0) {
                    this.saveQueuedDialog(state);
                }
            });
    }
}

module.exports = HealthBot;