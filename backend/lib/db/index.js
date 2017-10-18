'use strict';

module.exports = dependencies => {

  const Organization = require('./organization')(dependencies);
  const Contract = require('./contract')(dependencies);
  const Order = require('./order')(dependencies);
  const TicketingUserRole = require('./ticketing-user-role')(dependencies);

  return {
    Organization,
    Contract,
    Order,
    TicketingUserRole
  };
};
