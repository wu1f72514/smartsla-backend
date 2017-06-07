(function() {
  'use strict';

  angular.module('linagora.esn.ticketing')
    .controller('ticClientAddController', ticClientAddController);

  function ticClientAddController($state, ticNotificationFactory, ticClientApiService, ticClientLogoService) {
    var self = this;

    self.createClient = createClient;
    initClient();

    ////////////

    function initClient() {
      // self.client must be initialized to make logo picker work.
      self.client = {
        is_active: true
      };
    }

    function createClient() {
      if (self.form && self.form.$invalid) {
        return ticNotificationFactory.weakError('Error', 'Client is not valid');
      }

      ticClientLogoService.handleLogoUpload(self.client)
        .then(ticClientApiService.createClient)
        .then(function() {
          $state.go('ticketing.client-view', {clientId: self.client._id, client: self.client});

          ticNotificationFactory.weakInfo('Success', 'Client Created');
        }, function(response) {
          var error = response.data.error;

          ticNotificationFactory.weakError('Error', error.message);
        });
    }
  }
})();
