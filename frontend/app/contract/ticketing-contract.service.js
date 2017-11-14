(function(angular) {
  'use strict';

  angular.module('linagora.esn.ticketing')
    .factory('TicketingContractService', TicketingContractService);

  function TicketingContractService(
    $rootScope,
    $q,
    asyncAction,
    ticketingContractClient,
    TicketingUserService,
    TicketingService,
    TICKETING_CONTRACT_EVENTS
  ) {
    return {
      create: create,
      get: get,
      update: update
    };

    function get(contractId) {
      return ticketingContractClient.get(contractId)
        .then(function(response) {
          var contract = response.data;

          if (contract.manager) {
            contract.manager = _denormalizeManager(contract.manager);
          }

          if (contract.defaultSupportManager) {
            contract.defaultSupportManager = _denormalizeManager(contract.defaultSupportManager);
          }

          return contract;
        });
    }

    function create(contract) {
      if (!contract) {
        return $q.reject(new Error('Contract is required'));
      }

      var manager = angular.copy(contract.manager);
      var organization = angular.copy(contract.organization);

      TicketingService.depopulate(contract, ['manager', 'defaultSupportManager', 'organization']);
      contract.startDate = new Date();
      contract.endDate = new Date();

      var notificationMessages = {
        progressing: 'Creating contract...',
        success: 'Contract created',
        failure: 'Failed to create contract'
      };

      return asyncAction(notificationMessages, function() {
        return ticketingContractClient.create(contract);
      }).then(function(response) {
        var createdContract = response.data;

        createdContract.manager = manager;
        createdContract.organization = organization;

        $rootScope.$broadcast(TICKETING_CONTRACT_EVENTS.CONTRACT_CREATED, createdContract);
      });
    }

    function update(contract) {
      if (!contract) {
        return $q.reject(new Error('Contract is required'));
      }

      var contractToUpdate = angular.copy(contract);

      TicketingService.depopulate(contractToUpdate, ['manager', 'defaultSupportManager', 'organization']);

      var notificationMessages = {
        progressing: 'Updating contract...',
        success: 'Contract updated',
        failure: 'Failed to update contract'
      };

      return asyncAction(notificationMessages, function() {
        return ticketingContractClient.update(contractToUpdate._id, contractToUpdate);
      });
    }

    function _denormalizeManager(manager) {
      manager.displayName = TicketingUserService.buildDisplayName(manager) || manager.preferredEmail;
      manager.id = manager._id;

      return manager;
    }
  }
})(angular);
