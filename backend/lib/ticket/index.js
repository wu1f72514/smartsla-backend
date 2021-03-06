'use strict';

const { DEFAULT_LIST_OPTIONS, TICKET_STATUS, EVENTS, EMAIL_NOTIFICATIONS, ALL_CONTRACTS, TICKETING_USER_TYPES, NOTIFICATIONS_TYPE } = require('../constants');
const { isSuspendedTicketState } = require('../helpers');
const { diff } = require('deep-object-diff');
const moment = require('moment-timezone');

const DEFAULT_TICKET_POPULATES = [
  { path: 'software.software' },
  { path: 'relatedContributions' }
];

module.exports = dependencies => {
  const mongoose = dependencies('db').mongo.mongoose;
  const Ticket = mongoose.model('Ticket');
  const Contract = mongoose.model('Contract');
  const email = require('../email')(dependencies);
  const contract = require('../contract')(dependencies);
  const pubsubLocal = dependencies('pubsub').local;
  const logger = dependencies('logger');
  const ticketDeletedTopic = pubsubLocal.topic(EVENTS.TEAM.deleted);
  const { computeCns } = require('../cns')(dependencies);
  const limesurvey = require('../limesurvey/limesurvey')(dependencies);

  return {
    count,
    create,
    list,
    listForContracts,
    getById,
    updateById,
    removeById,
    addEvent,
    updateRelatedContributions,
    updateState,
    setWorkaroundTime,
    setCorrectionTime
  };

  /**
   * Add event to a ticket
   *
   * Update ticket status and/or assignedTo if modified by event
   *
   * @param {Object}  ticketId - The ticket Id
   * @param {Object}  event    - The event to add
   * @return {Promise}          - Resolve on success
   */
  function addEvent(ticketId, event) {
    const set = {};

    if (event.status) {
      set.status = event.status;
    }

    if (event.target) {
      set.assignedTo = event.target;

      if (event.target.type === 'expert') {
        set.responsible = event.target;
      }
    }

    return Promise.resolve()
      .then(() => {
        if (event.isSurvey) return limesurvey.createSurvey(ticketId);
      })
      .then(survey => _updateTicket(survey));

    function _updateTicket(survey) {
      if (survey) {
        set.survey = survey;
      }

      return Ticket.findByIdAndUpdate(ticketId, { $push: { events: event }, $set: set }, { new: true })
      .exec()
      .then(modifiedTicket => {
        const noticationType = event.isPrivate ? NOTIFICATIONS_TYPE.EXPERT_ATTENDEES : NOTIFICATIONS_TYPE.ALL_ATTENDEES;

        email.send(EMAIL_NOTIFICATIONS.TYPES.UPDATED, noticationType, modifiedTicket);

        return modifiedTicket;
      });
    }
  }

  /**
   * Create ticket.
   * @param {Object}  ticket  - The ticket object
   * @param {Object}  options - The options object may contain population options
   * @return {Promise}         - Resolve on success
   */
  function create(ticket, options = {}) {
    ticket = ticket instanceof Ticket ? ticket : new Ticket(ticket);

    return Ticket.create(ticket).then(createdTicket => {
      email.send(EMAIL_NOTIFICATIONS.TYPES.CREATED, NOTIFICATIONS_TYPE.ALL_ATTENDEES, createdTicket);

      Contract.findById(createdTicket.contract)
        .exec()
        .then(contract => {
          if (moment().diff(contract.endDate) > 0) {
            email.send(EMAIL_NOTIFICATIONS.TYPES.CONTRACT_EXPIRED, NOTIFICATIONS_TYPE.EXPERT_ATTENDEES, createdTicket, contract.name);
          }
          listForContracts(createdTicket.contract, options).then(ticketsObject => {
            if (ticketsObject.size >= contract.credits) {
              email.send(EMAIL_NOTIFICATIONS.TYPES.CONTRACT_CREDITCONSUMED, createdTicket, contract.name);
            }
          });
        });

      if (options.populations) {
        return createdTicket.populate(options.populations).execPopulate();
      }

      return createdTicket;
    });
  }

  /**
   * List tickets.
   * @param {Object}  options - The options object, may contain states of ticket, requester, supportManager, supportTechnician, offset and limit
   * @return {Promise}         - Resolve on success
   */
  function list({ user, ticketingUser }, options = {}) {
    return contract.allowedContracts({ user, ticketingUser })
      .then(contract => ({ ...options, contract }))
      .then(listOptions => list(listOptions))
      .then(tickets => {
        if (ticketingUser) {
          const { type } = ticketingUser;

          if (type === TICKETING_USER_TYPES.EXPERT) {
            return tickets;
          }
        }

        return ticketsWithoutPrivateComments(tickets);
      })
      .then(addCnsToTickets);

    function list(options = {}) {
      options.populations = DEFAULT_TICKET_POPULATES.concat(options.populations || []);

      const query = buildTicketListQuery(options)
        .lean()
        .skip(+options.offset || DEFAULT_LIST_OPTIONS.OFFSET)
        .limit(+options.limit || DEFAULT_LIST_OPTIONS.LIMIT)
        .sort('-timestamps.createdAt');

      return query.exec();
    }

    function ticketsWithoutPrivateComments(tickets) {
      return (tickets || []).map(({ events, ...ticket }) => ({
        ...ticket,
        events: (events || []).filter(event => !event.isPrivate)
      }));
    }
  }

  function buildTicketListQuery(options) {
    const findOptions = {};

    if (options.contract && options.contract !== ALL_CONTRACTS) {
      findOptions.contract = { $in: options.contract };
    }
    const query = Ticket.find(findOptions);

    if (options.populations) {
      query.populate(options.populations);
    }

    return query;
  }

  function listForContracts(contracts, options = {}) {
    options.contract = contracts;

    return Promise.all([
      count(),
      list()
    ]).then(result => ({
      size: result[0],
      list: result[1]
    }));

    function count() {
      return buildTicketListQuery(options).count().exec();
    }

    function list() {
      const query = buildTicketListQuery(options)
        .lean()
        .skip(+options.offset || DEFAULT_LIST_OPTIONS.OFFSET)
        .limit(+options.limit || DEFAULT_LIST_OPTIONS.LIMIT)
        .sort('-timestamps.createdAt');

      return query.exec();
    }
  }
  /**
   * Get ticket by ID.
   * @param  {String}   ticketId - The ticket ID
   * @param {Object}    options - Db query options
   * @return {Promise}  - Resolve the found ticket
   */
  function getById(ticketId, options = {}) {
    options.populations = DEFAULT_TICKET_POPULATES.concat(options.populations || []);

    return Ticket
      .findById(ticketId)
      .populate(options.populations)
      .lean()
      .exec()
      .then(addCnsToTicket);
  }

  /**
   * Update a ticket by ID.
   * @param  {String}   ticketId  - The ticket ID
   * @param  {Object}   modified  - The modified ticket object
   * @return {Promise}            - Resolve the updated ticket
   */
  function updateById(ticketId, modified, ticketingUser) {
    return getById(ticketId)
    .then(ticket => _pushEvent(ticket, modified, ticketingUser))
    .then(({unsetValues, modified}) => {
      //Need this because we can't pass an empty object to $unset
      const updateSet = Object.keys(unsetValues).length !== 0 ? {$set: modified, $unset: unsetValues} : { $set: modified };

      return Ticket.findByIdAndUpdate(ticketId, updateSet, { new: true })
        .exec()
        .then(updatedTicket => {
          email.send(EMAIL_NOTIFICATIONS.TYPES.UPDATED, NOTIFICATIONS_TYPE.ALL_ATTENDEES, updatedTicket);

          return updatedTicket;
        });
    })
    .catch(err => logger.error(`Error while updating the ticket: ${ticketId}`, err));

    function _pushEvent(ticket, modified, ticketingUser) {
      const ticketFields = _getTicketFields(ticket);
      const modifiedTicketFields = _getTicketFields(modified);
      const changes = _getChanges(ticketFields, modifiedTicketFields);

      const unsetValues = {};

      return new Promise(resolve => {

        if (!modified.hasOwnProperty('software')) {
          unsetValues.software = 1;
        }

        if (!modified.hasOwnProperty('severity')) {
          unsetValues.severity = 1;
        }

        if (changes.length !== 0) {
          const { events } = modified;

          const event = {
            author: {
              id: ticketingUser.user,
              name: ticketingUser.name,
              type: ticketingUser.type
            },
            changes: changes
          };

          events.push(event);
          modified.events = events;

          resolve({unsetValues, modified});
        }
        resolve({unsetValues, modified});
      });

    }

    function _getTicketFields(ticket) {
      const {
        title,
        beneficiary,
        responsible,
        callNumber,
        meetingId,
        type,
        severity,
        description,
        participants,
        relatedRequests
      } = ticket;

      //TODO: Add participants, related request
      let ticketFields = Object.assign({}, { title, beneficiary, responsible, callNumber, meetingId, type, severity, description, participants, relatedRequests});

      if (ticket.software && Object.keys(ticket.software).length && ticket.software.software) {
        const software = {
          ...ticket.software,
          software: {
            _id: ticket.software.software._id.toString(),
            name: `${ticket.software.software.name} ${ticket.software.version} ${ticket.software.os}`
          }
        };

        ticketFields = {
          ...ticketFields,
          software
        };
      }

      return ticketFields;
    }

    function _getChanges(ticketFields, modifiedTicketFields) {
      const changes = [];
      const diffs = Object.entries(diff(ticketFields, modifiedTicketFields));
      const config = {
        software: 'software.name',
        beneficiary: 'name',
        responsible: 'name'
      };

      let oldValue = '';
      let newValue = '';
      let action = 'changed';

      for (const [field, value] of diffs) {
        switch (true) {
          case typeof value === 'string':
          case typeof value === 'undefined' && field === 'severity':
            oldValue = ticketFields[field] ? ticketFields[field] : '';
            newValue = value || '';
            break;
          case field === 'participants':
            oldValue = ticketFields[field] ? ticketFields[field].join(' ') : '';
            newValue = modifiedTicketFields[field] ? modifiedTicketFields[field].join(' ') : '';
            break;
          case field === 'relatedRequests':
            oldValue = ticketFields[field] ? ticketFields[field].map(related => _humanizeRelatedRequest(related)).join(', ') : '';
            newValue = ticketFields[field] ? modifiedTicketFields[field].map(related => _humanizeRelatedRequest(related)).join(', ') : '';
          break;
          case typeof value === 'object':
          case typeof value === 'undefined' && field === 'software':
            if (ticketFields[field]) {
              oldValue = config[field].split('.').reduce((o, i) => o[i], ticketFields[field]);
            }
            newValue = value ? config[field].split('.').reduce((o, i) => o[i], value) : '';
            break;
        }

        if (oldValue.length !== 0 && newValue.length === 0) {
          action = 'removed';
        } else if (oldValue.length === 0 && newValue.length !== 0) {
          action = 'added';
        } else {
          action = 'changed';
        }

        changes.push({
          field,
          oldValue,
          newValue,
          action
        });
      }

      return changes;
    }
  }

  function _humanizeRelatedRequest(relatedRequest) {
    const { link, request } = relatedRequest;

    return `${link} #${request.id}-${request.title}`;
  }

  /**
   * Update state of ticket.
   * @param  {Object}   ticket  - The ticket object
   * @param  {String}   state   - New state
   * @return {Promise}          - Resolve the updated ticket
   *
   * @deprecated The times computing aren't relevent anymore, needs update !!!
   */
  function updateState(ticket, state) {
    if (ticket.state === state) {
      return Promise.resolve(ticket);
    }

    ticket.times = ticket.times || {};

    if (state === TICKET_STATUS.SUPPORTED) {
      if (ticket.times.response === undefined) {
        // set response time
        ticket.times.response = Math.round(
          (new Date() - ticket.creation) / (1000 * 60) - (ticket.times.suspend || 0)
        ); // in minutes
      }

      if (isSuspendedTicketState(state)) {
        // accumulate suspend time
        ticket.times.suspend =
          (ticket.times.suspend || 0) + Math.round((new Date() - ticket.suspendedAt) / (1000 * 60)); // in minutes
      }
    } else if (isSuspendedTicketState(state) && !isSuspendedTicketState(ticket.state)) {
      // set suspendedAt
      ticket.times.suspendedAt = new Date();
    }

    ticket.state = state;

    return ticket.save();
  }

  /**
   * Set/unset workaround time of ticket.
   * @param  {Object}   ticket  - The ticket object
   * @param  {Boolean}  set     - Flag to determine should set or unset workaround time
   * @return {Promise}          - Resolve the updated ticket
   */
  function setWorkaroundTime(ticket, set) {
    ticket.times = ticket.times || {};

    if (set) {
      ticket.times.workaround = Math.round(
        (new Date() - ticket.creation) / (1000 * 60) - (ticket.times.suspend || 0)
      );
    } else {
      ticket.times.workaround = undefined;
    }

    return ticket.save();
  }

  /**
   * Set/unset correction time of ticket.
   * @param  {Object}   ticket  - The ticket object
   * @param  {Boolean}  set     - Flag to determine should set or unset correction time
   * @return {Promise}          - Resolve the updated ticket
   */
  function setCorrectionTime(ticket, set) {
    ticket.times = ticket.times || {};

    if (set) {
      ticket.times.correction = Math.round(
        (new Date() - ticket.creation) / (1000 * 60) - (ticket.times.suspend || 0)
      );
    } else {
      ticket.times.correction = undefined;
    }

    return ticket.save();
  }

  /**
  * Remove ticket by ID
  * @param {String}   ticketId - The software ID
  * @return {Promise}             - Resolve on success
  */
  function removeById(ticketId) {
    return Ticket.findByIdAndRemove(ticketId).then(deletedTicket => {
      if (deletedTicket) {
        ticketDeletedTopic.publish(deletedTicket);
      }

      return deletedTicket;
    });
  }

  function addCnsToTicket(ticket) {
    return Contract.findById(ticket.contract).lean().exec()
      .then(contract => {
        ticket.cns = computeCns(ticket, contract);

        return Promise.resolve(ticket);
      });
  }

  function addCnsToTickets(tickets) {
    return Promise.all(tickets.map(addCnsToTicket));
  }

  /**
   * Update ticket related contributions
   * @param {String} ticketId       - the ticket ID
   * @param {Array}  contributions  - the related contributions
   * @return {Promise}              - Resolve on success
   */
  function updateRelatedContributions(ticketId, contributions = []) {
    return Ticket
      .findByIdAndUpdate(ticketId, { $set: {relatedContributions: contributions} })
      .exec();
  }

  /**
   * Count all tickets
   * @param {Object}    - connected user
   * @param {Object}    - ticketing user
   * @return {Promise}  - Resolve on success
   */
  function count({ user, ticketingUser }) {

    return contract.allowedContracts({ user, ticketingUser })
      .then(contracts => {
        const options = {
          contract: contracts
        };

        return buildTicketListQuery(options)
          .count()
          .exec();
      });
  }
};
