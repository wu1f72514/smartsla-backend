'use strict';

const chai = require('chai');
const path = require('path');
const EsConfig = require('esn-elasticsearch-configuration');
const Q = require('q');
const fs = require('fs');
const _ = require('lodash');
const testConfig = require('../config/servers-conf');
const basePath = path.resolve(__dirname + '/../../node_modules/linagora-rse');
const backendPath = path.normalize(__dirname + '/../../backend');
const MODULE_NAME = 'smartsla-backend';
const { INDICES } = require('../../backend/lib/constants');
let rse;
let getEsConfig;

before(function(done) {
  chai.use(require('chai-shallow-deep-equal'));
  chai.use(require('sinon-chai'));
  chai.use(require('chai-as-promised'));

  this.testEnv = {
    serversConfig: testConfig,
    basePath: basePath,
    backendPath: backendPath,
    fixtures: path.resolve(basePath, 'test/midway-backend/fixtures'),
    mongoUrl: testConfig.mongodb.connectionString,
    initCore(callback) {
      rse.core.init(() => { callback && process.nextTick(callback); });
    }
  };

  process.env.NODE_CONFIG = 'test/config';
  process.env.NODE_ENV = 'test';
  process.env.REDIS_HOST = 'redis';
  process.env.REDIS_PORT = 6379;
  process.env.AMQP_HOST = 'rabbitmq';
  process.env.ES_HOST = 'elasticsearch';

  rse = require('linagora-rse');
  this.helpers = {};

  this.testEnv.core = rse.core;
  this.testEnv.moduleManager = rse.moduleManager;
  rse.test.helpers(this.helpers, this.testEnv);
  rse.test.moduleHelpers(this.helpers, this.testEnv);
  rse.test.apiHelpers(this.helpers, this.testEnv);

  const manager = this.testEnv.moduleManager.manager;
  const nodeModulesPath = path.normalize(
    path.join(__dirname, '../../node_modules/')
  );
  const nodeModulesLoader = manager.loaders.filesystem(nodeModulesPath, true);
  const loader = manager.loaders.code(require('../../index.js'), true);

  manager.appendLoader(nodeModulesLoader);
  manager.appendLoader(loader);
  loader.load(MODULE_NAME, done);
});

before(function(done) {
  const self = this;

  self.helpers.modules.initMidway(MODULE_NAME, function(err) {
    if (err) {
      return done(err);
    }
    const ticketingApp = require(self.testEnv.backendPath + '/webserver/application')(self.helpers.modules.current.deps);
    const api = require(self.testEnv.backendPath + '/webserver/api')(self.helpers.modules.current.deps, self.helpers.modules.current.lib.lib);

    ticketingApp.use(require('body-parser').json());
    ticketingApp.use('/ticketing/api', api);

    self.app = self.helpers.modules.getWebServer(ticketingApp);
    self.lib = self.helpers.modules.current.lib.lib;
    self.lib.start(err => done(err));
  });
});

before(function() {
  this.helpers.initUsers = (users = []) => {
    const promises = users.map(user => this.lib.user.create(user));

    return Q.all(promises);
  };
});

before(function() {
  const esConfigPath = path.normalize(`${__dirname}/../../config/elasticsearch/`);
  const esConfigs = Object.values(INDICES).map(index => {
    if (fs.existsSync(path.resolve([esConfigPath, index.type, '.json'].join('')))) {
      return {
        type: index.type,
        esConfig: new EsConfig({ host: testConfig.elasticsearch.host, port: testConfig.elasticsearch.port, path: esConfigPath })
      };
    }

    return {
      type: index.type,
      esConfig: new EsConfig({ host: testConfig.elasticsearch.host, port: testConfig.elasticsearch.port })
    };
  });

  getEsConfig = type => _.find(esConfigs, { type }).esConfig;
});

beforeEach(function(done) {
  Q.all(Object.values(INDICES).map(index => getEsConfig(index.type).setup(index.name, index.type)))
    .then(() => done())
    .catch(err => {
      console.error('Error while creating ES configuration, but launching tests...', err);
      done();
    });
});

afterEach(function(done) {
  const esnConf = new EsConfig(testConfig.elasticsearch);

  Q.all(Object.values(INDICES).map(index => esnConf.deleteIndex(index.name)))
    .then(() => done())
    .catch(err => {
      console.error('Error while clear ES indices', err);
      done();
    });
});
