var fs = require('fs');
var path = require('path');

var restify = require('restify');
var builder = require('botbuilder');

var config = require('./config');
var languageLibrary = require('./languageLibrary')

//=========================================================
// Bot Setup
//=========================================================

// Setup Restify Server
var server = restify.createServer();
server.use(restify.queryParser());

server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});

// Create chat bot
var connector = new builder.ChatConnector({
    appId: config.get('BOT_MicrosoftAppId'),
    appPassword: config.get('BOT_MicrosoftAppPassword')
});

// Defining the default language as english
var bot = new builder.UniversalBot(connector, {
    localizerSettings: {
        defaultLocale: "en"
    }
});
server.post('/api/messages', connector.listen());

bot.endConversationAction('cancel', 'conversation-end', { matches: /^(cancel|cancelar|ביטול)/i });

// Adding language change library to bot 
bot.library(languageLibrary.createLibrary(bot));

// Adding middleware to intercept all received messages
bot.use({
    botbuilder: function (session, next) {

        var message = session &&
            session.message &&
            session.message.text &&
            session.message.text.toLowerCase() || '';

        var restartDialog = false;
        if (message === 'go home') {
            restartDialog = true;

        // go <bot name> will redirect to that bot
        } else {

            // Find the corresponding bot
            var goBot = bots.find(function (bot) {
                return ('go ' + bot.getName().toLowerCase() == message);
            });

            if (goBot) {

                // This will ensure that the next bot will be the one requested
                session.conversationData.nextBot = goBot.getName();
                restartDialog = true;
            } else {
                next();
            }
        }

        if (restartDialog) {
            if (session.sessionState.callstack && session.sessionState.callstack.length) {
                session.cancelDialog(0, '/');
            } else {
                session.beginDialog('/');
            }
        }

    }
});

// Loop through bots in the /bots directory and add them as sub bots
function getDirectories(srcpath) {
    return fs.readdirSync(srcpath).filter(function (file) {
        return fs.statSync(path.join(srcpath, file)).isDirectory();
    });
}

var bots = [];
var botDirectories = getDirectories('./bots');
for (var dirIdx in botDirectories) {

    var dirName = botDirectories[dirIdx];
    var childBot = require('./bots/' + dirName);
    bots.push(childBot);
    bot.library(childBot.createLibrary());
}

var intents = new builder.IntentDialog();

bot.dialog('/', intents);

intents.matches(/^(home|menu)/i, "*:home");
intents.matches(/^(change language|language)/i, [languageLibrary.changeLocale]);

bot.dialog('home', [
    function (session, results) {
        session.endDialog("locale-home");
    }
]);

intents.onDefault([

    // Prompting the user to choose a language if none is selected
    function (session, args, next) {
        if (!languageLibrary.isLocaleSet(session)) {
            languageLibrary.changeLocale(session);
        }
        else {
            languageLibrary.ensureLocale(session);
            next();
        }
    },

    // Offering the user a bot to choose from
    function (session, args, next) {

        if (!session.conversationData.nextBot) {
            var botNames = bots.map(function (bot) { return bot.getName(session); });
            builder.Prompts.choice(session, 'what-to-do', botNames);
        } else {
            next();
        }
    },

    // Setting up next bot and directing to dialog
    function (session, args, next) {

        var requestedBot = session.conversationData.nextBot || args.response.entity;
        delete session.conversationData.nextBot;

        var selectedBot = bots.find(function (bot) { return bot.getName(session) == requestedBot; });
        var locale = session.preferredLocale();
        var botKey = 'locale-' + locale + '-' + requestedBot;

        if (!bot.dialog(botKey)) {
            var localeIntents = selectedBot.initialize(locale);
            bot.dialog(botKey, localeIntents);
        }

        //welcome message
        var welcomeMessage = null;
        if (selectedBot.welcomeMessage) {
            welcomeMessage = selectedBot.welcomeMessage(session);
        } else {
            welcomeMessage = "Welcome to the " + requestedBot + " bot!";
        }

        session.send(welcomeMessage);
        session.beginDialog(botKey);
    },
    function (session, args, next) {
        session.send('master-dialog-done');
    }
]);