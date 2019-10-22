module.exports = dependencies => {
  const emailModule = dependencies('email');
  const userModule = dependencies('coreUser');
  const esnConfig = dependencies('esn-config');

  const logger = dependencies('logger');
  const { EMAIL_NOTIFICATIONS } = require('../constants');
  const i18n = require('../i18n')(dependencies);

  return {
    send
  };

  function formatMessage(type, ticket, event, frontendUrl) {
    let ticketUrl = '';

    try {
      ticketUrl = new URL(`requests/${ticket._id}`, frontendUrl).toString();
    } catch (e) {
      logger.warn(`Invalid ticket url, please check that linagora.esn.ticketing.frontendUrl configuration is set with a valid url (current url: ${frontendUrl})`, e);
    }
    const messageBody = i18n.__('Issue #{{id}} is available here: ', { id: ticket._id }) + ticketUrl;

    switch (type) {
      case EMAIL_NOTIFICATIONS.TYPES.CREATED: {
        const subject = i18n.__('#{{id}} {{title}}: issue #{{id}} has been created',
          { id: ticket._id, title: ticket.title });

        return {
          subject: subject,
          text: messageBody
        };
      }
      case EMAIL_NOTIFICATIONS.TYPES.UPDATED: {
        if (event.status) {
          const translatedStatus = i18n.__(event.status);
          const subject = i18n.__('#{{id}} {{title}}: issue #{{id}} has been changed to {{status}}',
            { id: ticket._id, title: ticket.title, status: translatedStatus });

          return {
            subject: subject,
            text: messageBody
          };
        }

        if (event.target) {
          const subject = i18n.__('#{{id}} {{title}}: issue #{{id}} has been assigned to {{assignee}}',
            { id: ticket._id, title: ticket.title, assignee: ticket.assignedTo.name });

          return {
            subject: subject,
            text: messageBody
          };
        }

        if (event.comment) {
          const subject = i18n.__('#{{id}} {{title}}: issue #{{id}} has been commented by {{commenter}}',
            { id: ticket._id, title: ticket.title, commenter: event.author.name });

          return {
            subject: subject,
            text: messageBody
          };
        }
      }
    }
  }

  function getRecipients(ticket) {
    const to = [];
    const cc = [];

    ticket.author && ticket.author.email && to.push(ticket.author.email);

    if (ticket.responsible && ticket.responsible.email) {
      to.push(ticket.responsible.email);
    } else {
      to.push(EMAIL_NOTIFICATIONS.DEFAULT_RESPONSIBLE_EMAIL);
    }

    cc.concat(ticket.participants);

    return { to: to, cc: cc };
  }

  function send(type, ticket, event) {
    return esnConfig('frontendUrl').inModule('linagora.esn.ticketing').get()
      .then(frontendUrl => {
        userModule.get(ticket.author.id, (err, user) => {
          if (err || !user) {
            return logError(err || `User ${ticket.author.id} not found`);
          }

          const message = formatMessage(type, ticket, event, frontendUrl);

          if (!message) {
            return;
          }

          const recipents = getRecipients(ticket);

          message.to = recipents.to;
          message.cc = recipents.cc;
          message.from = EMAIL_NOTIFICATIONS.DEFAULT_FROM;

          return emailModule.getMailer(user).send(message, logError);
        });
      })
      .catch(logError);
  }

  function logError(err) {
    if (err) {
      logger.error('Unable to send notification email', err);
    }
  }
};