'use strict';

const cloudant = require('cloudant');

/**
 * This class is used to create and initialize the Cloudant database required
 * to store Watson Conversation state.
 */
class CloudantUserStore {

    /**
     * Creates a new instance of CloudantUserStore.
     * @param {string} cloudantUrl - The url of the of cloudant instance to connect to
     * @param {string} dbName - The name of the database to use
     */
    constructor(cloudantUrl, dbName) {
        this.cloudantUrl = cloudantUrl;
        this.cloudant = cloudant({
            url: cloudantUrl,
            plugin:'promises'
        });
        this.dbName = dbName;
        this.db = null;
    }

    /**
     * Creates and initializes the database.
     * @returns {Promise.<TResult>}
     */
    init() {
        console.log('Getting user database...');
        return this.cloudant.db.list()
            .then((dbNames) => {
                let exists = false;
                for (let dbName of dbNames) {
                    if (dbName == this.dbName) {
                        exists = true;
                    }
                }
                if (!exists) {
                    console.log(`Creating user database ${this.dbName}...`);
                    return this.cloudant.db.create(this.dbName);
                }
                else {
                    return Promise.resolve();
                }
            })
            .then(() => {
                this.db = this.cloudant.db.use(this.dbName);
                return Promise.resolve();
            });
    }

    /**
     * Adds a new user to Cloudant if a user with the specified ID does not already exist.
     * @param userId - The ID of the user (Slack ID, or unique ID associated with the WebSocket client)
     * @returns {Promise.<TResult>}
     */
    addUser(userId) {
        return this.db.get(userId)
            .then((userDoc) => {
                return Promise.resolve(userDoc);
            })
            .catch((err) => {
                if (err.statusCode == 404) {
                    let doc = { _id: userId };
                    return this.db.insert(doc)
                        .then((body) => {
                            doc._id = body.id;
                            doc._rev = body.rev;
                            return Promise.resolve(doc);
                        });
                }
                else {
                    return Promise.reject(err);
                }
            });
    }

    /**
     * Adds a new user to Cloudant if a user with the specified ID does not already exist.
     * @param userId - The ID of the user (Slack ID, or unique ID associated with the WebSocket client)
     * @returns {Promise.<TResult>}
     */
    updateUser(user, context) {
        return this.db.get(user._id)
            .then((userDoc) => {
                let doc = userDoc;
                doc.conversationContext = context;
                return this.db.insert(doc)
                        .then((body) => {
                            doc._id = body.id;
                            doc._rev = body.rev;
                            doc.context = body.context;
                            return Promise.resolve(doc);
                        });
            });
    }
}

module.exports = CloudantUserStore;