(function() {
  'use strict';

  var MODULE_NAME = 'linagora.esn.ticketing';

  angular.module(MODULE_NAME, [
    'esn.http',
    'esn.router',
    'op.dynamicDirective',
    'restangular'
  ]);
})();